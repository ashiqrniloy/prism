import type { ExternalActivity } from "@arnilo/prism";
import { jsonlStreamDialect } from "@arnilo/prism/testing";
import type { AgentAdapter } from "../../index.js";

export function testAdapter(command: readonly string[]): AgentAdapter {
  return {
    name: "test-process-driver",
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
        permissionCallback: false,
        rewrite: false,
        continueOnStop: false,
        steer: "none",
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
          },
        ],
      },
    },
    binary: { command, versionArgs: ["--version"], version: (text) => (/^\d+\.\d+\.\d+$/.test(text) ? text : undefined) },
    profile: { parseStatus: ({ exitCode }) => ({ signedIn: exitCode === 0 }) },
    configure: () => ({ args: [] }),
    encode: {
      prompt: (input) => JSON.parse(jsonlStreamDialect.encodeInput({ kind: "user", text: typeof input === "string" ? input : "go" })),
    },
    decode(frame) {
      const output = jsonlStreamDialect.parseFrame(JSON.stringify(frame));
      if (output?.kind !== "frame") return { activity: [], unmapped: true };
      return "kind" in output.frame ? { activity: [output.frame as ExternalActivity] } : { activity: [], turnEnd: true };
    },
    session: { strategy: "none" },
    abort: [{ signal: "SIGTERM" }],
  };
}
