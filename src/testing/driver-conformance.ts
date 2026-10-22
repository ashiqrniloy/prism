/**
 * `driverConformance` (roadmap §2.12.10): drives a driver package through the cases every driver must pass,
 * against a {@link createScriptedCli} binary of one dialect. Each leg builds its own binary, profile root, and
 * agent, so one leg cannot leave state for the next. A failing leg throws {@link DriverConformanceError}.
 *
 * The driver under test receives its binary through `fixtures.config`, which returns the driver's own config
 * keys. The binary records argv, env names, gate results, and inputs; the legs read that record and the events.
 */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { JsonValue } from "../contracts.js";
import type { AgentConfig } from "../contracts-core/agent.js";
import type { AgentEvent } from "../contracts-protocol.js";
import { type DriverDefinition, driverPackage } from "../driver-kit/define.js";
import { type AuthMode, type DriverDescriptor } from "../driver-kit/descriptor.js";
import { EXTERNAL_ACTIVITY_EVENTS } from "../driver-kit/events.js";
import { assertIsolation } from "../driver-kit/materialize.js";
import { createProfiles, resolveProtected } from "../driver-kit/profiles.js";
import { createAgent } from "../index.js";
import { definePackage } from "../packages/define.js";
import {
  createScriptedCli,
  type ScriptedCli,
  type ScriptedDialect,
  type ScriptedDialectName,
  type ScriptedRecordEntry,
  type ScriptStep,
} from "./scripted-cli.js";
import { jsonRpcDialect } from "./scripted-dialects/json-rpc.js";
import { jsonlStreamDialect } from "./scripted-dialects/jsonl-stream.js";

export class DriverConformanceError extends Error {
  readonly leg: string;
  constructor(leg: string, message: string) {
    super(`driverConformance leg "${leg}" failed: ${message}`);
    this.name = "DriverConformanceError";
    this.leg = leg;
  }
}

export interface DriverConformanceFixtures {
  /** The driver's own config keys that point at the binary. Receives the scripted CLI for each leg. */
  readonly scriptFor?: (activity: import("../loop/types.js").ExternalActivity) => readonly ScriptStep[];
  readonly config: (cli: ScriptedCli) => Readonly<Record<string, JsonValue>>;
  /** Files that locate discovers in a user home; loaded must report their relative or absolute paths.
   * Defaults: .scripted/hook.json, .scripted/skills/planted/SKILL.md, .scripted/mcp.json.
   */
  readonly home?: Readonly<Record<"hook" | "skill" | "mcp", { readonly path: string; readonly content: string }>>;
  /** The auth mode the profile is created with. Default: the descriptor's first mode. */
  readonly mode?: string;
  /** Tool names the host allows and denies at the gate. Defaults: `read_file` and `write_file`. */
  readonly tools?: { readonly allowed?: string; readonly denied?: string };
  /** The grace bound an abort must meet, in ms. Default 1000. */
  readonly graceMs?: number;
}

export interface DriverConformanceOptions {
  readonly dialect: ScriptedDialectName | ScriptedDialect;
  readonly fixtures: DriverConformanceFixtures;
}

export interface DriverConformanceLeg {
  readonly name: string;
  readonly status: "passed" | "skipped";
  readonly reason?: string;
}

export interface DriverConformanceResult {
  readonly legs: readonly DriverConformanceLeg[];
}

type Agent = Awaited<ReturnType<typeof createAgent>>;
type Session = Awaited<ReturnType<Agent["session"]>>;
type Hooks = Parameters<NonNullable<AgentConfig["hooks"]>>[0];

const PROFILE = "conformance";
const PRINCIPAL = "conformance-principal";
const DEFAULT_GRACE_MS = 1000;
const DEFAULT_ALLOWED = "read_file";
const DEFAULT_DENIED = "write_file";
/** Every activity kind, one frame each, so the observe leg sees the whole mapping. */
const OBSERVE_STEPS: readonly ScriptStep[] = [
  { out: { kind: "message.delta", content: { type: "text", text: "partial" } } },
  { out: { kind: "message", message: { role: "assistant", content: [{ type: "text", text: "full" }] } } },
  { out: { kind: "tool.started", call: { id: "o-1", name: DEFAULT_ALLOWED, args: { path: "a.txt" } } } },
  { out: { kind: "tool.progress", toolCallId: "o-1", progress: { percent: 50 } } },
  { out: { kind: "tool.completed", toolCallId: "o-1", status: "finished", result: { ok: true } } },
  { out: { kind: "skill", name: "review", source: "tool", resolved: true } },
  { out: { kind: "file", path: "a.txt", change: "modified", source: "diff" } },
  { out: { kind: "plan", entries: [{ title: "step", status: "done" }] } },
  { out: { kind: "subagent", phase: "started", id: "sub-1", name: "helper" } },
  { out: { kind: "subagent", phase: "completed", id: "sub-1", result: "done" } },
  { out: { kind: "compaction", phase: "completed", summary: "compacted" } },
  { out: { kind: "notice", level: "info", code: "seen", message: "notice" } },
  { out: { kind: "usage", usage: { inputTokens: 1, outputTokens: 1 } } },
  { out: { kind: "raw", vendor: "conformance", type: "custom", data: { ok: true } } },
];

/** The event each activity kind must produce. `usage` has no event: it only adds to the run's totals. */
const EXPECTED_EVENTS: Readonly<Record<string, string>> = {
  "message.delta": "message.delta",
  message: "message.completed",
  "tool.started": "tool.started",
  "tool.progress": "tool.progress",
  "tool.completed": "tool.completed",
  skill: EXTERNAL_ACTIVITY_EVENTS.skill,
  file: EXTERNAL_ACTIVITY_EVENTS.file,
  plan: EXTERNAL_ACTIVITY_EVENTS.plan,
  subagent: EXTERNAL_ACTIVITY_EVENTS.subagent,
  compaction: EXTERNAL_ACTIVITY_EVENTS.compaction,
  notice: EXTERNAL_ACTIVITY_EVENTS.notice,
  raw: EXTERNAL_ACTIVITY_EVENTS.raw,
};

interface Context {
  readonly driver: DriverDefinition<any>;
  readonly dialect: ScriptedDialect;
  readonly descriptor: DriverDescriptor;
  readonly mode: AuthMode;
  readonly allowed: string;
  readonly denied: string;
  readonly graceMs: number;
  readonly config: DriverConformanceFixtures["config"];
  readonly plantedHome: DriverConformanceFixtures["home"];
  readonly scriptFor: DriverConformanceFixtures["scriptFor"];
}

interface OpenOptions {
  readonly script: readonly ScriptStep[];
  readonly home?: string;
  readonly strict?: boolean;
  readonly profilePrincipal?: string;
  readonly maxConcurrentRuns?: number;
  readonly deployment?: "local" | "hosted";
  /** Replaces the default gate, which denies `ctx.denied` and allows everything else. */
  readonly hooks?: (hooks: Hooks, denied: string) => void;
}

interface Opened {
  readonly agent: Agent;
  readonly cli: ScriptedCli;
  /** The profile home, where the driver's protected credential paths resolve. */
  readonly home: string;
  /** The profile directory, which holds `profile.json`. */
  readonly profileDir: string;
  close(): void;
}

interface Leg {
  readonly name: string;
  readonly skip?: string;
  /** Resolves with a string note when the leg passed but could not check everything it names. */
  run(): Promise<unknown>;
}

/** Runs every conformance leg for `driver` against the dialect. Throws {@link DriverConformanceError} on the first failure. */
export async function driverConformance(
  driver: DriverDefinition<any>,
  options: DriverConformanceOptions,
): Promise<DriverConformanceResult> {
  const dialect = typeof options.dialect === "string" ? REFERENCE_DIALECTS[options.dialect] : options.dialect;
  const mode =
    options.fixtures.mode === undefined
      ? driver.descriptor.auth.modes[0]
      : driver.descriptor.auth.modes.find((entry) => entry.name === options.fixtures.mode);
  if (mode === undefined) throw new DriverConformanceError("setup", `no auth mode named "${options.fixtures.mode}"`);
  const ctx: Context = {
    driver,
    dialect,
    descriptor: driver.descriptor,
    mode,
    allowed: options.fixtures.tools?.allowed ?? DEFAULT_ALLOWED,
    denied: options.fixtures.tools?.denied ?? DEFAULT_DENIED,
    graceMs: options.fixtures.graceMs ?? DEFAULT_GRACE_MS,
    config: options.fixtures.config,
    plantedHome: options.fixtures.home,
    scriptFor: options.fixtures.scriptFor,
  };
  const results: DriverConformanceLeg[] = [];
  for (const leg of legs(ctx)) {
    if (leg.skip !== undefined) {
      results.push({ name: leg.name, status: "skipped", reason: leg.skip });
      continue;
    }
    let note: unknown;
    try {
      note = await leg.run();
    } catch (error) {
      if (error instanceof DriverConformanceError) throw error;
      throw new DriverConformanceError(leg.name, error instanceof Error ? error.message : String(error));
    }
    results.push(typeof note === "string" ? { name: leg.name, status: "passed", reason: note } : { name: leg.name, status: "passed" });
  }
  return { legs: results };
}

const REFERENCE_DIALECTS: Record<ScriptedDialectName, ScriptedDialect> = {
  "jsonl-stream": jsonlStreamDialect,
  "json-rpc": jsonRpcDialect,
};

function legs(ctx: Context): Leg[] {
  const commandHook = ctx.dialect.hook.via === "command";
  const protectedDeclared = ctx.mode.protected.paths.length > 0 || ctx.mode.protected.env.length > 0;
  return [
    {
      name: "materialization",
      async run() {
        const opened = await open(ctx, { script: [{ out: { kind: "message.delta", content: { type: "text", text: "ok" } } }] });
        try {
          mustComplete(await runTurn(opened.agent, "go"));
          const argv = firstArgv(opened.cli);
          if (argv === undefined) throw new Error("the binary was never spawned");
          if (commandHook && !ctx.dialect.locate && !argv.includes("--hook-command")) {
            throw new Error("a command-hook driver must pass its hook command to the binary as a flag");
          }
        } finally {
          opened.close();
        }
      },
    },
    {
      name: "observe",
      async run() {
        const opened = await open(ctx, { script: OBSERVE_STEPS });
        try {
          const { events } = mustComplete(await runTurn(opened.agent, "go"));
          const seen = new Set(events.map(eventName));
          const missing = Object.values(EXPECTED_EVENTS).filter((name) => !seen.has(name));
          if (missing.length > 0) throw new Error(`no event for: ${[...new Set(missing)].join(", ")}`);
        } finally {
          opened.close();
        }
      },
    },
    {
      name: "gating",
      async run() {
        const opened = await open(ctx, {
          script: [{ hook: { tool: ctx.allowed, id: "g-allow" } }, { hook: { tool: ctx.denied, id: "g-deny" } }],
        });
        try {
          const { events } = mustComplete(await runTurn(opened.agent, "go"));
          const allowed = hookResult(opened.cli, "g-allow");
          const denied = hookResult(opened.cli, "g-deny");
          if (allowed?.exitCode !== 0) throw new Error(`an allowed call exited ${allowed?.exitCode}, expected 0`);
          if (
            denied === undefined ||
            (ctx.dialect.hook.via === "command" && ctx.dialect.hook.allowed ? ctx.dialect.hook.allowed(denied) : denied.exitCode === 0)
          )
            throw new Error("the gate allowed a call the host denies");
          expectToolStatus(events, "g-allow", "finished");
          expectToolStatus(events, "g-deny", "blocked");
        } finally {
          opened.close();
        }
      },
    },
    {
      name: "fail_closed",
      skip: commandHook ? undefined : "a client-request dialect has no relay to break",
      async run() {
        const opened = await open(ctx, { script: [{ hook: { tool: ctx.allowed, id: "f-1", breakBroker: true } }] });
        try {
          const { events } = mustComplete(await runTurn(opened.agent, "go"));
          const result = hookResult(opened.cli, "f-1");
          if (
            result === undefined ||
            (ctx.dialect.hook.via === "command" && ctx.dialect.hook.allowed ? ctx.dialect.hook.allowed(result) : result.exitCode === 0)
          )
            throw new Error("the gate allowed a call while the broker was down");
          expectToolStatus(events, "f-1", "blocked");
        } finally {
          opened.close();
        }
      },
    },
    {
      name: "steer",
      async run() {
        const opened = await open(ctx, { script: [{ wait: 600 }] });
        try {
          await withSession(opened.agent, async (session) => {
            const running = session.run("go");
            await retryUntil(() => session.steer("change course"), 2000);
            await running;
          });
          // A `next-turn` adapter holds the steer and sends it as the next prompt, so the binary records it as a
          // user input. A `mid-turn` adapter sends it as a steer. Either way it must reach the binary.
          const steered = opened.cli
            .record()
            .some(
              (entry) =>
                entry.event === "input" &&
                (entry.input.kind === "steer" ||
                  (ctx.descriptor.controls.steer === "next-turn" && entry.input.kind === "user" && entry.input.text === "change course")),
            );
          if (!steered) throw new Error("a steer sent during a run never reached the binary");
        } finally {
          opened.close();
        }
      },
    },
    {
      name: "abort",
      async run() {
        const opened = await open(ctx, {
          script: [{ out: { kind: "message.delta", content: { type: "text", text: "start" } } }, { wait: 30_000 }],
        });
        try {
          const controller = new AbortController();
          const started = Date.now();
          await withSession(opened.agent, async (session) => {
            const running = session.run("go", { signal: controller.signal });
            // Abort only once the binary has started, so the abort tests the stop, not a spawn that never began.
            await waitUntil(() => opened.cli.record().some((entry) => entry.event === "argv"), 5000, "the binary never started");
            controller.abort();
            await running.catch(() => undefined);
          });
          const elapsed = Date.now() - started;
          if (elapsed > 2 * ctx.graceMs + 3000) throw new Error(`abort took ${elapsed}ms, over the ${ctx.graceMs}ms grace bound`);
          await waitUntil(
            () => opened.cli.record().some((entry) => entry.event === "exit" || entry.event === "signal"),
            2 * ctx.graceMs + 1000,
            "the binary did not exit within the grace bound",
          );
        } finally {
          opened.close();
        }
      },
    },
    {
      name: "resume",
      skip: ctx.descriptor.controls.resume === "none" ? "the descriptor declares no resume" : undefined,
      async run() {
        const opened = await open(ctx, {
          script: [{ hook: { tool: ctx.denied, id: "r-1" } }],
          hooks: (hooks, denied) =>
            hooks.on("tool.call", (payload) => (payload.name === denied ? { ask: "conformance approval" } : "allow")),
        });
        try {
          await withSession(opened.agent, async (session) => {
            const first = await session.run("go");
            if (first.status !== "suspended") throw new Error(`expected the run to suspend for approval, got ${String(first.status)}`);
            const pending = first.pending ?? [];
            if (pending.length === 0) throw new Error("the suspension lists no pending decision");
            const decisions = pending.map((entry) => ({ approvalId: entry.approvalId, outcome: "allow_once" as const }));
            for await (const _event of session.resume(decisions)) {
              // Drain: the resumed run's events are checked through the binary record.
            }
          });
          if (opened.cli.record().filter((entry) => entry.event === "hook").length < 2) {
            throw new Error("the resumed run never re-entered the gate");
          }
        } finally {
          opened.close();
        }
      },
    },
    {
      name: "profile_principal",
      async run() {
        const opened = await open(ctx, { script: [], profilePrincipal: "someone-else" });
        try {
          const { error } = await runTurn(opened.agent, "go");
          if (!error?.includes("profile_principal_mismatch"))
            throw new Error(`expected profile_principal_mismatch, got ${error ?? "no error"}`);
        } finally {
          opened.close();
        }
      },
    },
    {
      name: "profile_concurrency",
      async run() {
        const opened = await open(ctx, { script: [{ wait: 300 }], maxConcurrentRuns: 1 });
        try {
          const [first, second] = await Promise.all([runTurn(opened.agent, "a"), runTurn(opened.agent, "b")]);
          const errors = [first.error, second.error].filter((value): value is string => value !== undefined);
          if (!errors.some((value) => value.includes("profile_busy"))) throw new Error("two runs on a one-run profile were both admitted");
        } finally {
          opened.close();
        }
      },
    },
    {
      name: "deployment",
      skip: ctx.mode.deployments.includes("hosted") ? "the mode permits hosted use, so there is no refusal to check" : undefined,
      async run() {
        const opened = await open(ctx, { script: [], deployment: "hosted" });
        try {
          const { error } = await runTurn(opened.agent, "go");
          if (!error?.includes("plan_login_not_permitted"))
            throw new Error(`expected plan_login_not_permitted, got ${error ?? "no error"}`);
        } finally {
          opened.close();
        }
      },
    },
    {
      name: "strict_isolation",
      async run() {
        const flagged = ctx.descriptor.controls.isolation === "workspace-files";
        const failure = (fn: () => unknown): string | undefined => {
          try {
            fn();
            return undefined;
          } catch (error) {
            return error instanceof Error ? error.message : String(error);
          }
        };
        const withoutWorktree = failure(() => assertIsolation(ctx.descriptor, { isolation: "strict" }));
        if (flagged && !withoutWorktree?.includes("worktree_required")) throw new Error("strict isolation without a worktree was admitted");
        if (!flagged && withoutWorktree !== undefined) throw new Error(`strict isolation was refused: ${withoutWorktree}`);
        if (failure(() => assertIsolation(ctx.descriptor, { isolation: "strict", worktree: "/work" })) !== undefined) {
          throw new Error("strict isolation with a worktree was refused");
        }
        if (ctx.dialect.locate) {
          const home = mkdtempSync(join(tmpdir(), "dc-home-"));
          const savedHome = process.env.HOME;
          let opened: Opened | undefined;
          try {
            const files = Object.values(
              ctx.plantedHome ?? {
                hook: { path: ".scripted/hook.json", content: '{"name":"planted-hook"}' },
                skill: {
                  path: ".scripted/skills/planted/SKILL.md",
                  content: "---\nname: planted\ndescription: isolation canary\n---\nPlanted skill.",
                },
                mcp: { path: ".scripted/mcp.json", content: '{"name":"planted-mcp"}' },
              },
            );
            for (const file of files) {
              const path = resolve(home, file.path);
              const rel = relative(home, path);
              if (!rel || rel === ".." || rel.startsWith("../") || isAbsolute(rel))
                throw new Error("planted home path must stay inside fake home");
              mkdirSync(dirname(path), { recursive: true });
              writeFileSync(path, file.content);
            }
            process.env.HOME = home;
            opened = await open(ctx, { script: [], home, strict: true });
            mustComplete(await runTurn(opened.agent, "isolation"));
            const records = opened.cli.record().filter((entry) => entry.event === "loaded");
            if (records.length === 0) throw new Error("locate never recorded loaded paths");
            const planted = new Set(files.map((file) => resolve(home, file.path)));
            for (const record of records) {
              if (record.items.some((item) => planted.has(resolve(home, item))))
                throw new Error("a planted home item was loaded under strict isolation");
            }
          } finally {
            if (savedHome === undefined) delete process.env.HOME;
            else process.env.HOME = savedHome;
            opened?.close();
            rmSync(home, { recursive: true, force: true });
          }
        }
      },
    },
    {
      name: "credential_canary",
      skip: protectedDeclared ? undefined : "the mode declares no protected paths or env",
      async run() {
        const recorded = atimeIsRecorded();
        await withCanary(ctx, recorded, async (opened, canary) => {
          const outcome = await runTurn(opened.agent, "go");
          if (outcome.error?.includes("EACCES")) throw new Error("the driver tried to read a protected credential path");
          if (recorded) {
            for (const [path, atime] of canary.atimes) {
              if (statSync(path).atimeMs !== atime) throw new Error("the driver opened a protected credential path");
            }
          }
          const names = new Set(firstEnv(opened.cli) ?? []);
          for (const name of ctx.mode.protected.env) {
            if (names.has(name)) throw new Error(`the binary inherited protected variable ${name}`);
          }
        });
        return recorded
          ? undefined
          : "this filesystem records no atime; reads were caught only as access errors, so a silent read would pass";
      },
    },
    {
      name: "no_secret",
      skip: protectedDeclared ? undefined : "the mode declares no protected paths or env",
      async run() {
        await withCanary(ctx, atimeIsRecorded(), async (opened, canary) => {
          const { events } = await runTurn(opened.agent, "go");
          const surfaces = [JSON.stringify(events), JSON.stringify(opened.cli.record()), readText(join(opened.profileDir, "profile.json"))];
          if (surfaces.some((surface) => surface.includes(canary.token))) {
            throw new Error("a protected secret reached events, the binary record, or the profile record");
          }
        });
      },
    },
  ];
}

/** A leg that expects a clean run: the run's own error becomes the leg's failure. */
function mustComplete<T extends { readonly error?: string }>(outcome: T): T {
  if (outcome.error !== undefined) throw new Error(`the run failed: ${outcome.error}`);
  return outcome;
}

function eventName(event: AgentEvent): string {
  return event.type === "package.event" ? event.name : event.type;
}

function firstArgv(cli: ScriptedCli): readonly string[] | undefined {
  const entry = cli.record().find((item): item is Extract<ScriptedRecordEntry, { event: "argv" }> => item.event === "argv");
  return entry?.argv;
}

function firstEnv(cli: ScriptedCli): readonly string[] | undefined {
  const entry = cli.record().find((item): item is Extract<ScriptedRecordEntry, { event: "env" }> => item.event === "env");
  return entry?.names;
}

function hookResult(cli: ScriptedCli, id: string): { readonly exitCode: number; readonly stdout: string } | undefined {
  return cli
    .record()
    .find((entry): entry is Extract<ScriptedRecordEntry, { event: "hook-result" }> => entry.event === "hook-result" && entry.id === id);
}

function expectToolStatus(events: readonly AgentEvent[], id: string, status: string): void {
  const completed = events.find((event) => event.type === "tool.completed" && event.toolCallId === id);
  if (completed === undefined || completed.type !== "tool.completed") throw new Error(`no tool.completed event for ${id}`);
  if (completed.status !== status) throw new Error(`tool.completed for ${id} had status ${String(completed.status)}, expected ${status}`);
}

async function open(ctx: Context, options: OpenOptions): Promise<Opened> {
  // Short prefix: the run directory holds a Unix socket, and the path must fit in 103 bytes.
  const root = mkdtempSync(join(tmpdir(), "dc-"));
  const cli = createScriptedCli({
    dialect: ctx.dialect,
    script: options.script.flatMap((step) =>
      "out" in step && "kind" in step.out && ctx.scriptFor ? [...ctx.scriptFor(step.out)] : [step],
    ),
    ...(options.home ? { home: options.home } : {}),
  });
  try {
    const profiles = createProfiles({ root, driver: ctx.driver });
    await profiles.create(PROFILE, {
      mode: ctx.mode.name,
      principal: options.profilePrincipal ?? PRINCIPAL,
      maxConcurrentRuns: options.maxConcurrentRuns ?? 2,
    });
    if (ctx.descriptor.controls.isolation === "workspace-files") {
      mkdirSync(join(root, "worktree"));
      execFileSync("git", ["init", "--quiet", join(root, "worktree")]);
    }
    const agent = await createAgent({
      packages: [
        driverPackage(ctx.driver),
        ...(ctx.descriptor.controls.isolation === "workspace-files"
          ? [
              definePackage({
                name: "conformance-workspace",
                version: "1.0.0",
                requires: { api: 1 },
                setup(prism) {
                  prism.services.provide("workspace", { worktree: { bound: () => ({ path: join(root, "worktree") }) } });
                },
              }),
            ]
          : []),
      ],
      packageConfig: {
        [ctx.driver.name]: {
          ...ctx.config(cli),
          ...(options.strict ? { isolation: "strict" } : {}),
          name: "conformance",
          profile: PROFILE,
          profilesRoot: root,
          principal: PRINCIPAL,
          ...(options.deployment === undefined ? {} : { deployment: options.deployment }),
        },
      },
      hooks: (hooks) => {
        if (options.hooks) options.hooks(hooks, ctx.denied);
        else hooks.on("tool.call", (payload) => (payload.name === ctx.denied ? { deny: "conformance denies this tool" } : "allow"));
      },
    });
    const home = profiles.homeOf(PROFILE);
    return {
      agent,
      cli,
      home,
      profileDir: dirname(home),
      close() {
        cli.dispose();
        rmSync(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    cli.dispose();
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

/** One run in its own session: the events it produced and the error it ended with, if any. */
async function runTurn(agent: Agent, input: string): Promise<{ readonly events: AgentEvent[]; readonly error?: string }> {
  return withSession(agent, async (session, events) => {
    const result = await session.run(input);
    return { events, ...(result.error ? { error: result.error.message } : {}) };
  });
}

async function withSession<T>(agent: Agent, body: (session: Session, events: AgentEvent[]) => Promise<T>): Promise<T> {
  const session = await agent.session({ id: `conformance-${randomUUID()}`, create: true });
  const events: AgentEvent[] = [];
  const subscription = session.subscribe({ acrossRuns: true });
  const pump = (async () => {
    for await (const event of subscription) events.push(event);
  })();
  try {
    return await body(session, events);
  } finally {
    await session.close();
    await pump.catch(() => undefined);
  }
}

/**
 * Plants a token at each protected path and in each protected env variable, then runs `body`. When the filesystem
 * records atime, the paths are readable with atime pinned to the past, so a read moves it. Otherwise the paths are
 * mode 0000, so a read fails with `EACCES` and the run reports it. Either way the driver under test never sees the
 * token unless it reads the path.
 */
async function withCanary(
  ctx: Context,
  recorded: boolean,
  body: (opened: Opened, canary: { readonly token: string; readonly atimes: ReadonlyMap<string, number> }) => Promise<void>,
): Promise<void> {
  const token = `conformance-canary-${randomUUID()}`;
  const opened = await open(ctx, { script: [{ out: { kind: "message.delta", content: { type: "text", text: "ok" } } }] });
  const saved = new Map<string, string | undefined>();
  try {
    const past = new Date("2001-01-01T00:00:00Z");
    const atimes = new Map<string, number>();
    for (const entry of ctx.mode.protected.paths) {
      const path = resolveProtected(entry, opened.home);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, token);
      utimesSync(path, past, past);
      if (!recorded) chmodSync(path, 0o000);
      atimes.set(path, statSync(path).atimeMs);
    }
    for (const name of ctx.mode.protected.env) {
      saved.set(name, process.env[name]);
      process.env[name] = token;
    }
    await body(opened, { token, atimes });
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    opened.close();
  }
}

/** True when a read of a file moves its atime on this filesystem. Probed once per call with a scratch file. */
function atimeIsRecorded(): boolean {
  const dir = mkdtempSync(join(tmpdir(), "dc-atime-"));
  try {
    const path = join(dir, "probe");
    writeFileSync(path, "probe");
    const past = new Date("2001-01-01T00:00:00Z");
    utimesSync(path, past, past);
    const before = statSync(path).atimeMs;
    readFileSync(path);
    return statSync(path).atimeMs !== before;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retries `attempt` until it stops throwing, for a call that is only valid while a run is active. */
async function retryUntil(attempt: () => void, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      attempt();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await delay(20);
    }
  }
}

async function waitUntil(condition: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(what);
    await delay(20);
  }
}
