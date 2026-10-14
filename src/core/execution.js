import bs58 from "bs58";

import { decodeInstruction } from "../parsers/instructions.js";

/**
 * Execution results from local simulation and on-chain metadata are
 * normalized into one shape so both commands share rendering:
 *
 * { success, err, errorMessage, logs, computeUnits, fee, returnData,
 *   innerInstructions: Instruction[][] (indexed by outer instruction),
 *   balances: { pre, post, preToken, postToken } | null }
 */

function describeInstructionError(detail) {
  if (typeof detail === "string") {
    return detail;
  }
  if (detail && typeof detail === "object" && "Custom" in detail) {
    return `custom program error 0x${detail.Custom.toString(16)} (${detail.Custom})`;
  }
  const [kind, value] = Object.entries(detail ?? {})[0] ?? [JSON.stringify(detail), null];
  return value == null ? kind : `${kind}: ${JSON.stringify(value)}`;
}

export function formatTransactionError(err) {
  if (err == null) {
    return null;
  }
  if (typeof err === "string") {
    return err;
  }
  if (Array.isArray(err.InstructionError)) {
    const [index, detail] = err.InstructionError;
    return `Instruction #${index + 1} failed: ${describeInstructionError(detail)}`;
  }
  return JSON.stringify(err);
}

function normalizeInnerInstruction(ix, keys, idls) {
  if (ix.parsed !== undefined) {
    const parsed =
      typeof ix.parsed === "string"
        ? { name: ix.program ?? "parsed", accountNames: [], fields: { value: ix.parsed } }
        : { name: ix.parsed.type, accountNames: [], fields: ix.parsed.info ?? {} };
    return { programId: ix.programId, accounts: [], data: null, parsed, stackHeight: ix.stackHeight ?? null };
  }
  const data = Buffer.from(bs58.decode(ix.data ?? ""));
  const stackHeight = ix.stackHeight ?? null;
  if (ix.programId) {
    return {
      programId: ix.programId,
      accounts: ix.accounts,
      data,
      parsed: decodeInstruction(ix.programId, data, { idls, accounts: ix.accounts }),
      stackHeight,
    };
  }
  const programId = keys[ix.programIdIndex] ?? null;
  const accounts = ix.accounts.map((index) => keys[index] ?? null);
  return {
    programId,
    accountIndexes: ix.accounts,
    accounts,
    data,
    parsed: decodeInstruction(programId, data, { idls, accounts }),
    stackHeight,
  };
}

/**
 * Inner instruction groups arrive either compiled (account indexes, from
 * `getTransaction`) or jsonParsed (pubkeys or parsed info, from surfnet's
 * `simulateTransaction`).
 */
export function normalizeInnerInstructions(groups, keys, idls = null) {
  const result = [];
  for (const group of groups ?? []) {
    result[group.index] = group.instructions.map((ix) => normalizeInnerInstruction(ix, keys, idls));
  }
  return result;
}

function normalizeReturnData(returnData) {
  if (!returnData?.data) {
    return null;
  }
  const data = Buffer.from(returnData.data[0], "base64");
  return data.length > 0 ? { programId: returnData.programId, data } : null;
}

function normalizeBalances(source) {
  if (!source.preBalances || !source.postBalances) {
    return null;
  }
  return {
    pre: source.preBalances,
    post: source.postBalances,
    preToken: source.preTokenBalances ?? [],
    postToken: source.postTokenBalances ?? [],
  };
}

/** `localBalances` fills in when the simulator does not report pre/post balances itself. */
export function fromSimulation(value, keys, localBalances = null, idls = null) {
  return {
    success: value.err == null,
    err: value.err ?? null,
    errorMessage: formatTransactionError(value.err),
    logs: value.logs ?? [],
    computeUnits: value.unitsConsumed ?? null,
    fee: value.fee ?? null,
    returnData: normalizeReturnData(value.returnData),
    innerInstructions: normalizeInnerInstructions(value.innerInstructions, keys, idls),
    balances: normalizeBalances(value) ?? localBalances,
  };
}

export function fromMeta(meta, keys, idls = null) {
  if (!meta) {
    return {
      success: false,
      err: null,
      errorMessage: "No execution metadata in RPC response",
      logs: [],
      computeUnits: null,
      fee: null,
      returnData: null,
      innerInstructions: [],
      balances: null,
    };
  }
  return {
    success: meta.err == null,
    err: meta.err ?? null,
    errorMessage: formatTransactionError(meta.err),
    logs: meta.logMessages ?? [],
    computeUnits: meta.computeUnitsConsumed ?? null,
    fee: meta.fee ?? null,
    returnData: normalizeReturnData(meta.returnData),
    innerInstructions: normalizeInnerInstructions(meta.innerInstructions, keys, idls),
    balances: normalizeBalances(meta),
  };
}

function abs(value) {
  return value < 0n ? -value : value;
}

function byMagnitude(a, b) {
  const x = abs(a.delta);
  const y = abs(b.delta);
  return x > y ? -1 : x < y ? 1 : 0;
}

export function solBalanceChanges(keys, balances) {
  if (!balances) {
    return [];
  }
  return balances.pre
    .map((pre, index) => {
      const post = balances.post[index];
      if (pre == null || post == null) {
        return null;
      }
      const before = BigInt(pre);
      const after = BigInt(post);
      return { pubkey: keys[index] ?? null, before, after, delta: after - before };
    })
    .filter((change) => change && change.delta !== 0n)
    .sort(byMagnitude);
}

/** Token balance diffs matched by account index; accounts missing from `post` were closed. */
export function tokenBalanceChanges(keys, balances) {
  if (!balances) {
    return [];
  }
  const pre = new Map(balances.preToken.map((entry) => [entry.accountIndex, entry]));
  const post = new Map(balances.postToken.map((entry) => [entry.accountIndex, entry]));
  const indexes = new Set([...post.keys(), ...pre.keys()]);
  const changes = [];
  for (const index of indexes) {
    const entry = post.get(index) ?? pre.get(index);
    const before = BigInt(pre.get(index)?.uiTokenAmount.amount ?? 0);
    const after = BigInt(post.get(index)?.uiTokenAmount.amount ?? 0);
    if (before === after) {
      continue;
    }
    changes.push({
      account: keys[index] ?? null,
      owner: entry.owner ?? null,
      mint: entry.mint,
      decimals: entry.uiTokenAmount.decimals,
      before,
      after,
      delta: after - before,
    });
  }
  return changes.sort(byMagnitude);
}
