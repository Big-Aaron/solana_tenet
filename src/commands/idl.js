import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { fetchIdlAccounts, idlAccountAddress, parseProgramId, programIdsFromSyncPath, resolveIdlOutputDir } from "../core/idl-account.js";
import { createRpc, resolveRpcUrl } from "../core/rpc.js";
import { clearStatus, warn } from "../utils/diagnostics.js";

function formatIdl(text) {
  try {
    return `${JSON.stringify(JSON.parse(text), null, 2)}\n`;
  } catch {
    return text.endsWith("\n") ? text : `${text}\n`;
  }
}

/** Write fetched IDL JSON. Parse and RPC failures stay in the report. */
export function materializeIdls(results, outputDir) {
  return results.map((result) => {
    if (result.error) {
      return { program: result.programId, path: null, status: "error", message: result.error.message };
    }
    if (result.idl == null) {
      return { program: result.programId, path: null, status: "not_found", message: null };
    }
    const file = join(outputDir, `${result.programId}.json`);
    writeFileSync(file, formatIdl(result.idl));
    return { program: result.programId, path: file, status: "ok", message: null };
  });
}

export function renderIdlReport(report, json) {
  if (json) {
    const document = report.map(({ program, path, status }) => ({ program, path, status }));
    return `${JSON.stringify(document, null, 2)}\n`;
  }
  return report
    .filter((row) => row.status === "ok")
    .map((row) => `${row.path}\n`)
    .join("");
}

function emitReport(report, json) {
  let fetched = 0;
  let notFound = 0;
  let errors = 0;
  for (const row of report) {
    if (row.status === "ok") {
      fetched += 1;
    } else if (row.status === "not_found") {
      notFound += 1;
      warn(`no IDL found: ${row.program}`);
    } else {
      errors += 1;
      clearStatus();
      process.stderr.write(`error: IDL fetch failed for ${row.program}: ${row.message}\n`);
    }
  }
  if (notFound || errors) {
    warn(`Summary: ${fetched} fetched, ${notFound} not found, ${errors} error(s)`);
  }
  clearStatus();
  const text = renderIdlReport(report, json);
  if (text) {
    process.stdout.write(text);
  }
}

async function fetchAndWrite(programIds, { rpcUrl, outputDir, json }) {
  mkdirSync(outputDir, { recursive: true });
  const results = await fetchIdlAccounts(createRpc(rpcUrl), programIds);
  emitReport(materializeIdls(results, outputDir), json);
}

export async function runIdlFetch(programs, opts) {
  const programIds = programs.map(parseProgramId);
  await fetchAndWrite(programIds, {
    rpcUrl: resolveRpcUrl(opts.rpcUrl),
    outputDir: resolveIdlOutputDir(opts.outputDir),
    json: Boolean(opts.json),
  });
}

export async function runIdlSync(path, opts) {
  const { programIds, outputDir } = programIdsFromSyncPath(path);
  await fetchAndWrite(programIds, {
    rpcUrl: resolveRpcUrl(opts.rpcUrl),
    outputDir: resolveIdlOutputDir(opts.outputDir, outputDir),
    json: Boolean(opts.json),
  });
}

export async function runIdlAddress(program, opts) {
  const programId = parseProgramId(program);
  const idlAddress = await idlAccountAddress(programId);
  clearStatus();
  if (opts.json) {
    process.stdout.write(`${JSON.stringify({ program: programId, idl_address: idlAddress }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${idlAddress}\n`);
}
