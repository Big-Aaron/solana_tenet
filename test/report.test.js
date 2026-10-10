import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fromMeta } from "../src/core/execution.js";
import { buildReport } from "../src/core/report.js";
import { decodeTransaction, describeTransaction } from "../src/core/transaction.js";
import { renderJson } from "../src/output/json.js";
import { renderText } from "../src/output/text.js";
import { loadFixture } from "./helpers.js";

function replayReport(name) {
  const fixture = loadFixture(name);
  const tx = describeTransaction(decodeTransaction(fixture.wire), fixture.wire, fixture.meta.loadedAddresses);
  const keys = tx.accounts.map((account) => account.pubkey);
  return buildReport({
    mode: "replay",
    context: { rpcUrl: "https://rpc.test", slot: fixture.slot, blockTime: fixture.blockTime },
    tx,
    execution: fromMeta(fixture.meta, keys),
  });
}

const allSections = { showIxDetail: true, showBalanceChange: true };

describe("replay report", () => {
  it("renders a successful v0 transaction as text", () => {
    const text = renderText(replayReport("v0_pump_sell"), allSections);
    assert.match(text, /✓ SUCCESS \| CU: 111,647 \/ 400,000 \(28%\) \| Fee: 0\.000013451 SOL \| Size: 542 bytes/);
    assert.match(text, /#3\.3 Token-2022 Program: transferChecked/);
    assert.match(text, /5bxqDWkgK9mcJV7uULdnpkrvpr34J9qQGPYtbvriKSVi {2}-0\.253707420/);
    assert.match(text, /6iaUZbEpTADN45wgwGWPVA3HA9mgjjY8GEzmPHtZFSXW {2}\+1954840\.929852/);
  });

  it("renders a failed v1 transaction with its error and config", () => {
    const text = renderText(replayReport("v1_durable_nonce"), {});
    assert.match(text, /✗ FAILED/);
    assert.match(text, /Instruction #2 failed: custom program error 0x300e \(12302\)/);
    assert.match(text, /v1 config +priority fee: 414 lamports, compute unit limit: 360,000/);
    assert.match(text, /#1 System Program: advanceNonceAccount/);
    assert.doesNotMatch(text, /SOL Balance Changes/);
  });

  it("prints raw logs with --raw-log", () => {
    const text = renderText(replayReport("v0_pump_sell"), { rawLog: true });
    assert.match(text, /Program Logs/);
    assert.match(text, /Program ComputeBudget111111111111111111111111111111 invoke \[1\]/);
  });

  it("serializes to a single JSON document", () => {
    const doc = JSON.parse(renderJson(replayReport("v0_pump_sell")));
    assert.equal(doc.mode, "replay");
    assert.equal(doc.status.success, true);
    assert.deepEqual(doc.computeUnits, { consumed: 111_647, limit: 400_000 });
    assert.equal(doc.transaction.instructions[0].parsed.fields.units, 400_000);
    assert.equal(doc.innerInstructions[0].index, 2);
    assert.equal(doc.balanceChanges.sol[0].delta, "-253707420");
    assert.equal(doc.balanceChanges.token[0].decimals, 6);
  });
});
