import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import bs58 from "bs58";

import { decodeIdlArgs } from "./idl-args.js";

const DISCRIMINATOR_LEN = 8;

function isPubkey(text) {
  try {
    return bs58.decode(text).length === 32;
  } catch {
    return false;
  }
}

function splitSpec(spec) {
  if (typeof spec !== "string" || spec.trim() === "") {
    throw new Error("Anchor IDL path is empty");
  }
  const eq = spec.indexOf("=");
  if (eq > 0 && isPubkey(spec.slice(0, eq))) {
    const file = spec.slice(eq + 1);
    if (!file) {
      throw new Error(`Anchor IDL path is empty for ${spec.slice(0, eq)}`);
    }
    return { programId: spec.slice(0, eq), file };
  }
  return { programId: null, file: spec };
}

function discriminatorOf(ix) {
  const name = ix.name ?? "?";
  if (ix.discriminator != null) {
    const values = ix.discriminator;
    const valid =
      Array.isArray(values) &&
      values.length === DISCRIMINATOR_LEN &&
      values.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);
    if (!valid) {
      throw new Error(`Instruction ${name} discriminator must be 8 bytes`);
    }
    return Buffer.from(values);
  }
  if (!ix.name) {
    throw new Error("Anchor instruction is missing a name");
  }
  return createHash("sha256").update(`global:${ix.name}`).digest().subarray(0, DISCRIMINATOR_LEN);
}

function flattenAccounts(items, prefix = "") {
  if (!Array.isArray(items)) {
    throw new Error("Anchor instruction accounts must be an array");
  }
  const leaves = [];
  for (const item of items) {
    if (!item || typeof item !== "object" || !item.name) {
      throw new Error("Anchor account is missing a name");
    }
    const name = prefix ? `${prefix}.${item.name}` : item.name;
    if (Array.isArray(item.accounts)) {
      leaves.push(...flattenAccounts(item.accounts, name));
      continue;
    }
    leaves.push({
      name,
      signer: Boolean(item.signer ?? item.isSigner),
      writable: Boolean(item.writable ?? item.isMut),
      optional: Boolean(item.optional ?? item.isOptional),
      ...(item.address ? { address: item.address } : {}),
      ...(item.pda != null ? { pda: true } : {}),
    });
  }
  return leaves;
}

/**
 * Index one Anchor IDL (spec 0.1.0 or the legacy `isMut` / `isSigner` form).
 * `programId` overrides `address` / `metadata.address`.
 */
export function parseIdl(idl, programId = null) {
  if (!idl || typeof idl !== "object" || !Array.isArray(idl.instructions)) {
    throw new Error("Not an Anchor IDL: missing instructions");
  }
  const address = programId ?? idl.address ?? idl.metadata?.address ?? null;
  if (!address || !isPubkey(address)) {
    throw new Error(
      address
        ? `Invalid program address in Anchor IDL: ${address}`
        : "Anchor IDL has no program address; pass <PROGRAM_ID>=<PATH>",
    );
  }
  const instructions = new Map();
  for (const ix of idl.instructions) {
    if (!ix || typeof ix !== "object" || !ix.name) {
      throw new Error("Anchor instruction is missing a name");
    }
    const discriminator = discriminatorOf(ix);
    const key = discriminator.toString("hex");
    if (instructions.has(key)) {
      throw new Error(`Duplicate discriminator on instruction ${ix.name ?? "?"} in ${address}`);
    }
    instructions.set(key, {
      name: ix.name,
      accounts: flattenAccounts(ix.accounts ?? []),
      args: Array.isArray(ix.args) ? ix.args : [],
    });
  }
  return {
    programId: address,
    name: idl.metadata?.name ?? idl.name ?? null,
    instructions,
    types: indexTypes(idl),
  };
}

function indexTypes(idl) {
  const types = new Map();
  const add = (item) => {
    if (item?.name && item.type) {
      types.set(item.name, item.type);
    }
  };
  for (const item of idl.accounts ?? []) {
    add(item);
  }
  for (const item of idl.types ?? []) {
    add(item);
  }
  return types;
}

/** Load `--idl` specs into a map keyed by program id. `null` when none were given. */
export function loadIdls(specs = []) {
  if (!specs || specs.length === 0) {
    return null;
  }
  const byProgram = new Map();
  for (const spec of specs) {
    const { programId, file } = splitSpec(spec);
    let text;
    try {
      text = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error(`Anchor IDL not found: ${file}`);
      }
      if (error.code === "EISDIR") {
        throw new Error(`Anchor IDL path is a directory: ${file}`);
      }
      throw error;
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Anchor IDL is not valid JSON: ${file}`);
    }
    let program;
    try {
      program = parseIdl(json, programId);
    } catch (error) {
      throw new Error(`${error.message} (${file})`);
    }
    if (byProgram.has(program.programId)) {
      throw new Error(`Duplicate Anchor IDL for ${program.programId}`);
    }
    byProgram.set(program.programId, program);
  }
  return byProgram;
}

function namedAccount(meta, extra) {
  return {
    name: meta.name,
    signer: meta.signer,
    writable: meta.writable,
    optional: meta.optional,
    ...(meta.address ? { address: meta.address } : {}),
    ...(meta.pda ? { pda: true } : {}),
    ...extra,
  };
}

/**
 * Match `data`'s 8-byte discriminator, split `accountPubkeys` into the IDL's
 * named accounts and Anchor `remaining_accounts`, and Borsh-decode `args`.
 * An optional account set to the program id is absent (`present: false`).
 * Args that do not match the IDL leave `fields` empty and set `argsDecoded: false`.
 * Returns `null` when no IDL instruction matches.
 */
export function decodeAnchorInstruction(idls, programId, data, accountPubkeys = []) {
  const program = idls?.get(programId);
  if (!program || data.length < DISCRIMINATOR_LEN) {
    return null;
  }
  const ix = program.instructions.get(data.subarray(0, DISCRIMINATOR_LEN).toString("hex"));
  if (!ix) {
    return null;
  }

  const idlAccounts = ix.accounts.map((meta, index) => {
    if (index >= accountPubkeys.length) {
      return namedAccount(meta, { missing: true });
    }
    const pubkey = accountPubkeys[index];
    const present = !(meta.optional && pubkey != null && pubkey === programId);
    return namedAccount(meta, { pubkey, present });
  });
  const remainingAccounts = accountPubkeys.slice(ix.accounts.length).map((pubkey, index) => ({
    name: `remaining[${index}]`,
    pubkey,
  }));
  const accountNames = [
    ...idlAccounts
      .filter((account) => !account.missing)
      .map((account) => (account.present ? account.name : `${account.name} (none)`)),
    ...remainingAccounts.map((account) => account.name),
  ];

  let fields = {};
  let argsDecoded = true;
  try {
    fields = decodeIdlArgs(program.types, ix.args, data);
  } catch {
    fields = {};
    argsDecoded = false;
  }

  return {
    name: ix.name,
    ...(program.name ? { programName: program.name } : {}),
    accountNames,
    fields,
    ...(argsDecoded ? {} : { argsDecoded: false }),
    idlAccounts,
    remainingAccounts,
  };
}
