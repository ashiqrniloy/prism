/** Offline workspace-file-configured reference adapter. See docs/agent-adapters.md, worked mapping C. */
import { readFile } from "node:fs/promises";
import type { ExternalActivity, JsonValue, Message, Usage } from "@arnilo/prism";
import type { ExternalAgentSpec, MaterializedFile } from "@arnilo/prism/driver-kit";
import type { AgentAdapter, Decoded } from "@arnilo/prism-hosts/driver-process";

function text(input: string | Message | readonly Message[]): string {
  if (typeof input === "string") return input;
  const messages: readonly Message[] = Array.isArray(input) ? input : [input as Message];
  return messages.flatMap((message) => message.content.filter((part) => part.type === "text").map((part) => part.text)).join("\n");
}

/** Frontmatter carries the built-in tool list; the body is the replaced prompt. */
function agentFile(spec: Pick<ExternalAgentSpec, "builtinTools" | "systemPrompt">, subagent = false): string {
  const tools = spec.builtinTools?.allow ?? [];
  const frontmatter = [`tools: [${tools.join(", ")}]`, ...(subagent ? ["subagent: true"] : [])].join("\n");
  const body = spec.systemPrompt && "replace" in spec.systemPrompt ? spec.systemPrompt.replace : "";
  return `---\n${frontmatter}\n---\n\n${body}\n`;
}

const FAIL_CLOSED = { exitCode: 0, stdout: '{"decision":"deny","reason":"prism relay unavailable"}' };

export const workspaceConfig: AgentAdapter = {
  name: "@example/prism-adapter-workspace-config",
  revision: "1",
  transport: "jsonl-stream",
  descriptor: {
    vendor: "workspace-config",
    usesModel: false,
    models: "passthrough",
    controls: {
      systemPrompt: ["replace", "append"],
      builtinTools: "per-tool",
      clientTools: "mcp",
      skills: true,
      subagents: true,
      permissionCallback: true,
      rewrite: false,
      continueOnStop: true,
      steer: "next-turn",
      resume: "vendor",
      isolation: "workspace-files",
    },
    capture: {
      textDeltas: true,
      thinking: "tokens-only",
      skillActivation: "tool",
      toolCalls: true,
      fileDiffs: true,
      subagents: "summary",
      usage: "tokens",
    },
    auth: {
      modes: [
        {
          name: "account",
          kind: "account",
          deployments: ["local"],
          protected: { paths: ["auth.json"], env: ["WORKSPACE_CONFIG_TOKEN"] },
          login: ["workspace-config", "login"],
          status: ["workspace-config", "status", "--json"],
        },
        {
          name: "key",
          kind: "api-key",
          deployments: ["local", "hosted"],
          protected: { paths: ["api-key.json"], env: ["WORKSPACE_CONFIG_API_KEY"] },
        },
      ],
    },
  },
  binary: { command: ["workspace-config"], versionArgs: ["--version"], version: (stdout) => /\b\d+\.\d+\.\d+\b/.exec(stdout)?.[0] },
  profile: {
    parseStatus: ({ exitCode, stdout }) => {
      try {
        return { signedIn: exitCode === 0 && JSON.parse(stdout).signedIn === true };
      } catch {
        return { signedIn: false };
      }
    },
  },
  async configure(spec, ctx) {
    const args = ["--agent", spec.name, "--input-format", "stream-json", "--output-format", "stream-json"];
    if (spec.model !== undefined) args.push("--model", spec.model);
    if (spec.effort !== undefined) args.push("--effort", spec.effort);
    if (spec.isolation !== "inherit") args.push("--no-user-config");
    if (ctx.resume.sessionId !== undefined) args.push("--conversation", ctx.resume.sessionId);
    const overlays: MaterializedFile[] = [];
    const write = (path: string, content: string) => overlays.push({ path, content });
    write(`.agents/agents/${spec.name}.md`, agentFile(spec));
    if (spec.systemPrompt && "append" in spec.systemPrompt) write(".agents/rules/prism-append.md", spec.systemPrompt.append);
    if (spec.builtinTools?.deny?.length) write(".agents/rules/prism-deny.md", `Denied tools: ${spec.builtinTools.deny.join(", ")}`);
    for (const [name, sub] of Object.entries(spec.subagents ?? {})) write(`.agents/agents/${name}.md`, agentFile(sub, true));
    write(".agents/hooks.json", JSON.stringify({ PreToolUse: [{ type: "command", command: [...ctx.hook.argv] }] }));
    write(".agents/mcp.json", JSON.stringify({ strict: true, endpoint: ctx.endpoint ?? null }));
    if (ctx.skills) {
      const skillFiles: string[] = [];
      for (const [name, path] of ctx.skills.pathToSkill) {
        const file = `.agents/skills/${name}/SKILL.md`;
        write(file, await readFile(path, "utf8"));
        skillFiles.push(file);
      }
      write(".agents/skills/manifest.json", JSON.stringify({ skillFiles }));
    }
    write(".agents/manifest.json", JSON.stringify({ files: overlays.map((file) => file.path) }));
    return { args, overlays };
  },
  encode: {
    prompt: (input) => ({ type: "prompt", text: text(input) }),
    continue: (reason) => ({ type: "prompt", text: reason }),
  },
  decode: decodeWorkspaceFrame,
  hooks: {
    codec: {
      decode: (stdin) => {
        const value = JSON.parse(stdin);
        if (value.type === "stop") return { kind: "stop", reason: typeof value.reason === "string" ? value.reason : undefined };
        if (value.type !== "pre_tool" || typeof value.id !== "string" || typeof value.name !== "string")
          throw Error("invalid workspace hook");
        return {
          kind: "pre-tool",
          request: { toolCallId: value.id, name: value.name, args: value.input ?? {}, effects: ["write"] },
        };
      },
      encode: (answer) => {
        if ("end" in answer) return { exitCode: 0, stdout: JSON.stringify({ decision: answer.end.continue ? "continue" : "stop" }) };
        if ("allow" in answer)
          return {
            exitCode: 0,
            stdout: JSON.stringify(answer.allow ? { decision: "allow" } : { decision: "deny", reason: answer.message }),
          };
        return FAIL_CLOSED;
      },
    },
    failClosed: FAIL_CLOSED,
  },
  session: { strategy: "vendor" },
  abort: [{ closeStdin: true }, { signal: "SIGTERM" }],
  notices: (activity) =>
    activity.kind === "notice" && ["rate_limit", "quota", "billing", "auth"].includes(activity.code)
      ? { code: activity.code as "rate_limit" | "quota" | "billing" | "auth" }
      : undefined,
};

/** The wire table is intentionally explicit: unknown frames remain available to capture:all. */
export function decodeWorkspaceFrame(frame: JsonValue): Decoded {
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) return { activity: [], unmapped: true };
  const f = frame as Record<string, JsonValue>;
  const activity: ExternalActivity[] = [];
  switch (f.type) {
    case "init":
      if (typeof f.conversationId === "string") return { activity, sessionId: f.conversationId };
      break;
    case "text_delta":
      if (typeof f.text === "string") return { activity: [{ kind: "message.delta", content: { type: "text", text: f.text } }] };
      break;
    // The vendor streams no thinking text; only its token count in `usage` is captured.
    case "delta":
      break;
    case "message":
      if (Array.isArray(f.blocks))
        return { activity: [{ kind: "message", message: { role: "assistant", content: f.blocks as unknown as Message["content"] } }] };
      break;
    case "tool_start":
      if (typeof f.id === "string" && typeof f.name === "string")
        return { activity: [{ kind: "tool.started", call: { id: f.id, name: f.name, args: f.parameters ?? {} } }] };
      break;
    case "tool_progress":
      if (typeof f.id === "string") return { activity: [{ kind: "tool.progress", toolCallId: f.id, progress: f.progress }] };
      break;
    case "tool_end":
      if (typeof f.id === "string")
        return {
          activity: [
            {
              kind: "tool.completed",
              toolCallId: f.id,
              status: f.status === "blocked" ? "blocked" : f.status === "error" ? "error" : "finished",
              ...(f.output !== undefined ? { result: f.output } : {}),
              ...(typeof f.error === "string" ? { error: f.error } : {}),
            },
          ],
        };
      break;
    case "skill_read":
      return { activity: [{ kind: "skill", name: f.name as string, source: f.source as "tool", resolved: f.resolved as boolean }] };
    case "file_change":
      return {
        activity: [
          {
            kind: "file",
            path: f.path as string,
            change: f.change as "created" | "modified" | "deleted" | "moved",
            source: f.source as "agent" | "diff",
            ...(f.diff !== undefined ? { diff: f.diff as string } : {}),
          },
        ],
      };
    case "plan_update":
      return { activity: [{ kind: "plan", entries: f.entries as never }] };
    case "subagent_info":
      if (typeof f.id === "string" && (f.phase === "started" || f.phase === "completed"))
        return {
          activity: [
            {
              kind: "subagent",
              phase: f.phase,
              id: f.id,
              parentToolCallId: f.id,
              ...(typeof f.name === "string" ? { name: f.name } : {}),
              ...(typeof f.result === "string" ? { result: f.result } : {}),
            },
          ],
        };
      break;
    case "checkpoint":
      return {
        activity: [
          {
            kind: "compaction",
            phase: f.phase as "started" | "completed",
            ...(f.summary !== undefined ? { summary: f.summary as string } : {}),
          },
        ],
      };
    case "notice":
      return {
        activity: [
          {
            kind: "notice",
            level: f.level as "info" | "warn" | "error",
            code: f.code as string,
            message: f.message as string,
          },
        ],
      };
    case "usage":
      return { activity: [{ kind: "usage", usage: f.usage as Usage }] };
    case "raw":
      if (f.payload && typeof f.payload === "object" && !Array.isArray(f.payload))
        return { activity: [{ ...f.payload, kind: "raw" } as unknown as ExternalActivity] };
      break;
    case "result":
      return {
        activity: f.usage && typeof f.usage === "object" ? [{ kind: "usage", usage: f.usage as Usage }] : [],
        turnEnd: true,
        ...(typeof f.conversationId === "string" ? { sessionId: f.conversationId } : {}),
      };
  }
  return { activity, unmapped: true };
}
