import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname } from "node:path";
import { inflateSync } from "node:zlib";

import { address, getAddressDecoder, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import bs58 from "bs58";

import { fetchAccounts } from "./accounts.js";
import { status } from "../utils/diagnostics.js";

const IDL_SEED = "anchor:idl";
const HEADER_LEN = 44;
export const IDL_FETCH_BATCH = 100;

const encodeAddress = getAddressEncoder();
const decodeAddress = getAddressDecoder();

function isPubkey(text) {
  try {
    return bs58.decode(text).length === 32;
  } catch {
    return false;
  }
}

export function parseProgramId(text) {
  const id = String(text ?? "").trim();
  if (!isPubkey(id)) {
    throw new Error(`Invalid program ID: ${id}`);
  }
  return id;
}

/**
 * Anchor IDL account: `createWithSeed(findProgramAddress([], program), "anchor:idl", program)`.
 */
export async function idlAccountAddress(programId) {
  const program = address(parseProgramId(programId));
  const [base] = await getProgramDerivedAddress({ programAddress: program, seeds: [] });
  const hash = createHash("sha256");
  hash.update(encodeAddress.encode(base));
  hash.update(IDL_SEED);
  hash.update(encodeAddress.encode(program));
  return decodeAddress.decode(hash.digest());
}

/**
 * Anchor IDL account body: 8-byte discriminator, 32-byte authority, u32 length, zlib JSON.
 * Returns the decompressed JSON text.
 */
export function parseIdlAccount(data) {
  const bytes = Buffer.from(data);
  if (bytes.length < HEADER_LEN) {
    throw new Error(`IDL account data too short: ${bytes.length} bytes (expected at least 44)`);
  }
  const length = bytes.readUInt32LE(40);
  if (bytes.length < HEADER_LEN + length) {
    throw new Error(`IDL account data truncated: has ${bytes.length} bytes, expected 44 + ${length}`);
  }
  try {
    return inflateSync(bytes.subarray(HEADER_LEN, HEADER_LEN + length)).toString("utf8");
  } catch (error) {
    throw new Error(`Failed to decompress IDL data: ${error.message}`);
  }
}

/**
 * Fetch IDL JSON for each program. A missing account is `{ idl: null }`.
 * An RPC or parse failure is `{ error }` and does not fail the other programs.
 */
export async function fetchIdlAccounts(rpc, programIds, batchSize = IDL_FETCH_BATCH) {
  const derived = await Promise.all(
    programIds.map(async (programId) => ({ programId, idlAddress: await idlAccountAddress(programId) })),
  );
  const size = Math.max(1, batchSize);
  const results = new Array(derived.length);
  for (let start = 0; start < derived.length; start += size) {
    const chunk = derived.slice(start, start + size);
    status(`Fetching IDL accounts (${start + 1}/${derived.length}) ...`);
    let accounts;
    try {
      accounts = await fetchAccounts(
        rpc,
        chunk.map((item) => item.idlAddress),
      );
    } catch (error) {
      chunk.forEach((item, offset) => {
        results[start + offset] = { programId: item.programId, idl: null, error };
      });
      continue;
    }
    chunk.forEach((item, offset) => {
      const account = accounts[offset];
      if (!account) {
        results[start + offset] = { programId: item.programId, idl: null, error: null };
        return;
      }
      try {
        results[start + offset] = { programId: item.programId, idl: parseIdlAccount(account.data), error: null };
      } catch (error) {
        results[start + offset] = { programId: item.programId, idl: null, error };
      }
    });
  }
  return results;
}

/** Program IDs named by `<PROGRAM_ID>.json` files, plus the directory those files live in. */
export function programIdsFromSyncPath(path) {
  if (!existsSync(path)) {
    throw new Error(`Sync path does not exist or is not readable: ${path}`);
  }
  const info = statSync(path);
  if (info.isDirectory()) {
    const programIds = readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isFile() && extname(entry.name) === ".json" && isPubkey(basename(entry.name, ".json")))
      .map((entry) => basename(entry.name, ".json"));
    if (programIds.length === 0) {
      throw new Error(`No valid IDL files found in directory: ${path}`);
    }
    return { programIds, outputDir: path };
  }
  if (info.isFile()) {
    if (extname(path) !== ".json") {
      throw new Error(`Sync file must be a .json file named <PROGRAM_ID>.json: ${path}`);
    }
    const stem = basename(path, ".json");
    if (!isPubkey(stem)) {
      throw new Error(`Sync file name must be <PROGRAM_ID>.json, got invalid pubkey stem: ${stem}`);
    }
    return { programIds: [stem], outputDir: dirname(path) };
  }
  throw new Error(`Sync path does not exist or is not readable: ${path}`);
}

/** `-o`, then the sync source directory, then `TENET_IDL_DIR`, then the working directory. */
export function resolveIdlOutputDir(explicit, syncDir = null) {
  if (explicit) {
    return explicit;
  }
  if (syncDir) {
    return syncDir;
  }
  const env = process.env.TENET_IDL_DIR?.trim();
  if (env) {
    return env;
  }
  return ".";
}
