import { styleText } from "node:util";

const SECTION_WIDTH = 80;

/** Style text for `stream`; styling is dropped for non-TTY streams and when NO_COLOR is set. */
export function paint(format, text, stream = process.stdout) {
  return styleText(format, String(text), { stream });
}

export function formatInt(value) {
  return Number(value).toLocaleString("en-US");
}

/** Render an integer amount of base units as a fixed-point decimal string. */
export function formatUnits(value, decimals) {
  const amount = BigInt(value);
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const sign = negative ? "-" : "";
  if (decimals === 0) {
    return `${sign}${abs}`;
  }
  const base = 10n ** BigInt(decimals);
  const fraction = (abs % base).toString().padStart(decimals, "0");
  return `${sign}${abs / base}.${fraction}`;
}

export function formatSol(lamports) {
  return formatUnits(lamports, 9);
}

export function formatSigned(value, decimals) {
  const text = formatUnits(value, decimals);
  return BigInt(value) > 0n ? `+${text}` : text;
}

export function hex(data) {
  return `0x${Buffer.from(data).toString("hex")}`;
}

/** A centered ` ─── title ─── ` rule; `styled` replaces the title after width is computed from `title`. */
export function section(title, styled = title) {
  const label = ` ${title} `;
  const fill = Math.max(4, SECTION_WIDTH - label.length);
  const left = Math.floor(fill / 2);
  return ` ${"─".repeat(left)} ${styled} ${"─".repeat(fill - left)} `;
}

export function versionLabel(version) {
  return version === "legacy" ? "legacy" : `v${version}`;
}

/** `[sig perm exe]` marker, e.g. `[sw-]` for a writable signer. */
export function permissionMarker(account) {
  const sig = account.signer ? "s" : "-";
  const perm = account.writable ? "w" : "r";
  const exe = account.executable ? "x" : "-";
  return `[${sig}${perm}${exe}]`;
}
