import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decodeClock,
  parseClockOptions,
  parseSlot,
  parseTimestamp,
  resolveClockOverride,
  withClock,
} from "../src/core/clock.js";

describe("parseTimestamp", () => {
  it("accepts Unix seconds and RFC3339", () => {
    assert.equal(parseTimestamp("1700000000"), 1_700_000_000);
    assert.equal(parseTimestamp("2024-01-01T00:00:00Z"), 1_704_067_200);
    assert.equal(parseTimestamp("2024-01-01T08:00:00.5+08:00"), 1_704_067_200);
  });

  it("rejects other formats", () => {
    assert.throws(() => parseTimestamp("2024-01-01"), /supported formats/);
    assert.throws(() => parseTimestamp("tomorrow"), /Invalid --timestamp/);
  });
});

describe("parseSlot", () => {
  it("accepts non-negative integers only", () => {
    assert.equal(parseSlot("416697641"), 416_697_641);
    assert.throws(() => parseSlot("-1"), /Invalid --slot/);
    assert.throws(() => parseSlot("1.5"), /Invalid --slot/);
  });
});

describe("withClock", () => {
  const clock = Buffer.alloc(40);
  clock.writeBigUInt64LE(100n, 0);
  clock.writeBigInt64LE(50n, 8);
  clock.writeBigInt64LE(1_000n, 32);

  it("replaces only the requested fields", () => {
    const patched = withClock(clock, { slot: 7, unixTimestamp: null });
    assert.deepEqual(decodeClock(patched), { slot: 7, unixTimestamp: 1_000 });
    assert.equal(patched.readBigInt64LE(8), 50n);
    assert.deepEqual(decodeClock(withClock(clock, { unixTimestamp: -5 })), { slot: 100, unixTimestamp: -5 });
    assert.deepEqual(decodeClock(clock), { slot: 100, unixTimestamp: 1_000 });
  });

  it("rejects truncated data", () => {
    assert.throws(() => withClock(Buffer.alloc(8), { slot: 1 }), /too short/);
  });
});

describe("resolveClockOverride", () => {
  const fetched = { slot: 416_697_641, blockTime: 1_777_568_172 };

  it("returns null when nothing is pinned", () => {
    assert.equal(resolveClockOverride(parseClockOptions({}), null), null);
  });

  it("uses the transaction's slot and block time for --at-tx-time", () => {
    assert.deepEqual(resolveClockOverride(parseClockOptions({ atTxTime: true }), fetched), {
      slot: 416_697_641,
      unixTimestamp: 1_777_568_172,
    });
  });

  it("lets explicit values win over --at-tx-time", () => {
    const options = parseClockOptions({ atTxTime: true, timestamp: "1700000000" });
    assert.deepEqual(resolveClockOverride(options, fetched), { slot: 416_697_641, unixTimestamp: 1_700_000_000 });
  });

  it("pins only the slot when the block time is unknown", () => {
    const options = parseClockOptions({ atTxTime: true });
    assert.deepEqual(resolveClockOverride(options, { slot: 1, blockTime: null }), { slot: 1, unixTimestamp: null });
  });

  it("requires a fetched transaction for --at-tx-time", () => {
    assert.throws(() => resolveClockOverride(parseClockOptions({ atTxTime: true }), null), /requires a transaction signature/);
  });
});
