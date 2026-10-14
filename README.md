# Tenet — Solana transaction decode, simulate, replay, and Anchor IDL

Tenet is a Node.js CLI that inspects Solana transactions. Install it from npm as [`solana-tenet`](https://www.npmjs.com/package/solana-tenet). The design follows [sonar](https://github.com/okxlabs/sonar).

- `decode` shows the accounts and instructions in a transaction. It does not execute the transaction.
- `simulate` executes a transaction on a local [Surfpool](https://github.com/solana-foundation/surfpool) surfnet. The surfnet forks mainnet or any RPC. It loads accounts on demand. SOL and token funding cheatcodes set balances before the run.
- `replay` shows a confirmed transaction from its on-chain metadata. It does not execute the transaction.
- `idl` fetches an Anchor IDL, refreshes local `<PROGRAM_ID>.json` files from the chain, or derives the IDL account address.

`simulate` and `replay` share one report:

- status and compute units
- an execution trace from program logs, with CPI nesting and decoded instruction names
- instruction details
- SOL and token balance changes

`decode` reports only the transaction structure. Tenet supports Legacy transactions, v0 transactions (address lookup tables), and v1 transactions (SIMD-0385).

## Installation

Tenet requires Node.js 22.13 or later. The npm package is [`solana-tenet`](https://www.npmjs.com/package/solana-tenet). The command name is `tenet`.

```bash
npm install -g solana-tenet
tenet --help
```

Run one command without a global install:

```bash
npx solana-tenet decode <SIGNATURE>
```

From a checkout of this repository:

```bash
npm install
npm link        # optional. This adds tenet to PATH. Or run: node bin/tenet.js
```

`@solana/surfpool` supplies the embedded surfnet. It includes native binaries for macOS (x64 and arm64) and Linux x64 (glibc). On other platforms, run `surfpool start` yourself. Then pass `--surfnet-url`.

## Agent skill

The skill at `.cursor/skills/tenet/SKILL.md` tells an agent how to run Tenet. A checkout of this repository already includes it. Install the same skill into another project:

```bash
npx skills add Big-Aaron/solana_tenet --skill tenet
```

Add `-g` to install it for every project on this machine.

## Quick start

```bash
# Fetch the signature from the RPC. Execute it on the current fork.
tenet simulate <SIGNATURE> --rpc-url https://api.mainnet-beta.solana.com

# Simulate a Base58 or Base64 transaction. Or send the transaction on stdin.
tenet sim <BASE64_TX>
cat tx.b64 | tenet sim

# Show balance changes and instruction details.
tenet sim <TX> -b -d

# Decode only the structure: instructions, lookup tables, and the account list.
tenet decode <SIGNATURE>
tenet dec <BASE64_TX> --json

# Name Anchor accounts from an IDL, then decode the transaction.
tenet idl fetch <PROGRAM_ID> -o ./idls
tenet decode <SIGNATURE> --idl ./idls/<PROGRAM_ID>.json

# Show a confirmed transaction from on-chain metadata.
tenet replay <SIGNATURE> -b --idl ./idls/<PROGRAM_ID>.json

# Write JSON to stdout.
tenet replay <SIGNATURE> --json | jq .status
```

## Commands

### `simulate` (alias `sim`)

```
tenet simulate [TX] [options]
```

Tenet detects `TX` as a signature or an encoded transaction. It fetches a signature from `--rpc-url`. When you omit `TX`, Tenet reads it from stdin.

| Option | Description |
|--------|-------------|
| `-u, --rpc-url <URL>` | Fetch signatures. The surfnet uses this RPC as its datasource. |
| `--surfnet-url <URL>` | Use a running surfpool. Do not start an embedded surfnet. That surfpool uses its own datasource. |
| `--fund-sol <PUBKEY>=<AMOUNT>` | Set the SOL balance of an account. Forms: `1.5`, `1.5sol`, or `5000lamports`. You can repeat this option. |
| `--fund-token <TOKEN_ACCOUNT>=<AMOUNT>` | Set the balance of an existing token account. You can repeat this option. |
| `--fund-token <OWNER>:<MINT>=<AMOUNT>` | Set the balance for this owner and mint. Tenet creates the associated token account if it does not exist. You can repeat this option. |
| `-s, --slot <SLOT>` | Pin the `Clock.slot` value that programs read. |
| `-t, --timestamp <TIMESTAMP>` | Pin `Clock.unix_timestamp`. Use Unix seconds (`1700000000`) or an RFC3339 time (`2024-01-01T00:00:00Z`). |
| `--at-tx-time` | Pin the clock to the slot and block time of the fetched transaction. This applies only to a signature. `--slot` or `--timestamp` overrides this option. |
| `--check-sig` | Enable signature verification. Tenet does not replace the recent blockhash. |
| `--idl <SPEC>` | Anchor IDL JSON. Names this program's accounts and remaining accounts. Repeat for several programs. `<PATH>` or `<PROGRAM_ID>=<PATH>`. |

Tenet reads an integer token amount as a raw unit (`1000000`). Tenet reads an amount that contains a dot in the mint decimals (`1.5`). Tenet detects SPL Token and Token-2022 from the mint owner.

How a simulation runs:

1. An embedded surfnet starts on dynamic ports and forks `--rpc-url`. The surfnet fetches an account the first time the simulation accesses that account.
2. Tenet applies the funding cheatcodes `surfnet_setAccount` and `surfnet_setTokenAccount`. Tenet writes a pinned clock directly into the Clock sysvar. Only the fields you request change.
3. The first instruction of a durable nonce transaction is `AdvanceNonceAccount`. Tenet rewrites the nonce account so the stored nonce matches the signed nonce. For every other transaction, Tenet replaces the recent blockhash.
4. The surfnet resolves address lookup tables. Tenet records snapshots of writable accounts. Tenet simulates the original wire bytes and skips signature verification. `--check-sig` enables signature verification.
5. Tenet computes balance changes from the before and after snapshots of writable accounts. The changes include fees.

The fork reflects current state. When you simulate an old transaction, the result can legitimately differ from the on-chain result. Slippage errors and drained pools are examples. Use `replay` to see the on-chain result.

`--slot`, `--timestamp`, and `--at-tx-time` change only the values that programs read from the Clock sysvar. Use them for time-dependent logic such as vesting, expiries, or auctions. They do not restore historical account state.

### `decode` (alias `dec`)

```
tenet decode [TX] [options]
```

`TX` is a signature or an encoded transaction, as in `simulate`. When you omit `TX`, Tenet reads it from stdin. Tenet does not execute the transaction.

The report is the transaction. It includes the version, the v1 config, decoded instructions, address lookup tables, and the full account list.

Tenet fetches a signature with `getTransaction`. It reads lookup addresses from the historical `meta.loadedAddresses`. For a raw transaction, Tenet resolves lookup tables against the live `--rpc-url`.

| Option | Description |
|--------|-------------|
| `-u, --rpc-url <URL>` | Fetch a signature and resolve lookup tables. |
| `--idl <SPEC>` | Anchor IDL JSON. Names this program's accounts and remaining accounts. Repeat for several programs. `<PATH>` or `<PROGRAM_ID>=<PATH>`. |
| `--raw-ix-data` | Print raw instruction data, including data that Tenet already decoded. |
| `--json` | Write one JSON document to stdout. |

`simulate` and `replay` accept the same `--idl` flag. Tenet matches the first 8 bytes of instruction data to an IDL discriminator. A legacy IDL with no discriminator uses `sha256("global:<name>")`. Nested account structs are flattened, so a field named `vault` inside `pool` is labeled `pool.vault`. Accounts after that list are `remaining[0]`, `remaining[1]`, and so on. An optional account set to the program id is absent and shown as `(none)`. A named account the transaction does not include is `(missing)`. System, Token, and the other builtin decoders stay in front of the IDL. Anchor instruction arguments stay raw. Fetch the file with `idl fetch`, described below.

### `replay`

```
tenet replay <SIGNATURE> [options]
```

Tenet fetches the transaction and its metadata (`getTransaction`, `maxSupportedTransactionVersion: 1`). It shows logs, inner instructions, compute units, the fee, and balance changes from that metadata.

Tenet reads lookup table addresses from the historical `meta.loadedAddresses`. It does not read live tables. `replay` accepts `--idl` and the output options in the next section.

### `idl`

```
tenet idl fetch <PROGRAM_ID>... [options]
tenet idl sync <PATH> [options]
tenet idl address <PROGRAM_ID> [options]
```

`idl` follows [sonar](https://github.com/okxlabs/sonar)'s `idl` command. It reads the Anchor IDL account:

```
createWithSeed(findProgramAddress([], program), "anchor:idl", program)
```

The account data is an 8-byte discriminator, a 32-byte authority, a little-endian length, and zlib-compressed IDL JSON. Tenet writes that JSON as `<PROGRAM_ID>.json`.

```bash
# stdout is the file that was written.
tenet idl fetch <PROGRAM_ID> -o ./idls

# A program with no IDL account is a warning. The command still exits 0.
tenet idl fetch <PROGRAM_ID_1> <PROGRAM_ID_2> -o ./idls

# Re-fetch every <PROGRAM_ID>.json in a directory. Other names are skipped.
tenet idl sync ./idls

# Re-fetch one file. The file name must be <PROGRAM_ID>.json.
tenet idl sync ./idls/<PROGRAM_ID>.json

# Print the IDL account address. This does not call an RPC.
tenet idl address <PROGRAM_ID>
```

`sync` replaces those files with the IDL currently stored on chain.

Without `-o`, `fetch` writes to `TENET_IDL_DIR`, or to the working directory when that variable is unset. `sync` writes back into the directory that holds the source file. `TENET_IDL_DIR` does not change the `sync` destination.

`fetch` and `sync` exit 0 when some programs have no IDL or the account cannot be decoded. They exit 1 when a program ID is invalid, the sync path is missing, or Tenet cannot create or write the output file. stdout lists only the files that were written, one path per line. Each missing IDL prints `warning: no IDL found: <PROGRAM_ID>` on stderr, then a summary line: `warning: Summary: N fetched, N not found, N error(s)`.

`--json` on `fetch` and `sync` prints one array. `status` is `ok`, `not_found`, or `error`. `path` is `null` unless `status` is `ok`.

```json
[
  {
    "program": "<PROGRAM_ID>",
    "path": "idls/<PROGRAM_ID>.json",
    "status": "ok"
  }
]
```

`--json` on `address` prints one object:

```json
{
  "program": "<PROGRAM_ID>",
  "idl_address": "<IDL_ACCOUNT>"
}
```

| Option | Commands | Description |
|--------|----------|-------------|
| `-u, --rpc-url <URL>` | `fetch`, `sync` | RPC used to read IDL accounts. |
| `-o, --output-dir <DIR>` | `fetch`, `sync` | Directory for `<PROGRAM_ID>.json`. |
| `-j, --json` | `fetch`, `sync`, `address` | Write one JSON document to stdout. |

### Output options (`simulate` and `replay`)

| Option | Description |
|--------|-------------|
| `-b, --show-balance-change` | Show SOL and token balance changes. |
| `-d, --show-ix-detail` | Show instruction accounts, decoded fields, and inner instructions. |
| `-l, --raw-log` | Show raw program logs in place of the execution trace. |
| `--raw-ix-data` | Print raw instruction data, including data that Tenet already decoded. |
| `--json` | Write one JSON document to stdout. |

Tenet decodes instruction names and fields for System, Compute Budget, SPL Token, Token-2022, Associated Token Account, and Memo. It labels other known programs by name. `--idl` adds Anchor account names and remaining accounts for other programs.

In `-d` output, an account marker has the form `[<sig><perm><exe>]`.

- `s` means signer. `-` means not a signer.
- `w` means writable. `r` means read-only.
- `x` means program. `-` means not a program.

`[n]` is the account index in the transaction. `decode` uses the same marker. With `--idl`, named accounts and remaining accounts are separate blocks under the instruction.

## Output conventions

- stdout carries only the report, as text or as JSON. Tenet writes progress, warnings, and errors to stderr.
- With `--json`, stdout is one valid JSON document. Tenet writes amounts that may exceed 2^53 as strings.
- Tenet disables colors when stdout is not a TTY. Tenet also disables colors when `NO_COLOR` is present.
- When a simulated transaction fails, the process still exits 0. The command exits 1 only when it cannot run.
- `idl fetch` and `idl sync` exit 0 when a program has no IDL or its account cannot be decoded. They exit 1 when the command cannot run.

## Environment

| Variable | Description |
|----------|-------------|
| `TENET_RPC_URL`, `SOLANA_RPC_URL` | Default for `--rpc-url`. When both are unset, Tenet uses mainnet-beta. |
| `TENET_IDL_DIR` | Default directory for `idl fetch` when `-o` is omitted. `idl sync` writes next to the source file instead. |
| `TENET_DEBUG` | Print a stack trace when an error occurs. |

The public mainnet endpoint is heavily rate-limited. A dedicated RPC makes simulations faster. It also avoids transient surfnet internal errors while the surfnet fetches accounts.

## Development

```bash
npm test             # unit tests, plus an offline surfnet clock test (fixtures in test/fixtures)
npm run test:e2e     # live tests against --rpc-url or mainnet-beta
```

Layout:

- `src/cli.js` defines the commands.
- `src/commands/` runs `decode`, `simulate`, `replay`, and `idl`.
- `src/core/` reads the RPC and parses transactions. It runs the surfnet lifecycle and cheatcodes. It funds accounts and records account snapshots. It normalizes execution results and assembles the report.
- `src/parsers/` defines known programs and decodes instructions, including Anchor accounts from an IDL. It builds an execution tree from logs.
- `src/output/` renders text and JSON.
- `.cursor/skills/tenet/SKILL.md` tells an agent how to run Tenet. Install it with `npx skills add Big-Aaron/solana_tenet --skill tenet`.

## Limitations (v0.1)

- Each simulation runs one transaction. Tenet does not run bundles.
- Tenet does not load program or account overrides from files.
- `--idl` names Anchor accounts and remaining accounts. Anchor instruction arguments stay raw.
- `simulate` always runs against the latest forked state. Clock pinning does not restore historical accounts.

## License

MIT
