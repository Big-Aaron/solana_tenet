import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatTransactionError,
  fromSimulation,
  normalizeInnerInstructions,
  solBalanceChanges,
  tokenBalanceChanges,
} from "../src/core/execution.js";

describe("formatTransactionError", () => {
  it("formats instruction errors", () => {
    assert.equal(
      formatTransactionError({ InstructionError: [1, { Custom: 12302 }] }),
      "Instruction #2 failed: custom program error 0x300e (12302)",
    );
    assert.equal(formatTransactionError({ InstructionError: [0, "InvalidAccountData"] }), "Instruction #1 failed: InvalidAccountData");
    assert.equal(
      formatTransactionError({ InstructionError: [0, { BorshIoError: "Unknown" }] }),
      'Instruction #1 failed: BorshIoError: "Unknown"',
    );
  });

  it("passes through other errors", () => {
    assert.equal(formatTransactionError(null), null);
    assert.equal(formatTransactionError("BlockhashNotFound"), "BlockhashNotFound");
    assert.equal(
      formatTransactionError({ InsufficientFundsForRent: { account_index: 2 } }),
      '{"InsufficientFundsForRent":{"account_index":2}}',
    );
  });
});

describe("normalizeInnerInstructions", () => {
  const keys = ["K0", "11111111111111111111111111111111", "K2"];

  it("handles compiled, jsonParsed and partially decoded forms", () => {
    const groups = [
      {
        index: 1,
        instructions: [
          { programIdIndex: 1, accounts: [0, 2], data: "3Bxs4ffTu9T19DNF", stackHeight: 2 },
          { programId: "P", program: "spl-memo", parsed: "hi", stackHeight: 2 },
          { programId: "T", parsed: { type: "transfer", info: { amount: "5" } }, stackHeight: 3 },
          { programId: "X", accounts: ["A"], data: "2", stackHeight: 2 },
        ],
      },
    ];
    const [compiled, memo, parsed, raw] = normalizeInnerInstructions(groups, keys)[1];
    assert.equal(compiled.programId, "11111111111111111111111111111111");
    assert.deepEqual(compiled.accounts, ["K0", "K2"]);
    assert.deepEqual(compiled.accountIndexes, [0, 2]);
    assert.equal(compiled.parsed.name, "transfer");
    assert.deepEqual(memo.parsed, { name: "spl-memo", accountNames: [], fields: { value: "hi" } });
    assert.deepEqual(parsed.parsed.fields, { amount: "5" });
    assert.equal(parsed.stackHeight, 3);
    assert.deepEqual(raw.accounts, ["A"]);
    assert.deepEqual(raw.data, Buffer.from([1]));
  });
});

describe("balance changes", () => {
  const keys = ["A", "B", "C"];

  it("skips unknown and unchanged SOL balances and sorts by magnitude", () => {
    const changes = solBalanceChanges(keys, { pre: [100, 5, null], post: [90, 25, 7] });
    assert.deepEqual(
      changes.map((c) => [c.pubkey, c.delta]),
      [
        ["B", 20n],
        ["A", -10n],
      ],
    );
  });

  it("matches token balances by account index, including closed accounts", () => {
    const entry = (accountIndex, amount) => ({ accountIndex, mint: "M", owner: "O", uiTokenAmount: { amount, decimals: 6 } });
    const changes = tokenBalanceChanges(keys, {
      preToken: [entry(0, "100"), entry(2, "50")],
      postToken: [entry(0, "40"), entry(1, "10")],
    });
    assert.deepEqual(
      changes.map((c) => [c.account, c.before, c.after]),
      [
        ["A", 100n, 40n],
        ["C", 50n, 0n],
        ["B", 0n, 10n],
      ],
    );
  });

  it("prefers simulator balances over local snapshots", () => {
    const local = { pre: [1], post: [2], preToken: [], postToken: [] };
    assert.equal(fromSimulation({ err: null }, keys, local).balances, local);
    const value = { err: null, preBalances: [3], postBalances: [4] };
    assert.deepEqual(fromSimulation(value, keys, local).balances.pre, [3]);
  });
});
