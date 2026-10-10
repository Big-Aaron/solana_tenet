import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { describe, it } from "node:test";
import { promisify } from "node:util";

import { buildDecodeModel } from "../src/commands/decode.js";
import { renderDecodeJson, renderDecodeText } from "../src/output/decode.js";
import { loadFixture } from "./helpers.js";

const run = promisify(execFile);
const CLI = new URL("../bin/tenet.js", import.meta.url).pathname;
const v0 = loadFixture("v0_pump_sell");
const nonce = loadFixture("v1_durable_nonce");

function model(fixture, loadedAddresses = fixture.meta?.loadedAddresses ?? { writable: [], readonly: [] }) {
  return buildDecodeModel({
    wire: fixture.wire,
    loadedAddresses,
    context: { rpcUrl: "https://rpc.test", slot: fixture.slot, blockTime: fixture.blockTime },
  });
}

describe("decode", () => {
  it("renders a v0 transaction with lookups, instructions, and the account list", () => {
    const text = renderDecodeText(model(v0), {});
    assert.match(text, /Decoded Instructions/);
    assert.match(text, /#1 Compute Budget Program: setComputeUnitLimit/);
    assert.match(text, /units {2}400,000/);
    assert.match(text, /Address Lookup Tables/);
    assert.match(text, /Hyif6eWb8x88RVrvjPfabsgRYnwkVnyByEXTVTXbUcyP/);
    assert.match(text, /#18 {2}13ec7XdrjF3h3YcqBTFDSReRcUFwbCnJaAQspM4j6DDJ/);
    assert.match(text, /Account List/);
    assert.match(text, /ALT\[0\] #18/);
    assert.match(text, /slot 455,258,570/);
    assert.doesNotMatch(text, /Execution Trace/);
  });

  it("renders a v1 config and keeps raw instruction data when asked", () => {
    const text = renderDecodeText(model(nonce, null), { rawIxData: true });
    assert.match(text, /v1 config {2}priority fee: 414 lamports, compute unit limit: 360,000/);
    assert.match(text, /#1 System Program: advanceNonceAccount/);
    assert.match(text, /data {2}0x/);
    assert.doesNotMatch(text, /Address Lookup Tables/);
  });

  it("marks unresolved lookup tables", () => {
    const text = renderDecodeText(model(v0, null), {});
    assert.match(text, /address lookup tables could not be resolved/);
    assert.match(text, /<unresolved lookup>/);
  });

  it("serializes one JSON document without execution fields", () => {
    const doc = JSON.parse(renderDecodeJson(model(v0)));
    assert.equal(doc.mode, "decode");
    assert.equal(doc.signature, v0.signature);
    assert.equal(doc.slot, v0.slot);
    assert.equal(doc.transaction.lookupsResolved, true);
    assert.equal(doc.transaction.instructions[0].parsed.name, "setComputeUnitLimit");
    assert.equal(doc.transaction.instructions[0].parsed.fields.units, 400_000);
    assert.equal(doc.transaction.lookupTables[0].writable[0].index, 18);
    assert.equal(doc.transaction.accounts[10].lookup.table, 0);
    assert.equal(doc.status, undefined);
    assert.equal(doc.logs, undefined);
  });

  it("decodes a raw transaction through the CLI", async () => {
    const stdout = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [CLI, "dec", "--json"], { stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      let err = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`decode timed out\n${err}`));
      }, 10_000);
      child.stdout.on("data", (chunk) => {
        out += chunk;
      });
      child.stderr.on("data", (chunk) => {
        err += chunk;
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(out);
        else reject(new Error(err || out));
      });
      child.stdin.end(nonce.wire.toString("base64"));
    });
    const doc = JSON.parse(stdout);
    assert.equal(doc.mode, "decode");
    assert.equal(doc.slot, null);
    assert.equal(doc.transaction.version, 1);
    assert.equal(doc.transaction.instructions[0].parsed.name, "advanceNonceAccount");
    assert.equal(doc.transaction.lookupsResolved, true);
  });

  it("documents the command in --help", async () => {
    const { stdout } = await run(process.execPath, [CLI, "decode", "--help"], { timeout: 10_000 });
    assert.match(stdout, /without executing/);
    assert.match(stdout, /--raw-ix-data/);
    assert.match(stdout, /--json/);
  });
});
