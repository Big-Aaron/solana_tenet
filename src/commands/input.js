import { text } from "node:stream/consumers";

import { createRpc, fetchTransaction } from "../core/rpc.js";
import { classifyInput } from "../core/transaction.js";
import { status } from "../utils/diagnostics.js";

/** A signature or encoded transaction from the argument, or from stdin when omitted. */
export async function readTransactionInput(arg) {
  if (arg !== undefined) {
    return arg;
  }
  if (process.stdin.isTTY) {
    throw new Error("No transaction provided: pass a signature or encoded transaction, or pipe one via stdin");
  }
  return text(process.stdin);
}

/**
 * Wire bytes, plus the confirmed transaction (`slot`, `blockTime`, `meta`)
 * when the input is a signature.
 */
export async function loadTransaction(input, rpcUrl) {
  const parsed = classifyInput(input);
  if (parsed.kind === "raw") {
    return { wire: parsed.wire, fetched: null };
  }
  status(`Fetching transaction ${parsed.signature} ...`);
  const fetched = await fetchTransaction(createRpc(rpcUrl), parsed.signature);
  return { wire: fetched.wire, fetched };
}
