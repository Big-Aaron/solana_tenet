import bs58 from "bs58";

import { decodeAnchorInstruction } from "./idl.js";
import {
  ASSOCIATED_TOKEN_PROGRAM,
  COMPUTE_BUDGET_PROGRAM,
  MEMO_PROGRAM,
  MEMO_V1_PROGRAM,
  SYSTEM_PROGRAM,
  isTokenProgram,
} from "./programs.js";

/**
 * Decoded instruction: `{ name, accountNames, fields }`. `accountNames` labels
 * the instruction's accounts by position; `fields` holds decoded arguments.
 * An Anchor match also sets `idlAccounts` and `remainingAccounts`.
 */
function decoded(name, accountNames = [], fields = {}) {
  return { name, accountNames, fields };
}

const pubkeyAt = (data, offset) => bs58.encode(data.subarray(offset, offset + 32));

const SYSTEM_INSTRUCTIONS = {
  0: (d) =>
    decoded("createAccount", ["funding", "newAccount"], {
      lamports: d.readBigUInt64LE(4),
      space: d.readBigUInt64LE(12),
      owner: pubkeyAt(d, 20),
    }),
  1: (d) => decoded("assign", ["account"], { owner: pubkeyAt(d, 4) }),
  2: (d) => decoded("transfer", ["source", "destination"], { lamports: d.readBigUInt64LE(4) }),
  3: () => decoded("createAccountWithSeed", ["funding", "newAccount", "base"]),
  4: () => decoded("advanceNonceAccount", ["nonceAccount", "recentBlockhashesSysvar", "nonceAuthority"]),
  5: (d) =>
    decoded("withdrawNonceAccount", ["nonceAccount", "recipient"], { lamports: d.readBigUInt64LE(4) }),
  6: () => decoded("initializeNonceAccount", ["nonceAccount"]),
  7: () => decoded("authorizeNonceAccount", ["nonceAccount", "nonceAuthority"]),
  8: (d) => decoded("allocate", ["account"], { space: d.readBigUInt64LE(4) }),
  9: () => decoded("allocateWithSeed", ["account", "base"]),
  10: () => decoded("assignWithSeed", ["account", "base"]),
  11: (d) =>
    decoded("transferWithSeed", ["source", "base", "destination"], { lamports: d.readBigUInt64LE(4) }),
  12: () => decoded("upgradeNonceAccount", ["nonceAccount"]),
};

const COMPUTE_BUDGET_INSTRUCTIONS = {
  1: (d) => decoded("requestHeapFrame", [], { bytes: d.readUInt32LE(1) }),
  2: (d) => decoded("setComputeUnitLimit", [], { units: d.readUInt32LE(1) }),
  3: (d) => decoded("setComputeUnitPrice", [], { microLamports: d.readBigUInt64LE(1) }),
  4: (d) => decoded("setLoadedAccountsDataSizeLimit", [], { bytes: d.readUInt32LE(1) }),
};

const amount = (d) => ({ amount: d.readBigUInt64LE(1) });
const amountChecked = (d) => ({ amount: d.readBigUInt64LE(1), decimals: d.readUInt8(9) });

const TOKEN_INSTRUCTIONS = {
  0: () => decoded("initializeMint", ["mint"]),
  1: () => decoded("initializeAccount", ["account", "mint", "owner"]),
  2: () => decoded("initializeMultisig", ["multisig"]),
  3: (d) => decoded("transfer", ["source", "destination", "authority"], amount(d)),
  4: (d) => decoded("approve", ["source", "delegate", "owner"], amount(d)),
  5: () => decoded("revoke", ["source", "owner"]),
  6: () => decoded("setAuthority", ["account", "currentAuthority"]),
  7: (d) => decoded("mintTo", ["mint", "account", "mintAuthority"], amount(d)),
  8: (d) => decoded("burn", ["account", "mint", "authority"], amount(d)),
  9: () => decoded("closeAccount", ["account", "destination", "owner"]),
  10: () => decoded("freezeAccount", ["account", "mint", "freezeAuthority"]),
  11: () => decoded("thawAccount", ["account", "mint", "freezeAuthority"]),
  12: (d) =>
    decoded("transferChecked", ["source", "mint", "destination", "authority"], amountChecked(d)),
  13: (d) => decoded("approveChecked", ["source", "mint", "delegate", "owner"], amountChecked(d)),
  14: (d) => decoded("mintToChecked", ["mint", "account", "mintAuthority"], amountChecked(d)),
  15: (d) => decoded("burnChecked", ["account", "mint", "authority"], amountChecked(d)),
  16: () => decoded("initializeAccount2", ["account", "mint"]),
  17: () => decoded("syncNative", ["account"]),
  18: () => decoded("initializeAccount3", ["account", "mint"]),
  19: () => decoded("initializeMultisig2", ["multisig"]),
  20: () => decoded("initializeMint2", ["mint"]),
  21: () => decoded("getAccountDataSize", ["mint"]),
  22: () => decoded("initializeImmutableOwner", ["account"]),
  23: (d) => decoded("amountToUiAmount", ["mint"], amount(d)),
  24: () => decoded("uiAmountToAmount", ["mint"]),
};

const ATA_ACCOUNTS = ["payer", "associatedAccount", "wallet", "mint", "systemProgram", "tokenProgram"];
const ATA_INSTRUCTIONS = {
  0: () => decoded("create", ATA_ACCOUNTS),
  1: () => decoded("createIdempotent", ATA_ACCOUNTS),
  2: () => decoded("recoverNested", ["nestedAccount", "nestedMint", "destination", "ownerAccount"]),
};

function decodeTable(table, discriminator, data) {
  const decoder = table[discriminator];
  return decoder ? decoder(data) : null;
}

/**
 * Decode instruction data for the builtin and SPL programs tenet knows about.
 * `context.idls` (from `--idl`) names Anchor accounts when no builtin matches.
 * Returns `null` for unknown programs or malformed data.
 */
export function decodeInstruction(programId, data, context) {
  const bytes = Buffer.from(data ?? []);
  try {
    if (programId === SYSTEM_PROGRAM) {
      return bytes.length >= 4 ? decodeTable(SYSTEM_INSTRUCTIONS, bytes.readUInt32LE(0), bytes) : null;
    }
    if (programId === COMPUTE_BUDGET_PROGRAM) {
      return bytes.length >= 1 ? decodeTable(COMPUTE_BUDGET_INSTRUCTIONS, bytes[0], bytes) : null;
    }
    if (isTokenProgram(programId)) {
      return bytes.length >= 1 ? decodeTable(TOKEN_INSTRUCTIONS, bytes[0], bytes) : null;
    }
    if (programId === ASSOCIATED_TOKEN_PROGRAM) {
      return decodeTable(ATA_INSTRUCTIONS, bytes.length === 0 ? 0 : bytes[0], bytes);
    }
    if (programId === MEMO_PROGRAM || programId === MEMO_V1_PROGRAM) {
      return decoded("memo", [], { text: bytes.toString("utf8") });
    }
  } catch (error) {
    if (error instanceof RangeError) {
      return null;
    }
    throw error;
  }
  return decodeAnchorInstruction(context?.idls, programId, bytes, context?.accounts);
}
