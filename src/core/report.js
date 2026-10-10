import { solBalanceChanges, tokenBalanceChanges } from "./execution.js";
import { computeUnitLimit } from "./transaction.js";

/** Assemble the render model shared by `simulate` and `replay`. */
export function buildReport({ mode, context, tx, execution }) {
  const keys = tx.accounts.map((account) => account.pubkey);
  return {
    mode,
    context,
    tx,
    execution,
    computeUnitLimit: computeUnitLimit(tx),
    balanceChanges: {
      sol: solBalanceChanges(keys, execution.balances),
      token: tokenBalanceChanges(keys, execution.balances),
    },
  };
}
