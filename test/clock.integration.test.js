import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import {
  appendTransactionMessageInstruction,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  generateKeyPairSigner,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";

import { createRpc } from "../src/core/rpc.js";
import { overrideClock, simulate } from "../src/core/surfnet.js";

const PROBE_SO = new URL("./fixtures/clock_probe.so", import.meta.url).pathname;
const CLOCK_LOG = /clock slot=(\d+) unix_timestamp=(-?\d+)/;
const REMOTE_RPC_URL = process.env.TENET_E2E ? (process.env.TENET_RPC_URL ?? "https://api.mainnet-beta.solana.com") : null;

let Surfnet = null;
try {
  ({ Surfnet } = await import("@solana/surfpool"));
} catch {
  // Native surfpool binary unavailable on this platform.
}

describe("clock override", { skip: Surfnet ? false : "@solana/surfpool unavailable" }, () => {
  let instance;
  let connection;
  let payer;
  let programId;

  before(async () => {
    programId = (await generateKeyPairSigner()).address;
    instance = Surfnet.startWithConfig(
      REMOTE_RPC_URL ? { offline: false, remoteRpcUrl: REMOTE_RPC_URL } : { offline: true },
    );
    instance.deploy({ programId, soPath: PROBE_SO });
    payer = await createKeyPairSignerFromBytes(Uint8Array.from(instance.payerSecretKey));
    connection = createRpc(instance.rpcUrl);
  });

  after(() => instance.stop());

  /** Clock as read by a program during simulation (see fixtures/clock_probe). */
  async function programClock() {
    const { value: latestBlockhash } = await connection.getLatestBlockhash().send();
    const message = pipe(
      createTransactionMessage({ version: "legacy" }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstruction({ programAddress: programId }, tx),
    );
    const signed = await signTransactionMessageWithSigners(message);
    const { value } = await simulate(connection, Buffer.from(getTransactionEncoder().encode(signed)), {
      sigVerify: false,
      replaceRecentBlockhash: true,
      accounts: [],
    });
    assert.equal(value.err, null, JSON.stringify(value.logs));
    const [, slot, unixTimestamp] = value.logs.map((log) => CLOCK_LOG.exec(log)).find(Boolean);
    return { slot: Number(slot), unixTimestamp: Number(unixTimestamp) };
  }

  it("programs read the pinned slot and timestamp", async () => {
    const pinned = await overrideClock(connection, { slot: 416_697_641, unixTimestamp: 1_777_568_172 });
    assert.deepEqual(pinned, { slot: 416_697_641, unixTimestamp: 1_777_568_172 });

    await sleep(1500);
    assert.deepEqual(await programClock(), pinned);
  });

  it("changes only the requested field", async () => {
    const before = await programClock();
    await overrideClock(connection, { unixTimestamp: 1_700_000_000 });
    assert.deepEqual(await programClock(), { slot: before.slot, unixTimestamp: 1_700_000_000 });
  });
});
