import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decodeInstruction } from "../src/parsers/instructions.js";
import {
  ASSOCIATED_TOKEN_PROGRAM,
  COMPUTE_BUDGET_PROGRAM,
  MEMO_PROGRAM,
  SYSTEM_PROGRAM,
  TOKEN_2022_PROGRAM,
} from "../src/parsers/programs.js";

describe("decodeInstruction", () => {
  it("decodes a system transfer", () => {
    const data = Buffer.alloc(12);
    data.writeUInt32LE(2, 0);
    data.writeBigUInt64LE(1_000_000_000n, 4);
    const parsed = decodeInstruction(SYSTEM_PROGRAM, data);
    assert.equal(parsed.name, "transfer");
    assert.deepEqual(parsed.accountNames, ["source", "destination"]);
    assert.equal(parsed.fields.lamports, 1_000_000_000n);
  });

  it("decodes compute budget instructions", () => {
    const limit = Buffer.from([2, 0x80, 0x1a, 0x06, 0x00]);
    assert.deepEqual(decodeInstruction(COMPUTE_BUDGET_PROGRAM, limit).fields, { units: 400_000 });
  });

  it("decodes Token-2022 transferChecked", () => {
    const data = Buffer.alloc(10);
    data[0] = 12;
    data.writeBigUInt64LE(42n, 1);
    data[9] = 6;
    const parsed = decodeInstruction(TOKEN_2022_PROGRAM, data);
    assert.equal(parsed.name, "transferChecked");
    assert.deepEqual(parsed.fields, { amount: 42n, decimals: 6 });
  });

  it("treats empty ATA data as create", () => {
    assert.equal(decodeInstruction(ASSOCIATED_TOKEN_PROGRAM, Buffer.alloc(0)).name, "create");
    assert.equal(decodeInstruction(ASSOCIATED_TOKEN_PROGRAM, Buffer.from([1])).name, "createIdempotent");
  });

  it("decodes memo text", () => {
    assert.deepEqual(decodeInstruction(MEMO_PROGRAM, Buffer.from("hello")).fields, { text: "hello" });
  });

  it("returns null for unknown programs and truncated data", () => {
    assert.equal(decodeInstruction("JUP6LkbZbjS1jKKwapdHNy74zcZ3tUP3wQ1yt3EJ4Vf", Buffer.from([1, 2])), null);
    assert.equal(decodeInstruction(SYSTEM_PROGRAM, Buffer.from([2, 0, 0, 0, 1])), null);
    assert.equal(decodeInstruction(SYSTEM_PROGRAM, Buffer.from([99, 0, 0, 0])), null);
  });
});
