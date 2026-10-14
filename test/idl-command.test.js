import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";
import { deflateSync } from "node:zlib";

import { materializeIdls, renderIdlReport } from "../src/commands/idl.js";
import { fetchIdlAccounts, idlAccountAddress, parseIdlAccount, programIdsFromSyncPath, resolveIdlOutputDir } from "../src/core/idl-account.js";

const run = promisify(execFile);
const CLI = new URL("../bin/tenet.js", import.meta.url).pathname;
const JUPITER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const JUPITER_IDL = "C88XWfp26heEmDkmfSzeXP7Fd7GQJ2j9dDTUsyiZbUTa";
const SYSTEM = "11111111111111111111111111111111";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

function idlAccount(json) {
  const compressed = deflateSync(Buffer.from(json));
  const data = Buffer.alloc(44 + compressed.length);
  data.writeUInt32LE(compressed.length, 40);
  compressed.copy(data, 44);
  return { lamports: 1, owner: SYSTEM, data: [data.toString("base64"), "base64"] };
}

function fakeRpc(accounts, { failOn } = {}) {
  let calls = 0;
  return {
    getMultipleAccounts(pubkeys) {
      calls += 1;
      return {
        async send() {
          if (failOn === calls) {
            throw new Error("rpc down");
          }
          return {
            value: pubkeys.map((key) => accounts[key] ?? null),
          };
        },
      };
    },
    get calls() {
      return calls;
    },
  };
}

describe("idl account", () => {
  it("derives the Anchor IDL address", async () => {
    assert.equal(await idlAccountAddress(JUPITER), JUPITER_IDL);
  });

  it("inflates an IDL account and rejects a short or truncated body", () => {
    const json = '{"name":"demo"}';
    assert.equal(parseIdlAccount(Buffer.from(idlAccount(json).data[0], "base64")), json);
    assert.throws(() => parseIdlAccount(Buffer.alloc(10)), /too short/);
    const truncated = Buffer.alloc(50);
    truncated.writeUInt32LE(999, 40);
    assert.throws(() => parseIdlAccount(truncated), /truncated/);
  });

  it("fetches each program and keeps going when one batch fails", async () => {
    const rpc = fakeRpc({ [JUPITER_IDL]: idlAccount('{"name":"jupiter"}') }, { failOn: 2 });
    const results = await fetchIdlAccounts(rpc, [JUPITER, SYSTEM, TOKEN], 2);
    assert.equal(results[0].idl, '{"name":"jupiter"}');
    assert.equal(results[1].idl, null);
    assert.equal(results[1].error, null);
    assert.match(results[2].error.message, /rpc down/);
    assert.equal(rpc.calls, 2);
  });

  it("reads program ids from IDL file names", () => {
    const dir = mkdtempSync(join(tmpdir(), "tenet-idl-sync-"));
    try {
      writeFileSync(join(dir, `${SYSTEM}.json`), "{}");
      writeFileSync(join(dir, "notes.json"), "{}");
      const scanned = programIdsFromSyncPath(dir);
      assert.deepEqual(scanned.programIds, [SYSTEM]);
      assert.equal(scanned.outputDir, dir);

      const file = join(dir, `${TOKEN}.json`);
      writeFileSync(file, "{}");
      assert.deepEqual(programIdsFromSyncPath(file).programIds, [TOKEN]);
      assert.throws(() => programIdsFromSyncPath(join(dir, "notes.json")), /invalid pubkey stem/);
      assert.throws(() => programIdsFromSyncPath(join(dir, "missing")), /does not exist/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves the output directory from -o, the sync dir, then TENET_IDL_DIR", () => {
    const previous = process.env.TENET_IDL_DIR;
    try {
      process.env.TENET_IDL_DIR = " /tmp/idls ";
      assert.equal(resolveIdlOutputDir("/explicit", "/sync"), "/explicit");
      assert.equal(resolveIdlOutputDir(undefined, "/sync"), "/sync");
      assert.equal(resolveIdlOutputDir(undefined, null), "/tmp/idls");
      delete process.env.TENET_IDL_DIR;
      assert.equal(resolveIdlOutputDir(undefined, null), ".");
    } finally {
      if (previous === undefined) delete process.env.TENET_IDL_DIR;
      else process.env.TENET_IDL_DIR = previous;
    }
  });

  it("writes pretty IDL files and reports the ones it could not fetch", () => {
    const dir = mkdtempSync(join(tmpdir(), "tenet-idl-write-"));
    try {
      const report = materializeIdls(
        [
          { programId: SYSTEM, idl: '{"name":"system","version":"0.1.0"}', error: null },
          { programId: TOKEN, idl: null, error: null },
          { programId: JUPITER, idl: null, error: new Error("bad zlib") },
        ],
        dir,
      );
      assert.equal(JSON.parse(readFileSync(join(dir, `${SYSTEM}.json`), "utf8")).name, "system");
      assert.deepEqual(
        report.map(({ program, status }) => [program, status]),
        [
          [SYSTEM, "ok"],
          [TOKEN, "not_found"],
          [JUPITER, "error"],
        ],
      );
      const doc = JSON.parse(renderIdlReport(report, true));
      assert.equal(doc[0].path, join(dir, `${SYSTEM}.json`));
      assert.equal(doc[1].status, "not_found");
      assert.equal(doc[1].path, null);
      assert.equal(renderIdlReport(report, false), `${join(dir, `${SYSTEM}.json`)}\n`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("idl command", () => {
  it("prints the same address as text and JSON", async () => {
    const { stdout } = await run(process.execPath, [CLI, "idl", "address", JUPITER], { timeout: 10_000 });
    assert.equal(stdout, `${JUPITER_IDL}\n`);
    const { stdout: json } = await run(process.execPath, [CLI, "idl", "address", JUPITER, "--json"], { timeout: 10_000 });
    assert.deepEqual(JSON.parse(json), { program: JUPITER, idl_address: JUPITER_IDL });
  });

  it("rejects a program id that is not a pubkey", async () => {
    await assert.rejects(run(process.execPath, [CLI, "idl", "address", "nope"], { timeout: 10_000 }), (error) => {
      assert.match(error.stderr, /Invalid program ID: nope/);
      return true;
    });
  });

  it("documents fetch, sync, and address", async () => {
    const { stdout } = await run(process.execPath, [CLI, "idl", "--help"], { timeout: 10_000 });
    assert.match(stdout, /fetch/);
    assert.match(stdout, /sync/);
    assert.match(stdout, /address/);
    const { stdout: fetchHelp } = await run(process.execPath, [CLI, "idl", "fetch", "--help"], { timeout: 10_000 });
    assert.match(fetchHelp, /--output-dir/);
    assert.match(fetchHelp, /--json/);
  });
});
