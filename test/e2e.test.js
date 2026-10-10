import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { describe, it } from "node:test";
import { promisify } from "node:util";

import { loadFixture } from "./helpers.js";

const run = promisify(execFile);
const CLI = new URL("../bin/tenet.js", import.meta.url).pathname;
const skip = process.env.TENET_E2E ? false : "set TENET_E2E=1 to run tests against a live RPC";

async function tenet(...args) {
  const { stdout } = await run(process.execPath, [CLI, ...args, "--json"], { timeout: 180_000 });
  return JSON.parse(stdout);
}

describe("e2e (live RPC)", { skip }, () => {
  it("decodes a confirmed transaction", async () => {
    const fixture = loadFixture("v0_pump_sell");
    const doc = await tenet("decode", fixture.signature);
    assert.equal(doc.mode, "decode");
    assert.equal(doc.transaction.lookupsResolved, true);
    assert.equal(doc.transaction.instructions[0].parsed.name, "setComputeUnitLimit");
    assert.equal(doc.transaction.lookupTables[0].writable.length, fixture.meta.loadedAddresses.writable.length);
  });

  it("replays a confirmed transaction", async () => {
    const fixture = loadFixture("v0_pump_sell");
    const doc = await tenet("replay", fixture.signature);
    assert.equal(doc.status.success, true);
    assert.equal(doc.computeUnits.consumed, fixture.meta.computeUnitsConsumed);
  });

  it("simulates a durable nonce transaction on surfnet", async () => {
    const fixture = loadFixture("v1_durable_nonce");
    const doc = await tenet("simulate", fixture.signature);
    assert.equal(doc.durableNonce, "He4mVHjae11FW51YBw24ghaiLVJHjcWLfE6oEcSAEXuy");
    assert.notEqual(doc.status.errorMessage, "BlockhashNotFound");
  });

  it("simulates a raw transaction with SOL funding", async () => {
    const fixture = loadFixture("v0_pump_sell");
    const payer = "Gygj9QQby4j2jryqyqBHvLP7ctv2SaANgh4sCb69BUpA";
    const doc = await tenet("sim", fixture.transaction[0], "--fund-sol", `${payer}=3sol`);
    assert.equal(doc.mode, "simulate");
    assert.equal(doc.transaction.lookupsResolved, true);
    assert.equal(doc.fundings[0].lamports, "3000000000");
  });
});
