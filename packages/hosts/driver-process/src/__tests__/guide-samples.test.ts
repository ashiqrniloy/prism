import { expect, test } from "bun:test";
import type { ExternalActivity } from "@arnilo/prism";
import { jsonlStreamDialect } from "@arnilo/prism/testing";
import { type AgentAdapter, extendAdapter } from "@arnilo/prism-hosts/driver-process";
import { adapterConformance } from "@arnilo/prism-hosts/driver-process/testing";

/**
 * The two synthesized code samples in `docs/agent-adapters.md`, kept compilable here. Every other sample in the
 * guide is a verbatim excerpt of `examples/adapters/*.ts`, `examples/adapters/conformance.ts`, or the package README.
 */
const minimal: AgentAdapter = {
  name: "example-adapter",
  revision: "1",
  transport: "jsonl-stream",
  descriptor: {
    vendor: "example",
    usesModel: false,
    models: "passthrough",
    controls: {
      systemPrompt: ["replace", "append"],
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
          deployments: ["local"],
          homeEnv: "EXAMPLE_HOME",
          protected: { paths: [], env: ["EXAMPLE_TOKEN"] },
        },
      ],
    },
  },
  binary: { command: ["example-cli"], versionArgs: ["--version"], version: (stdout) => /\d+\.\d+\.\d+/.exec(stdout)?.[0] },
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

const extended = extendAdapter(minimal, {
  name: "my-extended-adapter",
  revision: "1",
  configure: (baseConfigure) => async (spec, ctx) => {
    const plan = await baseConfigure(spec, ctx);
    return { ...plan, args: [...(plan.args ?? []), "--quiet"] };
  },
  descriptor: { auth: { modes: minimal.descriptor.auth.modes.map((mode) => ({ ...mode, deployments: ["local"] })) } },
});

const runConformance = () =>
  adapterConformance(minimal, {
    dialect: "jsonl-stream",
    fixtures: { config: (cli) => ({ binary: cli.command[0], args: [...cli.command.slice(1)] }) },
  });

test("guide_samples_typecheck", () => {
  expect(extended.name).toBe("my-extended-adapter");
  expect(typeof runConformance).toBe("function");
});
