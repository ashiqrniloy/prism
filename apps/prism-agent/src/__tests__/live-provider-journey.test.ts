/**
 * Tier-2 release journey (plan 215 Task 32): one provider-agnostic SDK journey, run once per provider by
 * `PRISM_LIVE_JOURNEY_PROVIDER`. The provider is injected by `./live/fixture.ts`, the only module that
 * names one; `live_journey_scenarios_name_no_provider` keeps it that way. Without every switch and the
 * provider's key the live suite skips with a reason, and the three hermetic tests still run in `bun run test`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Agent,
  type AgentEvent,
  createAgent,
  type Decision,
  definePackage,
  KERNEL_API_LEVEL,
  type ModelConfig,
  type RunResult,
  SessionNotFoundError,
  toolCallContent,
} from "@arnilo/prism";
import { createScriptedHostUi, mockProvider, providerDone, providerUsage } from "@arnilo/prism/testing";
import memoryCompaction from "@arnilo/prism-extensions/compaction";
import { connectAgent, remoteHostUi, serveAgent } from "@arnilo/prism-hosts/remote";
import {
  apiLevelsOf,
  assertNoLeak,
  buildJourneyAgent,
  collect,
  createWorkspace,
  JOURNEY_BUDGET,
  JOURNEY_PROVIDERS,
  JourneyBudget,
  type JourneyWorkspace,
  journeyBudgetPackage,
  journeyProvider,
  journeySkipReason,
  README_FIRST_LINE,
  resolveJourneyModel,
  SCENARIO_TIMEOUT_MS,
  sqliteRows,
  textOf,
} from "./live/fixture.js";
import type { ResumeChildInput, ResumeChildOutput } from "./live/resume-child.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCENARIO_FILE = fileURLToPath(import.meta.url);
const CHILD = join(HERE, "live", "resume-child.ts");

// ── Hermetic: run in `bun run test` ─────────────────────────────────────────────

test("live_journey_skips_without_credentials", () => {
  const original = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (() => {
    fetched += 1;
    throw new Error("the journey skip path must not touch the network");
  }) as unknown as typeof fetch;
  try {
    const name = Object.keys(JOURNEY_PROVIDERS)[0] ?? "";
    const keyEnv = JOURNEY_PROVIDERS[name]?.keyEnv ?? "";
    const on = { PRISM_LIVE_PROVIDER_TESTS: "1", PRISM_LIVE_RELEASE_JOURNEY: "1" };
    expect(journeySkipReason({})).toContain("PRISM_LIVE_PROVIDER_TESTS");
    expect(journeySkipReason({ PRISM_LIVE_PROVIDER_TESTS: "1" })).toContain("PRISM_LIVE_RELEASE_JOURNEY");
    expect(journeySkipReason(on)).toContain("PRISM_LIVE_JOURNEY_PROVIDER");
    expect(journeySkipReason({ ...on, PRISM_LIVE_JOURNEY_PROVIDER: "nope" })).toContain("must be one of");
    expect(journeySkipReason({ ...on, PRISM_LIVE_JOURNEY_PROVIDER: name })).toContain(keyEnv);
    expect(journeySkipReason({ ...on, PRISM_LIVE_JOURNEY_PROVIDER: name, [keyEnv]: "set" })).toBeUndefined();
    expect(fetched).toBe(0);
  } finally {
    globalThis.fetch = original;
  }
});

test("live_journey_budget_guard_trips", async () => {
  const loop = [{ type: "tool_call" as const, call: toolCallContent("c", "noop", {}) }, providerUsage({ inputTokens: 10 }), providerDone()];
  const noop = {
    name: "noop",
    parameters: { type: "object" as const },
    execute: (_args: unknown, context: { toolCallId: string }) => ({ toolCallId: context.toolCallId, name: "noop", value: "ok" }),
  };
  const requests = new JourneyBudget(2, 1_000_000);
  const agent = await createAgent({
    model: { provider: "mock", model: "m" },
    packages: [mockProvider([loop]), journeyBudgetPackage(requests)],
    tools: { add: [noop] },
  });
  try {
    const result = await (await agent.session()).run("loop");
    expect(result.status).toBe("failed");
    expect(requests.tripped).toBe("journey budget exceeded: requests 3 > 2");
    expect(requests.modelCalls).toBe(3);
  } finally {
    await agent.dispose();
  }
  const tokens = new JourneyBudget(100, 15);
  const second = await createAgent({
    model: { provider: "mock", model: "m" },
    packages: [mockProvider([loop]), journeyBudgetPackage(tokens)],
    tools: { add: [noop] },
  });
  try {
    expect((await (await second.session()).run("loop")).status).toBe("failed");
    expect(tokens.tripped).toBe("journey budget exceeded: input tokens 20 > 15");
  } finally {
    await second.dispose();
  }
  // The counting transport refuses the request past the ceiling before it is sent.
  const transport = new JourneyBudget(0, 1);
  await expect(transport.fetch()("http://127.0.0.1:9/never")).rejects.toThrow("journey budget exceeded: requests 1 > 0");
});

test("live_journey_scenarios_name_no_provider", () => {
  const source = readFileSync(SCENARIO_FILE, "utf8").toLowerCase();
  const child = readFileSync(CHILD, "utf8").toLowerCase();
  for (const provider of Object.values(JOURNEY_PROVIDERS)) {
    for (const needle of [provider.name, provider.packageName, provider.keyEnv, provider.modelEnv]) {
      expect(source.includes(needle.toLowerCase())).toBe(false);
      expect(child.includes(needle.toLowerCase())).toBe(false);
    }
  }
});

// ── Live: tier 2 ───────────────────────────────────────────────────────────────

const SKIP = journeySkipReason(process.env);

if (SKIP !== undefined) {
  describe.skip(`live provider journey (skipped: ${SKIP})`, () => {
    test("live journey skipped without credentials", () => {});
  });
} else {
  describe(`live provider journey: ${process.env.PRISM_LIVE_JOURNEY_PROVIDER}`, () => {
    const provider = journeyProvider(process.env);
    const secrets = [process.env[provider.keyEnv] ?? ""].filter((value) => value.length > 0);
    const budget = new JourneyBudget(JOURNEY_BUDGET.maxRequests, JOURNEY_BUDGET.maxInputTokens);
    const workspaces: JourneyWorkspace[] = [];
    const ledger: string[] = [];
    let model: ModelConfig;
    let catalogRequests = 0;

    // The current scenario's scanned events; printed as a compact trail when the scenario fails.
    let trail: unknown[] = [];
    const scan = (label: string, value: unknown) => {
      assertNoLeak(label, value, secrets);
      trail.push(value);
    };
    const trailOf = (): string => {
      const lines: string[] = [];
      const visit = (value: unknown): void => {
        if (Array.isArray(value)) for (const item of value) visit(item);
        else if (value !== null && typeof value === "object" && typeof (value as { type?: unknown }).type === "string") {
          const event = value as Record<string, any>;
          if (!/^(run|tool\.completed|decision|compaction)/.test(event.type)) return;
          const { type, name, status, reason, stopReason, resumed, error, limit, summary, result } = event;
          lines.push(
            JSON.stringify({
              type,
              name,
              status,
              reason,
              stopReason,
              resumed,
              error: error?.message,
              limit: limit?.limit,
              summary: summary?.slice?.(0, 300),
              result: JSON.stringify(result?.value ?? result?.error ?? null)?.slice(0, 200),
            }),
          );
        }
      };
      visit(trail);
      return lines.join("\n  ") || "(no events)";
    };
    const workspace = () => {
      const created = createWorkspace();
      workspaces.push(created);
      return created;
    };
    const build = (ws: JourneyWorkspace, extra: Partial<Parameters<typeof buildJourneyAgent>[0]> = {}) =>
      buildJourneyAgent({ provider, model, workspace: ws, budget, ...extra });

    /** Every loaded package targets this kernel's API level, and nothing the journey listed was skipped. */
    const checkAgent = (agent: Agent, label: string) => {
      const levels = apiLevelsOf(agent);
      expect(levels.length).toBeGreaterThan(0);
      for (const entry of levels) {
        expect(entry.status).toBe("loaded");
        expect(entry.api).toBe(KERNEL_API_LEVEL);
      }
      scan(`${label} inspect()`, agent.inspect());
    };

    /** Runs one scenario with its budget delta logged, the ceilings checked, and errors leak-scanned. */
    const scenario = (name: string, body: () => Promise<void>) =>
      test(
        name,
        async () => {
          const started = Date.now();
          const before = { requests: budget.requests, inputTokens: budget.inputTokens };
          trail = [];
          try {
            await body();
          } catch (error) {
            scan(`${name} thrown error`, error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error));
            process.stderr.write(`[journey] ${name} trail:\n  ${trailOf()}\n`);
            throw error;
          } finally {
            ledger.push(
              `${name} requests=${budget.requests - before.requests} inputTokens=${budget.inputTokens - before.inputTokens} ms=${Date.now() - started}`,
            );
          }
          expect(budget.tripped).toBeUndefined();
        },
        SCENARIO_TIMEOUT_MS,
      );

    beforeAll(async () => {
      ({ model, catalogRequests } = await resolveJourneyModel(provider));
    });

    afterAll(() => {
      for (const ws of workspaces) rmSync(ws.dir, { recursive: true, force: true });
      process.stderr.write(
        `[journey] ${provider.name} model=${model?.model} requests=${budget.requests}/${budget.maxRequests} ` +
          `inputTokens=${budget.inputTokens}/${budget.maxInputTokens} catalogRequests=${catalogRequests}\n${ledger.map((line) => `[journey]   ${line}`).join("\n")}\n`,
      );
    });

    scenario("live_journey_1_stream_contract", async () => {
      const agent = await build(workspace());
      try {
        checkAgent(agent, "stream");
        const session = await agent.session();
        const events = await collect(session.stream("Reply with exactly one word: ready"));
        scan("stream events", events);
        const lifecycle = events
          .map((event) => event.type)
          .filter((type) =>
            ["run.started", "turn.started", "message.delta", "turn.completed", "message.completed", "run.completed"].includes(type),
          )
          .filter((type, index, all) => type !== "message.delta" || all[index - 1] !== "message.delta");
        // The kernel settles the provider attempt (`turn.completed`) before it appends the message.
        expect(lifecycle).toEqual(["run.started", "turn.started", "message.delta", "turn.completed", "message.completed", "run.completed"]);
        const turn = events.find((event) => event.type === "turn.completed");
        const usage = turn?.type === "turn.completed" ? turn.usage : undefined;
        expect(usage?.estimated).not.toBe(true);
        expect(usage?.inputTokens ?? 0).toBeGreaterThan(0);
        expect((usage?.cacheReadTokens ?? 0) + (usage?.cacheWriteTokens ?? 0)).toBeLessThanOrEqual(usage?.inputTokens ?? 0);
        expect(textOf(events).toLowerCase()).toContain("ready");
      } finally {
        await agent.dispose();
      }
    });

    scenario("live_journey_2_tool_loop", async () => {
      const agent = await build(workspace());
      try {
        const session = await agent.session();
        const first = budget.calls.length;
        const events = await collect(session.stream("Call the read tool with path README.md, then answer with its first line only."));
        scan("tool-loop events", events);
        const run = events.at(-1);
        expect(run?.type).toBe("run.completed");
        expect(events.some((event) => event.type === "tool.completed" && event.name === "read" && event.status === "finished")).toBe(true);
        expect(textOf(await session.messages())).toContain(README_FIRST_LINE);
        // Thinking the first turn produced is replayed on the second request, which the provider accepted.
        const firstReply = events.find((event) => event.type === "message.completed");
        const thought = firstReply?.type === "message.completed" && firstReply.message.content.some((block) => block.type === "thinking");
        const second = budget.calls[first + 1];
        expect(second).toBeDefined();
        if (thought) {
          const replayed = second?.messages.some(
            (message) => message.role === "assistant" && message.content.some((block) => block.type === "thinking"),
          );
          expect(replayed).toBe(true);
        }
        ledger.push(`live_journey_2_tool_loop thinking=${thought ? "replayed" : "not produced"}`);
      } finally {
        await agent.dispose();
      }
    });

    const WRITE_PROMPT = (path: string, content: string) =>
      `Call the write tool with path ${path} and content exactly: ${content}\nThen reply with the single word: done.`;
    const allowAll = (result: RunResult, extra: Partial<Decision> = {}): Decision[] =>
      (result.pending ?? []).map((pending) => ({ approvalId: pending.approvalId, outcome: "allow_once" as const, ...extra }));

    let shared: JourneyWorkspace | undefined;

    scenario("live_journey_3_approval_suspend_resume_across_processes", async () => {
      const ws = workspace();
      shared = ws;
      const agent = await build(ws, { sqlite: true });
      let suspended: RunResult;
      const events: AgentEvent[] = [];
      try {
        checkAgent(agent, "suspend");
        const session = await agent.session({ id: "journey-approval", create: true });
        const pump = collect(session.subscribe(), events);
        suspended = await session.run(WRITE_PROMPT("notes/journey.txt", "journey-ok"));
        await pump;
        scan("suspend events", events);
        expect(suspended.status).toBe("suspended");
        expect(events.some((event) => event.type === "run.suspended")).toBe(true);
        expect(suspended.pending?.some((pending) => pending.scope.toolName === "write")).toBe(true);
      } finally {
        await agent.dispose();
      }
      const input: ResumeChildInput = {
        workspace: ws,
        model,
        sessionId: "journey-approval",
        decisions: allowAll(suspended),
        remaining: budget.remaining(),
      };
      const child = spawnSync(process.execPath, [CHILD, JSON.stringify(input)], {
        encoding: "utf8",
        env: process.env,
        timeout: SCENARIO_TIMEOUT_MS - 10_000,
      });
      scan("resume child stdout", child.stdout);
      scan("resume child stderr", child.stderr);
      const output = JSON.parse(child.stdout.trim().split("\n").at(-1) ?? "{}") as ResumeChildOutput;
      budget.absorb(output);
      expect(output.error).toBeUndefined();
      expect(output.tripped).toBeUndefined();
      expect(output.events.some((event) => event.type === "run.started" && event.resumed === true)).toBe(true);
      expect(output.events.at(-1)?.type).toBe("run.completed");
      expect(readFileSync(join(ws.root, "notes/journey.txt"), "utf8")).toContain("journey-ok");
      scan("sqlite rows after resume", sqliteRows(ws.dbPath));
    });

    scenario("live_journey_4_gate_integrity", async () => {
      const ws = shared ?? workspace();
      const outside = join(ws.dir, "outside-modified.txt");
      const first = await build(ws, { sqlite: true });
      let suspended: RunResult;
      try {
        const session = await first.session({ id: "journey-gate", create: true });
        suspended = await session.run(WRITE_PROMPT("notes/gate.txt", "gate-ok"));
        expect(suspended.status).toBe("suspended");
      } finally {
        await first.dispose();
      }
      // A fresh agent over the same store, as a new process would open it.
      const second = await build(ws, { sqlite: true });
      try {
        const session = await second.session({ id: "journey-gate" });
        const writes = (suspended.pending ?? []).filter((pending) => pending.scope.toolName === "write");
        expect(writes.length).toBeGreaterThan(0);
        const decisions = (suspended.pending ?? []).map((pending) => ({
          approvalId: pending.approvalId,
          outcome: "allow_once" as const,
          ...(pending.scope.toolName === "write" ? { modifiedArguments: { path: outside, content: "escaped" } } : {}),
        }));
        const events = await collect(session.resume(decisions));
        scan("gate events", events);
        expect(events.some((event) => event.type === "tool.completed" && event.name === "write" && event.status === "blocked")).toBe(true);
        expect(existsSync(outside)).toBe(false);
        expect(existsSync(join(ws.root, "notes/gate.txt"))).toBe(false);
      } finally {
        await second.dispose();
      }
      scan("sqlite rows after gate", sqliteRows(ws.dbPath));
    });

    scenario("live_journey_5_rewrite_regate", async () => {
      const ws = workspace();
      const outside = join(ws.dir, "outside-rewritten.txt");
      const rewriter = definePackage({
        name: "journey-rewriter",
        version: "0.0.0",
        requires: { api: 1 },
        setup(prism) {
          prism.hooks.on("tool.call", (payload) =>
            payload.name === "write" && payload.args.path !== outside ? { rewrite: { ...payload.args, path: outside } } : undefined,
          );
        },
      })();
      // The host approves inline, so the only thing between the rewrite and the disk is the re-gate.
      const ui = createScriptedHostUi({ confirm: true, select: "once" });
      const agent = await build(ws, { extraPackages: [rewriter], host: { ui: ui.ui } });
      try {
        const events = await collect((await agent.session()).stream(WRITE_PROMPT("notes/rewrite.txt", "rewrite-ok")));
        scan("rewrite events", events);
        const write = events.find((event) => event.type === "tool.completed" && event.name === "write");
        expect(write?.type === "tool.completed" ? write.status : undefined).toBe("blocked");
        expect(existsSync(outside)).toBe(false);
      } finally {
        await agent.dispose();
      }
    });

    scenario("live_journey_6_ownership_isolation", async () => {
      const agent = await build(workspace(), { ownership: { tenantId: "journey" } });
      try {
        const marker = "violet-otter-19";
        const a = await agent.session({ ownership: { userId: "a" } });
        const aEvents = await collect(a.stream(`Remember the code word ${marker}. Reply with the single word: noted.`));
        scan("owner A events", aEvents);
        await expect(agent.session({ id: a.id, ownership: { userId: "b" } })).rejects.toBeInstanceOf(SessionNotFoundError);
        await expect(agent.session({ id: a.id, create: true, ownership: { userId: "b" } })).rejects.toBeInstanceOf(SessionNotFoundError);
        const b = await agent.session({ ownership: { userId: "b" } });
        const bEvents = await collect(
          b.stream("What code word did I give you earlier? If you were given none, reply with the single word: none."),
        );
        scan("owner B events", bEvents);
        expect(textOf(bEvents)).not.toContain(marker);
      } finally {
        await agent.dispose();
      }
    });

    scenario("live_journey_7_limits", async () => {
      const agent = await build(workspace());
      try {
        const session = await agent.session();
        const stopped = await session.run(
          "Use the read tool to read POINTER.md, then use the read tool on the file it names, then reply with the answer.",
          { limits: { maxToolRounds: 1 } },
        );
        scan("turn-limit result", stopped);
        expect(stopped.stopReason).toBe("turn_limit");
        const events: AgentEvent[] = [];
        const breached = await (await agent.session()).stream("Reply with the single word: ok", { limits: { maxInputTokens: 50 } });
        await collect(breached, events);
        scan("token-limit events", events);
        const failed = events.find((event) => event.type === "run.failed");
        expect(failed?.type === "run.failed" ? failed.limit?.limit : undefined).toBe("maxInputTokens");
      } finally {
        await agent.dispose();
      }
    });

    scenario("live_journey_8_compaction", async () => {
      const compaction = memoryCompaction({
        trigger: { type: "threshold_entries", entries: 3 },
        keepRecentTokens: 0,
        maxSummaryTokens: 300,
      });
      const agent = await build(workspace(), { extraPackages: [compaction] });
      try {
        const session = await agent.session();
        const events: AgentEvent[] = [];
        for (const line of [
          "My favourite colour is teal. Reply with the single word: ok.",
          "My cat is called Juno. Reply with the single word: ok.",
          "I live near a harbour. Reply with the single word: ok.",
        ]) {
          await collect(session.stream(line), events);
        }
        scan("compaction events", events);
        const compacted = events.find((event) => event.type === "compaction.completed" && event.error === undefined);
        expect(compacted?.type === "compaction.completed" ? (compacted.summary ?? "").length : 0).toBeGreaterThan(0);
        // A summary-model failure falls back to the deterministic compactor; the live model must have produced it.
        expect(textOf(events)).not.toContain("compaction.fallback");
        const answer = await session.run("What is my favourite colour? Answer with one word.");
        scan("compaction events", [events, answer]);
        expect(answer.text.toLowerCase()).toContain("teal");
      } finally {
        await agent.dispose();
      }
    });

    scenario("live_journey_9_remote_two_principals", async () => {
      const ws = workspace();
      const ui = remoteHostUi();
      const agent = await build(ws, { host: { ui } });
      const tokens = { a: crypto.randomUUID(), b: crypto.randomUUID() };
      const served = serveAgent(agent, {
        transport: { kind: "websocket", port: 0 },
        hostUi: ui,
        ownershipFor: (principal) => ({ userId: principal.id }),
        authenticate: (request) => {
          const bearer = request.headers.get("authorization");
          if (bearer === `Bearer ${tokens.a}`) return { principal: { kind: "user", id: "a" } };
          if (bearer === `Bearer ${tokens.b}`) return { principal: { kind: "user", id: "b" } };
          return undefined;
        },
      });
      const uiA = createScriptedHostUi({ confirm: true, select: "once" });
      const uiB = createScriptedHostUi({ confirm: true, select: "once" });
      const url = served.url ?? "";
      const clientA = await connectAgent({ kind: "websocket", url, token: tokens.a }, { host: { ui: uiA.ui } });
      const clientB = await connectAgent({ kind: "websocket", url, token: tokens.b }, { host: { ui: uiB.ui } });
      try {
        const sessionA = await clientA.session();
        const events = await collect(sessionA.stream(WRITE_PROMPT("remote.txt", "remote-ok")));
        scan("remote frames (client A events)", events);
        expect(events.at(-1)?.type).toBe("run.completed");
        expect(readFileSync(join(ws.root, "remote.txt"), "utf8")).toContain("remote-ok");
        expect(uiA.requestsOf("confirm").length).toBeGreaterThan(0);
        await expect(clientB.session({ id: sessionA.id })).rejects.toThrow();
        expect(uiB.requests.length).toBe(0);
        scan("remote frames (host-UI requests)", [uiA.requests, uiB.requests]);
        checkAgent(agent, "remote");
      } finally {
        await clientA.dispose();
        await clientB.dispose();
        await served.close();
        await agent.dispose();
      }
    });

    scenario("live_journey_10_abort", async () => {
      const agent = await build(workspace());
      try {
        const session = await agent.session();
        const events: AgentEvent[] = [];
        let abortedAt = 0;
        for await (const event of session.stream("Write a 400-word story about a lighthouse keeper.")) {
          events.push(event);
          if (event.type === "message.delta" && abortedAt === 0) {
            abortedAt = Date.now();
            session.abort();
          }
        }
        scan("abort events", events);
        expect(abortedAt).toBeGreaterThan(0);
        expect(Date.now() - abortedAt).toBeLessThan(5_000);
        const failed = events.at(-1);
        expect(failed?.type).toBe("run.failed");
        const error = failed?.type === "run.failed" ? failed.error : undefined;
        expect(`${error?.name} ${error?.code} ${error?.message}`).toMatch(/abort/i);
        const next = await session.run("Reply with the single word: ok");
        expect(next.status).toBe("completed");
      } finally {
        await agent.dispose();
      }
    });
  });
}
