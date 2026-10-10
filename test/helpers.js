import { readFileSync } from "node:fs";

/** A `getTransaction` (base64) RPC result saved from mainnet, plus its `signature`. */
export function loadFixture(name) {
  const fixture = JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
  return { ...fixture, wire: Buffer.from(fixture.transaction[0], "base64") };
}

/** Minimal stand-in for `Connection.getMultipleAccountsInfo`. */
export function fakeConnection(accounts) {
  return {
    async getMultipleAccountsInfo(pubkeys) {
      return pubkeys.map((key) => accounts[key.toBase58()] ?? null);
    },
  };
}
