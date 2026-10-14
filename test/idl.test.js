import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import bs58 from "bs58";

import { buildDecodeModel } from "../src/commands/decode.js";
import { normalizeInnerInstructions } from "../src/core/execution.js";
import { decodeTransaction, describeTransaction } from "../src/core/transaction.js";
import { renderDecodeJson, renderDecodeText } from "../src/output/decode.js";
import { renderInstructionDetails } from "../src/output/text.js";
import { loadIdls, parseIdl } from "../src/parsers/idl.js";
import { decodeInstruction } from "../src/parsers/instructions.js";
import { SYSTEM_PROGRAM } from "../src/parsers/programs.js";

const CLI = new URL("../bin/tenet.js", import.meta.url).pathname;
const DISC = [1, 2, 3, 4, 5, 6, 7, 8];

const program = pubkey(9);
const user = pubkey(1);
const vault = pubkey(2);
const rem0 = pubkey(3);
const rem1 = pubkey(4);
const mint = pubkey(5);
const oracle = pubkey(6);
const keys = [user, vault, rem0, rem1, mint, oracle, program];

const swapIdl = {
  address: program,
  metadata: { name: "demo", version: "0.1.0", spec: "0.1.0" },
  instructions: [
    {
      name: "swap",
      discriminator: DISC,
      accounts: [
        { name: "user", writable: true, signer: true },
        {
          name: "pool",
          accounts: [
            { name: "vault", writable: true, pda: { seeds: [] } },
            { name: "mint", address: mint },
          ],
        },
        { name: "oracle", optional: true },
      ],
      args: [],
    },
  ],
};

function pubkey(byte) {
  return bs58.encode(Buffer.alloc(32, byte));
}

function legacyWire({ numReadonlyUnsigned, accountKeys, instructions }) {
  const rawKeys = accountKeys.map((key) => Buffer.from(bs58.decode(key)));
  const compiled = instructions.map((ix) =>
    Buffer.concat([
      Buffer.from([ix.programIdIndex]),
      Buffer.from([ix.accounts.length]),
      Buffer.from(ix.accounts),
      Buffer.from([ix.data.length]),
      Buffer.from(ix.data),
    ]),
  );
  const message = Buffer.concat([
    Buffer.from([1, 0, numReadonlyUnsigned]),
    Buffer.from([rawKeys.length]),
    Buffer.concat(rawKeys),
    Buffer.alloc(32),
    Buffer.from([instructions.length]),
    ...compiled,
  ]);
  return Buffer.concat([Buffer.from([1]), Buffer.alloc(64), message]);
}

function idlMap(idl, programId = null) {
  const indexed = parseIdl(idl, programId);
  return new Map([[indexed.programId, indexed]]);
}

const swapIdls = idlMap(swapIdl);

function swapWire(accountIndexes) {
  return legacyWire({
    numReadonlyUnsigned: 3,
    accountKeys: keys,
    instructions: [{ programIdIndex: 6, accounts: accountIndexes, data: DISC }],
  });
}

describe("Anchor IDL accounts", () => {
  it("splits named accounts and remaining accounts on a transaction", () => {
    const wire = swapWire([0, 1, 4, 5, 2, 3]);
    const info = describeTransaction(decodeTransaction(wire), wire, null, swapIdls);
    const ix = info.instructions[0];
    assert.equal(ix.parsed.name, "swap");
    assert.equal(ix.parsed.programName, "demo");
    assert.deepEqual(ix.parsed.accountNames, [
      "user",
      "pool.vault",
      "pool.mint",
      "oracle",
      "remaining[0]",
      "remaining[1]",
    ]);
    assert.equal(ix.parsed.idlAccounts[0].signer, true);
    assert.equal(ix.parsed.idlAccounts[0].writable, true);
    assert.equal(ix.parsed.idlAccounts[1].pda, true);
    assert.equal(ix.parsed.idlAccounts[2].address, mint);
    assert.deepEqual(
      ix.parsed.remainingAccounts.map((account) => account.pubkey),
      [rem0, rem1],
    );

    const model = buildDecodeModel({
      wire,
      loadedAddresses: null,
      idls: swapIdls,
      context: { rpcUrl: "https://rpc.test", slot: null, blockTime: null },
    });
    const text = renderDecodeText(model, {});
    assert.match(text, /demo: swap/);
    assert.match(text, /\[1\] .*pool\.vault/);
    assert.match(text, /remaining accounts/);
    assert.match(text, /remaining\[1\]/);
    assert.doesNotMatch(text, /\(missing\)/);

    const doc = JSON.parse(renderDecodeJson(model));
    assert.equal(doc.transaction.instructions[0].programName, "demo");
    assert.equal(doc.transaction.instructions[0].parsed.accounts[1].name, "pool.vault");
    assert.equal(doc.transaction.instructions[0].parsed.remainingAccounts[0].pubkey, rem0);
  });

  it("marks an optional program-id account as absent and a short list as missing", () => {
    const absent = decodeInstruction(program, Buffer.from(DISC), {
      idls: swapIdls,
      accounts: [user, vault, mint, program, rem0],
    });
    assert.equal(absent.idlAccounts[3].present, false);
    assert.equal(absent.accountNames[3], "oracle (none)");
    assert.equal(absent.remainingAccounts[0].pubkey, rem0);

    const short = decodeInstruction(program, Buffer.from(DISC), {
      idls: swapIdls,
      accounts: [user, vault],
    });
    assert.deepEqual(short.accountNames, ["user", "pool.vault"]);
    assert.equal(short.idlAccounts[2].missing, true);
    assert.equal(short.idlAccounts[2].name, "pool.mint");
    assert.deepEqual(short.remainingAccounts, []);

    const text = renderInstructionDetails(
      {
        accounts: [
          { pubkey: user, signer: true, writable: true, executable: false },
          { pubkey: vault, signer: false, writable: true, executable: false },
        ],
        instructions: [
          {
            index: 0,
            programId: program,
            accountIndexes: [0, 1],
            accounts: [user, vault],
            parsed: short,
          },
        ],
      },
      {},
    ).join("\n");
    assert.match(text, /\(missing\) {2}pool\.mint/);
    assert.match(text, /\(missing\) {2}oracle/);
    assert.doesNotMatch(text, /remaining accounts/);
  });

  it("accepts a legacy IDL and hashes global:<name> when no discriminator is set", () => {
    const indexed = parseIdl({
      name: "legacy_prog",
      metadata: { address: program },
      instructions: [
        {
          name: "initialize",
          accounts: [
            { name: "payer", isMut: true, isSigner: true },
            { name: "state", accounts: [{ name: "vault", isMut: true, isSigner: false }] },
            { name: "oracle", isOptional: true },
          ],
          args: [],
        },
      ],
    });
    const sighash = createHash("sha256").update("global:initialize").digest().subarray(0, 8);
    const parsed = decodeInstruction(program, sighash, {
      idls: new Map([[indexed.programId, indexed]]),
      accounts: [user, vault, program, rem0],
    });
    assert.equal(parsed.name, "initialize");
    assert.equal(parsed.programName, "legacy_prog");
    assert.deepEqual(parsed.accountNames, ["payer", "state.vault", "oracle (none)", "remaining[0]"]);
    assert.equal(parsed.idlAccounts[0].signer, true);
    assert.equal(parsed.idlAccounts[0].writable, true);
    assert.equal(parsed.idlAccounts[1].name, "state.vault");
  });

  it("decodes instruction args, including structs, enums, and options", () => {
    const owner = pubkey(7);
    const u64 = (value) => {
      const bytes = Buffer.alloc(8);
      bytes.writeBigUInt64LE(value);
      return bytes;
    };
    const idl = {
      address: program,
      metadata: { name: "demo", spec: "0.1.0" },
      instructions: [
        {
          name: "swap",
          discriminator: DISC,
          accounts: [{ name: "user", signer: true, writable: true }],
          args: [
            { name: "amount_in", type: "u64" },
            { name: "side", type: { defined: { name: "Side" } } },
            { name: "memo", type: { option: "string" } },
            { name: "owner", type: "publicKey" },
            { name: "flags", type: { vec: { defined: "Flag" } } },
            { name: "pad", type: { array: ["u8", 2] } },
          ],
        },
      ],
      types: [
        {
          name: "Side",
          type: {
            kind: "enum",
            variants: [{ name: "Bid" }, { name: "Ask", fields: [{ name: "limit", type: "u64" }] }],
          },
        },
        { name: "Flag", type: { kind: "enum", variants: [{ name: "None" }, { name: "Set" }] } },
      ],
    };
    const data = Buffer.concat([
      Buffer.from(DISC),
      u64(1000n),
      Buffer.from([1]),
      u64(7n),
      Buffer.from([1, 2, 0, 0, 0]),
      Buffer.from("hi"),
      Buffer.from(bs58.decode(owner)),
      Buffer.from([2, 0, 0, 0, 0, 1]),
      Buffer.from([9, 8]),
    ]);
    const parsed = decodeInstruction(program, data, {
      idls: idlMap(idl),
      accounts: [user],
    });
    assert.equal(parsed.accountNames[0], "user");
    assert.equal(parsed.argsDecoded, undefined);
    assert.equal(parsed.fields.amount_in, 1000n);
    assert.deepEqual(parsed.fields.side, { Ask: { limit: 7n } });
    assert.equal(parsed.fields.memo, "hi");
    assert.equal(parsed.fields.owner, owner);
    assert.deepEqual(parsed.fields.flags, ["None", "Set"]);
    assert.deepEqual(parsed.fields.pad, [9, 8]);

    const text = renderInstructionDetails(
      {
        accounts: [{ pubkey: user, signer: true, writable: true, executable: false }],
        instructions: [
          {
            index: 0,
            programId: program,
            accountIndexes: [0],
            accounts: [user],
            data,
            parsed,
          },
        ],
      },
      {},
    ).join("\n");
    assert.match(text, /amount_in {2}1,000/);
    assert.match(text, /side {2}\{"Ask":\{"limit":7\}\}/);
    assert.doesNotMatch(text, /\n {4}data {2}/);

    const broken = decodeInstruction(program, Buffer.concat([Buffer.from(DISC), Buffer.from([1, 2, 3, 4])]), {
      idls: idlMap(idl),
      accounts: [user],
    });
    assert.equal(broken.accountNames[0], "user");
    assert.equal(broken.argsDecoded, false);
    assert.deepEqual(broken.fields, {});
    const raw = renderInstructionDetails(
      {
        accounts: [{ pubkey: user, signer: true, writable: true, executable: false }],
        instructions: [
          {
            index: 0,
            programId: program,
            accountIndexes: [0],
            accounts: [user],
            data: Buffer.concat([Buffer.from(DISC), Buffer.from([1, 2, 3, 4])]),
            parsed: broken,
          },
        ],
      },
      {},
    ).join("\n");
    assert.match(raw, /data {2}0x/);
  });

  it("leaves builtin instructions on their built-in decoder", () => {
    const data = Buffer.alloc(12);
    data.writeUInt32LE(2, 0);
    data.writeBigUInt64LE(1n, 4);
    const systemIdl = parseIdl({
      address: SYSTEM_PROGRAM,
      instructions: [
        { name: "fake", discriminator: [...data.subarray(0, 8)], accounts: [{ name: "a" }], args: [] },
      ],
    });
    const parsed = decodeInstruction(SYSTEM_PROGRAM, data, {
      idls: new Map([[SYSTEM_PROGRAM, systemIdl]]),
      accounts: [user, vault],
    });
    assert.equal(parsed.name, "transfer");
    assert.equal(parsed.idlAccounts, undefined);
    assert.equal(decodeInstruction(program, Buffer.alloc(8), { idls: swapIdls, accounts: [user] }), null);
    assert.equal(decodeInstruction(program, Buffer.from([1]), { idls: swapIdls, accounts: [] }), null);
  });

  it("decodes a compiled inner instruction with the same IDL", () => {
    const [inner] = normalizeInnerInstructions(
      [
        {
          index: 0,
          instructions: [
            {
              programIdIndex: 6,
              accounts: [0, 1, 4, 5, 2],
              data: bs58.encode(Buffer.from(DISC)),
              stackHeight: 2,
            },
          ],
        },
      ],
      keys,
      swapIdls,
    )[0];
    assert.equal(inner.parsed.name, "swap");
    assert.equal(inner.parsed.remainingAccounts.length, 1);
    assert.equal(inner.parsed.remainingAccounts[0].pubkey, rem0);
  });

  it("rejects IDLs that cannot be indexed", () => {
    assert.throws(() => parseIdl({}), /missing instructions/);
    assert.throws(() => parseIdl({ instructions: [] }), /no program address/);
    assert.throws(() => parseIdl({ address: "not-a-pubkey", instructions: [] }), /Invalid program address/);
    assert.throws(
      () =>
        parseIdl({
          address: program,
          instructions: [
            { name: "a", discriminator: DISC, accounts: [] },
            { name: "b", discriminator: DISC, accounts: [] },
          ],
        }),
      /Duplicate discriminator/,
    );
    assert.throws(
      () => parseIdl({ address: program, instructions: [{ name: "a", discriminator: [1], accounts: [] }] }),
      /8 bytes/,
    );
  });

  it("loads IDL files, including a program id override", () => {
    const dir = mkdtempSync(join(tmpdir(), "tenet-idl-"));
    try {
      const file = join(dir, "demo.json");
      writeFileSync(file, JSON.stringify(swapIdl));
      assert.equal(loadIdls([file]).get(program).name, "demo");

      const bare = join(dir, "bare.json");
      writeFileSync(
        bare,
        JSON.stringify({ instructions: [{ name: "noop", discriminator: DISC, accounts: [], args: [] }] }),
      );
      assert.equal(loadIdls([`${program}=${bare}`]).get(program).instructions.size, 1);
      assert.throws(() => loadIdls([file, file]), /Duplicate Anchor IDL/);
      assert.throws(() => loadIdls([join(dir, "missing.json")]), /not found/);
      assert.throws(() => loadIdls([bare]), /no program address/);
      assert.throws(() => loadIdls([dir]), /directory/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("decodes a raw transaction through the CLI", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tenet-idl-"));
    const file = join(dir, "demo.json");
    writeFileSync(file, JSON.stringify(swapIdl));
    try {
      const stdout = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [CLI, "dec", "--json", "--idl", file], { stdio: ["pipe", "pipe", "pipe"] });
        let out = "";
        let err = "";
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error(`decode timed out\n${err}`));
        }, 10_000);
        child.stdout.on("data", (chunk) => {
          out += chunk;
        });
        child.stderr.on("data", (chunk) => {
          err += chunk;
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          if (code === 0) resolve(out);
          else reject(new Error(err || out));
        });
        child.stdin.end(swapWire([0, 1, 4, 5, 2, 3]).toString("base64"));
      });
      const doc = JSON.parse(stdout);
      assert.equal(doc.transaction.instructions[0].parsed.name, "swap");
      assert.equal(doc.transaction.instructions[0].parsed.accounts[1].name, "pool.vault");
      assert.equal(doc.transaction.instructions[0].parsed.remainingAccounts.length, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
