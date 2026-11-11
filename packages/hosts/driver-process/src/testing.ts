import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AgentEvent, createAgent, definePackage, type ExternalActivity, type JsonValue } from "@arnilo/prism";
import { createProfiles } from "@arnilo/prism/driver-kit";
import {
  createScriptedCli,
  DriverConformanceError,
  type DriverConformanceFixtures,
  type DriverConformanceLeg,
  type DriverConformanceOptions,
  type DriverConformanceResult,
  driverConformance,
  jsonlStreamDialect,
  jsonRpcDialect,
  recordFixtures,
  type ScriptedCli,
  type ScriptStep,
} from "@arnilo/prism/testing";
import { type AgentAdapter, adapterDriver, processDriver } from "./index.js";

export interface AdapterConformanceFixtures extends DriverConformanceFixtures {
  readonly recorded?: string;
  readonly scriptFor?: (activity: ExternalActivity) => readonly ScriptStep[];
}
export interface AdapterConformanceOptions extends DriverConformanceOptions {
  readonly fixtures: AdapterConformanceFixtures;
}
export class AdapterConformanceError extends Error {
  constructor(
    readonly leg: string,
    message: string,
  ) {
    super(`adapterConformance leg "${leg}" failed: ${message}`);
    this.name = "AdapterConformanceError";
  }
}

/** Runs the kernel driver suite followed by adapter wire, policy, and lifecycle checks. */
export async function adapterConformance(adapter: AgentAdapter, options: AdapterConformanceOptions): Promise<DriverConformanceResult> {
  const dialect =
    typeof options.dialect === "string" ? (options.dialect === "json-rpc" ? jsonRpcDialect : jsonlStreamDialect) : options.dialect;
  const config = (cli: ScriptedCli) => options.fixtures.config(cli);
  let kit: DriverConformanceResult;
  try {
    kit = await driverConformance(adapterDriver(adapter), { dialect, fixtures: { ...options.fixtures, config } });
  } catch (error) {
    throw new AdapterConformanceError(error instanceof DriverConformanceError ? error.leg : "setup", message(error));
  }
  const legs: DriverConformanceLeg[] = [...kit.legs];
  const steps = (activity: ExternalActivity): readonly ScriptStep[] => options.fixtures.scriptFor?.(activity) ?? [{ out: activity }];
  const check = async (name: string, run: () => Promise<void>, skip?: string) => {
    if (skip) {
      legs.push({ name, status: "skipped", reason: skip });
      return;
    }
    try {
      await run();
    } catch (error) {
      throw new AdapterConformanceError(name, message(error));
    }
    legs.push({ name, status: "passed" });
  };
  const open = async (
    script: readonly ScriptStep[],
    overrides: Record<string, JsonValue> = {},
    mode = options.fixtures.mode,
    subject = adapter,
  ) => {
    const root = mkdtempSync(join(tmpdir(), "ac-"));
    const cli = createScriptedCli({ dialect, script });
    try {
      await createProfiles({ root, driver: adapterDriver(adapter) }).create("conformance", {
        mode: mode ?? adapter.descriptor.auth.modes[0]!.name,
        principal: "conformance",
        maxConcurrentRuns: 2,
      });
      const worktree = join(root, "worktree");
      const workspace = adapter.descriptor.controls.isolation === "workspace-files";
      if (workspace) {
        mkdirSync(worktree);
        execFileSync("git", ["init", "--quiet", worktree]);
      }
      const agent = await createAgent({
        packages: [
          processDriver(subject),
          ...(workspace
            ? [
                definePackage({
                  name: "conformance-workspace",
                  version: "1.0.0",
                  requires: { api: 1 },
                  setup(prism) {
                    prism.services.provide("workspace", { worktree: { bound: () => ({ path: worktree }) } });
                  },
                }),
              ]
            : []),
        ],
        packageConfig: {
          [adapter.name]: {
            ...config(cli),
            name: "conformance",
            profile: "conformance",
            profilesRoot: root,
            principal: "conformance",
            graceMs: options.fixtures.graceMs ?? 1000,
            ...overrides,
          },
        },
        hooks: (hooks) => {
          hooks.on("tool.call", () => "allow");
        },
      });
      const session = await agent.session({ id: "adapter-conformance", create: true });
      const events: AgentEvent[] = [];
      const sub = session.subscribe({ acrossRuns: true });
      const pump = (async () => {
        for await (const event of sub) events.push(event);
      })();
      return {
        cli,
        session,
        events,
        async close() {
          try {
            await session.close();
            await pump;
          } finally {
            cli.dispose();
            rmSync(root, { recursive: true, force: true });
          }
        },
      };
    } catch (error) {
      cli.dispose();
      rmSync(root, { recursive: true, force: true });
      throw error;
    }
  };
  const withRun = async (
    script: readonly ScriptStep[],
    body: (h: Awaited<ReturnType<typeof open>>) => Promise<void>,
    overrides?: Record<string, JsonValue>,
    mode?: string,
    subject?: AgentAdapter,
  ) => {
    const h = await open(script, overrides, mode, subject);
    try {
      await body(h);
    } finally {
      await h.close();
    }
  };
  const complete = (result: { error?: { message: string } }) => {
    if (result.error) throw Error(result.error.message);
  };
  await check(
    "fixture_replay",
    async () => {
      const fixture = await recordFixtures.load(options.fixtures.recorded!);
      for (const turn of fixture.turns) {
        const decodedLines: string[] = [];
        const invalidLines: string[] = [];
        for (const line of turn.output) {
          let frame: JsonValue;
          try {
            frame = JSON.parse(line);
          } catch {
            invalidLines.push(line);
            continue;
          } // Invalid JSON is captured as agent.raw by the transport.
          decodedLines.push(JSON.stringify(frame));
          const decoded = adapter.decode(frame);
          if (
            !decoded.activity.length &&
            !decoded.unmapped &&
            !decoded.turnEnd &&
            !decoded.stop &&
            decoded.sessionId === undefined &&
            decoded.turnId === undefined
          )
            throw Error("recorded output was silently dropped");
        }
        const seen: string[] = [];
        const replayAdapter: AgentAdapter = {
          ...adapter,
          decode(frame) {
            seen.push(JSON.stringify(frame));
            return adapter.decode(frame);
          },
        };
        await withRun(
          turn.output.map((raw) => ({ raw })),
          async (h) => {
            complete(await h.session.run("replay"));
            for (const line of decodedLines) {
              const index = seen.indexOf(line);
              if (index < 0) throw Error("recorded output never reached decode");
              seen.splice(index, 1);
            }
            for (const line of invalidLines) {
              if (
                !h.events.some(
                  (event) =>
                    event.type === "package.event" &&
                    event.name === "agent.raw" &&
                    JSON.stringify(event.data).includes(JSON.stringify(line)),
                )
              )
                throw Error("invalid recorded output never reached agent.raw");
            }
          },
          { capture: "all" },
          undefined,
          replayAdapter,
        );
      }
    },
    options.fixtures.recorded ? undefined : "no recorded fixture supplied",
  );
  await check("unmapped_to_raw", async () => {
    const frame = { type: "adapter.conformance.unknown", conformance: true };
    if (!adapter.decode(frame).unmapped) throw Error("unknown frame must be marked unmapped");
    for (const capture of ["all", "mapped"] as const)
      await withRun(
        [{ raw: JSON.stringify(frame) }],
        async (h) => {
          complete(await h.session.run("go"));
          const events = JSON.stringify(h.events);
          if (!events.includes(capture === "all" ? "agent.raw" : "unmapped_frames")) throw Error(`unmapped frame missing under ${capture}`);
          if (capture === "mapped" && events.includes("agent.raw")) throw Error("mapped capture emitted raw activity");
        },
        { capture },
      );
  });
  await check(
    "fail_closed_response",
    async () => {
      await withRun([{ hook: { tool: options.fixtures.tools?.allowed ?? "read_file", id: "broken", breakBroker: true } }], async (h) => {
        complete(await h.session.run("go"));
        const answer = h.cli.record().find((item) => item.event === "hook-result" && item.id === "broken");
        if (
          answer?.event !== "hook-result" ||
          answer.exitCode !== adapter.hooks!.failClosed.exitCode ||
          answer.stdout !== adapter.hooks!.failClosed.stdout
        )
          throw Error("relay response differs from hooks.failClosed");
        if (h.events.some((event) => event.type === "tool.completed" && event.toolCallId === "broken" && event.status === "finished"))
          throw Error("tool ran with broker down");
      });
    },
    adapter.hooks ? undefined : "adapter has no relay hooks",
  );
  await check(
    "unknown_request_fails",
    async () => {
      const method = `adapter.conformance.${randomUUID()}`;
      if (Object.hasOwn(adapter.requests ?? {}, method)) throw Error("the unknown-request probe has a handler; remove catch-all handlers");
      await withRun([{ raw: JSON.stringify({ jsonrpc: "2.0", id: "unknown", method, params: {} }) }], async (h) => {
        const result = await h.session.run("go");
        if (!result.error?.message.includes("vendor_request_unhandled"))
          throw Error(`unknown server request did not fail closed (got: ${result.error?.message ?? "no error"})`);
      });
    },
    adapter.transport === "json-rpc" ? undefined : "not a JSON-RPC transport",
  );
  await check("abort_within_grace", async () => {
    await withRun([{ wait: 30_000 }], async (h) => {
      const controller = new AbortController();
      const running = h.session.run("go", { signal: controller.signal });
      const deadline = Date.now() + 5000;
      while (!h.cli.record().some((item) => item.event === "argv")) {
        if (Date.now() > deadline) throw Error("binary never started");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const started = Date.now();
      controller.abort();
      await running;
      // Plan 174 Task 11 (plan 173 Further Actions P3): the abort ladder itself is bounded by
      // `graceMs`, so this bound only has to catch a hang — the extra headroom is for loaded runs,
      // where a `release:gate` that also runs the Postgres legs starves this process.
      if (Date.now() - started > (options.fixtures.graceMs ?? 1000) + 10_000) throw Error("abort exceeded grace");
    });
  });
  await check("resume_strategy", async () => {
    const resumes: { entries: readonly JsonValue[]; sessionId?: string }[] = [];
    const configure = adapter.configure;
    const archive = adapter.session.archive;
    const restore = adapter.session.restore;
    let restored: readonly JsonValue[] = [];
    let archived: readonly JsonValue[] = [];
    let recordedId: string | undefined;
    const observed: AgentAdapter = {
      ...adapter,
      decode(frame) {
        const decoded = adapter.decode(frame);
        if (decoded.sessionId !== undefined) recordedId = decoded.sessionId;
        return decoded;
      },
      configure(spec, ctx) {
        resumes.push(ctx.resume);
        return configure(spec, ctx);
      },
      session: {
        ...adapter.session,
        ...(restore
          ? {
              async restore(entries, ctx) {
                restored = entries;
                return restore(entries, ctx);
              },
            }
          : {}),
        ...(archive
          ? {
              async archive(ctx) {
                const entries = await archive(ctx);
                archived = entries;
                return entries;
              },
            }
          : {}),
      },
    };
    await withRun(
      steps({ kind: "message.delta", content: { type: "text", text: "resume" } }),
      async (h) => {
        complete(await h.session.run("first"));
        const firstArchive = archived;
        const firstId = recordedId;
        complete(await h.session.run("second"));
        if (h.cli.record().filter((item) => item.event === "argv").length !== 2) throw Error("resume did not start a new process");
        if (resumes.length !== 2) throw Error("configure did not run twice");
        const resumed = resumes[1]!;
        if (
          adapter.session.strategy === "store" &&
          (!firstArchive.length ||
            JSON.stringify(firstArchive) !== JSON.stringify(resumed.entries) ||
            JSON.stringify(restored) !== JSON.stringify(resumed.entries))
        )
          throw Error("store resume lost archived state");
        if (adapter.session.strategy === "vendor" && (!firstId || resumed.sessionId !== firstId))
          throw Error("vendor resume lost session id");
        if (adapter.session.strategy === "none" && (resumed.entries.length || resumed.sessionId)) throw Error("none resumed prior state");
      },
      undefined,
      undefined,
      observed,
    );
  });
  await check(
    "hosted_acknowledgement",
    async () => {
      for (const mode of adapter.descriptor.auth.modes.filter((mode) => mode.deployments.includes("hosted"))) {
        const terms = mode.hostedAcknowledgements ?? [];
        if (terms.length)
          await withRun(
            [],
            async (h) => {
              const result = await h.session.run("go");
              if (!result.error?.message.includes("plan_login_not_permitted")) throw Error("hosted run admitted without acknowledgements");
              if (h.cli.record().some((item) => item.event === "argv")) throw Error("refused hosted run spawned binary");
            },
            { deployment: "hosted", acknowledgements: [] },
            mode.name,
          );
        await withRun(
          [],
          async (h) => {
            complete(await h.session.run("go"));
            if (!h.cli.record().some((item) => item.event === "argv")) throw Error("acknowledged hosted run did not start");
          },
          { deployment: "hosted", acknowledgements: [...terms] },
          mode.name,
        );
      }
    },
    adapter.descriptor.auth.modes.some((mode) => mode.deployments.includes("hosted")) ? undefined : "no hosted auth mode",
  );
  await check("limit_signal", async () => {
    await withRun(steps({ kind: "notice", level: "warn", code: "rate_limit", message: "rate limit" }), async (h) => {
      const result = await h.session.run("go");
      if (!result.error?.message.includes("vendor_limit")) throw Error("rate limit did not stop the run");
      if (h.cli.record().filter((item) => item.event === "argv").length !== 1) throw Error("rate limit retried the binary");
    });
  });
  return { legs };
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
