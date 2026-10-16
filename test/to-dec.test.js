import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { describe, it } from "node:test";
import { promisify } from "node:util";

import { littleEndianToDecimal } from "../src/commands/to-dec.js";

const run = promisify(execFile);
const CLI = new URL("../bin/tenet.js", import.meta.url).pathname;

describe("to-dec", () => {
  it("reads little-endian hex as a decimal integer", () => {
    assert.equal(littleEndianToDecimal("0x639b010000000000"), "105315");
    assert.equal(littleEndianToDecimal("639B010000000000"), "105315");
    assert.equal(littleEndianToDecimal("0x0100"), "1");
    assert.equal(littleEndianToDecimal("0x00"), "0");
    assert.equal(littleEndianToDecimal("0xffffffffffffffff"), "18446744073709551615");
  });

  it("rejects hex that is not whole little-endian bytes", () => {
    assert.throws(() => littleEndianToDecimal("0x639"), /invalid little-endian hex/);
    assert.throws(() => littleEndianToDecimal("0x"), /invalid little-endian hex/);
    assert.throws(() => littleEndianToDecimal("zz"), /invalid little-endian hex/);
  });

  it("prints the decimal from the CLI", async () => {
    const { stdout } = await run(process.execPath, [CLI, "to-dec", "0x639b010000000000"], { timeout: 10_000 });
    assert.equal(stdout, "105315\n");
  });
});
