import assert from "node:assert/strict";
import { describe, it } from "node:test";

import bs58 from "bs58";

import {
  classifyInput,
  computeUnitLimit,
  decodeTransaction,
  describeLookups,
  describeTransaction,
  durableNonceAccount,
  parseSignature,
  withNonceBlockhash,
} from "../src/core/transaction.js";
import { loadFixture } from "./helpers.js";

const v0 = loadFixture("v0_pump_sell");
const nonce = loadFixture("v1_durable_nonce");

describe("classifyInput", () => {
  it("detects a signature", () => {
    assert.deepEqual(classifyInput(` ${v0.signature}\n`), { kind: "signature", signature: v0.signature });
  });

  it("decodes base64 and base58 transactions", () => {
    assert.deepEqual(classifyInput(v0.wire.toString("base64")).wire, v0.wire);
    assert.deepEqual(classifyInput(bs58.encode(v0.wire)).wire, v0.wire);
  });

  it("rejects garbage", () => {
    assert.throws(() => classifyInput("not a tx"), /neither a transaction signature/);
    assert.throws(() => classifyInput("   "), /Empty transaction input/);
  });
});

describe("parseSignature", () => {
  it("accepts a 64-byte base58 signature and rejects others", () => {
    assert.equal(parseSignature(v0.signature), v0.signature);
    assert.throws(() => parseSignature("abc"), /Invalid transaction signature/);
  });
});

describe("durable nonce", () => {
  it("finds the nonce account of an AdvanceNonceAccount transaction", () => {
    assert.equal(durableNonceAccount(decodeTransaction(nonce.wire)), "He4mVHjae11FW51YBw24ghaiLVJHjcWLfE6oEcSAEXuy");
    assert.equal(durableNonceAccount(decodeTransaction(v0.wire)), null);
  });

  it("rewrites the stored nonce value", () => {
    const blockhash = decodeTransaction(nonce.wire).message.recentBlockhash;
    const patched = withNonceBlockhash(Buffer.alloc(80, 7), blockhash);
    assert.equal(bs58.encode(patched.subarray(40, 72)), blockhash);
    assert.equal(patched[39], 7);
    assert.equal(patched[72], 7);
    assert.throws(() => withNonceBlockhash(Buffer.alloc(10), blockhash), /too short/);
  });
});

describe("describeTransaction", () => {
  it("orders static keys, then writable and readonly lookups", () => {
    const tx = decodeTransaction(v0.wire);
    const info = describeTransaction(tx, v0.wire, v0.meta.loadedAddresses);
    const staticCount = tx.message.staticAccountKeys.length;
    const { writable, readonly } = v0.meta.loadedAddresses;

    assert.equal(info.version, 0);
    assert.equal(info.signature, v0.signature);
    assert.equal(info.accounts.length, staticCount + writable.length + readonly.length);
    assert.equal(info.accounts[staticCount].pubkey, writable[0]);
    assert.equal(info.accounts[staticCount].writable, true);
    assert.equal(info.accounts.at(-1).pubkey, readonly.at(-1));
    assert.equal(info.accounts.at(-1).writable, false);
    assert.equal(info.accounts[0].signer, true);
    assert.ok(info.lookupsResolved);
    assert.equal(info.instructions[1].parsed.name, "setComputeUnitPrice");
  });

  it("leaves lookup accounts unresolved without loaded addresses", () => {
    const info = describeTransaction(decodeTransaction(v0.wire), v0.wire, null);
    assert.equal(info.lookupsResolved, false);
    assert.ok(info.instructions[2].accounts.includes(null));
  });

  it("exposes the v1 transaction config", () => {
    const info = describeTransaction(decodeTransaction(nonce.wire), nonce.wire, null);
    assert.equal(info.version, 1);
    assert.equal(info.config.computeUnitLimit, 360_000);
    assert.ok(info.lookupsResolved);
  });
});

describe("describeLookups", () => {
  it("pairs lookup indexes with loaded addresses in runtime order", () => {
    const tx = decodeTransaction(v0.wire);
    const { tables, accountTags } = describeLookups(tx, v0.meta.loadedAddresses);
    const staticCount = tx.message.staticAccountKeys.length;

    assert.equal(tables.length, 1);
    assert.equal(tables[0].accountKey, "Hyif6eWb8x88RVrvjPfabsgRYnwkVnyByEXTVTXbUcyP");
    assert.deepEqual(
      tables[0].writable.map((entry) => entry.index),
      [18, 19, 37, 33],
    );
    assert.equal(tables[0].writable[0].pubkey, v0.meta.loadedAddresses.writable[0]);
    assert.equal(tables[0].readonly.at(-1).pubkey, v0.meta.loadedAddresses.readonly.at(-1));
    assert.equal(accountTags[staticCount].index, 18);
    assert.equal(accountTags.at(-1).index, 20);
    assert.equal(accountTags[0], null);
  });

  it("keeps table indexes when addresses are unresolved", () => {
    const { tables, accountTags } = describeLookups(decodeTransaction(v0.wire), null);
    assert.equal(tables[0].writable[0].pubkey, null);
    assert.equal(accountTags.length, decodeTransaction(v0.wire).message.staticAccountKeys.length);
  });
});

describe("computeUnitLimit", () => {
  const base = { config: null, instructions: [] };
  const budget = { programId: "ComputeBudget111111111111111111111111111111" };

  it("prefers the v1 config, then SetComputeUnitLimit", () => {
    assert.equal(computeUnitLimit({ ...base, config: { computeUnitLimit: 5 } }), 5);
    const setLimit = { ...budget, parsed: { name: "setComputeUnitLimit", fields: { units: 400_000 } } };
    assert.equal(computeUnitLimit({ ...base, instructions: [setLimit, { programId: "x" }] }), 400_000);
  });

  it("falls back to 200k per non-budget instruction, capped at 1.4M", () => {
    assert.equal(computeUnitLimit({ ...base, instructions: [budget, { programId: "a" }, { programId: "b" }] }), 400_000);
    const many = Array.from({ length: 10 }, () => ({ programId: "a" }));
    assert.equal(computeUnitLimit({ ...base, instructions: many }), 1_400_000);
  });
});
