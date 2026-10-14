import { createRequire } from "node:module";

import { Command } from "commander";

import { runDecode } from "./commands/decode.js";
import { runIdlAddress, runIdlFetch, runIdlSync } from "./commands/idl.js";
import { runReplay } from "./commands/replay.js";
import { runSimulate } from "./commands/simulate.js";
import { clearStatus } from "./utils/diagnostics.js";

const { version } = createRequire(import.meta.url)("../package.json");

const collect = (value, previous) => [...previous, value];

function addRpcOption(command) {
  return command.option(
    "-u, --rpc-url <URL>",
    "Solana RPC URL (env: TENET_RPC_URL or SOLANA_RPC_URL; default: mainnet-beta)",
  );
}

function addIdlOption(command) {
  return command.option(
    "--idl <SPEC>",
    "Anchor IDL JSON for accounts, remaining accounts, and args (repeatable): <PATH> or <PROGRAM_ID>=<PATH>",
    collect,
    [],
  );
}

function addOutputOptions(command) {
  return command
    .option("-b, --show-balance-change", "Show SOL and token balance changes")
    .option("-d, --show-ix-detail", "Show instruction details (accounts, decoded fields, inner instructions)")
    .option("-l, --raw-log", "Print raw program logs instead of the structured execution trace")
    .option("--raw-ix-data", "Always print raw instruction data, even when decoded")
    .option("--json", "Print a single JSON document to stdout");
}

export function buildProgram() {
  const program = new Command()
    .name("tenet")
    .description("Solana transaction decode, simulation (Surfpool), replay, and Anchor IDL tools")
    .version(version);

  const simulate = program
    .command("simulate")
    .alias("sim")
    .description("Simulate a transaction on a local surfnet forked from the RPC")
    .argument("[tx]", "Transaction signature, or Base58/Base64 encoded transaction (default: read stdin)");
  addRpcOption(simulate)
    .option("--surfnet-url <URL>", "Use a running surfpool instead of starting an embedded surfnet")
    .option("--fund-sol <PUBKEY=AMOUNT>", "Set an account's SOL balance, e.g. <PUBKEY>=1.5sol (repeatable)", collect, [])
    .option(
      "--fund-token <SPEC=AMOUNT>",
      "Set a token balance: <TOKEN_ACCOUNT>=<AMOUNT> or <OWNER>:<MINT>=<AMOUNT> (repeatable)",
      collect,
      [],
    )
    .option("-s, --slot <SLOT>", "Pin Clock.slot read by programs (account state stays current)")
    .option("-t, --timestamp <TIMESTAMP>", "Pin Clock.unix_timestamp: Unix seconds or RFC3339 (2024-01-01T00:00:00Z)")
    .option("--at-tx-time", "Pin the clock to the fetched transaction's slot and block time (signature input only)")
    .option("--check-sig", "Verify transaction signatures (disables blockhash replacement)");
  addIdlOption(simulate);
  addOutputOptions(simulate).action(runSimulate);

  const decode = program
    .command("decode")
    .alias("dec")
    .description("Decode a transaction's accounts and instructions without executing it")
    .argument("[tx]", "Transaction signature, or Base58/Base64 encoded transaction (default: read stdin)");
  addIdlOption(addRpcOption(decode))
    .option("--raw-ix-data", "Always print raw instruction data, even when decoded")
    .option("--json", "Print a single JSON document to stdout")
    .action(runDecode);

  const replay = program
    .command("replay")
    .description("Replay a confirmed transaction from on-chain metadata (no local execution)")
    .argument("<signature>", "Transaction signature");
  addIdlOption(addRpcOption(replay));
  addOutputOptions(replay).action(runReplay);

  const idl = program.command("idl").description("Fetch, refresh, or derive Anchor IDL accounts");

  const fetchIdl = idl
    .command("fetch")
    .description("Fetch Anchor IDLs from on-chain accounts and write <PROGRAM_ID>.json")
    .argument("<programs...>", "Program IDs");
  addRpcOption(fetchIdl)
    .option("-o, --output-dir <DIR>", "Directory for IDL files (env: TENET_IDL_DIR; default: cwd)")
    .option("-j, --json", "Print per-program status as one JSON document")
    .action(runIdlFetch);

  const syncIdl = idl
    .command("sync")
    .description("Refresh on-chain IDLs for <PROGRAM_ID>.json names in a directory or one file")
    .argument("<path>", "IDL directory or one <PROGRAM_ID>.json file");
  addRpcOption(syncIdl)
    .option("-o, --output-dir <DIR>", "Directory for IDL files (default: the source directory)")
    .option("-j, --json", "Print per-program status as one JSON document")
    .action(runIdlSync);

  idl
    .command("address")
    .description("Derive a program's Anchor IDL account address")
    .argument("<program>", "Program ID")
    .option("-j, --json", "Print { program, idl_address }")
    .action(runIdlAddress);

  return program;
}

export async function main(argv = process.argv) {
  try {
    await buildProgram().parseAsync(argv);
  } catch (error) {
    clearStatus();
    process.stderr.write(`error: ${process.env.TENET_DEBUG ? error.stack : error.message}\n`);
    process.exitCode = 1;
  }
}
