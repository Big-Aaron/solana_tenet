import { formatInt, paint, permissionMarker, section, versionLabel } from "./format.js";
import { serializeInstruction } from "./json.js";
import { renderInstructionDetails, v1ConfigLine } from "./text.js";

const UNRESOLVED = "<unresolved lookup>";

function overview({ context, tx, signatures }) {
  const rows = [];
  if (signatures.length > 1) {
    signatures.forEach((signature, index) => rows.push([`Signature ${index + 1}`, signature ?? "(unsigned)"]));
  } else {
    rows.push(["Signature", signatures[0] ?? "(unsigned)"]);
  }
  rows.push(["Version", versionLabel(tx.version)]);
  rows.push(["Size", `${formatInt(tx.size)} bytes`]);
  rows.push(["Blockhash", tx.recentBlockhash]);
  if (context.slot != null) {
    const time = context.blockTime != null ? `, ${new Date(context.blockTime * 1000).toISOString()}` : "";
    rows.push(["Source", `${context.rpcUrl} (slot ${formatInt(context.slot)}${time})`]);
  }
  if (tx.config) rows.push(["v1 config", v1ConfigLine(tx.config)]);
  if (!tx.lookupsResolved) rows.push(["Lookups", paint("yellow", "address lookup tables could not be resolved")]);

  const width = Math.max(...rows.map(([label]) => label.length)) + 2;
  return rows.map(([label, value]) => `  ${paint("dim", label.padEnd(width))}${value}`);
}

function lookupTables(lookups) {
  const lines = [];
  lookups.forEach((lookup, table) => {
    lines.push(`  ${paint("dim", `[${table}]`)} ${lookup.accountKey}`);
    for (const kind of ["writable", "readonly"]) {
      if (lookup[kind].length === 0) continue;
      lines.push(paint("dim", `      ${kind}`));
      for (const entry of lookup[kind]) {
        lines.push(`        ${paint("dim", `#${entry.index}`)}  ${entry.pubkey ?? UNRESOLVED}`);
      }
    }
  });
  return lines;
}

function accountList(accounts) {
  const width = String(Math.max(0, accounts.length - 1)).length;
  return accounts.map((account) => {
    const index = String(account.index).padStart(width);
    const tag = account.lookup ? paint("dim", `  ALT[${account.lookup.table}] #${account.lookup.index}`) : "";
    return `  ${paint("dim", `[${index}]`)} ${account.pubkey ?? UNRESOLVED} ${permissionMarker(account)}${tag}`;
  });
}

export function renderDecodeText(model, opts) {
  const { tx, lookups, accounts } = model;
  const lines = ["", section("Transaction"), "", ...overview(model), "", section("Decoded Instructions"), ""];
  lines.push(...renderInstructionDetails(tx, opts));
  if (lookups.length > 0) {
    lines.push("", section("Address Lookup Tables"), "", ...lookupTables(lookups));
  }
  lines.push("", section("Account List"), "", ...accountList(accounts), "");
  return lines.join("\n");
}

export function renderDecodeJson(model) {
  const { context, tx, lookups, signatures, accounts } = model;
  const document = {
    mode: "decode",
    signature: tx.signature,
    signatures,
    slot: context.slot,
    blockTime: context.blockTime,
    rpcUrl: context.rpcUrl,
    transaction: {
      version: tx.version,
      size: tx.size,
      recentBlockhash: tx.recentBlockhash,
      config: tx.config,
      lookupsResolved: tx.lookupsResolved,
      lookupTables: lookups,
      accounts,
      instructions: tx.instructions.map((ix) => ({ index: ix.index, ...serializeInstruction(ix) })),
    },
  };
  return JSON.stringify(document, (_key, value) => (typeof value === "bigint" ? value.toString() : value), 2);
}
