export const CLOCK_SYSVAR = "SysvarC1ock11111111111111111111111111111111";

const SLOT_OFFSET = 0;
const UNIX_TIMESTAMP_OFFSET = 32;
const CLOCK_SIZE = 40;
const UNSIGNED = /^\d+$/;
const SIGNED = /^-?\d+$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

export function parseSlot(raw) {
  const text = String(raw).trim();
  if (!UNSIGNED.test(text) || !Number.isSafeInteger(Number(text))) {
    throw new Error(`Invalid --slot "${raw}": expected a non-negative integer`);
  }
  return Number(text);
}

/** Unix seconds (`1700000000`) or RFC3339 (`2024-01-01T00:00:00Z`) to Unix seconds. */
export function parseTimestamp(raw) {
  const text = String(raw).trim();
  if (SIGNED.test(text) && Number.isSafeInteger(Number(text))) {
    return Number(text);
  }
  if (RFC3339.test(text)) {
    return Math.floor(Date.parse(text) / 1000);
  }
  throw new Error(
    `Invalid --timestamp "${raw}": supported formats are Unix seconds (e.g. 1700000000) ` +
      "or RFC3339 (e.g. 2024-01-01T00:00:00Z)",
  );
}

export function decodeClock(data) {
  if (data.length < CLOCK_SIZE) {
    throw new Error(`Clock sysvar data is too short (${data.length} bytes)`);
  }
  return {
    slot: Number(data.readBigUInt64LE(SLOT_OFFSET)),
    unixTimestamp: Number(data.readBigInt64LE(UNIX_TIMESTAMP_OFFSET)),
  };
}

/** Copy of Clock sysvar data with `slot` and/or `unixTimestamp` replaced; other fields are kept. */
export function withClock(data, { slot, unixTimestamp }) {
  decodeClock(data);
  const patched = Buffer.from(data);
  if (slot != null) {
    patched.writeBigUInt64LE(BigInt(slot), SLOT_OFFSET);
  }
  if (unixTimestamp != null) {
    patched.writeBigInt64LE(BigInt(unixTimestamp), UNIX_TIMESTAMP_OFFSET);
  }
  return patched;
}

export function parseClockOptions({ slot, timestamp, atTxTime }) {
  return {
    slot: slot != null ? parseSlot(slot) : null,
    unixTimestamp: timestamp != null ? parseTimestamp(timestamp) : null,
    atTxTime: Boolean(atTxTime),
  };
}

/**
 * Clock to pin, or `null` when nothing is pinned. `--at-tx-time` takes the
 * slot and block time of the fetched transaction; explicit values win.
 */
export function resolveClockOverride(options, fetched) {
  if (options.atTxTime && !fetched) {
    throw new Error("--at-tx-time requires a transaction signature as input");
  }
  const fromTx = options.atTxTime ? fetched : {};
  const slot = options.slot ?? fromTx.slot ?? null;
  const unixTimestamp = options.unixTimestamp ?? fromTx.blockTime ?? null;
  return slot == null && unixTimestamp == null ? null : { slot, unixTimestamp };
}
