import { fromMeta } from "../core/execution.js";
import { buildReport } from "../core/report.js";
import { createRpc, fetchTransaction, resolveRpcUrl } from "../core/rpc.js";
import { decodeTransaction, describeTransaction, parseSignature } from "../core/transaction.js";
import { status } from "../utils/diagnostics.js";
import { printReport } from "./output.js";

/**
 * Render a confirmed transaction from its on-chain metadata. Nothing is
 * executed locally, and lookup tables are resolved from the historical
 * `meta.loadedAddresses` because the tables may have changed or closed since.
 */
export async function runReplay(signatureArg, opts) {
  const rpcUrl = resolveRpcUrl(opts.rpcUrl);
  const signature = parseSignature(signatureArg);

  status(`Fetching transaction ${signature} ...`);
  const fetched = await fetchTransaction(createRpc(rpcUrl), signature);
  const tx = decodeTransaction(fetched.wire);
  const txInfo = describeTransaction(tx, fetched.wire, fetched.meta?.loadedAddresses ?? null);
  const keys = txInfo.accounts.map((account) => account.pubkey);

  const report = buildReport({
    mode: "replay",
    context: { rpcUrl, slot: fetched.slot, blockTime: fetched.blockTime },
    tx: txInfo,
    execution: fromMeta(fetched.meta, keys),
  });
  printReport(report, opts);
}
