/** Offline flag-configured reference adapter. See docs/agent-adapters.md, worked mapping A. */
import { cp, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExternalActivity, JsonValue, Message, Usage } from "@arnilo/prism";
import type { AgentAdapter, Decoded } from "@arnilo/prism-hosts/driver-process";

function text(input: string | Message | readonly Message[]): string {
  if (typeof input === "string") return input;
  const messages: readonly Message[] = Array.isArray(input) ? input : [input as Message];
  return messages.flatMap((message) => message.content.filter((part) => part.type === "text").map((part) => part.text)).join("\n");
}

export const streamCli: AgentAdapter = {
  name: "@example/prism-adapter-stream-cli",
  revision: "1",
  transport: "jsonl-stream",
  descriptor: {
    vendor: "stream-cli",
    usesModel: false,
    models: "passthrough",
    controls: {
      systemPrompt: ["replace", "append"],
      builtinTools: "per-tool",
      clientTools: "mcp",
      skills: true,
      subagents: true,
      permissionCallback: true,
      rewrite: true,
      continueOnStop: true,
      steer: "mid-turn",
      resume: "store",
      isolation: "flags",
    },
    capture: {
      textDeltas: true,
      thinking: "deltas",
      skillActivation: "native",
      toolCalls: true,
      fileDiffs: true,
      subagents: "full",
      usage: "tokens+cost",
    },
    auth: {
      modes: [
        {
          name: "account",
          kind: "account",
          deployments: ["local"],
          homeEnv: "STREAM_HOME",
          protected: { paths: ["credentials.json"], env: ["STREAM_ACCOUNT_TOKEN"] },
          login: ["stream-cli", "login"],
          status: ["stream-cli", "status", "--json"],
        },
        {
          name: "key",
          kind: "api-key",
          deployments: ["local", "hosted"],
          homeEnv: "STREAM_HOME",
          protected: { paths: ["api-key.json"], env: ["STREAM_API_KEY"] },
        },
      ],
    },
  },
  binary: { command: ["stream-cli"], versionArgs: ["--version"], version: (stdout) => /\b\d+\.\d+\.\d+\b/.exec(stdout)?.[0] },
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
    const args = [
      "--stream",
      "--settings",
      join(ctx.runDir.path, "settings.json"),
      "--mcp-config",
      join(ctx.runDir.path, "mcp.json"),
      "--strict-mcp",
      "--transcript",
      join(ctx.runDir.path, "transcript.jsonl"),
    ];
    const settings: Record<string, JsonValue> = { hooks: { preTool: [...ctx.hook.argv], stop: [...ctx.hook.argv] } };
    if (spec.isolation !== "inherit") args.push("--no-user-config");
    if (spec.systemPrompt) {
      const mode = "replace" in spec.systemPrompt ? "replace" : "append";
      const content = "replace" in spec.systemPrompt ? spec.systemPrompt.replace : spec.systemPrompt.append;
      settings.systemPrompt = { mode, file: await ctx.runDir.writeFile("prompt.md", content) };
    }
    for (const [flag, value] of [
      ["--model", spec.model],
      ["--effort", spec.effort],
      ["--allow-tools", spec.builtinTools?.allow?.join(",")],
      ["--deny-tools", spec.builtinTools?.deny?.join(",")],
    ] as const) {
      if (value !== undefined) args.push(flag, value);
    }
    if (ctx.skills) {
      await ctx.runDir.writeFile(
        "plugin/manifest.json",
        JSON.stringify({
          name: "prism-skills",
          skills: "skills",
          skillFiles: [...ctx.skills.pathToSkill.keys()].map((name) => `skills/${name}/SKILL.md`),
        }),
      );
      await cp(ctx.skills.root, join(ctx.runDir.path, "plugin/skills"), { recursive: true });
      args.push("--plugin", join(ctx.runDir.path, "plugin"));
    }
    if (spec.subagents) args.push("--agents", await ctx.runDir.writeFile("agents.json", JSON.stringify(spec.subagents)));
    await ctx.runDir.writeFile("settings.json", JSON.stringify(settings));
    await ctx.runDir.writeFile("mcp.json", JSON.stringify({ strict: true, endpoint: ctx.endpoint ?? null }));
    return { args };
  },
  encode: {
    prompt: (input) => ({ type: "user", text: text(input) }),
    steer: (message) => ({ type: "steer", text: text([message]) }),
    continue: (reason) => ({ type: "user", text: reason }),
  },
  decode: decodeStreamFrame,
  hooks: {
    codec: {
      decode: (stdin) => {
        const value = JSON.parse(stdin);
        if (value.type === "stop") return { kind: "stop", reason: typeof value.reason === "string" ? value.reason : undefined };
        if (value.type !== "pre_tool" || typeof value.id !== "string" || typeof value.name !== "string") throw Error("invalid stream hook");
        return { kind: "pre-tool", request: { toolCallId: value.id, name: value.name, args: value.input ?? {}, effects: ["write"] } };
      },
      encode: (answer) => {
        if ("end" in answer) return { exitCode: 0, stdout: JSON.stringify({ decision: answer.end.continue ? "continue" : "stop" }) };
        if ("allow" in answer)
          return {
            exitCode: answer.allow ? 0 : 2,
            stdout: JSON.stringify(
              answer.allow
                ? { decision: "allow", ...(answer.args !== undefined ? { updatedInput: answer.args } : {}) }
                : { decision: "deny", reason: answer.message },
            ),
          };
        return { exitCode: 2, stdout: "" };
      },
    },
    failClosed: { exitCode: 2, stdout: "" },
  },
  session: {
    strategy: "store",
    archive: async (ctx) => [await readFile(join(ctx.runDir.path, "transcript.jsonl"), "utf8")],
    restore: async (entries, ctx) => {
      const transcript = entries.at(-1);
      if (typeof transcript !== "string") throw Error("invalid stream transcript");
      const path = await ctx.runDir.writeFile("transcript.jsonl", transcript);
      return { args: ["--resume-file", path] };
    },
  },
  abort: [{ signal: "SIGINT" }, { signal: "SIGTERM" }],
  notices: (activity) =>
    activity.kind === "notice" && ["rate_limit", "quota", "billing", "auth"].includes(activity.code)
      ? { code: activity.code as "rate_limit" | "quota" | "billing" | "auth" }
      : undefined,
};

/** The wire table is intentionally explicit: unknown frames remain available to capture:all. */
export function decodeStreamFrame(frame: JsonValue): Decoded {
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) return { activity: [], unmapped: true };
  const f = frame as Record<string, JsonValue>;
  const activity: ExternalActivity[] = [];
  switch (f.type) {
    case "init":
      if (typeof f.sessionId === "string") return { activity, sessionId: f.sessionId };
      break;
    case "assistant":
      if (!Array.isArray(f.blocks)) break;
      for (const block of f.blocks) {
        if (
          block &&
          typeof block === "object" &&
          !Array.isArray(block) &&
          (block.type === "text" || block.type === "thinking") &&
          typeof block.text === "string"
        ) {
          activity.push({ kind: "message.delta", content: { type: block.type, text: block.text } });
        } else return { activity, unmapped: true };
      }
      return { activity };
    case "delta":
      if ((f.block === "text" || f.block === "thinking") && typeof f.text === "string")
        return { activity: [{ kind: "message.delta", content: { type: f.block, text: f.text } }] };
      break;
    case "tool_use":
      if (typeof f.id === "string" && typeof f.name === "string")
        return { activity: [{ kind: "tool.started", call: { id: f.id, name: f.name, args: f.input ?? {} } }] };
      break;
    case "tool_result":
      if (typeof f.id === "string")
        return {
          activity: [
            {
              kind: "tool.completed",
              toolCallId: f.id,
              status: f.status === "blocked" ? "blocked" : f.status === "error" ? "error" : "finished",
              ...(f.result !== undefined ? { result: f.result } : {}),
              ...(typeof f.error === "string" ? { error: f.error } : {}),
            },
          ],
        };
      break;
    case "retry":
    case "permission_denied":
      return {
        activity: [
          {
            kind: "notice",
            level: "warn",
            code: f.type === "permission_denied" ? "permission_denied" : typeof f.category === "string" ? f.category : "retry",
            message: typeof f.message === "string" ? f.message : String(f.type),
          },
        ],
      };
    case "subagent":
      if (typeof f.parentToolId === "string" && (f.phase === "started" || f.phase === "completed"))
        return {
          activity: [
            {
              kind: "subagent",
              phase: f.phase,
              id: f.parentToolId,
              parentToolCallId: f.parentToolId,
              ...(typeof f.name === "string" ? { name: f.name } : {}),
              ...(typeof f.result === "string" ? { result: f.result } : {}),
            },
          ],
        };
      break;
    case "result":
      return {
        activity: f.usage && typeof f.usage === "object" ? [{ kind: "usage", usage: f.usage as Usage }] : [],
        turnEnd: true,
        ...(typeof f.sessionId === "string" ? { sessionId: f.sessionId } : {}),
      };
    // Additional notifications carry the same fields as their normalized activity.
    case "message":
    case "tool.progress":
    case "skill":
    case "file":
    case "plan":
    case "compaction":
    case "usage":
    case "raw":
      if (f.payload && typeof f.payload === "object" && !Array.isArray(f.payload))
        return { activity: [{ ...f.payload, kind: f.type } as unknown as ExternalActivity] };
      break;
  }
  return { activity, unmapped: true };
}
