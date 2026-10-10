import bs58 from "bs58";

import { isTokenProgram } from "../parsers/programs.js";

const TOKEN_ACCOUNT_SIZE = 165;
export const TOKEN_ACCOUNT_AMOUNT_OFFSET = 64;
const ACCOUNT_TYPE_OFFSET = TOKEN_ACCOUNT_SIZE;
const ACCOUNT_TYPE_ACCOUNT = 2;
const MINT_DECIMALS_OFFSET = 44;

/**
 * Token-2022 accounts with extensions are longer than 165 bytes and carry an
 * account-type byte at offset 165 (mints with extensions are padded the same way).
 */
function isTokenAccountData(data) {
  return (
    data.length === TOKEN_ACCOUNT_SIZE ||
    (data.length > TOKEN_ACCOUNT_SIZE && data[ACCOUNT_TYPE_OFFSET] === ACCOUNT_TYPE_ACCOUNT)
  );
}

/** `{ mint, owner, amount }` for an SPL Token / Token-2022 account, otherwise `null`. */
export function decodeTokenAccount(account) {
  if (!account || !isTokenProgram(account.owner) || !isTokenAccountData(account.data)) {
    return null;
  }
  return {
    mint: bs58.encode(account.data.subarray(0, 32)),
    owner: bs58.encode(account.data.subarray(32, 64)),
    amount: account.data.readBigUInt64LE(TOKEN_ACCOUNT_AMOUNT_OFFSET),
  };
}

export function mintDecimals(account) {
  if (!account || !isTokenProgram(account.owner) || account.data.length <= MINT_DECIMALS_OFFSET) {
    return null;
  }
  return account.data[MINT_DECIMALS_OFFSET];
}
