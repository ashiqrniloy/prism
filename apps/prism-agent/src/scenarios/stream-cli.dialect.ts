/**
 * Host code copied from the Phase 15 reference dialect (examples/adapters/stream-cli.dialect.ts, plan 167).
 * Lives under scenarios/ because it imports the kernel testing helpers, which the boundary gate allows only here.
 */
/** Offline wire companion for worked mapping A in docs/agent-adapters.md. */

import { fileURLToPath } from "node:url";
import type { ExternalActivity } from "@arnilo/prism";
import { defineScriptedDialect, type ScriptedInput } from "@arnilo/prism/testing";
import type { AdapterConformanceFixtures } from "@arnilo/prism-driver-process/testing";

export const hostStreamCliDialect = defineScriptedDialect({
  name: "stream-cli",
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
    const settings = load(flag("--settings"));
    const mcp = load(flag("--mcp-config"));
    if (settings?.systemPrompt?.file && readFile(settings.systemPrompt.file) !== undefined) loaded.push(settings.systemPrompt.file);
    const plugin = flag("--plugin");
    if (plugin) {
      const manifest = load(`${plugin}/manifest.json`);
      for (const rel of manifest?.skillFiles ?? []) {
        const path = `${plugin}/${rel}`;
        if (readFile(path) !== undefined) loaded.push(path);
      }
    }
    load(flag("--agents"));
    const resume = flag("--resume-file");
    if (resume && readFile(resume) !== undefined) loaded.push(resume);
    if (!argv.includes("--no-user-config")) {
      const home = env.STREAM_HOME ?? env.HOME;
      for (const rel of [".stream-cli/settings.json", ".stream-cli/plugins/planted/skills/planted/SKILL.md", ".stream-cli/mcp.json"]) {
        const path = `${home}/${rel}`;
        if (readFile(path) !== undefined) loaded.push(path);
      }
    }
    return { hookCommand: settings?.hooks?.preTool, endpoint: mcp?.endpoint ?? undefined, loaded };
  },
  encodeInput: (input) => JSON.stringify({ type: input.kind, ...("text" in input ? { text: input.text } : {}) }),
  decodeInput: (line) => {
    let value: ReturnType<typeof JSON.parse>;
    try {
      value = JSON.parse(line);
    } catch {
      return undefined;
    }
    if (!value || (value.type !== "user" && value.type !== "steer")) return undefined;
    // Model a binary-owned transcript, including the restored contents on the next process start.
    const i = process.argv.indexOf("--transcript");
    if (i >= 0) require("node:fs").appendFileSync(process.argv[i + 1], `${line}\n`);
    return { kind: value.type, text: value.text } as ScriptedInput;
  },
  frames: (frame) => {
    if (!("kind" in frame))
      return JSON.stringify({ type: "result", sessionId: "stream-session", usage: { inputTokens: 1, outputTokens: 1 } });
    switch (frame.kind) {
      case "message.delta":
        return JSON.stringify({ type: "delta", block: frame.content.type, text: frame.content.text });
      case "tool.started":
        return JSON.stringify({ type: "tool_use", id: frame.call.id, name: frame.call.name, input: frame.call.args });
      case "tool.completed":
        return JSON.stringify({
          type: "tool_result",
          id: frame.toolCallId,
          status: frame.status,
          result: frame.result,
          error: frame.error,
        });
      case "subagent":
        return JSON.stringify({
          type: "subagent",
          parentToolId: frame.parentToolCallId ?? frame.id,
          phase: frame.phase,
          name: frame.name,
          result: frame.result,
        });
      case "notice":
        return JSON.stringify({ type: "retry", category: frame.code, message: frame.message });
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
      case "assistant":
        activity = { kind: "message", message: { role: "assistant", content: frame.blocks } };
        break;
      case "delta":
        activity = { kind: "message.delta", content: { type: frame.block, text: frame.text } };
        break;
      case "tool_use":
        activity = { kind: "tool.started", call: { id: frame.id, name: frame.name, args: frame.input } };
        break;
      case "tool_result":
        activity = { kind: "tool.completed", toolCallId: frame.id, status: frame.status, result: frame.result, error: frame.error };
        break;
      case "subagent":
        activity = {
          kind: "subagent",
          id: frame.parentToolId,
          parentToolCallId: frame.parentToolId,
          phase: frame.phase,
          ...(frame.name ? { name: frame.name } : {}),
        };
        break;
      case "retry":
      case "permission_denied":
        activity = {
          kind: "notice",
          level: "warn",
          code: frame.type === "retry" ? frame.category : "permission_denied",
          message: frame.message,
        };
        break;
      case "message":
      case "tool.progress":
      case "skill":
      case "file":
      case "plan":
      case "compaction":
      case "usage":
      case "raw":
        if (!frame.payload || typeof frame.payload !== "object") return undefined;
        activity = { ...frame.payload, kind: frame.type };
        break;
      default:
        return undefined;
    }
    return { kind: "frame", frame: activity };
  },
  hook: {
    via: "command",
    payload: (call) => JSON.stringify({ type: "pre_tool", id: call.id, name: call.tool, input: call.args }),
    allowed: (answer) => answer.exitCode === 0,
  },
});

export const hostStreamCliFixtures: AdapterConformanceFixtures = {
  mode: "key",
  home: {
    hook: { path: ".stream-cli/settings.json", content: '{"hooks":{"preTool":["planted-hook"]}}' },
    skill: { path: ".stream-cli/plugins/planted/skills/planted/SKILL.md", content: "planted skill" },
    mcp: { path: ".stream-cli/mcp.json", content: '{"endpoint":{"command":"planted-server"}}' },
  },
  config: (cli) => ({ binary: cli.command[0]!, args: cli.command.slice(1) }),
  recorded: fileURLToPath(new URL("./fixtures/stream-cli.json", import.meta.url)),
};
