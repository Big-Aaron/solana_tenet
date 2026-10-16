---
name: tenet
description: >-
  Use the Tenet CLI (npm package solana-tenet, https://www.npmjs.com/package/solana-tenet)
  to decode, simulate, or replay a Solana transaction, and to fetch or derive an
  Anchor IDL. Use when the user asks to inspect a transaction, name Anchor accounts
  or remaining accounts, simulate on a Surfpool fork, replay on-chain metadata,
  run tenet idl fetch, sync, or address, or install Tenet from npm.
---

# Tenet

Published package: [solana-tenet](https://www.npmjs.com/package/solana-tenet). The binary name is `tenet`. Node.js 22.13 or later is required.

```bash
npx solana-tenet <command> [args]
npm install -g solana-tenet
tenet <command> [args]
```

In this repository, run the checkout so the command uses the working tree:

```bash
node bin/tenet.js <command> [args]
```

Do not run `npx bin/tenet.js`. npx treats that path as a package name and exits 128 with no output. `npx solana-tenet` is the published package.

stdout is the report. Progress, warnings, and errors go to stderr. Add `--json` when the result will be parsed. A simulated transaction that fails on chain still exits 0; read the report status. The process exits 1 only when the command cannot run.

## Pick a command

| Goal | Command |
|------|---------|
| Structure only: instructions, lookup tables, account list | `decode` (alias `dec`) |
| Execute on a fork of current chain state | `simulate` (alias `sim`) |
| Confirmed result from `getTransaction` metadata | `replay` |
| Download, refresh, or derive an Anchor IDL | `idl` |
| Little-endian hex bytes to a decimal integer | `to-dec` |

`decode` and `simulate` take a signature, Base58 transaction, or Base64 transaction. Omit the argument to read stdin. `replay` takes a signature only. `to-dec` takes little-endian hex (optional `0x`) and prints one decimal integer. `0x639b010000000000` is `105315`.

```bash
node bin/tenet.js decode <SIGNATURE>
node bin/tenet.js dec <BASE64_TX> --json
node bin/tenet.js sim <SIGNATURE> -b -d
node bin/tenet.js replay <SIGNATURE> -b --json
```

Default RPC is mainnet-beta. Set `-u` or `TENET_RPC_URL` / `SOLANA_RPC_URL` for a dedicated endpoint.

## Anchor accounts

Pass `--idl` to `decode`, `simulate`, or `replay` to name accounts. Repeat the flag for several programs. Use `<PATH>`, or `<PROGRAM_ID>=<PATH>` when the file has no `address`.

```bash
node bin/tenet.js idl fetch <PROGRAM_ID> -o ./idls
node bin/tenet.js decode <SIGNATURE> --idl ./idls/<PROGRAM_ID>.json --json
```

Tenet matches the first 8 instruction bytes to the IDL discriminator. A legacy IDL with no discriminator uses `sha256("global:<name>")`. Nested structs flatten to `pool.vault`. Accounts after the IDL list are `remaining[0]`, `remaining[1]`, and so on. An optional account set to the program id is `(none)`. A named account the transaction omits is `(missing)`.

System, Compute Budget, SPL Token, Token-2022, ATA, and Memo keep their builtin decoders. `--idl` Borsh-decodes Anchor instruction arguments into `parsed.fields`, including structs, enums, vectors, and options. Integers wider than 32 bits stay exact. Arguments that do not match the IDL stay raw, and the account names are still shown.

In text output, account markers are `[<sig><perm><exe>]`: `s` signer, `w`/`r` writable/read-only, `x` program. `[n]` is the transaction account index. `decode` always prints instruction details. `simulate` and `replay` print them with `-d`.

JSON for an Anchor instruction puts named accounts on `parsed.accounts`, the rest on `parsed.remainingAccounts`, and arguments on `parsed.fields`.

## IDL command

The IDL account is `createWithSeed(findProgramAddress([], program), "anchor:idl", program)`. Account data is an 8-byte discriminator, a 32-byte authority, a little-endian length, and zlib-compressed JSON.

```bash
node bin/tenet.js idl address <PROGRAM_ID>
node bin/tenet.js idl fetch <PROGRAM_ID> [<PROGRAM_ID>...] -o ./idls
node bin/tenet.js idl sync ./idls
node bin/tenet.js idl sync ./idls/<PROGRAM_ID>.json
```

- `address` does not call an RPC. `--json` prints `{ "program", "idl_address" }`.
- `fetch` writes `<PROGRAM_ID>.json`. Without `-o`, the directory is `TENET_IDL_DIR`, then the working directory.
- `sync` re-fetches the on-chain IDL for every file named `<PROGRAM_ID>.json`. It replaces those files. It does not upload a local IDL. Other names are skipped. Without `-o`, files are written next to the source. `TENET_IDL_DIR` does not redirect `sync`.
- stdout lists only written paths, one per line. A missing IDL prints `warning: no IDL found: <PROGRAM_ID>` on stderr and the command still exits 0. Exit 1 means an invalid program id, a missing sync path, or a write failure.
- `--json` on `fetch` and `sync` prints `[{ "program", "path", "status" }]`. `status` is `ok`, `not_found`, or `error`. `path` is null unless `status` is `ok`.

## Simulate

`simulate` forks the RPC with an embedded Surfpool surfnet and loads accounts on demand. The fork is current state, so an old transaction can fail for reasons that did not exist when it landed. Use `replay` for the historical result.

Useful flags: `-b` balance changes, `-d` instruction details, `-l` raw logs, `--raw-ix-data`, `--idl`, `--fund-sol <PUBKEY>=<AMOUNT>`, `--fund-token <TOKEN_ACCOUNT>=<AMOUNT>` or `<OWNER>:<MINT>=<AMOUNT>`, `-s` slot, `-t` timestamp, `--at-tx-time`, `--check-sig`, `--surfnet-url`.

Clock flags change only the Clock sysvar. They do not restore old account data. `--check-sig` verifies signatures and keeps the signed blockhash. Token amounts with a dot use mint decimals; integers are raw units.

## Do not

- Do not sign or send transactions. Tenet only reads and simulates.
- Do not treat a failed simulation as a process failure. Check the report.
- Do not expect `--idl` to override builtin programs.
- Do not expect `idl sync` to publish a local IDL.
