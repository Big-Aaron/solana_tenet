import { balancesFromSnapshots, fetchAccounts, fromUiAccounts } from "../core/accounts.js";
import { parseClockOptions, resolveClockOverride } from "../core/clock.js";
import { fromSimulation } from "../core/execution.js";
import { applyFundings, parseSolFunding, parseTokenFunding } from "../core/funding.js";
import { buildReport } from "../core/report.js";
import { resolveRpcUrl } from "../core/rpc.js";
import { alignDurableNonce, openSurfnet, overrideClock, simulate } from "../core/surfnet.js";
import { decodeTransaction, describeTransaction, resolveLoadedAddresses } from "../core/transaction.js";
import { status, warn } from "../utils/diagnostics.js";
import { loadTransaction, readTransactionInput } from "./input.js";
import { printReport } from "./output.js";

function clockOverride(options, fetched) {
  const override = resolveClockOverride(options, fetched);
  if (options.atTxTime && options.unixTimestamp == null && fetched.blockTime == null) {
    warn("The RPC returned no block time for this transaction; only the slot is pinned");
  }
  return override;
}

async function loadAddresses(connection, tx) {
  try {
    return await resolveLoadedAddresses(connection, tx);
  } catch (error) {
    warn(`Failed to resolve address lookup tables: ${error.message}`);
    return null;
  }
}

function warnUnreferenced(fundings, txInfo) {
  const referenced = new Set(txInfo.accounts.map((account) => account.pubkey));
  for (const funding of fundings) {
    if (!referenced.has(funding.account)) {
      warn(`Funded account ${funding.account} is not referenced by the transaction`);
    }
  }
}

export async function runSimulate(txArg, opts) {
  const rpcUrl = resolveRpcUrl(opts.rpcUrl);
  const fundingRequests = {
    sol: opts.fundSol.map(parseSolFunding),
    token: opts.fundToken.map(parseTokenFunding),
  };
  const clockOptions = parseClockOptions(opts);
  const { wire, fetched } = await loadTransaction(await readTransactionInput(txArg), rpcUrl);
  const tx = decodeTransaction(wire);
  const pinClock = clockOverride(clockOptions, fetched);

  status(opts.surfnetUrl ? `Connecting to surfnet ${opts.surfnetUrl} ...` : `Starting surfnet (fork of ${rpcUrl}) ...`);
  const surfnet = await openSurfnet({ rpcUrl, surfnetUrl: opts.surfnetUrl });
  let report;
  try {
    const { connection } = surfnet;
    status("Preparing accounts ...");
    const fundings = await applyFundings(connection, fundingRequests);
    const durableNonce = await alignDurableNonce(connection, tx);
    const clock = pinClock ? await overrideClock(connection, pinClock) : null;
    const txInfo = describeTransaction(tx, wire, await loadAddresses(connection, tx));
    warnUnreferenced(fundings, txInfo);
    const keys = txInfo.accounts.map((account) => account.pubkey);
    const writable = keys.flatMap((pubkey, index) => (pubkey && txInfo.accounts[index].writable ? [index] : []));
    const writableKeys = writable.map((index) => keys[index]);
    const preState = await fetchAccounts(connection, writableKeys);

    status("Simulating ...");
    const { slot, value } = await simulate(connection, wire, {
      sigVerify: Boolean(opts.checkSig),
      // The RPC rejects sigVerify together with blockhash replacement, and a
      // durable nonce must stay as signed.
      replaceRecentBlockhash: !opts.checkSig && !durableNonce,
      accounts: writableKeys,
    });
    const localBalances = value.accounts
      ? await balancesFromSnapshots(connection, keys.length, writable, preState, fromUiAccounts(value.accounts))
      : null;

    report = buildReport({
      mode: "simulate",
      context: { rpcUrl, surfnetUrl: surfnet.url, embedded: surfnet.embedded, slot, durableNonce, fundings, clock },
      tx: txInfo,
      execution: fromSimulation(value, keys, localBalances),
    });
  } finally {
    surfnet.stop();
  }
  printReport(report, opts);
}
