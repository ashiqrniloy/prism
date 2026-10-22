import type { JsonValue } from "../../contracts.js";
import type { ScriptedDialect, ScriptedInput, ScriptedOutput, ScriptFrame } from "../scripted-cli.js";

/**
 * `json-rpc` (roadmap §2.12.4): a JSON-RPC 2.0 app-server over stdio, JSONL framed. The client sends the neutral
 * methods `turn.start`, `turn.steer`, and `turn.interrupt`. The server sends `approval.request` to the client and
 * waits for the answer. A JSON-RPC error answer counts as a deny. The shapes are neutral: no vendor frame is copied.
 *
 * Every function is self-contained, because the binary inlines it from its source text.
 */
export const jsonRpcDialect: ScriptedDialect = {
  name: "json-rpc",
  encodeInput: (input: ScriptedInput): string => {
    if (input.kind === "answer") {
      return JSON.stringify({ jsonrpc: "2.0", id: input.id, result: { decision: input.allow ? "allow" : "deny" } });
    }
    const method = input.kind === "user" ? "turn.start" : input.kind === "steer" ? "turn.steer" : "turn.interrupt";
    const params = input.kind === "interrupt" ? {} : { text: input.text };
    return JSON.stringify({ jsonrpc: "2.0", id: 0, method, params });
  },
  decodeInput: (line: string): ScriptedInput | undefined => {
    let message: { method?: unknown; id?: unknown; params?: { text?: unknown }; result?: { decision?: unknown } } | null;
    try {
      message = JSON.parse(line);
    } catch {
      return undefined;
    }
    if (typeof message !== "object" || message === null) return undefined;
    if (message.method === undefined) {
      if (message.id === undefined) return undefined;
      return { kind: "answer", id: String(message.id), allow: message.result?.decision === "allow" };
    }
    const text = typeof message.params?.text === "string" ? message.params.text : "";
    if (message.method === "turn.start") return { kind: "user", text };
    if (message.method === "turn.steer") return { kind: "steer", text };
    if (message.method === "turn.interrupt") return { kind: "interrupt" };
    return undefined;
  },
  frames: (frame: ScriptFrame): string =>
    JSON.stringify(
      "type" in frame && frame.type === "turn.done"
        ? { jsonrpc: "2.0", method: "turn.completed", params: {} }
        : { jsonrpc: "2.0", method: "activity", params: frame },
    ),
  parseFrame: (line: string): ScriptedOutput | undefined => {
    let message: { method?: unknown; id?: unknown; params?: { tool?: unknown; args?: unknown } & Record<string, unknown> } | null;
    try {
      message = JSON.parse(line);
    } catch {
      return undefined;
    }
    if (typeof message !== "object" || message === null) return undefined;
    if (message.method === "turn.completed") return { kind: "frame", frame: { type: "turn.done" } };
    if (message.method === "activity" && typeof message.params === "object" && message.params !== null) {
      return { kind: "frame", frame: message.params as ScriptFrame };
    }
    if (message.method === "approval.request" && message.id !== undefined) {
      return {
        kind: "hook",
        call: { id: String(message.id), tool: String(message.params?.tool ?? ""), args: (message.params?.args ?? {}) as JsonValue },
      };
    }
    return undefined;
  },
  hook: {
    via: "client",
    request: (call): string =>
      JSON.stringify({ jsonrpc: "2.0", id: call.id, method: "approval.request", params: { tool: call.tool, args: call.args } }),
  },
};
