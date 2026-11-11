/** Offline JSON-RPC app-server reference adapter. See docs/agent-adapters.md, worked mapping B. */
import { join } from "node:path";
import type { AgentInput, JsonObject, JsonValue, Message, Usage } from "@arnilo/prism";
import type { AgentAdapter, Decoded, OutboundFrame, RequestContext } from "@arnilo/prism-hosts/driver-process";

function text(input: string | Message | readonly Message[]): string {
  if (typeof input === "string") return input;
  const messages: readonly Message[] = Array.isArray(input) ? input : [input as Message];
  return messages.flatMap((message) => message.content.filter((part) => part.type === "text").map((part) => part.text)).join("\n");
}

function answerToDecision(answer: Awaited<ReturnType<RequestContext["ask"]>>): JsonValue {
  return { decision: "allow" in answer && answer.allow ? "allow" : "deny" };
}

export const rpcServer: AgentAdapter = {
  name: "@example/prism-adapter-rpc-server",
  revision: "1",
  transport: "json-rpc",
  descriptor: {
    vendor: "rpc-server",
    usesModel: false,
    models: "passthrough",
    controls: {
      systemPrompt: ["replace", "append"],
      builtinTools: "partial",
      clientTools: "native",
      skills: false,
      subagents: false,
      permissionCallback: true,
      rewrite: false,
      continueOnStop: true,
      steer: "mid-turn",
      resume: "vendor",
      isolation: "flags",
    },
    capture: {
      textDeltas: true,
      thinking: "deltas",
      skillActivation: "none",
      toolCalls: true,
      fileDiffs: true,
      subagents: "none",
      usage: "tokens",
    },
    auth: {
      modes: [
        {
          name: "account",
          kind: "account",
          deployments: ["local"],
          homeEnv: "RPC_HOME",
          protected: { paths: ["auth.json"], env: ["RPC_ACCOUNT_TOKEN"] },
          login: ["rpc-server", "login"],
          status: ["rpc-server", "login", "status"],
        },
        {
          name: "token",
          kind: "api-key",
          deployments: ["local", "hosted"],
          hostedAcknowledgements: ["rpc-server-token-terms"],
          homeEnv: "RPC_HOME",
          protected: { paths: ["token.json"], env: ["RPC_TOKEN"] },
        },
        {
          name: "key",
          kind: "api-key",
          deployments: ["local", "hosted"],
          homeEnv: "RPC_HOME",
          protected: { paths: ["api-key.json"], env: ["RPC_API_KEY"] },
        },
      ],
    },
  },
  binary: { command: ["rpc-server"], versionArgs: ["--version"], version: (stdout) => /\b\d+\.\d+\.\d+\b/.exec(stdout)?.[0] },
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
    const configPath = join(ctx.runDir.path, "config.json");
    const args = ["app-server", "--config", configPath];
    if (spec.isolation !== "inherit") args.push("--no-user-config");
    const config: Record<string, JsonValue> = {};
    if (spec.systemPrompt) {
      const mode = "replace" in spec.systemPrompt ? "base" : "developer";
      const content = "replace" in spec.systemPrompt ? spec.systemPrompt.replace : spec.systemPrompt.append;
      config.instructions = { mode, file: await ctx.runDir.writeFile("instructions.md", content) };
    }
    if (spec.model !== undefined) config.model = spec.model;
    if (spec.effort !== undefined) config.reasoningEffort = spec.effort;
    if (spec.builtinTools) config.approvalPolicy = spec.builtinTools.deny?.length ? "on-request" : "on-failure";
    if (ctx.endpoint) {
      await ctx.runDir.writeFile("mcp.json", JSON.stringify({ servers: { prism: ctx.endpoint } }));
      args.push("--mcp-config", join(ctx.runDir.path, "mcp.json"));
    }
    await ctx.runDir.writeFile("config.json", JSON.stringify(config));
    return { args };
  },
  open: (ctx): readonly OutboundFrame[] => {
    const thread = (method: string, threadId: string | null): OutboundFrame => ({
      method,
      params: { threadId, dynamicTools: ctx.tools as unknown as JsonValue },
      notify: true,
    });
    return [
      {
        method: "initialize",
        params: { capabilities: { experimentalApi: true }, clientInfo: { name: "prism", version: "1" } },
        notify: true,
      },
      { method: "initialized", notify: true },
      ctx.resume.sessionId ? thread("thread/resume", ctx.resume.sessionId) : thread("thread/start", null),
    ];
  },
  encode: {
    prompt: (input: AgentInput, ctx) => ({
      method: "turn/start",
      params: { threadId: ctx.sessionId ?? null, text: text(input) },
      notify: true,
    }),
    steer: (message: Message, ctx) => ({
      method: "turn/steer",
      params: { threadId: ctx.sessionId ?? null, turnId: ctx.turnId ?? null, text: text([message]) },
      notify: true,
    }),
    continue: (reason: string, ctx) => ({ method: "turn/start", params: { threadId: ctx.sessionId ?? null, text: reason }, notify: true }),
  },
  decode: decodeRpcNotification,
  requests: {
    "item/approval": async ({ params, ask }) => {
      const call = params as { toolCallId?: unknown; name?: unknown; args?: unknown };
      return answerToDecision(
        await ask({
          toolCallId: String(call.toolCallId ?? ""),
          name: String(call.name ?? ""),
          args: (call.args ?? {}) as JsonValue,
          effects: ["write"],
        }),
      );
    },
    "user/input": async ({ params, host }) => {
      const question = params as { question?: unknown };
      const answer = await host.ui?.request({ kind: "input", title: String(question.question ?? "Input") });
      return { answer: answer?.status === "answered" ? String(answer.value) : null };
    },
    "item/tool/call": async ({ params, bridge }) => {
      const call = params as { toolCallId?: unknown; name?: unknown; args?: unknown };
      const result = await bridge.invoke({
        type: "tool_call",
        id: String(call.toolCallId ?? ""),
        name: String(call.name ?? ""),
        arguments: (call.args ?? {}) as JsonObject,
      });
      return { result: (result.value ?? null) as JsonValue };
    },
  },
  session: { strategy: "vendor" },
  abort: [
    { rpc: "turn/interrupt", params: (ctx) => ({ threadId: ctx.sessionId ?? null, turnId: ctx.turnId ?? null }) },
    { closeStdin: true },
    { signal: "SIGTERM" },
  ],
  notices: (activity) =>
    activity.kind === "notice" && ["rate_limit", "quota", "billing", "auth"].includes(activity.code)
      ? { code: activity.code as "rate_limit" | "quota" | "billing" | "auth" }
      : undefined,
};

/** The wire table is intentionally explicit: unknown notifications remain available to capture:all. */
export function decodeRpcNotification(frame: JsonValue): Decoded {
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) return { activity: [], unmapped: true };
  const f = frame as Record<string, JsonValue>;
  if (typeof f.method !== "string") return { activity: [], unmapped: true };
  const params = (f.params && typeof f.params === "object" && !Array.isArray(f.params) ? f.params : {}) as Record<string, JsonValue>;
  const ids = {
    ...(typeof params.threadId === "string" ? { sessionId: params.threadId } : {}),
    ...(typeof params.turnId === "string" ? { turnId: params.turnId } : {}),
  };
  const item = (params.item && typeof params.item === "object" && !Array.isArray(params.item) ? params.item : undefined) as
    | Record<string, JsonValue>
    | undefined;
  switch (f.method) {
    case "turn/completed":
      return { activity: [], turnEnd: true, ...ids };
    case "item/agentMessage/delta":
      if (typeof params.delta === "string")
        return { activity: [{ kind: "message.delta", content: { type: "text", text: params.delta } }], ...ids };
      break;
    case "item/reasoning/delta":
      if (typeof params.delta === "string")
        return { activity: [{ kind: "message.delta", content: { type: "thinking", text: params.delta } }], ...ids };
      break;
    case "item/started":
      if (item?.type === "toolCall" && typeof item.id === "string" && typeof item.name === "string")
        return { activity: [{ kind: "tool.started", call: { id: item.id, name: item.name, args: item.args ?? {} } }], ...ids };
      break;
    case "item/completed":
      if (item?.type === "toolResult" && typeof item.id === "string")
        return {
          activity: [
            {
              kind: "tool.completed",
              toolCallId: item.id,
              status: item.status === "blocked" ? "blocked" : item.status === "error" ? "error" : "finished",
              ...(item.result !== undefined ? { result: item.result } : {}),
              ...(typeof item.error === "string" ? { error: item.error } : {}),
            },
          ],
          ...ids,
        };
      if (item?.type === "agentMessage" && typeof item.text === "string")
        return { activity: [{ kind: "message", message: { role: "assistant", content: [{ type: "text", text: item.text }] } }], ...ids };
      if (item?.type === "skill" && typeof item.name === "string")
        return {
          activity: [
            {
              kind: "skill",
              name: item.name,
              source: item.source === "native" || item.source === "tool" || item.source === "path" ? item.source : "explicit",
              resolved: item.resolved === true,
            },
          ],
          ...ids,
        };
      break;
    case "item/toolCall/progress":
      if (typeof params.toolCallId === "string")
        return { activity: [{ kind: "tool.progress", toolCallId: params.toolCallId, progress: params.progress ?? null }], ...ids };
      break;
    case "item/fileChange":
      if (typeof params.path === "string")
        return {
          activity: [
            {
              kind: "file",
              path: params.path,
              change: params.change === "created" || params.change === "deleted" || params.change === "moved" ? params.change : "modified",
              source: params.source === "diff" ? "diff" : "agent",
              ...(typeof params.diff === "string" ? { diff: params.diff } : {}),
            },
          ],
          ...ids,
        };
      break;
    case "turn/plan/updated":
      if (Array.isArray(params.entries))
        return { activity: [{ kind: "plan", entries: params.entries as unknown as { title: string; status: string }[] }], ...ids };
      break;
    case "item/subagent":
      if ((params.phase === "started" || params.phase === "completed") && typeof params.id === "string")
        return {
          activity: [
            {
              kind: "subagent",
              phase: params.phase,
              id: params.id,
              ...(typeof params.name === "string" ? { name: params.name } : {}),
              ...(typeof params.result === "string" ? { result: params.result } : {}),
            },
          ],
          ...ids,
        };
      break;
    case "thread/compacted":
      if (params.phase === "started" || params.phase === "completed")
        return {
          activity: [
            { kind: "compaction", phase: params.phase, ...(typeof params.summary === "string" ? { summary: params.summary } : {}) },
          ],
          ...ids,
        };
      break;
    case "notice":
      return {
        activity: [
          {
            kind: "notice",
            level: params.level === "warn" || params.level === "error" ? params.level : "info",
            code: typeof params.code === "string" ? params.code : "notice",
            message: typeof params.message === "string" ? params.message : "notice",
          },
        ],
        ...ids,
      };
    case "thread/tokenUsage/updated":
      if (params.usage && typeof params.usage === "object" && !Array.isArray(params.usage))
        return { activity: [{ kind: "usage", usage: params.usage as Usage }], ...ids };
      break;
    case "item/raw":
      return {
        activity: [
          {
            kind: "raw",
            vendor: typeof params.vendor === "string" ? params.vendor : "rpc-server",
            type: typeof params.type === "string" ? params.type : "raw",
            data: params.data ?? null,
          },
        ],
        ...ids,
      };
  }
  return { activity: [], unmapped: true, ...ids };
}
