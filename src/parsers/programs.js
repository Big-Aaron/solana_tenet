export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
export const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
export const MEMO_V1_PROGRAM = "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo";

const PROGRAM_NAMES = new Map([
  [SYSTEM_PROGRAM, "System Program"],
  [COMPUTE_BUDGET_PROGRAM, "Compute Budget Program"],
  [TOKEN_PROGRAM, "Token Program"],
  [TOKEN_2022_PROGRAM, "Token-2022 Program"],
  [ASSOCIATED_TOKEN_PROGRAM, "Associated Token Program"],
  [MEMO_PROGRAM, "Memo Program"],
  [MEMO_V1_PROGRAM, "Memo Program v1"],
  ["AddressLookupTab1e1111111111111111111111111", "Address Lookup Table Program"],
  ["Stake11111111111111111111111111111111111111", "Stake Program"],
  ["Vote111111111111111111111111111111111111111", "Vote Program"],
  ["BPFLoaderUpgradeab1e11111111111111111111111", "BPF Upgradeable Loader"],
]);

export function programName(programId) {
  return PROGRAM_NAMES.get(programId) ?? null;
}

export function isTokenProgram(programId) {
  return programId === TOKEN_PROGRAM || programId === TOKEN_2022_PROGRAM;
}
