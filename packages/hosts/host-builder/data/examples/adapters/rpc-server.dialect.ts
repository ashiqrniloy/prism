/** Offline wire companion for worked mapping B in docs/agent-adapters.md. */

import { fileURLToPath } from "node:url";
import type { ExternalActivity, JsonValue, Usage } from "@arnilo/prism";
import { defineScriptedDialect } from "@arnilo/prism/testing";
import type { AdapterConformanceFixtures } from "@arnilo/prism-hosts/driver-process/testing";

export const rpcServerDialect = defineScriptedDialect({
  name: "rpc-server",
  locate: ({ argv, env, readFile }) => {
    const loaded: string[] = [];
    const load = (path: string | undefined) => {
      if (!path) return undefined;
      const content = readFile(path);
      if (content === undefined) return undefined;
      loaded.push(path);
      return JSON.parse(content);
    };
    const flag = (name: string) => {
      const i = argv.indexOf(name);
      return i < 0 ? undefined : argv[i + 1];
    };
    const config = load(flag("--config"));
    if (config?.instructions?.file && readFile(config.instructions.file) !== undefined) loaded.push(config.instructions.file);
    const mcp = load(flag("--mcp-config"));
    if (!argv.includes("--no-user-config")) {
      const home = env.RPC_HOME ?? env.HOME;
      for (const rel of [".rpc-server/config.json", ".rpc-server/skills/planted/SKILL.md", ".rpc-server/mcp.json"]) {
        const path = `${home}/${rel}`;
        if (readFile(path) !== undefined) loaded.push(path);
      }
    }
    return { endpoint: mcp?.servers?.prism, loaded };
  },
  encodeInput: (input) => {
    if (input.kind === "answer")
      return JSON.stringify({ jsonrpc: "2.0", id: input.id, result: { decision: input.allow ? "allow" : "deny" } });
    const method = input.kind === "user" ? "turn/start" : input.kind === "steer" ? "turn/steer" : "turn/interrupt";
    return JSON.stringify({ jsonrpc: "2.0", id: 0, method, params: input.kind === "interrupt" ? {} : { text: input.text } });
  },
  decodeInput: (line) => {
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
    if (message.method === "turn/start") return { kind: "user", text };
    if (message.method === "turn/steer") return { kind: "steer", text };
    if (message.method === "turn/interrupt") return { kind: "interrupt" };
    return undefined;
  },
  frames: (frame) => {
    const ids = { threadId: "thread-1", turnId: "turn-1" };
    const wrap = (method: string, params: Record<string, unknown>) =>
      JSON.stringify({ jsonrpc: "2.0", method, params: { ...ids, ...params } });
    if (!("kind" in frame)) return wrap("turn/completed", {});
    switch (frame.kind) {
      case "message.delta":
        return frame.content.type === "thinking"
          ? wrap("item/reasoning/delta", { delta: frame.content.text })
          : wrap("item/agentMessage/delta", { delta: frame.content.text });
      case "message":
        return wrap("item/completed", {
          item: {
            type: "agentMessage",
            text: frame.message.content
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("\n"),
          },
        });
      case "tool.started":
        return wrap("item/started", { item: { type: "toolCall", id: frame.call.id, name: frame.call.name, args: frame.call.args } });
      case "tool.progress":
        return wrap("item/toolCall/progress", { toolCallId: frame.toolCallId, progress: frame.progress });
      case "tool.completed":
        return wrap("item/completed", {
          item: { type: "toolResult", id: frame.toolCallId, status: frame.status, result: frame.result, error: frame.error },
        });
      case "skill":
        return wrap("item/completed", { item: { type: "skill", name: frame.name, source: frame.source, resolved: frame.resolved } });
      case "file":
        return wrap("item/fileChange", { path: frame.path, change: frame.change, source: frame.source, diff: frame.diff });
      case "plan":
        return wrap("turn/plan/updated", { entries: frame.entries });
      case "subagent":
        return wrap("item/subagent", { phase: frame.phase, id: frame.id, name: frame.name, result: frame.result });
      case "compaction":
        return wrap("thread/compacted", { phase: frame.phase, summary: frame.summary });
      case "notice":
        return wrap("notice", { level: frame.level, code: frame.code, message: frame.message });
      case "usage":
        return wrap("thread/tokenUsage/updated", { usage: frame.usage });
      case "raw":
        return wrap("item/raw", { vendor: frame.vendor, type: frame.type, data: frame.data });
      default:
        return wrap("item/unknown", {});
    }
  },
  parseFrame: (line) => {
    let message: { method?: unknown; id?: unknown; params?: Record<string, unknown> } | null;
    try {
      message = JSON.parse(line);
    } catch {
      return undefined;
    }
    if (typeof message !== "object" || message === null) return undefined;
    if (message.method === "turn/completed") return { kind: "frame", frame: { type: "turn.done" } };
    const params = message.params ?? {};
    if (message.method === "item/approval" && message.id !== undefined) {
      return {
        kind: "hook",
        call: { id: String(message.id), tool: String(params.name ?? ""), args: (params.args ?? {}) as JsonValue },
      };
    }
    const item = (params.item ?? {}) as Record<string, unknown>;
    let activity: ExternalActivity;
    switch (message.method) {
      case "item/agentMessage/delta":
        activity = { kind: "message.delta", content: { type: "text", text: String(params.delta) } };
        break;
      case "item/reasoning/delta":
        activity = { kind: "message.delta", content: { type: "thinking", text: String(params.delta) } };
        break;
      case "item/started":
        activity = {
          kind: "tool.started",
          call: { id: String(item.id), name: String(item.name), args: item.args as JsonValue },
        };
        break;
      case "item/completed":
        if (item.type === "toolResult") {
          activity = { kind: "tool.completed", toolCallId: String(item.id), status: item.status as "finished" | "error" | "blocked" };
          break;
        }
        if (item.type === "skill") {
          activity = {
            kind: "skill",
            name: String(item.name),
            source: (item.source ?? "explicit") as "native" | "tool" | "explicit" | "path",
            resolved: item.resolved === true,
          };
          break;
        }
        activity = {
          kind: "message",
          message: { role: "assistant", content: [{ type: "text", text: String(item.text) }] },
        };
        break;
      case "item/toolCall/progress":
        activity = { kind: "tool.progress", toolCallId: String(params.toolCallId), progress: params.progress as JsonValue };
        break;
      case "item/fileChange":
        activity = {
          kind: "file",
          path: String(params.path),
          change: params.change as "created" | "modified" | "deleted" | "moved",
          source: params.source as "agent" | "diff",
          ...(typeof params.diff === "string" ? { diff: params.diff } : {}),
        };
        break;
      case "turn/plan/updated":
        activity = { kind: "plan", entries: params.entries as { title: string; status: string }[] };
        break;
      case "item/subagent":
        activity = { kind: "subagent", phase: params.phase as "started" | "completed", id: String(params.id) };
        break;
      case "thread/compacted":
        activity = { kind: "compaction", phase: params.phase as "started" | "completed" };
        break;
      case "notice":
        activity = {
          kind: "notice",
          level: params.level as "info" | "warn" | "error",
          code: String(params.code),
          message: String(params.message),
        };
        break;
      case "thread/tokenUsage/updated":
        activity = { kind: "usage", usage: params.usage as Usage };
        break;
      case "item/raw":
        activity = { kind: "raw", vendor: String(params.vendor), type: String(params.type), data: params.data as JsonValue };
        break;
      default:
        return undefined;
    }
    return { kind: "frame", frame: activity };
  },
  hook: {
    via: "client",
    request: (call) =>
      JSON.stringify({
        jsonrpc: "2.0",
        id: call.id,
        method: "item/approval",
        params: { toolCallId: call.id, name: call.tool, args: call.args },
      }),
  },
});

export const rpcServerFixtures: AdapterConformanceFixtures = {
  mode: "key",
  home: {
    hook: { path: ".rpc-server/config.json", content: '{"model":"planted-model"}' },
    skill: { path: ".rpc-server/skills/planted/SKILL.md", content: "planted skill" },
    mcp: { path: ".rpc-server/mcp.json", content: '{"servers":{"planted":{"command":"planted-server"}}}' },
  },
  config: (cli) => ({ binary: cli.command[0]!, args: cli.command.slice(1) }),
  recorded: fileURLToPath(new URL("./fixtures/rpc-server.json", import.meta.url)),
};
