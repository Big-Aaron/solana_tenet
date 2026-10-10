import { PublicKey } from "@solana/web3.js";

import { fetchAccounts } from "./accounts.js";
import { CLOCK_SYSVAR, decodeClock, withClock } from "./clock.js";
import { createConnection, rpcRequest } from "./rpc.js";
import { durableNonceAccount, withNonceBlockhash } from "./transaction.js";

const INTERNAL_ERROR = -32603;

async function loadSurfnetClass() {
  try {
    const { Surfnet } = await import("@solana/surfpool");
    return Surfnet;
  } catch (error) {
    throw new Error(
      `Failed to load the embedded surfpool runtime (@solana/surfpool): ${error.message}. ` +
        "Start surfpool separately and pass --surfnet-url instead.",
    );
  }
}

/**
 * Start an embedded surfnet forking `rpcUrl`, or attach to a running surfpool
 * at `surfnetUrl` (which then uses its own datasource). Always pair with `stop()`.
 */
export async function openSurfnet({ rpcUrl, surfnetUrl }) {
  if (surfnetUrl) {
    return { url: surfnetUrl, embedded: false, connection: createConnection(surfnetUrl), stop() {} };
  }
  const Surfnet = await loadSurfnetClass();
  const instance = Surfnet.startWithConfig({ offline: false, remoteRpcUrl: rpcUrl });
  const onSignal = () => {
    stop();
    process.exit(130);
  };
  const stop = () => {
    process.off("SIGINT", onSignal);
    instance.stop();
  };
  process.once("SIGINT", onSignal);
  return { url: instance.rpcUrl, embedded: true, connection: createConnection(instance.rpcUrl), stop };
}

export async function setAccount(connection, pubkey, { lamports, data, owner, executable }) {
  const update = {};
  if (lamports !== undefined) {
    update.lamports = lamports;
  }
  if (data !== undefined) {
    update.data = Buffer.from(data).toString("hex");
  }
  if (owner !== undefined) {
    update.owner = owner;
  }
  if (executable !== undefined) {
    update.executable = executable;
  }
  await rpcRequest(connection, "surfnet_setAccount", [pubkey, update]);
}

export async function setTokenAccount(connection, owner, mint, update, tokenProgram) {
  await rpcRequest(connection, "surfnet_setTokenAccount", [owner, mint, update, tokenProgram]);
}

/**
 * Durable-nonce transactions carry the nonce value instead of a recent
 * blockhash, and the on-chain nonce has advanced since signing. Rewrite the
 * nonce account on the surfnet so the stored value matches the transaction.
 * Returns the nonce account pubkey, or `null` for regular transactions.
 */
export async function alignDurableNonce(connection, tx) {
  const nonce = durableNonceAccount(tx);
  if (!nonce) {
    return null;
  }
  const info = await connection.getAccountInfo(new PublicKey(nonce));
  if (!info) {
    throw new Error(`Durable nonce account not found: ${nonce}`);
  }
  await setAccount(connection, nonce, {
    lamports: info.lamports,
    data: withNonceBlockhash(info.data, tx.message.recentBlockhash),
    owner: info.owner.toBase58(),
  });
  return nonce;
}

/** Simulate raw wire bytes; `accounts` lists pubkeys whose post-simulation state is returned. */
/**
 * Pin the Clock sysvar that programs read. Only the given fields change;
 * account state stays as forked. Returns the resulting `{ slot, unixTimestamp }`.
 */
export async function overrideClock(connection, override) {
  const [clock] = await fetchAccounts(connection, [CLOCK_SYSVAR]);
  if (!clock) {
    throw new Error("Clock sysvar not found on the surfnet");
  }
  const data = withClock(clock.data, override);
  await setAccount(connection, CLOCK_SYSVAR, { lamports: clock.lamports, data, owner: clock.owner });
  return decodeClock(data);
}

export async function simulate(connection, wire, { sigVerify, replaceRecentBlockhash, accounts }) {
  const config = { encoding: "base64", sigVerify, replaceRecentBlockhash, innerInstructions: true };
  if (accounts.length > 0) {
    config.accounts = { encoding: "base64", addresses: accounts };
  }
  try {
    const result = await rpcRequest(connection, "simulateTransaction", [wire.toString("base64"), config]);
    return { slot: result.context.slot, value: result.value };
  } catch (error) {
    if (error.code === INTERNAL_ERROR) {
      error.message +=
        ". Surfnet internal errors are often transient (e.g. the datasource RPC rate-limiting account fetches); " +
        "retry, or use a dedicated --rpc-url";
    }
    throw error;
  }
}
