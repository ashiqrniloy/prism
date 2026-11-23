/**
 * Plan 218.3 Task 7: WM runs only under a host scope, parses the scope into steps, advances remaining/finished
 * steps through cited passed outcomes or `memory:scope { finished }`, releases `neededLater` items once all their
 * steps finish, resets only changed steps on a scope change, and persists step state across resume and forks.
 */
import { describe, expect, it } from "bun:test";
import {
  createAgent,
  createMemorySessionStore,
  type JsonValue,
  type ModelClient,
  type ModelProvider,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import memorySystem, {
  activeWmItems,
  foldObservationalMemoryLedger,
  OBSERVATIONS_RECORDED,
  resolveMemorySystemConfig,
  SCOPE_STEP,
} from "../../index.js";
import { createObservationalFlush } from "../flush.js";
import { parseScopeSteps, prepareScope, renderScopeBlock, resolveScopeProgress } from "../scope.js";
import type { MemoryObservation } from "../types.js";
import { runWm } from "../workers/wm.js";

const MODEL = { provider: "main", model: "main-model", limits: { contextWindow: 64_000, maxOutputTokens: 0 } };

type ClientRequest = Parameters<ModelClient["generate"]>[0];

const userText = (request: ProviderRequest | ClientRequest): string =>
  request.messages
    .filter((message) => message.role === "user")
    .flatMap((message) => message.content)
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");

const toolResultOf = (request: ProviderRequest | ClientRequest): Record<string, unknown> | undefined => {
  const tool = [...request.messages].reverse().find((message) => message.role === "tool");
  const part = tool?.content.find((block: { type: string }) => block.type === "tool_result") as
    | { result?: Record<string, unknown> }
    | undefined;
  return part?.result;
};

const obs = (id: string, description: string, extra: Partial<MemoryObservation> = {}): MemoryObservation => ({
  id,
  kind: "result",
  description,
  timestamp: "2026-11-18T10:00:00.000Z",
  relevance: "medium",
  sourceEntryIds: [`e-${id.slice(0, 2)}`],
  tokenCount: 10,
  ...extra,
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

describe("WM host scope and step progress (plan 218.3 Task 7)", () => {
  it("wm_runs_only_under_a_host_scope", async () => {
    const store = createMemorySessionStore();
    const wmRequests: ProviderRequest[] = [];
    let stmCounter = 0;

    const main: ModelProvider = {
      id: "main",
      async *generate() {
        yield providerTextDelta("ok");
        yield providerDone();
      },
    };
    const worker: ModelProvider = {
      id: "worker",
      async *generate(request) {
        if (request.messages.some((message) => message.role === "tool")) {
          yield providerDone();
          return;
        }
        const tools = (request.tools ?? []).map((tool) => tool.name);
        if (tools.includes("record_event")) {
          stmCounter += 1;
          const prompt = userText(request);
          const id = /\[[^\]]+\] \[([^\]]+)\] user:/.exec(prompt)?.[1] ?? `e${stmCounter}`;
          yield providerToolCall(
            toolCallContent(`s${stmCounter}`, "record_event", {
              // A result: working memory judges it. A user statement would stay on the STM surface (plan 218.5 Task 3).
              kind: "result",
              description: `Observed ${stmCounter}`,
              sourceEntryIds: [id],
            }),
          );
        } else if (tools.includes("judge")) {
          wmRequests.push({ ...request, messages: [...request.messages] });
          const prompt = userText(request);
          const keep = [...prompt.matchAll(/^- \[(r[0-9]+)\]/gm)].map((match) => ({
            r: Number(match[1].slice(1)),
            reason: "needed for step 1",
            neededLater: "step 1",
          }));
          if (keep.length) yield providerToolCall(toolCallContent(`w${wmRequests.length}`, "judge", { keep }));
        }
        yield providerDone();
      },
    };

    const agent = await createAgent({
      model: MODEL,
      packages: [
        providerPackage("main-provider", [main]),
        providerPackage("worker-provider", [worker]),
        memorySystem({
          enabled: true,
          stm: { model: "worker/w", triggerTokens: 1 },
          wm: { model: "worker/w", policy: "model", triggerTokens: 1 },
        }),
      ],
      slots: { store },
    });
    try {
      const session = await agent.session({ id: "s1", create: true });

      // Without a scope: status says scope none and WM inactive; turns run STM-only with 0 WM calls.
      const beforeStatus = (await agent.commands.run("memory:session:status", {}, { session })) as {
        scope: { set: boolean };
        wmActive: boolean;
        text: string;
      };
      expect(beforeStatus.scope).toEqual({ set: false });
      expect(beforeStatus.wmActive).toBe(false);
      expect(beforeStatus.text).toMatch(/scope:\s*none/i);
      expect(beforeStatus.text).toMatch(/wm:\s*inactive/i);

      await session.run("first message without scope");
      await settle();
      expect(wmRequests).toHaveLength(0);
      expect(foldObservationalMemoryLedger(await session.entries()).observations.length).toBeGreaterThan(0);
      expect(foldObservationalMemoryLedger(await session.entries()).wmItems).toHaveLength(0);

      // Set a scope mid-session: status turns active and the next pass runs WM.
      await agent.commands.run("memory:scope", { text: "1. Migrate config\n2. Update CLI" }, { session });
      const activeStatus = (await agent.commands.run("memory:session:status", {}, { session })) as {
        scope: { set: boolean; steps: { total: number; remaining: number[]; finished: number[] } };
        wmActive: boolean;
        text: string;
      };
      expect(activeStatus.wmActive).toBe(true);
      expect(activeStatus.scope.set).toBe(true);
      expect(activeStatus.scope.steps).toEqual({ total: 2, remaining: [1, 2], finished: [] });
      expect(activeStatus.text).toMatch(/wm:\s*active/i);

      await session.run("second message with scope");
      await settle();
      expect(wmRequests.length).toBeGreaterThan(0);
      expect(foldObservationalMemoryLedger(await session.entries()).wmItems.length).toBeGreaterThan(0);

      // Clear the scope: WM stops on subsequent passes.
      const countBeforeClear = wmRequests.length;
      await agent.commands.run("memory:scope", { clear: true }, { session });
      const clearedStatus = (await agent.commands.run("memory:session:status", {}, { session })) as {
        scope: { set: boolean };
        wmActive: boolean;
      };
      expect(clearedStatus.scope).toEqual({ set: false });
      expect(clearedStatus.wmActive).toBe(false);

      await session.run("third message after clear");
      await settle();
      expect(wmRequests.length).toBe(countBeforeClear);
    } finally {
      await agent.dispose();
    }
  });

  it("scope_steps_parse_from_numbered_and_checkbox_lines", () => {
    const numbered = parseScopeSteps("# Plan\n1. Migrate the config\n2. Update the CLI\n3. Release notes");
    expect(numbered).toEqual([
      { step: 1, text: "Migrate the config" },
      { step: 2, text: "Update the CLI" },
      { step: 3, text: "Release notes" },
    ]);
    // Deterministic on repeated calls.
    expect(parseScopeSteps("1. Migrate the config\n2. Update the CLI\n3. Release notes")).toEqual(numbered);

    const checkboxes = parseScopeSteps("- [x] Prepare branch\n- [ ] Run conformance\n- [X] Update changelog");
    expect(checkboxes).toEqual([
      { step: 1, text: "Prepare branch", checked: true },
      { step: 2, text: "Run conformance" },
      { step: 3, text: "Update changelog", checked: true },
    ]);

    const unstructured = parseScopeSteps("Ship the 3 campaign suites and verify the retry fix.");
    expect(unstructured).toEqual([{ step: 1, text: "Ship the 3 campaign suites and verify the retry fix." }]);

    // Checked checkboxes start finished in progress; unchecked and numbered start remaining.
    const prepared = prepareScope("- [x] Done step\n- [ ] Open step", { maxBytes: 4_096 });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error("unreachable");
    const progress = resolveScopeProgress(prepared.scope);
    expect(progress.finished.map((s) => s.step)).toEqual([1]);
    expect(progress.remaining.map((s) => s.step)).toEqual([2]);

    const block = renderScopeBlock(prepared.scope, progress);
    expect(block).toContain("## Remaining steps\n- [2] Open step");
    expect(block).toContain("## Finished steps\n- [1] Done step");
  });

  it("step_finish_needs_a_cited_passed_outcome", async () => {
    const prepared = prepareScope("1. Migrate config\n2. Run tests", { maxBytes: 4_096 });
    if (!prepared.ok) throw new Error("unreachable");

    const resultRec = obs("aaaaaaaaaaaa", "Edited config.ts", { kind: "result", status: "passed" });
    const failedOutcome = obs("bbbbbbbbbbbb", "Tests failed: 2 errors", { kind: "outcome", status: "failed" });
    const unknownOutcome = obs("cccccccccccc", "Tests status unknown", { kind: "outcome" });
    const passedOutcome = obs("dddddddddddd", "All tests passed", { kind: "outcome", status: "passed" });
    const records = [resultRec, failedOutcome, unknownOutcome, passedOutcome];
    const ledger = foldObservationalMemoryLedger([{ type: OBSERVATIONS_RECORDED, observations: records }]);

    const requests: ClientRequest[] = [];
    const client: ModelClient = {
      model: { provider: "mock", model: "m", limits: { contextWindow: 64_000, maxOutputTokens: 0 } },
      async *generate(request) {
        requests.push({ ...request, messages: [...request.messages] });
        if (!request.messages.some((message) => message.role === "tool")) {
          yield providerToolCall(
            toolCallContent("j1", "judge", {
              finishedSteps: [
                { step: 1, evidence: ["r1"] }, // `result` kind -> refused
                { step: 1, evidence: ["r2"] }, // failed outcome -> refused
                { step: 1, evidence: ["r3"] }, // outcome without passed status -> refused
                { step: 2, evidence: ["r4"] }, // passed outcome -> accepted
              ],
              keep: [{ r: 4, reason: "step 2 outcome" }],
            }),
          );
        }
        yield providerDone();
      },
    };

    const output = await runWm({
      client,
      records,
      ledger,
      scope: prepared.scope,
      maxTurns: 2,
      endAfterCleanTurn: false,
    });

    const toolResult = toolResultOf(requests[1]!);
    expect(toolResult?.ok).toBe(false);
    expect(toolResult?.applied).toBe(2);
    expect(toolResult?.refused).toEqual([
      { entry: "finishedSteps[0]", reason: "unsupported_step_finish", ordinal: "r1" },
      { entry: "finishedSteps[1]", reason: "unsupported_step_finish", ordinal: "r2" },
      { entry: "finishedSteps[2]", reason: "unsupported_step_finish", ordinal: "r3" },
    ]);
    expect(output.finishedSteps).toEqual([{ step: 2, evidenceIds: [passedOutcome.id] }]);
  });

  it("items_for_finished_steps_are_offered_for_release", async () => {
    const prepared = prepareScope("1. Migrate config\n2. Update CLI\n3. Release notes", { maxBytes: 4_096 });
    if (!prepared.ok) throw new Error("unreachable");

    const r1 = obs("aaaaaaaaaaaa", "Old config path is src/cfg.ts", { kind: "result" });
    const r2 = obs("bbbbbbbbbbbb", "User constraint: keep backwards compat", { kind: "statement" });
    const r3 = obs("cccccccccccc", "CLI reads --json", { kind: "result" });
    const r4 = obs("dddddddddddd", "Config migration passed", { kind: "outcome", status: "passed" });

    const data = [{ type: OBSERVATIONS_RECORDED, observations: [r1, r2, r3] }] as unknown as JsonValue[];
    const session = { id: "s", entries: async () => [] as never[] } as never;
    const log = {
      entries: () => data,
      append: async (_s: unknown, value: JsonValue) => {
        data.push(value);
      },
    } as never;

    const wmPrompts: string[] = [];
    const refusals: unknown[] = [];
    let phase: "pass1" | "pass2" | "pass3" = "pass1";

    const client: ModelClient = {
      model: { provider: "mock", model: "m", limits: { contextWindow: 64_000, maxOutputTokens: 0 } },
      async *generate(request) {
        if (request.messages.some((message) => message.role === "tool")) {
          const result = toolResultOf(request);
          if (result?.refused) refusals.push(...(result.refused as unknown[]));
          yield providerDone();
          return;
        }
        const prompt = userText(request);
        wmPrompts.push(prompt);
        if (phase === "pass1") {
          // Keep r1 for step 1 (`neededLater: "step 1"`), r2 with NO neededLater, r3 for step 2 (`neededLater: "step 2"`).
          // Also try to finish step 1 using r4? Not yet in pass1.
          yield providerToolCall(
            toolCallContent("c1", "judge", {
              keep: [
                { r: 1, reason: "step 1 needs path", neededLater: "step 1" },
                { r: 2, reason: "general fact" },
                { r: 3, reason: "step 2 needs cli", neededLater: "step 2" },
              ],
            }),
          );
        } else if (phase === "pass2") {
          // Pass 2: r4 is a passed outcome -> mark step 1 finished.
          // Also verify step 2 item cannot be released yet (protected: needed_later).
          yield providerToolCall(
            toolCallContent("c2", "judge", {
              finishedSteps: [{ step: 1, evidence: ["r1"] }],
              keep: [{ r: 1, reason: "step 1 passed" }],
            }),
          );
        } else {
          // Pass 3: step 1 is finished, so w1 (neededLater: step 1) is offered for release!
          // Try releasing w1 (accepted), w2 (no neededLater -> refused), w3 (step 2 unfinished -> refused).
          const releaseMatch = prompt.split("## Items for finished steps")[1] ?? "";
          expect(releaseMatch).toContain("[w1]");
          expect(releaseMatch).not.toContain("[w2]");
          expect(releaseMatch).not.toContain("[w3]");
          yield providerToolCall(
            toolCallContent("c3", "judge", {
              discard: { finished: ["w1", "w2", "w3"] },
            }),
          );
        }
        yield providerDone();
      },
    };

    const flush = createObservationalFlush({
      log,
      config: resolveMemorySystemConfig({ wm: { policy: "model", triggerTokens: 1 }, rehearsal: { targetTokens: 1_000_000 } }),
      readState: () => ({ enabled: true }),
      scopeFor: () => prepared.scope,
      clientFor: () => client,
      onStatus: () => {},
    });

    // Pass 1: keeps w1 (step 1), w2 (no neededLater), w3 (step 2).
    await flush.flush(session);
    expect(activeWmItems(foldObservationalMemoryLedger(data))).toHaveLength(3);

    // Pass 2: passed outcome finishes step 1.
    phase = "pass2";
    data.push({ type: OBSERVATIONS_RECORDED, observations: [r4] } as unknown as JsonValue);
    await flush.flush(session);
    const afterPass2 = foldObservationalMemoryLedger(data);
    expect(resolveScopeProgress(prepared.scope, afterPass2.scopeSteps).finished.map((s) => s.step)).toEqual([1]);
    expect(resolveScopeProgress(prepared.scope, afterPass2.scopeSteps).remaining.map((s) => s.step)).toEqual([2, 3]);

    // Pass 3: offers w1 for release, keeps w2 and w3 untouched.
    phase = "pass3";
    await flush.flush(session, { forceWm: true });
    const afterPass3 = foldObservationalMemoryLedger(data);
    const remainingIds = activeWmItems(afterPass3).map((item) => item.citedIds[0]);
    expect(remainingIds).toEqual([r2.id, r3.id, r4.id]);
    expect(refusals).toEqual([
      { entry: "discard.finished[1]", reason: "invalid_arguments", ordinal: "w2" },
      { entry: "discard.finished[2]", reason: "protected", ordinal: "w3", protection: "needed_later" },
    ]);
  });

  it("step_state_survives_resume_and_fork", async () => {
    const store = createMemorySessionStore();
    const makeAgent = () =>
      createAgent({
        model: MODEL,
        packages: [
          providerPackage("main-provider", [
            {
              id: "main",
              async *generate() {
                yield providerTextDelta("ok");
                yield providerDone();
              },
            },
          ]),
          memorySystem({ enabled: true }),
        ],
        slots: { store },
      });

    const agent1 = await makeAgent();
    const s1 = await agent1.session({ id: "persist-session", create: true });
    await agent1.commands.run("memory:scope", { text: "1. Migrate config\n2. Update CLI\n3. Release notes" }, { session: s1 });
    const mark1 = await agent1.commands.run("memory:scope", { finished: [1] }, { session: s1 });
    expect(mark1).toMatchObject({ ok: true, finished: [1] });
    // Unknown step and invalid args fail closed.
    expect(await agent1.commands.run("memory:scope", { finished: [99] }, { session: s1 })).toMatchObject({
      ok: false,
      reason: "unknown_step",
    });

    // Fork before marking step 2: fork keeps step 1 finished; marking step 2 in fork does not affect parent.
    const fork = await s1.fork();
    const forkStatusBefore = (await agent1.commands.run("memory:session:status", {}, { session: fork })) as {
      scope: { steps: { total: number; remaining: number[]; finished: number[] } };
    };
    expect(forkStatusBefore.scope.steps).toEqual({ total: 3, remaining: [2, 3], finished: [1] });

    await agent1.commands.run("memory:scope", { finished: [2] }, { session: fork });
    const forkStatusAfter = (await agent1.commands.run("memory:session:status", {}, { session: fork })) as {
      scope: { steps: { total: number; remaining: number[]; finished: number[] } };
    };
    const parentStatus = (await agent1.commands.run("memory:session:status", {}, { session: s1 })) as {
      scope: { steps: { total: number; remaining: number[]; finished: number[] } };
    };
    expect(forkStatusAfter.scope.steps).toEqual({ total: 3, remaining: [3], finished: [1, 2] });
    expect(parentStatus.scope.steps).toEqual({ total: 3, remaining: [2, 3], finished: [1] });

    // Scope change resets step state ONLY for steps whose text changed:
    // Mark step 2 finished on parent, then change step 2's text while keeping step 1's text identical.
    await agent1.commands.run("memory:scope", { finished: [2] }, { session: s1 });
    await agent1.commands.run("memory:scope", { text: "1. Migrate config\n2. Update CLI and docs\n3. Release notes" }, { session: s1 });
    const afterReplan = (await agent1.commands.run("memory:session:status", {}, { session: s1 })) as {
      scope: { steps: { total: number; remaining: number[]; finished: number[] } };
    };
    expect(afterReplan.scope.steps).toEqual({ total: 3, remaining: [2, 3], finished: [1] });

    await s1.close();
    await agent1.dispose();

    // Resume in a new agent over the same store: step state survives resume.
    const agent2 = await makeAgent();
    try {
      const resumed = await agent2.session({ id: "persist-session" });
      const resumedStatus = (await agent2.commands.run("memory:session:status", {}, { session: resumed })) as {
        scope: { steps: { total: number; remaining: number[]; finished: number[] } };
      };
      expect(resumedStatus.scope.steps).toEqual({ total: 3, remaining: [2, 3], finished: [1] });
      const ledger = foldObservationalMemoryLedger(await resumed.entries());
      expect(ledger.scopeSteps?.["1"]?.step).toBe(1);
      expect(
        (await resumed.entries()).some(
          (entry) => entry.kind === "package_state" && (entry.data as { value?: { type?: string } })?.value?.type === SCOPE_STEP,
        ),
      ).toBe(true);
    } finally {
      await agent2.dispose();
    }
  });
});
