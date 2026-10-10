import { programName } from "../parsers/programs.js";
import { hex } from "./format.js";

export function serializeInstruction(ix) {
  return {
    programId: ix.programId,
    programName: programName(ix.programId),
    accounts: ix.accounts,
    data: ix.data ? hex(ix.data) : null,
    parsed: ix.parsed ? { name: ix.parsed.name, fields: ix.parsed.fields } : null,
    ...(ix.stackHeight !== undefined ? { stackHeight: ix.stackHeight } : {}),
  };
}

function toDocument({ mode, context, tx, execution, computeUnitLimit, balanceChanges }) {
  return {
    mode,
    signature: tx.signature,
    slot: context.slot,
    blockTime: context.blockTime ?? null,
    rpcUrl: context.rpcUrl,
    ...(mode === "simulate"
      ? {
          surfnetUrl: context.surfnetUrl,
          durableNonce: context.durableNonce,
          fundings: context.fundings,
          clock: context.clock,
        }
      : {}),
    transaction: {
      version: tx.version,
      size: tx.size,
      recentBlockhash: tx.recentBlockhash,
      config: tx.config,
      lookupTables: tx.lookupTables,
      lookupsResolved: tx.lookupsResolved,
      accounts: tx.accounts,
      instructions: tx.instructions.map((ix) => ({ index: ix.index, ...serializeInstruction(ix) })),
    },
    status: { success: execution.success, error: execution.err, errorMessage: execution.errorMessage },
    computeUnits: { consumed: execution.computeUnits, limit: computeUnitLimit },
    fee: execution.fee,
    logs: execution.logs,
    innerInstructions: execution.innerInstructions
      .map((group, index) => (group ? { index, instructions: group.map(serializeInstruction) } : null))
      .filter(Boolean),
    returnData: execution.returnData
      ? { programId: execution.returnData.programId, data: hex(execution.returnData.data) }
      : null,
    balanceChanges: execution.balances ? balanceChanges : null,
  };
}

export function renderJson(report) {
  return JSON.stringify(toDocument(report), (_key, value) => (typeof value === "bigint" ? value.toString() : value), 2);
}
