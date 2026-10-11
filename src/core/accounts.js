import { decodeTokenAccount, mintDecimals } from "./token.js";

/** Account snapshot: `{ lamports, owner, data: Buffer }`, or `null` when the account doesn't exist. */
export async function fetchAccounts(rpc, pubkeys) {
  if (pubkeys.length === 0) {
    return [];
  }
  const { value } = await rpc.getMultipleAccounts(pubkeys, { encoding: "base64" }).send();
  return value.map(
    (info) => info && { lamports: info.lamports, owner: info.owner, data: Buffer.from(info.data[0], "base64") },
  );
}

/** Accounts returned by `simulateTransaction` with `accounts.encoding = "base64"`. */
export function fromUiAccounts(accounts) {
  return accounts.map(
    (account) =>
      account && { lamports: account.lamports, owner: account.owner, data: Buffer.from(account.data[0], "base64") },
  );
}

function tokenEntry(accountIndex, token, decimals) {
  return {
    accountIndex,
    mint: token.mint,
    owner: token.owner,
    uiTokenAmount: { amount: token.amount.toString(), decimals },
  };
}

/**
 * Build RPC-shaped balances (`preBalances`/`postTokenBalances` style) from
 * account snapshots taken before and after simulation. `indexes[i]` is the
 * transaction account index of `pre[i]`/`post[i]`; other slots stay `null`.
 */
export async function balancesFromSnapshots(connection, keyCount, indexes, pre, post) {
  const preLamports = new Array(keyCount).fill(null);
  const postLamports = new Array(keyCount).fill(null);
  const preTokens = [];
  const postTokens = [];
  indexes.forEach((accountIndex, i) => {
    preLamports[accountIndex] = pre[i]?.lamports ?? 0;
    postLamports[accountIndex] = post[i]?.lamports ?? 0;
    const before = decodeTokenAccount(pre[i]);
    const after = decodeTokenAccount(post[i]);
    if (before) preTokens.push([accountIndex, before]);
    if (after) postTokens.push([accountIndex, after]);
  });

  const mints = [...new Set([...preTokens, ...postTokens].map(([, token]) => token.mint))];
  const mintAccounts = await fetchAccounts(connection, mints);
  const decimals = new Map(mints.map((mint, i) => [mint, mintDecimals(mintAccounts[i]) ?? 0]));
  const toEntries = (list) => list.map(([index, token]) => tokenEntry(index, token, decimals.get(token.mint)));

  return {
    pre: preLamports,
    post: postLamports,
    preToken: toEntries(preTokens),
    postToken: toEntries(postTokens),
  };
}
