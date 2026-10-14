import bs58 from "bs58";
import {
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  transactionConfigMaskHasComputeUnitLimit,
  transactionConfigMaskHasHeapSize,
  transactionConfigMaskHasLoadedAccountsDataSizeLimit,
  transactionConfigMaskHasPriorityFee,
} from "@solana/kit";

import { decodeInstruction } from "../parsers/instructions.js";
import { COMPUTE_BUDGET_PROGRAM, SYSTEM_PROGRAM } from "../parsers/programs.js";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const SIGNATURE_BYTES = 64;
const ADVANCE_NONCE_ACCOUNT = 4;
const NONCE_BLOCKHASH_OFFSET = 40;
const DEFAULT_CU_PER_INSTRUCTION = 200_000;
const MAX_COMPUTE_UNIT_LIMIT = 1_400_000;

const transactionDecoder = getTransactionDecoder();
const compiledMessageDecoder = getCompiledTransactionMessageDecoder();

/** Uniform view of a Kit compiled message, for legacy, v0, and v1 wire bytes. */
function adaptTransaction(transaction, message) {
  const staticAccountKeys = message.staticAccounts;
  const header = message.header;
  return {
    version: message.version,
    signatures: Object.values(transaction.signatures).map((signature) => signature ?? new Uint8Array(64)),
    message: {
      version: message.version,
      recentBlockhash: message.lifetimeToken,
      staticAccountKeys,
      compiledInstructions: compiledInstructions(message),
      addressTableLookups: addressTableLookups(message),
      transactionConfig: message.version === 1 ? transactionConfig(message) : null,
      isAccountSigner(index) {
        return index < header.numSignerAccounts;
      },
      isAccountWritable(index) {
        return accountIsWritable(header, staticAccountKeys.length, index);
      },
    },
  };
}

function compiledInstructions(message) {
  if (message.version === 1) {
    return message.instructionHeaders.map((header, index) => {
      const payload = message.instructionPayloads[index];
      return {
        programIdIndex: header.programAccountIndex,
        accountKeyIndexes: payload?.instructionAccountIndices ?? [],
        data: new Uint8Array(payload?.instructionData ?? []),
      };
    });
  }
  return message.instructions.map((ix) => ({
    programIdIndex: ix.programAddressIndex,
    accountKeyIndexes: ix.accountIndices ?? [],
    data: new Uint8Array(ix.data ?? []),
  }));
}

function addressTableLookups(message) {
  if (message.version !== 0) {
    return [];
  }
  return (message.addressTableLookups ?? []).map((lookup) => ({
    accountKey: lookup.lookupTableAddress,
    writableIndexes: lookup.writableIndexes,
    readonlyIndexes: lookup.readonlyIndexes,
  }));
}

/** Unset v1 fields are `null`. The priority fee is exposed as `priorityFee`. */
function transactionConfig(message) {
  const config = {
    computeUnitLimit: null,
    heapSize: null,
    loadedAccountsDataSizeLimit: null,
    priorityFee: null,
  };
  const values = message.configValues ?? [];
  let index = 0;
  if (transactionConfigMaskHasPriorityFee(message.configMask)) {
    config.priorityFee = Number(values[index++].value);
  }
  if (transactionConfigMaskHasComputeUnitLimit(message.configMask)) {
    config.computeUnitLimit = values[index++].value;
  }
  if (transactionConfigMaskHasLoadedAccountsDataSizeLimit(message.configMask)) {
    config.loadedAccountsDataSizeLimit = values[index++].value;
  }
  if (transactionConfigMaskHasHeapSize(message.configMask)) {
    config.heapSize = values[index++].value;
  }
  return config;
}

function accountIsWritable(header, staticCount, index) {
  const numSigned = header.numSignerAccounts;
  if (index >= staticCount || index < 0) {
    return false;
  }
  if (index >= numSigned) {
    const unsignedIndex = index - numSigned;
    const numWritableUnsigned = staticCount - numSigned - header.numReadonlyNonSignerAccounts;
    return unsignedIndex < numWritableUnsigned;
  }
  return index < numSigned - header.numReadonlySignerAccounts;
}

function tryDeserialize(bytes) {
  try {
    const transaction = transactionDecoder.decode(bytes);
    const message = compiledMessageDecoder.decode(transaction.messageBytes);
    return adaptTransaction(transaction, message);
  } catch {
    return null;
  }
}

/**
 * Classify user input as a transaction signature or encoded transaction.
 * Base58 is tried before Base64 because every Base58 string is also made of
 * Base64 characters.
 */
export function classifyInput(input) {
  const text = String(input ?? "").trim();
  if (!text) {
    throw new Error("Empty transaction input");
  }
  if (BASE58.test(text)) {
    const bytes = bs58.decode(text);
    if (bytes.length === SIGNATURE_BYTES) {
      return { kind: "signature", signature: text };
    }
    if (tryDeserialize(bytes)) {
      return { kind: "raw", wire: Buffer.from(bytes) };
    }
  }
  if (BASE64.test(text)) {
    const bytes = Buffer.from(text, "base64");
    if (tryDeserialize(bytes)) {
      return { kind: "raw", wire: bytes };
    }
  }
  throw new Error("Input is neither a transaction signature nor a Base58/Base64 encoded transaction");
}

export function parseSignature(input) {
  const text = String(input ?? "").trim();
  if (!BASE58.test(text) || bs58.decode(text).length !== SIGNATURE_BYTES) {
    throw new Error(`Invalid transaction signature: ${text}`);
  }
  return text;
}

export function decodeTransaction(wire) {
  const tx = tryDeserialize(wire);
  if (!tx) {
    throw new Error("Failed to deserialize transaction bytes");
  }
  return tx;
}

/**
 * Pubkey of the nonce account when the transaction uses a durable nonce
 * (first instruction is System `AdvanceNonceAccount`), otherwise `null`.
 */
export function durableNonceAccount(tx) {
  const { message } = tx;
  const first = message.compiledInstructions[0];
  if (!first || first.accountKeyIndexes.length === 0) {
    return null;
  }
  const keys = message.staticAccountKeys;
  const program = keys[first.programIdIndex];
  const data = Buffer.from(first.data);
  if (program !== SYSTEM_PROGRAM || data.length < 4 || data.readUInt32LE(0) !== ADVANCE_NONCE_ACCOUNT) {
    return null;
  }
  return keys[first.accountKeyIndexes[0]] ?? null;
}

/** Copy of nonce account data whose stored durable nonce is replaced by `blockhash`. */
export function withNonceBlockhash(nonceData, blockhash) {
  const data = Buffer.from(nonceData);
  if (data.length < NONCE_BLOCKHASH_OFFSET + 32) {
    throw new Error(`Nonce account data is too short (${data.length} bytes)`);
  }
  Buffer.from(bs58.decode(blockhash)).copy(data, NONCE_BLOCKHASH_OFFSET);
  return data;
}

/** Resolve address lookup table entries in runtime order: all writable, then all readonly. */
export async function resolveLoadedAddresses(rpc, tx) {
  const writable = [];
  const readonly = [];
  for (const lookup of tx.message.addressTableLookups) {
    const { value } = await rpc.getAccountInfo(lookup.accountKey, { encoding: "jsonParsed" }).send();
    const addresses = value?.data?.parsed?.info?.addresses;
    if (!value || !addresses) {
      throw new Error(`Address lookup table not found: ${lookup.accountKey}`);
    }
    const pick = (index) => {
      const address = addresses[index];
      if (!address) {
        throw new Error(`Index ${index} out of range in lookup table ${lookup.accountKey}`);
      }
      return address;
    };
    writable.push(...lookup.writableIndexes.map(pick));
    readonly.push(...lookup.readonlyIndexes.map(pick));
  }
  return { writable, readonly };
}

function firstSignature(tx) {
  return transactionSignatures(tx)[0] ?? null;
}

/** Every signature, with unsigned (all-zero) slots as `null`. */
export function transactionSignatures(tx) {
  return tx.signatures.map((signature) => (signature.some((byte) => byte !== 0) ? bs58.encode(signature) : null));
}

/**
 * Address lookup tables in runtime order. `loadedAddresses` may be `null`;
 * unresolved entries then have `pubkey: null`. `accountTags[i]` labels
 * account `i` with `{ table, index }` when it was loaded from a table.
 */
export function describeLookups(tx, loadedAddresses) {
  let writableCursor = 0;
  let readonlyCursor = 0;
  const tables = tx.message.addressTableLookups.map((lookup) => {
    const writable = lookup.writableIndexes.map((index, offset) => ({
      index,
      pubkey: loadedAddresses?.writable[writableCursor + offset] ?? null,
    }));
    const readonly = lookup.readonlyIndexes.map((index, offset) => ({
      index,
      pubkey: loadedAddresses?.readonly[readonlyCursor + offset] ?? null,
    }));
    writableCursor += lookup.writableIndexes.length;
    readonlyCursor += lookup.readonlyIndexes.length;
    return { accountKey: lookup.accountKey, writable, readonly };
  });

  const accountTags = tx.message.staticAccountKeys.map(() => null);
  if (loadedAddresses) {
    accountTags.push(
      ...tagsFor(tables, "writable", loadedAddresses.writable.length),
      ...tagsFor(tables, "readonly", loadedAddresses.readonly.length),
    );
  }
  return { tables, accountTags };
}

function tagsFor(tables, field, count) {
  const tags = [];
  for (const [table, lookup] of tables.entries()) {
    for (const entry of lookup[field]) {
      if (tags.length >= count) {
        return tags;
      }
      tags.push({ table, index: entry.index });
    }
  }
  while (tags.length < count) {
    tags.push(null);
  }
  return tags;
}

/**
 * Display model of a transaction. `loadedAddresses` (from lookup tables)
 * may be `null` when unresolved; affected account slots are then `null`.
 * `idls` is the `--idl` map used to name Anchor accounts.
 */
export function describeTransaction(tx, wire, loadedAddresses, idls = null) {
  const { message } = tx;
  const staticKeys = message.staticAccountKeys;
  const accounts = [
    ...staticKeys.map((pubkey, index) => ({
      pubkey,
      signer: message.isAccountSigner(index),
      writable: message.isAccountWritable(index),
      executable: false,
      source: "static",
    })),
    ...(loadedAddresses?.writable ?? []).map((pubkey) => ({
      pubkey,
      signer: false,
      writable: true,
      executable: false,
      source: "lookup",
    })),
    ...(loadedAddresses?.readonly ?? []).map((pubkey) => ({
      pubkey,
      signer: false,
      writable: false,
      executable: false,
      source: "lookup",
    })),
  ];
  const keys = accounts.map((account) => account.pubkey);

  const instructions = message.compiledInstructions.map((ix, index) => {
    const programId = keys[ix.programIdIndex] ?? null;
    if (accounts[ix.programIdIndex]) {
      accounts[ix.programIdIndex].executable = true;
    }
    const data = Buffer.from(ix.data);
    const instructionAccounts = ix.accountKeyIndexes.map((i) => keys[i] ?? null);
    return {
      index,
      programId,
      accountIndexes: [...ix.accountKeyIndexes],
      accounts: instructionAccounts,
      data,
      parsed: decodeInstruction(programId, data, { idls, accounts: instructionAccounts }),
    };
  });

  return {
    version: tx.version,
    signature: firstSignature(tx),
    size: wire.length,
    recentBlockhash: message.recentBlockhash,
    config: message.version === 1 ? message.transactionConfig : null,
    lookupTables: message.addressTableLookups.map((lookup) => lookup.accountKey),
    lookupsResolved: loadedAddresses != null || message.addressTableLookups.length === 0,
    accounts,
    instructions,
  };
}

/**
 * Compute unit limit the runtime applies: v1 config, then ComputeBudget
 * `SetComputeUnitLimit`, then the per-instruction default.
 */
export function computeUnitLimit(txInfo) {
  if (txInfo.config?.computeUnitLimit != null) {
    return txInfo.config.computeUnitLimit;
  }
  const budgetIx = txInfo.instructions.find(
    (ix) => ix.programId === COMPUTE_BUDGET_PROGRAM && ix.parsed?.name === "setComputeUnitLimit",
  );
  if (budgetIx) {
    return budgetIx.parsed.fields.units;
  }
  const count = txInfo.instructions.filter((ix) => ix.programId !== COMPUTE_BUDGET_PROGRAM).length;
  return Math.min(count * DEFAULT_CU_PER_INSTRUCTION, MAX_COMPUTE_UNIT_LIMIT);
}
