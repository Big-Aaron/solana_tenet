import { renderDecodeJson, renderDecodeText } from "../output/decode.js";
import { renderJson } from "../output/json.js";
import { renderText } from "../output/text.js";
import { clearStatus } from "../utils/diagnostics.js";

export function printReport(report, opts) {
  clearStatus();
  process.stdout.write(`${opts.json ? renderJson(report) : renderText(report, opts)}\n`);
}

export function printDecode(model, opts) {
  clearStatus();
  process.stdout.write(`${opts.json ? renderDecodeJson(model) : renderDecodeText(model, opts)}\n`);
}
