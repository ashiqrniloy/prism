/** Offline wire companion for worked mapping C in docs/agent-adapters.md. */

import { fileURLToPath } from "node:url";
import type { ExternalActivity, Usage } from "@arnilo/prism";
import { defineScriptedDialect, type ScriptedInput } from "@arnilo/prism/testing";
import type { AdapterConformanceFixtures } from "@arnilo/prism-hosts/driver-process/testing";

export const workspaceConfigDialect = defineScriptedDialect({
  name: "workspace-config",
  locate: ({ argv, env, readFile }) => {
    const loaded: string[] = [];
    const read = (path: string) => {
      const content = readFile(path);
      return content === undefined ? undefined : JSON.parse(content);
    };
    const manifest = read(".agents/manifest.json");
    for (const rel of manifest?.files ?? []) if (readFile(rel) !== undefined) loaded.push(rel);
    const hooks = read(".agents/hooks.json");
    const mcp = read(".agents/mcp.json");
    if (!argv.includes("--no-user-config")) {
      const home = env.WS_HOME ?? env.HOME;
      for (const rel of [".workspace-config/hooks.json", ".workspace-config/skills/planted/SKILL.md", ".workspace-config/mcp.json"]) {
        const path = `${home}/${rel}`;
        if (readFile(path) !== undefined) loaded.push(path);
      }
    }
    return { hookCommand: hooks?.PreToolUse?.[0]?.command, endpoint: mcp?.endpoint ?? undefined, loaded };
  },
  encodeInput: (input) => {
    if (input.kind === "answer") return JSON.stringify({ type: "answer", id: input.id, allow: input.allow });
    if (input.kind === "interrupt") return JSON.stringify({ type: "interrupt" });
    return JSON.stringify({ type: input.kind === "steer" ? "steer" : "prompt", text: input.text });
  },
  decodeInput: (line) => {
    let value: { type?: unknown; text?: unknown; id?: unknown; allow?: unknown };
    try {
      value = JSON.parse(line);
    } catch {
      return undefined;
    }
    if (!value || typeof value !== "object") return undefined;
    if (value.type === "prompt" && typeof value.text === "string") return { kind: "user", text: value.text } as ScriptedInput;
    if (value.type === "steer" && typeof value.text === "string") return { kind: "steer", text: value.text } as ScriptedInput;
    if (value.type === "answer" && typeof value.id === "string") return { kind: "answer", id: value.id, allow: value.allow === true };
    if (value.type === "interrupt") return { kind: "interrupt" };
    return undefined;
  },
  frames: (frame) => {
    if (!("kind" in frame))
      return JSON.stringify({
        type: "result",
        conversationId: "ws-conversation",
        status: "done",
        usage: { inputTokens: 1, outputTokens: 1, thinkingTokens: 3 },
      });
    switch (frame.kind) {
      case "message.delta":
        return frame.content.type === "thinking"
          ? JSON.stringify({ type: "delta", block: "thinking", text: frame.content.text })
          : JSON.stringify({ type: "text_delta", text: frame.content.text });
      case "message":
        return JSON.stringify({ type: "message", role: frame.message.role, blocks: frame.message.content });
      case "tool.started":
        return JSON.stringify({ type: "tool_start", id: frame.call.id, name: frame.call.name, parameters: frame.call.args });
      case "tool.progress":
        return JSON.stringify({ type: "tool_progress", id: frame.toolCallId, progress: frame.progress });
      case "tool.completed":
        return JSON.stringify({ type: "tool_end", id: frame.toolCallId, status: frame.status, output: frame.result, error: frame.error });
      case "skill":
        return JSON.stringify({ type: "skill_read", name: frame.name, source: frame.source, resolved: frame.resolved });
      case "file":
        return JSON.stringify({ type: "file_change", path: frame.path, change: frame.change, source: frame.source, diff: frame.diff });
      case "plan":
        return JSON.stringify({ type: "plan_update", entries: frame.entries });
      case "subagent":
        return JSON.stringify({ type: "subagent_info", phase: frame.phase, id: frame.id, name: frame.name, result: frame.result });
      case "compaction":
        return JSON.stringify({ type: "checkpoint", phase: frame.phase, summary: frame.summary });
      case "notice":
        return JSON.stringify({ type: "notice", level: frame.level, code: frame.code, message: frame.message });
      case "usage":
        return JSON.stringify({ type: "usage", usage: frame.usage });
      default: {
        const { kind, ...data } = frame;
        return JSON.stringify({ type: kind, payload: data });
      }
    }
  },
  parseFrame: (line) => {
    let frame: ReturnType<typeof JSON.parse>;
    try {
      frame = JSON.parse(line);
    } catch {
      return undefined;
    }
    if (!frame || typeof frame !== "object") return undefined;
    if (frame.type === "result") return { kind: "frame", frame: { type: "turn.done" } };
    let activity: ExternalActivity;
    switch (frame.type) {
      case "text_delta":
        activity = { kind: "message.delta", content: { type: "text", text: frame.text } };
        break;
      case "message":
        activity = { kind: "message", message: { role: frame.role, content: frame.blocks } };
        break;
      case "tool_start":
        activity = { kind: "tool.started", call: { id: frame.id, name: frame.name, args: frame.parameters } };
        break;
      case "tool_progress":
        activity = { kind: "tool.progress", toolCallId: frame.id, progress: frame.progress };
        break;
      case "tool_end":
        activity = { kind: "tool.completed", toolCallId: frame.id, status: frame.status, result: frame.output, error: frame.error };
        break;
      case "skill_read":
        activity = { kind: "skill", name: frame.name, source: frame.source, resolved: frame.resolved };
        break;
      case "file_change":
        activity = { kind: "file", path: frame.path, change: frame.change, source: frame.source, diff: frame.diff };
        break;
      case "plan_update":
        activity = { kind: "plan", entries: frame.entries };
        break;
      case "subagent_info":
        activity = {
          kind: "subagent",
          phase: frame.phase,
          id: frame.id,
          parentToolCallId: frame.id,
          name: frame.name,
          result: frame.result,
        };
        break;
      case "checkpoint":
        activity = { kind: "compaction", phase: frame.phase, summary: frame.summary };
        break;
      case "notice":
        activity = { kind: "notice", level: frame.level, code: frame.code, message: frame.message };
        break;
      case "usage":
        activity = { kind: "usage", usage: frame.usage as Usage };
        break;
      default:
        if (!frame.payload || typeof frame.payload !== "object") return undefined;
        activity = { ...frame.payload, kind: frame.type };
        break;
    }
    return { kind: "frame", frame: activity };
  },
  hook: {
    via: "command",
    payload: (call) => JSON.stringify({ type: "pre_tool", id: call.id, name: call.tool, input: call.args }),
    allowed: (answer) => {
      try {
        return JSON.parse(answer.stdout).decision === "allow";
      } catch {
        return false;
      }
    },
  },
});

export const workspaceConfigFixtures: AdapterConformanceFixtures = {
  mode: "key",
  home: {
    hook: { path: ".workspace-config/hooks.json", content: '{"PreToolUse":[{"command":["planted-hook"]}]}' },
    skill: { path: ".workspace-config/skills/planted/SKILL.md", content: "planted skill" },
    mcp: { path: ".workspace-config/mcp.json", content: '{"endpoint":{"command":"planted-server"}}' },
  },
  config: (cli) => ({ binary: cli.command[0]!, args: cli.command.slice(1) }),
  recorded: fileURLToPath(new URL("./fixtures/workspace-config.json", import.meta.url)),
};
