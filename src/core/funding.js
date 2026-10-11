import { address, getAddressEncoder, getBase58Decoder, getProgramDerivedAddress } from "@solana/kit";

import { ASSOCIATED_TOKEN_PROGRAM } from "../parsers/programs.js";
import { fetchAccounts } from "./accounts.js";
import { setAccount, setTokenAccount } from "./surfnet.js";
import { TOKEN_ACCOUNT_AMOUNT_OFFSET, decodeTokenAccount, mintDecimals } from "./token.js";

const SOL_DECIMALS = 9;
const SOL_AMOUNT = /^(\d+(?:\.\d+)?)(sol|lamports)?$/i;
const TOKEN_AMOUNT = /^\d+(?:\.\d+)?$/;
const addressEncoder = getAddressEncoder();
const base58Decoder = getBase58Decoder();

function parsePubkey(raw, flag) {
  try {
    return base58Decoder.decode(addressEncoder.encode(address(raw)));
  } catch {
    throw new Error(`Invalid pubkey "${raw}" in ${flag}`);
  }
}

function splitSpec(spec, flag, expected) {
  const eq = spec.lastIndexOf("=");
  if (eq <= 0 || eq === spec.length - 1) {
    throw new Error(`Invalid ${flag} value "${spec}": expected ${expected}`);
  }
  return [spec.slice(0, eq), spec.slice(eq + 1)];
}

/** Convert a decimal string to integer base units, rejecting excess precision. */
export function decimalToUnits(text, decimals) {
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > decimals) {
    throw new Error(`Amount "${text}" has more than ${decimals} decimal places`);
  }
  return BigInt(whole + fraction.padEnd(decimals, "0"));
}

/** `<PUBKEY>=<AMOUNT>` where AMOUNT is `1.5`, `1.5sol`, or `5000lamports`. */
export function parseSolFunding(spec) {
  const [left, right] = splitSpec(spec, "--fund-sol", "<PUBKEY>=<AMOUNT>");
  const match = SOL_AMOUNT.exec(right.trim());
  if (!match) {
    throw new Error(`Invalid --fund-sol amount "${right}": expected e.g. 1.5, 1.5sol or 5000lamports`);
  }
  const [, number, unit] = match;
  const isLamports = unit?.toLowerCase() === "lamports";
  if (isLamports && number.includes(".")) {
    throw new Error(`Invalid --fund-sol amount "${right}": lamports must be an integer`);
  }
  return {
    pubkey: parsePubkey(left, "--fund-sol"),
    lamports: isLamports ? BigInt(number) : decimalToUnits(number, SOL_DECIMALS),
  };
}

/**
 * `<TOKEN_ACCOUNT>=<AMOUNT>` patches an existing token account;
 * `<OWNER>:<MINT>=<AMOUNT>` sets (creating if needed) the owner's ATA.
 * Integer amounts are raw units; decimal amounts use the mint's decimals.
 */
export function parseTokenFunding(spec) {
  const [left, right] = splitSpec(spec, "--fund-token", "<TOKEN_ACCOUNT>=<AMOUNT> or <OWNER>:<MINT>=<AMOUNT>");
  const amount = right.trim();
  if (!TOKEN_AMOUNT.test(amount)) {
    throw new Error(`Invalid --fund-token amount "${right}"`);
  }
  const parts = left.split(":");
  if (parts.length === 1) {
    return { account: parsePubkey(parts[0], "--fund-token"), amount };
  }
  if (parts.length === 2) {
    return { owner: parsePubkey(parts[0], "--fund-token"), mint: parsePubkey(parts[1], "--fund-token"), amount };
  }
  throw new Error(`Invalid --fund-token value "${spec}"`);
}

export async function associatedTokenAddress(owner, mint, tokenProgram) {
  const [ata] = await getProgramDerivedAddress({
    programAddress: address(ASSOCIATED_TOKEN_PROGRAM),
    seeds: [
      addressEncoder.encode(address(owner)),
      addressEncoder.encode(address(tokenProgram)),
      addressEncoder.encode(address(mint)),
    ],
  });
  return ata;
}

function toSafeNumber(value, what) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${what} ${value} exceeds the maximum supported value ${Number.MAX_SAFE_INTEGER}`);
  }
  return Number(value);
}

async function fetchMint(connection, mint) {
  const [info] = await fetchAccounts(connection, [mint]);
  const decimals = mintDecimals(info);
  if (decimals == null) {
    throw new Error(`Mint not found or not owned by a token program: ${mint}`);
  }
  return { tokenProgram: info.owner, decimals };
}

async function rawTokenAmount(connection, mint, amount) {
  return amount.includes(".") ? decimalToUnits(amount, (await fetchMint(connection, mint)).decimals) : BigInt(amount);
}

async function fundTokenAccount(connection, { account, amount }) {
  const [info] = await fetchAccounts(connection, [account]);
  const token = decodeTokenAccount(info);
  if (!token) {
    throw new Error(`--fund-token ${account} is not an existing token account (use <OWNER>:<MINT>=<AMOUNT> to create one)`);
  }
  const raw = await rawTokenAmount(connection, token.mint, amount);
  const data = Buffer.from(info.data);
  data.writeBigUInt64LE(raw, TOKEN_ACCOUNT_AMOUNT_OFFSET);
  await setAccount(connection, account, { lamports: info.lamports, data, owner: info.owner });
  return { kind: "token", account, owner: token.owner, mint: token.mint, amount: raw };
}

async function fundOwnerMint(connection, { owner, mint, amount }) {
  const { tokenProgram, decimals } = await fetchMint(connection, mint);
  const raw = amount.includes(".") ? decimalToUnits(amount, decimals) : BigInt(amount);
  await setTokenAccount(connection, owner, mint, { amount: toSafeNumber(raw, "Token amount") }, tokenProgram);
  return {
    kind: "token",
    account: await associatedTokenAddress(owner, mint, tokenProgram),
    owner,
    mint,
    amount: raw,
  };
}

/** Apply funding cheatcodes on the surfnet; returns what was applied for reporting. */
export async function applyFundings(connection, { sol, token }) {
  const applied = [];
  for (const funding of sol) {
    await setAccount(connection, funding.pubkey, { lamports: toSafeNumber(funding.lamports, "Lamports") });
    applied.push({ kind: "sol", account: funding.pubkey, lamports: funding.lamports });
  }
  for (const funding of token) {
    applied.push(funding.account ? await fundTokenAccount(connection, funding) : await fundOwnerMint(connection, funding));
  }
  return applied;
}
