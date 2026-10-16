/** Little-endian hex bytes to a decimal integer string. */
export function littleEndianToDecimal(input) {
  const hex = String(input).trim().replace(/^0x/i, "");
  if (!hex || hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) {
    throw new Error(`invalid little-endian hex: ${input}`);
  }
  const bytes = Buffer.from(hex, "hex");
  let value = 0n;
  for (let i = bytes.length - 1; i >= 0; i -= 1) {
    value = (value << 8n) + BigInt(bytes[i]);
  }
  return value.toString();
}

export function runToDec(hex) {
  process.stdout.write(`${littleEndianToDecimal(hex)}\n`);
}
