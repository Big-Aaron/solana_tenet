const LOG = /^Program log: (.*)$/s;
const DATA = /^Program data: (.*)$/s;
const RETURN = /^Program return: (\S+) (.*)$/s;
const INVOKE = /^Program (\S+) invoke \[(\d+)\]$/;
const CONSUMED = /^Program (\S+) consumed (\d+) of (\d+) compute units$/;
const SUCCESS = /^Program (\S+) success$/;
const FAILED = /^Program (\S+) failed: (.*)$/s;

function newFrame(programId, depth) {
  return { programId, depth, entries: [], status: null, error: null, path: null, instruction: null };
}

/**
 * Build an invocation tree from program logs. Each frame holds its entries
 * in log order; nested invocations appear as `{ type: "invoke", frame }`.
 * The returned root frame (depth 0) collects top-level invocations and any
 * lines emitted outside of a program (e.g. "Log truncated").
 */
export function parseLogs(logs) {
  const root = newFrame(null, 0);
  const stack = [root];

  for (const line of logs ?? []) {
    const top = stack.at(-1);
    let match;
    if ((match = LOG.exec(line))) {
      top.entries.push({ type: "log", text: match[1] });
    } else if ((match = DATA.exec(line))) {
      top.entries.push({ type: "data", text: match[1] });
    } else if ((match = RETURN.exec(line))) {
      top.entries.push({ type: "return", programId: match[1], text: match[2] });
    } else if ((match = INVOKE.exec(line))) {
      const frame = newFrame(match[1], Number(match[2]));
      top.entries.push({ type: "invoke", frame });
      stack.push(frame);
    } else if ((match = CONSUMED.exec(line))) {
      top.entries.push({ type: "consumed", consumed: Number(match[2]), budget: Number(match[3]) });
    } else if ((match = SUCCESS.exec(line) ?? FAILED.exec(line))) {
      const failed = match[2] !== undefined;
      const index = stack.findLastIndex((frame) => frame.programId === match[1]);
      if (index <= 0) {
        top.entries.push({ type: "other", text: line });
        continue;
      }
      const frame = stack[index];
      frame.status = failed ? "failed" : "success";
      frame.error = failed ? match[2] : null;
      frame.entries.push(failed ? { type: "failed", text: match[2] } : { type: "success" });
      stack.length = index;
    } else {
      top.entries.push({ type: "other", text: line });
    }
  }
  return root;
}

function* childFrames(frame) {
  for (const entry of frame.entries) {
    if (entry.type === "invoke") {
      yield entry.frame;
      yield* childFrames(entry.frame);
    }
  }
}

function findFrom(list, start, programId) {
  for (let i = start; i < list.length; i++) {
    if (list[i].programId === programId) {
      return i;
    }
  }
  return -1;
}

/**
 * Attach instructions to trace frames: top-level frames match outer
 * instructions in order, nested frames match that instruction's inner
 * instructions in invocation order. Frames that can't be matched (e.g. due to
 * truncated logs) keep `instruction: null`.
 */
export function annotateTrace(root, instructions, innerInstructions) {
  let outerCursor = 0;
  for (const entry of root.entries) {
    if (entry.type !== "invoke") {
      continue;
    }
    const frame = entry.frame;
    const outer = findFrom(instructions, outerCursor, frame.programId);
    if (outer === -1) {
      continue;
    }
    outerCursor = outer + 1;
    frame.path = `${outer + 1}`;
    frame.instruction = instructions[outer];

    const inner = innerInstructions[outer] ?? [];
    let innerCursor = 0;
    for (const child of childFrames(frame)) {
      const index = findFrom(inner, innerCursor, child.programId);
      if (index !== -1) {
        innerCursor = index + 1;
        child.path = `${outer + 1}.${index + 1}`;
        child.instruction = inner[index];
      }
    }
  }
  return root;
}
