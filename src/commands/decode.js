import { createRpc, resolveRpcUrl } from "../core/rpc.js";
import {
  decodeTransaction,
  describeLookups,
  describeTransaction,
  resolveLoadedAddresses,
  transactionSignatures,
} from "../core/transaction.js";
import { status, warn } from "../utils/diagnostics.js";
import { loadTransaction, readTransactionInput } from "./input.js";
import { printDecode } from "./output.js";

/** Display model of a transaction that has not been executed. */
export function buildDecodeModel({ wire, loadedAddresses, context }) {
  const tx = decodeTransaction(wire);
  const info = describeTransaction(tx, wire, loadedAddresses);
  const { tables, accountTags } = describeLookups(tx, loadedAddresses);
  return {
    context,
    tx: info,
    lookups: tables,
    signatures: transactionSignatures(tx),
    accounts: info.accounts.map((account, index) => ({
      ...account,
      index,
      lookup: accountTags[index] ?? null,
    })),
  };
}

async function resolveAddresses(connection, tx, fetched) {
  if (tx.message.addressTableLookups.length === 0) {
    return { writable: [], readonly: [] };
  }
  if (fetched?.meta?.loadedAddresses) {
    return fetched.meta.loadedAddresses;
  }
  status("Resolving address lookup tables ...");
  try {
    return await resolveLoadedAddresses(connection, tx);
  } catch (error) {
    warn(`Failed to resolve address lookup tables: ${error.message}`);
    return null;
  }
}

export async function runDecode(txArg, opts) {
  const rpcUrl = resolveRpcUrl(opts.rpcUrl);
  const { wire, fetched } = await loadTransaction(await readTransactionInput(txArg), rpcUrl);
  const tx = decodeTransaction(wire);
  const connection = createRpc(rpcUrl);
  const loadedAddresses = await resolveAddresses(connection, tx, fetched);
  printDecode(
    buildDecodeModel({
      wire,
      loadedAddresses,
      context: { rpcUrl, slot: fetched?.slot ?? null, blockTime: fetched?.blockTime ?? null },
    }),
    opts,
  );
}
