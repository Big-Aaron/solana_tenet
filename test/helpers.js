import { readFileSync } from "node:fs";

/** A `getTransaction` (base64) RPC result saved from mainnet, plus its `signature`. */
export function loadFixture(name) {
  const fixture = JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
  return { ...fixture, wire: Buffer.from(fixture.transaction[0], "base64") };
}

/** Minimal stand-in for Kit's `getMultipleAccounts` (`encoding: "base64"`). */
export function fakeConnection(accounts) {
  return {
    getMultipleAccounts(pubkeys) {
      return {
        async send() {
          return {
            value: pubkeys.map((key) => {
              const account = accounts[key];
              if (!account) {
                return null;
              }
              return {
                lamports: account.lamports,
                owner: account.owner,
                data: [Buffer.from(account.data).toString("base64"), "base64"],
              };
            }),
          };
        },
      };
    },
  };
}
