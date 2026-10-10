import { Connection } from "@solana/web3.js";

export const DEFAULT_RPC_URL = "https://api.mainnet-beta.solana.com";

export function resolveRpcUrl(flag) {
  return flag ?? process.env.TENET_RPC_URL ?? process.env.SOLANA_RPC_URL ?? DEFAULT_RPC_URL;
}

export function createConnection(url) {
  return new Connection(url, "confirmed");
}

/**
 * Raw JSON-RPC call through web3.js' transport. Used where the typed
 * `Connection` methods would re-serialize the transaction: web3.js 1.x can
 * deserialize v1 (SIMD-0385) messages but cannot serialize them.
 */
export async function rpcRequest(connection, method, params) {
  const response = await connection._rpcRequest(method, params);
  if (response.error) {
    const { code, message } = response.error;
    throw Object.assign(new Error(`RPC ${method} failed (${code}): ${message}`), { code });
  }
  return response.result;
}

/** Fetch a confirmed transaction with its original wire bytes and metadata. */
export async function fetchTransaction(connection, signature) {
  const result = await rpcRequest(connection, "getTransaction", [
    signature,
    { encoding: "base64", commitment: "confirmed", maxSupportedTransactionVersion: 1 },
  ]);
  if (!result) {
    throw new Error(`Transaction not found: ${signature}`);
  }
  return {
    wire: Buffer.from(result.transaction[0], "base64"),
    meta: result.meta ?? null,
    slot: result.slot,
    blockTime: result.blockTime ?? null,
  };
}
