import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeInnerInstructions } from "../src/core/execution.js";
import { decodeTransaction, describeTransaction } from "../src/core/transaction.js";
import { annotateTrace, parseLogs } from "../src/parsers/logs.js";
import { loadFixture } from "./helpers.js";

describe("parseLogs", () => {
  it("nests invocations and records status", () => {
    const root = parseLogs([
      "Program A invoke [1]",
      "Program log: hello",
      "Program B invoke [2]",
      "Program data: AQI=",
      "Program B consumed 10 of 100 compute units",
      "Program B success",
      "Program A failed: custom program error: 0x1",
      "Log truncated",
    ]);
    const [outer, trailing] = root.entries;
    assert.equal(outer.frame.programId, "A");
    assert.equal(outer.frame.status, "failed");
    assert.equal(outer.frame.error, "custom program error: 0x1");
    const [log, invoke] = outer.frame.entries;
    assert.deepEqual(log, { type: "log", text: "hello" });
    assert.equal(invoke.frame.programId, "B");
    assert.equal(invoke.frame.status, "success");
    assert.deepEqual(invoke.frame.entries[1], { type: "consumed", consumed: 10, budget: 100 });
    assert.deepEqual(trailing, { type: "other", text: "Log truncated" });
  });

  it("does not mistake program log text for invoke lines", () => {
    const root = parseLogs(["Program A invoke [1]", "Program log: Program X invoke [2]", "Program A success"]);
    assert.equal(root.entries[0].frame.entries[0].type, "log");
  });
});

describe("annotateTrace", () => {
  it("matches frames to outer and inner instructions", () => {
    const fixture = loadFixture("v0_pump_sell");
    const info = describeTransaction(decodeTransaction(fixture.wire), fixture.wire, fixture.meta.loadedAddresses);
    const keys = info.accounts.map((account) => account.pubkey);
    const inner = normalizeInnerInstructions(fixture.meta.innerInstructions, keys);
    const root = annotateTrace(parseLogs(fixture.meta.logMessages), info.instructions, inner);

    const frames = root.entries.map((entry) => entry.frame);
    assert.deepEqual(frames.map((frame) => frame.path), ["1", "2", "3"]);
    assert.equal(frames[0].instruction.parsed.name, "setComputeUnitLimit");

    const nested = frames[2].entries.filter((entry) => entry.type === "invoke").map((entry) => entry.frame);
    assert.deepEqual(nested.map((frame) => frame.path), ["3.1", "3.5"]);
    const transfer = nested[0].entries.filter((entry) => entry.type === "invoke")[1].frame;
    assert.equal(transfer.path, "3.3");
    assert.equal(transfer.instruction.parsed.name, "transferChecked");
  });
});
