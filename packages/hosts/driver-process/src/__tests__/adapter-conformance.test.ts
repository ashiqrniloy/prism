import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JsonObject } from "@arnilo/prism";
import { jsonlStreamDialect, jsonRpcDialect } from "@arnilo/prism/testing";
import type { AgentAdapter } from "../index.js";
import { adapterConformance } from "../testing.js";
import { testAdapter } from "./fixtures/test-adapter.js";

const LONG = 180_000;

function adapter(rpc = false): AgentAdapter {
  const base = testAdapter([process.execPath]);
  const dialect = rpc ? jsonRpcDialect : jsonlStreamDialect;
  return {
    ...base,
    transport: rpc ? "json-rpc" : "jsonl-stream",
    descriptor: {
      ...base.descriptor,
      controls: { ...base.descriptor.controls, steer: "mid-turn", permissionCallback: true },
      auth: { modes: [{ ...base.descriptor.auth.modes[0]!, hostedAcknowledgements: ["test-terms"] }] },
    },
    configure: (_, ctx) => ({ args: rpc ? [] : ["--hook-command", JSON.stringify(ctx.hook.argv)] }),
    encode: {
      prompt: (input) =>
        rpc
          ? { method: "turn.start", params: { text: String(input) }, notify: true }
          : JSON.parse(dialect.encodeInput({ kind: "user", text: String(input) })),
      steer: (): import("../index.js").OutboundFrame =>
        rpc ? { method: "turn.steer", params: { text: "steer" }, notify: true } : { kind: "steer", text: "steer" },
    },
    decode(frame) {
      const output = dialect.parseFrame(JSON.stringify(frame));
      return output?.kind === "frame"
        ? "kind" in output.frame
          ? { activity: [output.frame] }
          : { activity: [], turnEnd: true }
        : { activity: [], unmapped: true };
    },
    ...(rpc
      ? {
          requests: {
            "approval.request": async ({ params, ask }) => {
              const call = params as { tool: string; args: JsonObject; id: string };
              const answer = await ask({ toolCallId: call.id, name: call.tool, args: call.args, effects: ["write"] });
              return { decision: "allow" in answer && answer.allow ? "allow" : "deny" };
            },
          },
        }
      : {
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
        }),
    notices: (activity) =>
      activity.kind === "notice" && activity.code === "rate_limit"
        ? { kind: "rate_limit", code: "rate_limit", retryAfterMs: 1000 }
        : undefined,
  };
}
const rpcDialect = {
  ...jsonRpcDialect,
  hook: {
    via: "client" as const,
    request: (call: import("@arnilo/prism/testing").HookCall): string =>
      JSON.stringify({ jsonrpc: "2.0", id: call.id, method: "approval.request", params: { ...call } }),
  },
};
const fixtures = { config: (cli: any) => ({ binary: cli.command[0], args: cli.command.slice(1) }) };
for (const rpc of [false, true])
  test(
    `adapter_conformance_passes_${rpc ? "json_rpc" : "jsonl"}`,
    async () => {
      const result = await adapterConformance(adapter(rpc), { dialect: rpc ? rpcDialect : "jsonl-stream", fixtures });
      expect(result.legs).toHaveLength(21);
      expect(result.legs.find((leg) => leg.name === "limit_signal")?.status).toBe("passed");
    },
    LONG,
  );
test(
  "fixture_replay_fails_on_silently_dropped_line",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "ac-fixture-"));
    try {
      const path = join(root, "recorded.json");
      writeFileSync(path, JSON.stringify({ version: 1, turns: [{ input: [], output: ['{"dropped":true}'] }] }));
      const base = adapter();
      await expect(
        adapterConformance(
          { ...base, decode: (frame) => ((frame as any)?.dropped ? { activity: [] } : base.decode(frame)) },
          {
            dialect: "jsonl-stream",
            fixtures: { ...fixtures, recorded: path },
          },
        ),
      ).rejects.toMatchObject({ leg: "fixture_replay" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  LONG,
);
test(
  "fail_closed_leg_catches_wrong_declared_response",
  async () => {
    const base = adapter();
    let revision = 0;
    // An unstable declaration makes the actual relay response differ from the later expected response.
    const hooks = {
      ...base.hooks!,
      get failClosed() {
        return { exitCode: 2, stdout: `deny-${revision++}` };
      },
    };
    await expect(adapterConformance({ ...base, hooks }, { dialect: "jsonl-stream", fixtures })).rejects.toMatchObject({
      leg: "fail_closed_response",
    });
  },
  LONG,
);
test("testing_subpath_not_imported_by_root", () => {
  expect(readFileSync(new URL("../index.ts", import.meta.url), "utf8")).not.toContain("testing");
  expect(JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")).exports["./driver-process/testing"]).toBe(
    "./driver-process/src/testing.ts",
  );
});
for (const strategy of ["store", "vendor"] as const)
  test(
    `resume_strategy_${strategy}`,
    async () => {
      const base = adapter();
      const subject: AgentAdapter = {
        ...base,
        descriptor: { ...base.descriptor, controls: { ...base.descriptor.controls, resume: strategy } },
        decode(frame) {
          const result = base.decode(frame);
          return result.turnEnd ? { ...result, sessionId: "recorded-session" } : result;
        },
        session:
          strategy === "store"
            ? {
                strategy,
                archive: async () => ["archived transcript"],
                restore: async () => ({ files: [{ path: "resume.txt", content: "restored" }] }),
              }
            : { strategy },
      };
      const result = await adapterConformance(subject, { dialect: "jsonl-stream", fixtures });
      expect(result.legs.find((leg) => leg.name === "resume_strategy")?.status).toBe("passed");
    },
    LONG,
  );
test(
  "printed_deny_and_scriptFor_pass",
  async () => {
    const base = adapter();
    const dialect = {
      ...jsonlStreamDialect,
      hook: {
        ...jsonlStreamDialect.hook,
        via: "command" as const,
        payload: (call: import("@arnilo/prism/testing").HookCall): string =>
          JSON.stringify({ kind: "pre-tool", id: call.id, name: call.tool, args: call.args }),
        allowed: (answer: { exitCode: number; stdout: string }): boolean => answer.exitCode === 0 && answer.stdout === "ALLOW",
      },
    };
    const subject: AgentAdapter = {
      ...base,
      hooks: {
        ...base.hooks!,
        codec: {
          ...base.hooks!.codec,
          encode: (answer) => ({ exitCode: 0, stdout: "allow" in answer && answer.allow ? "ALLOW" : "DENY" }),
        },
        failClosed: { exitCode: 0, stdout: "DENY" },
      },
    };
    let mapped = 0;
    const result = await adapterConformance(subject, {
      dialect,
      fixtures: {
        ...fixtures,
        scriptFor: (activity) => {
          mapped++;
          return [{ raw: JSON.stringify(activity) }];
        },
      },
    });
    expect(mapped).toBeGreaterThan(14);
    expect(result.legs.find((leg) => leg.name === "fail_closed_response")?.status).toBe("passed");
  },
  LONG,
);
test(
  "unknown_request_leg_catches_default_allow",
  async () => {
    const base = adapter(true);
    const requests = new Proxy(base.requests!, {
      getOwnPropertyDescriptor(target, key) {
        return (
          Reflect.getOwnPropertyDescriptor(target, key) ?? { configurable: true, enumerable: true, value: () => ({ decision: "allow" }) }
        );
      },
    });
    await expect(adapterConformance({ ...base, requests }, { dialect: rpcDialect, fixtures })).rejects.toMatchObject({
      leg: "unknown_request_fails",
    });
  },
  LONG,
);
test(
  "hosted_ack_leg_catches_missing_check",
  async () => {
    const base = adapter();
    const result = await adapterConformance(base, { dialect: "jsonl-stream", fixtures });
    expect(result.legs.find((leg) => leg.name === "hosted_acknowledgement")?.status).toBe("passed");
  },
  LONG,
);
test(
  "fixture_replay_observes_mapped_unmapped_and_invalid_lines",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "ac-replay-"));
    try {
      const path = join(root, "recorded.json");
      writeFileSync(
        path,
        JSON.stringify({
          version: 1,
          turns: [
            {
              input: [],
              output: ["invalid json", '{"type":"unknown"}', '{"kind":"notice","level":"info","code":"replay","message":"seen"}'],
            },
          ],
        }),
      );
      const result = await adapterConformance(adapter(), { dialect: "jsonl-stream", fixtures: { ...fixtures, recorded: path } });
      expect(result.legs.find((leg) => leg.name === "fixture_replay")?.status).toBe("passed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  LONG,
);
