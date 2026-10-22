import type { ScriptedDialect, ScriptedInput, ScriptedOutput, ScriptFrame } from "../scripted-cli.js";

/**
 * `jsonl-stream` (roadmap §2.12.4): one process per conversation. Each direction is one JSON object per line.
 * Gate calls run the driver's hook command with the call as JSON on stdin, and the binary honors its exit code.
 * The shapes are neutral: no vendor frame is copied here.
 *
 * Every function is self-contained, because the binary inlines it from its source text.
 */
export const jsonlStreamDialect: ScriptedDialect = {
  name: "jsonl-stream",
  encodeInput: (input: ScriptedInput): string => JSON.stringify(input),
  decodeInput: (line: string): ScriptedInput | undefined => {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return undefined;
    }
    const kind = typeof value === "object" && value !== null ? (value as { kind?: unknown }).kind : undefined;
    return kind === "user" || kind === "steer" || kind === "answer" || kind === "interrupt" ? (value as ScriptedInput) : undefined;
  },
  frames: (frame: ScriptFrame): string => JSON.stringify(frame),
  parseFrame: (line: string): ScriptedOutput | undefined => {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return undefined;
    }
    if (typeof value !== "object" || value === null) return undefined;
    if ((value as { type?: unknown }).type === "turn.done") return { kind: "frame", frame: { type: "turn.done" } };
    if (typeof (value as { kind?: unknown }).kind === "string") return { kind: "frame", frame: value as ScriptFrame };
    return undefined;
  },
  hook: {
    via: "command",
    payload: (call): string => JSON.stringify({ kind: "pre-tool", id: call.id, name: call.tool, args: call.args }),
  },
};
