import { annotateTrace, parseLogs } from "../parsers/logs.js";
import { programName } from "../parsers/programs.js";
import {
  formatInt,
  formatSigned,
  formatSol,
  formatUnits,
  hex,
  paint,
  permissionMarker,
  section,
  versionLabel,
} from "./format.js";

const UNRESOLVED = "<unresolved lookup>";

function instructionLabel(programId, parsed) {
  const program = programName(programId) ?? programId ?? UNRESOLVED;
  return parsed ? `${program}: ${parsed.name}` : program;
}

function formatField(value) {
  if (typeof value === "bigint" || typeof value === "number") {
    return formatInt(value);
  }
  return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
}

function header({ tx, execution, computeUnitLimit }) {
  const statusPlain = execution.success ? "✓ SUCCESS" : "✗ FAILED";
  const statusStyled = paint(["bold", execution.success ? "green" : "red"], statusPlain);
  const parts = [];
  if (execution.computeUnits != null) {
    const percent = computeUnitLimit > 0 ? Math.round((execution.computeUnits / computeUnitLimit) * 100) : 0;
    parts.push(`CU: ${formatInt(execution.computeUnits)} / ${formatInt(computeUnitLimit)} (${percent}%)`);
  }
  if (execution.fee != null) {
    parts.push(`Fee: ${formatSol(execution.fee)} SOL`);
  }
  parts.push(`Size: ${tx.size} bytes`);
  const rest = parts.map((part) => ` | ${part}`).join("");
  return section(`${statusPlain}${rest}`, `${statusStyled}${rest}`);
}

export function v1ConfigLine(config) {
  const parts = [];
  if (config.priorityFee != null) parts.push(`priority fee: ${formatInt(config.priorityFee)} lamports`);
  if (config.computeUnitLimit != null) parts.push(`compute unit limit: ${formatInt(config.computeUnitLimit)}`);
  if (config.loadedAccountsDataSizeLimit != null) {
    parts.push(`loaded accounts data size limit: ${formatInt(config.loadedAccountsDataSizeLimit)} bytes`);
  }
  if (config.heapSize != null) parts.push(`heap size: ${formatInt(config.heapSize)} bytes`);
  return parts.length > 0 ? parts.join(", ") : "defaults";
}

function describeFunding(funding) {
  if (funding.kind === "sol") {
    return `${funding.account} = ${formatSol(funding.lamports)} SOL`;
  }
  const owner = funding.owner ? ` (owner ${funding.owner})` : "";
  return `${funding.account}${owner} = ${funding.amount} raw units of ${funding.mint}`;
}

function overview(report) {
  const { mode, context, tx, execution } = report;
  const rows = [];
  if (mode === "simulate") {
    const source = context.embedded ? `fork of ${context.rpcUrl}` : "external surfpool";
    rows.push(["Surfnet", `${context.surfnetUrl} (${source}, slot ${formatInt(context.slot)})`]);
  } else {
    const time = context.blockTime != null ? `, ${new Date(context.blockTime * 1000).toISOString()}` : "";
    rows.push(["Source", `${context.rpcUrl} (slot ${formatInt(context.slot)}${time})`]);
  }
  if (tx.signature) rows.push(["Signature", tx.signature]);
  rows.push(["Version", versionLabel(tx.version)]);
  if (tx.config) rows.push(["v1 config", v1ConfigLine(tx.config)]);
  if (context.durableNonce) {
    rows.push(["Durable nonce", `${context.durableNonce} (nonce aligned to the transaction blockhash)`]);
  }
  if (context.clock) {
    const { slot, unixTimestamp } = context.clock;
    const time = new Date(unixTimestamp * 1000).toISOString();
    rows.push(["Clock", `slot ${formatInt(slot)}, ${time} (pinned; account state is current)`]);
  }
  for (const funding of context.fundings ?? []) {
    rows.push(["Funded", describeFunding(funding)]);
  }
  if (!tx.lookupsResolved) rows.push(["Lookups", paint("yellow", "address lookup tables could not be resolved")]);
  if (execution.errorMessage) rows.push(["Error", paint("red", execution.errorMessage)]);

  const width = Math.max(...rows.map(([label]) => label.length)) + 2;
  return rows.map(([label, value]) => `  ${paint("dim", label.padEnd(width))}${value}`);
}

function accountRows(pubkeys, names, indexes, accounts, indent) {
  return pubkeys.map((pubkey, position) => {
    const index = indexes?.[position];
    const account = index !== undefined ? accounts[index] : null;
    const marker = account ? ` ${permissionMarker(account)}` : "";
    const slot = index !== undefined ? paint("dim", `[${index}] `) : "";
    const name = names[position] ? paint("dim", `  ${names[position]}`) : "";
    return `${indent}${slot}${pubkey ?? UNRESOLVED}${marker}${name}`;
  });
}

function instructionBody(ix, accounts, opts, indent) {
  const lines = [];
  const names = ix.parsed?.accountNames ?? [];
  lines.push(`${indent}${paint("dim", "program")}  ${ix.programId ?? UNRESOLVED}`);
  if (ix.accounts.length > 0) {
    lines.push(`${indent}${paint("dim", "accounts")}`);
    lines.push(...accountRows(ix.accounts, names, ix.accountIndexes, accounts, `${indent}  `));
  }
  for (const [key, value] of Object.entries(ix.parsed?.fields ?? {})) {
    lines.push(`${indent}${paint("dim", key)}  ${formatField(value)}`);
  }
  if (ix.data && (opts.rawIxData || !ix.parsed)) {
    lines.push(`${indent}${paint("dim", "data")}  ${ix.data.length > 0 ? hex(ix.data) : "(empty)"}`);
  }
  return lines;
}

function instructionDetails(report, opts) {
  const { tx, execution } = report;
  const lines = [];
  for (const ix of tx.instructions) {
    lines.push(paint("bold", `#${ix.index + 1} ${instructionLabel(ix.programId, ix.parsed)}`));
    lines.push(...instructionBody(ix, tx.accounts, opts, "    "));
    const inner = execution.innerInstructions[ix.index] ?? [];
    inner.forEach((innerIx, position) => {
      const depth = Math.max(0, (innerIx.stackHeight ?? 2) - 2);
      const indent = "    ".repeat(depth + 1);
      lines.push(`${indent}${paint("bold", `#${ix.index + 1}.${position + 1} ${instructionLabel(innerIx.programId, innerIx.parsed)}`)}`);
      lines.push(...instructionBody(innerIx, tx.accounts, opts, `${indent}    `));
    });
    lines.push("");
  }
  lines.push(paint("dim", "  [sig perm exe]: s = signer, w/r = writable/read-only, x = program"));
  return lines;
}

function traceEntry(entry, indent) {
  switch (entry.type) {
    case "log":
      return `${indent}> ${entry.text}`;
    case "data":
      return `${indent}> ${paint("dim", `data: ${entry.text}`)}`;
    case "return":
      return `${indent}> ${paint("dim", `return: ${entry.text}`)}`;
    case "consumed":
      return `${indent}> ${paint("dim", `consumed ${formatInt(entry.consumed)} of ${formatInt(entry.budget)} compute units`)}`;
    case "success":
      return `${indent}${paint("green", "✓ success")}`;
    case "failed":
      return `${indent}${paint("red", `✗ failed: ${entry.text}`)}`;
    default:
      return `${indent}${paint("yellow", entry.text)}`;
  }
}

function renderFrame(frame, indent, lines) {
  const ix = frame.instruction;
  const path = frame.path ? `#${frame.path} ` : "";
  const label = `${path}${instructionLabel(frame.programId, ix?.parsed ?? null)}`;
  lines.push(`${indent}${paint(frame.status === "failed" ? ["bold", "red"] : "bold", label)}`);
  for (const entry of frame.entries) {
    if (entry.type === "invoke") {
      renderFrame(entry.frame, `${indent}  `, lines);
    } else {
      lines.push(traceEntry(entry, `${indent}  `));
    }
  }
}

function executionTrace({ tx, execution }) {
  if (execution.logs.length === 0) {
    return ["  (no logs)"];
  }
  const root = annotateTrace(parseLogs(execution.logs), tx.instructions, execution.innerInstructions);
  const lines = [];
  for (const entry of root.entries) {
    if (entry.type === "invoke") {
      renderFrame(entry.frame, "", lines);
    } else {
      lines.push(traceEntry(entry, ""));
    }
  }
  return lines;
}

function deltaText(delta, decimals) {
  const text = formatSigned(delta, decimals);
  return paint(delta > 0n ? "green" : "red", text);
}

function solChanges(changes) {
  if (changes.length === 0) {
    return ["  (no changes)"];
  }
  const lines = changes.map(
    (c) => `  ${c.pubkey ?? UNRESOLVED}  ${deltaText(c.delta, 9)}  ${formatSol(c.before)}  →  ${formatSol(c.after)}`,
  );
  lines.push("", paint("dim", "  account  ±Δ(SOL)  before → after"));
  return lines;
}

function tokenChanges(changes) {
  if (changes.length === 0) {
    return ["  (no changes)"];
  }
  const lines = [];
  for (const c of changes) {
    lines.push(
      `  ${c.account ?? UNRESOLVED}  ${deltaText(c.delta, c.decimals)}  ${formatUnits(c.before, c.decimals)}  →  ${formatUnits(c.after, c.decimals)}`,
    );
    lines.push(paint("dim", `    mint ${c.mint}${c.owner ? `  owner ${c.owner}` : ""}`));
  }
  return lines;
}

/** Instruction details with no inner instructions, for `decode`. */
export function renderInstructionDetails(tx, opts) {
  return instructionDetails({ tx, execution: { innerInstructions: [] } }, opts);
}

export function renderText(report, opts) {
  const { execution } = report;
  const lines = ["", header(report), "", ...overview(report)];

  if (opts.showIxDetail) {
    lines.push("", section("Instructions"), "", ...instructionDetails(report, opts));
  }

  lines.push("", section(opts.rawLog ? "Program Logs" : "Execution Trace"), "");
  lines.push(...(opts.rawLog ? execution.logs.map((log) => `  ${log}`) : executionTrace(report)));

  if (execution.returnData) {
    lines.push("", section("Return Data"), "");
    lines.push(`  ${execution.returnData.programId}  ${hex(execution.returnData.data)}`);
  }

  if (opts.showBalanceChange) {
    if (!execution.balances) {
      const reason = execution.success ? "no pre/post account state was returned" : "the transaction failed";
      lines.push("", paint("dim", `  (balance changes unavailable: ${reason})`));
    } else {
      lines.push("", section("SOL Balance Changes"), "", ...solChanges(report.balanceChanges.sol));
      lines.push("", section("Token Balance Changes"), "", ...tokenChanges(report.balanceChanges.token));
    }
  }

  lines.push("");
  return lines.join("\n");
}
