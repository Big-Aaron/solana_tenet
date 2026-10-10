import assert from "node:assert/strict";
import { describe, it } from "node:test";

import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";

import { balancesFromSnapshots } from "../src/core/accounts.js";
import { decodeTokenAccount } from "../src/core/token.js";
import { SYSTEM_PROGRAM, TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from "../src/parsers/programs.js";
import { fakeConnection } from "./helpers.js";

const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const OWNER = "Dy1jE82CCKsSE6aRFVfxQZemHqJ1Qa81CvGdLhxnJXJj";

function tokenAccountData(amount, size = 165) {
  const data = Buffer.alloc(size);
  Buffer.from(bs58.decode(MINT)).copy(data, 0);
  Buffer.from(bs58.decode(OWNER)).copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  return data;
}

describe("decodeTokenAccount", () => {
  it("decodes legacy and Token-2022 extension accounts", () => {
    const legacy = decodeTokenAccount({ owner: TOKEN_PROGRAM, data: tokenAccountData(5n) });
    assert.deepEqual(legacy, { mint: MINT, owner: OWNER, amount: 5n });

    const extended = tokenAccountData(7n, 182);
    extended[165] = 2;
    assert.equal(decodeTokenAccount({ owner: TOKEN_2022_PROGRAM, data: extended }).amount, 7n);
  });

  it("ignores mints and non-token accounts", () => {
    const mintWithExtensions = Buffer.alloc(182);
    mintWithExtensions[165] = 1;
    assert.equal(decodeTokenAccount({ owner: TOKEN_2022_PROGRAM, data: mintWithExtensions }), null);
    assert.equal(decodeTokenAccount({ owner: SYSTEM_PROGRAM, data: tokenAccountData(1n) }), null);
    assert.equal(decodeTokenAccount(null), null);
  });
});

describe("balancesFromSnapshots", () => {
  it("builds RPC-shaped balances for snapshotted indexes", async () => {
    const mintData = Buffer.alloc(82);
    mintData[44] = 6;
    const connection = fakeConnection({
      [MINT]: { lamports: 1, owner: new PublicKey(TOKEN_PROGRAM), data: mintData },
    });
    const pre = [
      { lamports: 100, owner: SYSTEM_PROGRAM, data: Buffer.alloc(0) },
      { lamports: 2_039_280, owner: TOKEN_PROGRAM, data: tokenAccountData(10n) },
    ];
    const post = [
      { lamports: 95, owner: SYSTEM_PROGRAM, data: Buffer.alloc(0) },
      { lamports: 2_039_280, owner: TOKEN_PROGRAM, data: tokenAccountData(25n) },
    ];

    const balances = await balancesFromSnapshots(connection, 4, [0, 2], pre, post);
    assert.deepEqual(balances.pre, [100, null, 2_039_280, null]);
    assert.deepEqual(balances.post, [95, null, 2_039_280, null]);
    assert.deepEqual(balances.preToken, [
      { accountIndex: 2, mint: MINT, owner: OWNER, uiTokenAmount: { amount: "10", decimals: 6 } },
    ]);
    assert.equal(balances.postToken[0].uiTokenAmount.amount, "25");
  });

  it("treats missing accounts as zero lamports", async () => {
    const balances = await balancesFromSnapshots(fakeConnection({}), 1, [0], [null], [
      { lamports: 890_880, owner: SYSTEM_PROGRAM, data: Buffer.alloc(0) },
    ]);
    assert.deepEqual([balances.pre, balances.post], [[0], [890_880]]);
  });
});
