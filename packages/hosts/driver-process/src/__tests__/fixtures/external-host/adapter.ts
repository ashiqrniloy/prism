import type { ExternalActivity } from "@arnilo/prism";
import type { AgentAdapter, OutboundFrame } from "@arnilo/prism-hosts/driver-process";
import { dialect } from "./dialect.js";

/**
 * A host-written adapter: the neutral contract wired to the host's dialect. The only imports are the public
 * package specifiers a host installs, so this file is the template the authoring guide points at.
 */
export function externalHostAdapter(command: readonly string[]): AgentAdapter {
  return {
    name: "external-host-driver",
    revision: "1",
    transport: "jsonl-stream",
    descriptor: {
      vendor: "neutral",
      usesModel: false,
      models: "passthrough",
      controls: {
        systemPrompt: ["append", "replace"],
        builtinTools: "per-tool",
        clientTools: "mcp",
        skills: true,
        subagents: true,
        permissionCallback: true,
        rewrite: false,
        continueOnStop: false,
        steer: "mid-turn",
        resume: "none",
        isolation: "flags",
      },
      capture: {
        textDeltas: true,
        thinking: "deltas",
        skillActivation: "native",
        toolCalls: true,
        fileDiffs: true,
        subagents: "full",
        usage: "tokens",
      },
      auth: {
        modes: [
          {
            name: "key",
            kind: "api-key",
            deployments: ["local", "hosted"],
            homeEnv: "NEUTRAL_HOME",
            protected: { paths: [], env: ["BLOCKED_TOKEN"] },
            hostedAcknowledgements: ["test-terms"],
          },
        ],
      },
    },
    binary: { command, versionArgs: ["--version"], version: (text) => (/^\d+\.\d+\.\d+$/.test(text) ? text : undefined) },
    profile: { parseStatus: ({ exitCode }) => ({ signedIn: exitCode === 0 }) },
    configure: (_spec, ctx) => ({ args: ["--hook-command", JSON.stringify(ctx.hook.argv)] }),
    encode: {
      prompt: (input) => JSON.parse(dialect.encodeInput({ kind: "user", text: typeof input === "string" ? input : "go" })),
      steer: (): OutboundFrame => ({ kind: "steer", text: "steer" }),
    },
    decode(frame) {
      const output = dialect.parseFrame(JSON.stringify(frame));
      if (output?.kind !== "frame") return { activity: [], unmapped: true };
      return "kind" in output.frame ? { activity: [output.frame as ExternalActivity] } : { activity: [], turnEnd: true };
    },
    hooks: {
      codec: {
        decode: (line) => {
          const call = JSON.parse(line);
          return { kind: "pre-tool", request: { toolCallId: call.id, name: call.name, args: call.args, effects: ["write"] } };
        },
        encode: (answer) => ({ exitCode: "allow" in answer && answer.allow ? 0 : 2, stdout: "" }),
      },
      failClosed: { exitCode: 2, stdout: "" },
    },
    session: { strategy: "none" },
    abort: [{ signal: "SIGTERM" }],
    notices: (activity) =>
      activity.kind === "notice" && activity.code === "rate_limit"
        ? { kind: "rate_limit", code: "rate_limit", retryAfterMs: 1000 }
        : undefined,
  };
}
