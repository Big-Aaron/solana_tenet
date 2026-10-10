import { paint } from "../output/format.js";

const interactive = Boolean(process.stderr.isTTY);

/** Transient progress line on stderr; silent when stderr is not a terminal. */
export function status(message) {
  if (interactive) {
    process.stderr.write(`\r\x1b[2K${paint("dim", message, process.stderr)}`);
  }
}

export function clearStatus() {
  if (interactive) {
    process.stderr.write("\r\x1b[2K");
  }
}

export function warn(message) {
  clearStatus();
  process.stderr.write(`${paint("yellow", "warning", process.stderr)}: ${message}\n`);
}