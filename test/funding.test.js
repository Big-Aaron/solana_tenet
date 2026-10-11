import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  associatedTokenAddress,
  decimalToUnits,
  parseSolFunding,
  parseTokenFunding,
} from "../src/core/funding.js";
import { TOKEN_PROGRAM } from "../src/parsers/programs.js";

const WALLET = "Dy1jE82CCKsSE6aRFVfxQZemHqJ1Qa81CvGdLhxnJXJj";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

describe("parseSolFunding", () => {
  it("accepts SOL and lamport amounts", () => {
    assert.equal(parseSolFunding(`${WALLET}=1.5`).lamports, 1_500_000_000n);
    assert.equal(parseSolFunding(`${WALLET}=10sol`).lamports, 10_000_000_000n);
    assert.equal(parseSolFunding(`${WALLET}=5000lamports`).lamports, 5000n);
  });

  it("rejects malformed specs", () => {
    assert.throws(() => parseSolFunding(WALLET), /expected <PUBKEY>=<AMOUNT>/);
    assert.throws(() => parseSolFunding("foo=1"), /Invalid pubkey "foo"/);
    assert.throws(() => parseSolFunding(`${WALLET}=1.5lamports`), /must be an integer/);
    assert.throws(() => parseSolFunding(`${WALLET}=-1`), /Invalid --fund-sol amount/);
  });
});

describe("parseTokenFunding", () => {
  it("parses both forms", () => {
    assert.deepEqual(parseTokenFunding(`${WALLET}=100`), { account: WALLET, amount: "100" });
    assert.deepEqual(parseTokenFunding(`${WALLET}:${USDC}=1.5`), { owner: WALLET, mint: USDC, amount: "1.5" });
  });

  it("rejects malformed specs", () => {
    assert.throws(() => parseTokenFunding(`${WALLET}=abc`), /Invalid --fund-token amount/);
    assert.throws(() => parseTokenFunding(`${WALLET}:${USDC}:${WALLET}=1`), /Invalid --fund-token value/);
  });
});

describe("decimalToUnits", () => {
  it("scales and validates precision", () => {
    assert.equal(decimalToUnits("1.5", 6), 1_500_000n);
    assert.equal(decimalToUnits("42", 0), 42n);
    assert.throws(() => decimalToUnits("0.1234567", 6), /more than 6 decimal places/);
  });
});

describe("associatedTokenAddress", () => {
  it("derives the ATA", async () => {
    assert.equal(
      await associatedTokenAddress(WALLET, USDC, TOKEN_PROGRAM),
      "2h3ogbUHK6rCuCwnPGhNSMTMjhr6XxQTeY6awuDWE9uD",
    );
  });
});
