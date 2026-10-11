import { createSolanaRpc } from "@solana/kit";

export const DEFAULT_RPC_URL = "https://api.mainnet-beta.solana.com";

const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

export function resolveRpcUrl(flag) {
  return flag ?? process.env.TENET_RPC_URL ?? process.env.SOLANA_RPC_URL ?? DEFAULT_RPC_URL;
}

/**
 * Kit RPC client for `url`.
 *
 * JSON-RPC failures keep the server error code (surfnet uses -32603 for
 * transient internal errors). Numeric fields that fit in a safe integer stay
 * numbers, matching the values this CLI already renders.
 */
export function createRpc(url) {
  const rpc = createSolanaRpc(url);
  return new Proxy(rpc, {
    get(target, prop, receiver) {
      if (typeof prop !== "string") {
        return Reflect.get(target, prop, receiver);
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") {
        return value;
      }
      return (...args) => {
        const pending = value.apply(target, args);
        if (!pending || typeof pending.send !== "function") {
          return pending;
        }
        return {
          send: (options) => send(pending, prop, options),
        };
      };
    },
  });
}

async function send(pending, method, options) {
  try {
    return normalizeNumbers(await pending.send(options));
  } catch (error) {
    const code = error?.code;
    if (typeof code === "number" && code <= -32000) {
      const serverMessage = error.context?.__serverMessage ?? error.message;
      throw Object.assign(new Error(`RPC ${method} failed (${code}): ${serverMessage}`), { code });
    }
    throw error;
  }
}

function normalizeNumbers(value) {
  if (typeof value === "bigint") {
    return value >= -MAX_SAFE_INTEGER && value <= MAX_SAFE_INTEGER ? Number(value) : value;
  }
  if (Array.isArray(value)) {
    return value.map(normalizeNumbers);
  }
  if (value && typeof value === "object" && !ArrayBuffer.isView(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeNumbers(item)]));
  }
  return value;
}

/** Fetch a confirmed transaction with its original wire bytes and metadata. */
export async function fetchTransaction(rpc, signature) {
  const result = await rpc
    .getTransaction(signature, {
      encoding: "base64",
      commitment: "confirmed",
      maxSupportedTransactionVersion: 1,
    })
    .send();
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
