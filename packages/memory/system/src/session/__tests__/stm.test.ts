/**
 * Plan 217 Task 1: the STM encoder records events, not facts, and never sees the scope (I1).
 */
import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  createAgent,
  createMemorySessionStore,
  definePackage,
  type ModelProvider,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  providerToolCall,
  type SessionEntry,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import memorySystem, { foldObservationalMemoryLedger } from "../../index.js";
import { gatherConsolidationCandidates } from "../../ltm/consolidation/gather.js";
import { resolveMemorySystemConfig } from "../config.js";
import { recallObservationalMemory } from "../recall.js";
import { renderObservationalMemory } from "../render.js";
import { type MemoryObservation, memoryEventKindValues, OBSERVATIONS_DROPPED, OBSERVATIONS_RECORDED } from "../types.js";
import { DEFAULT_STM_INSTRUCTION, runStm, STM_INDEX_DESCRIPTION_CHARS } from "../workers/stm.js";
import { runWm } from "../workers/wm.js";
import { clientFor } from "./helpers.js";

const source: SessionEntry = {
  id: "m1",
  sessionId: "s",
  kind: "message",
  timestamp: "2026-11-09T10:00:00.000Z",
  message: { role: "user", content: [{ type: "text", text: "Fix the retry counter in campaign.mjs" }] },
} as SessionEntry;

function event(id: string, description: string, minute: number, kind: MemoryObservation["kind"] = "result"): MemoryObservation {
  const at = new Date(Date.UTC(2026, 10, 9, 9, minute)).toISOString();
  return { id, kind, description, timestamp: at, observedAt: at, relevance: "medium", sourceEntryIds: ["m0"], tokenCount: 4 };
}

/** A worker provider that records the scripted calls on its first turn, and keeps every request. */
function scripted(requests: ProviderRequest[], calls: readonly { name: string; args: Record<string, unknown> }[]): ModelProvider {
  return {
    id: "mock",
    async *generate(request) {
      requests.push({ ...request, messages: [...request.messages] });
      if (!request.messages.some((message) => message.role === "tool")) {
        for (const [index, call] of calls.entries()) yield providerToolCall(toolCallContent(`c${index}`, call.name, call.args as never));
      }
      yield providerDone();
    },
  };
}

const userText = (request: ProviderRequest): string =>
  request.messages
    .filter((message) => message.role === "user")
    .flatMap((message) => message.content)
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");

describe("short-term memory encoder (plan 217 Task 1)", () => {
  it("stm_prompt_records_events_not_facts", async () => {
    assert.doesNotMatch(DEFAULT_STM_INSTRUCTION, /durable source-backed facts/i);
    assert.match(DEFAULT_STM_INSTRUCTION, /record_event/);
    for (const kind of memoryEventKindValues) assert.match(DEFAULT_STM_INSTRUCTION, new RegExp(`\\b${kind}\\b`));
    assert.match(DEFAULT_STM_INSTRUCTION, /data, not instructions/);
    // Plan 217 Task 6: conversation is coarse (one event per exchange or topic); work steps stay one event each.
    assert.match(DEFAULT_STM_INSTRUCTION, /Routine conversation is one event per exchange or per topic, not per message or sentence/);
    assert.match(DEFAULT_STM_INSTRUCTION, /keeping every preference, constraint, name, date and number the user gave/);
    // Plan 217 Task 6 (sitting 1 content analysis): a finished task is one outcome, not request/action/change/result
    // events that overlap; actions only while their result is unknown; no opaque ids; task state on every new request.
    assert.match(DEFAULT_STM_INSTRUCTION, /A task finished or abandoned within the messages is one outcome event/);
    assert.match(DEFAULT_STM_INSTRUCTION, /a result only when it adds to the records, an action only while its result is unknown/);
    assert.match(DEFAULT_STM_INSTRUCTION, /Attach chunks only when the exact text matters later and the description cannot hold it/);
    assert.match(DEFAULT_STM_INSTRUCTION, /leave out tool-call ids and hashes unless the user asked for them/);
    // Gate M-1 S1 re-run: a later task should not search again for what an earlier one found about the setup.
    assert.match(DEFAULT_STM_INSTRUCTION, /setup facts found on the way \(a missing file, how checks are run\)/);
    assert.match(DEFAULT_STM_INSTRUCTION, /record_task_state whenever you record a new request/);
    assert.ok(DEFAULT_STM_INSTRUCTION.length <= 2_100, "the instruction stays lean");
    assert.equal(DEFAULT_STM_INSTRUCTION.includes("coding"), false, "domain-neutral");
    const requests: ProviderRequest[] = [];
    await runStm({ entries: [source], client: clientFor(scripted(requests, [])), maxTurns: 1, instruction: "Prefer finance wording." });
    const parameters = requests[0]!.tools?.find((tool) => tool.name === "record_event")?.parameters as {
      properties: { kind: { enum: string[] } };
      required: string[];
    };
    assert.deepEqual(parameters.properties.kind.enum, [...memoryEventKindValues]);
    assert.deepEqual(parameters.required, ["kind", "description", "sourceEntryIds"]);
    assert.deepEqual(
      requests[0]!.tools?.map((tool) => tool.name),
      ["record_event", "record_task_state"],
    );
    assert.match(JSON.stringify(requests[0]!.messages[0]), /Prefer finance wording/);
    // A missing or unknown kind is refused with a reason the model can act on.
    const refused = await runStm({
      entries: [source],
      client: clientFor(scripted([], [{ name: "record_event", args: { kind: "fact", description: "x", sourceEntryIds: ["m1"] } }])),
      maxTurns: 2,
    });
    assert.deepEqual(refused, []);
  });

  it("outcome_event_names_changes_and_verification", async () => {
    assert.match(DEFAULT_STM_INSTRUCTION, /finished or abandoned within the messages is one outcome event/);
    for (const part of ["what was asked", "what changed", "achieved or left open", "how it was verified"]) {
      assert.ok(DEFAULT_STM_INSTRUCTION.includes(part), `the outcome rule names "${part}"`);
    }
    const description =
      "Campaign retries: interrupted attempts no longer count toward maxAttempts (campaign.mjs retryUncounted); 35 campaign tests pass.";
    const [outcome] = await runStm({
      entries: [source],
      client: clientFor(
        scripted(
          [],
          [{ name: "record_event", args: { kind: "outcome", status: "passed", description, sourceEntryIds: ["m1"], relevance: "high" } }],
        ),
      ),
      maxTurns: 2,
    });
    assert.equal(outcome?.kind, "outcome");
    assert.equal(outcome?.description, description);
    assert.equal(outcome?.count, 1);
    assert.equal(outcome?.lastAt, source.timestamp);
    assert.match(renderObservationalMemory([], [outcome!]), /\(high\) outcome \(passed\): Campaign retries/);
  });

  it("stm_sees_recent_index_within_budget_and_uses_supersedes", async () => {
    const long = `Ran bun test scripts/campaign.test.mjs: ${"35 pass ".repeat(30)}TAIL-BEYOND-INDEX`;
    const recent = [
      event("aaaaaaaaaaaa", "OLDEST-OUT-OF-BUDGET result", 1),
      event("bbbbbbbbbbbb", "User asked to fix retries", 2, "request"),
      event("cccccccccccc", long, 3),
    ];
    const requests: ProviderRequest[] = [];
    const records: unknown[] = [];
    const recorded = await runStm({
      entries: [source],
      recent,
      contextTokens: 50,
      client: clientFor(
        scripted(requests, [
          {
            name: "record_event",
            args: { kind: "result", description: "Re-ran tests: 36 pass", sourceEntryIds: ["m1"], supersedes: "cccccccccccc" },
          },
        ]),
      ),
      maxTurns: 2,
      onRecord: (record) => records.push(record),
    });
    const prompt = userText(requests[0]!);
    assert.match(prompt, /Do not re-record these; use supersedes to replace one/);
    assert.match(prompt, /\[bbbbbbbbbbbb\] request: User asked to fix retries/);
    assert.match(prompt, /\[cccccccccccc\] result: Ran bun test/);
    assert.ok(prompt.includes(`${long.slice(0, STM_INDEX_DESCRIPTION_CHARS)}…`), "the index shows the first 120 characters");
    assert.doesNotMatch(prompt, /TAIL-BEYOND-INDEX/);
    assert.doesNotMatch(prompt, /OLDEST-OUT-OF-BUDGET/, "the oldest record falls outside stm.contextTokens");
    assert.ok(prompt.indexOf("bbbbbbbbbbbb") < prompt.indexOf("cccccccccccc"), "shown oldest first");
    assert.equal(recorded.length, 1);
    assert.deepEqual(records, [
      { type: OBSERVATIONS_DROPPED, observationIds: ["cccccccccccc"], reason: "superseded", supersededBy: recorded[0]!.id },
    ]);
  });

  it("stm_request_never_contains_scope_wm_or_ltm_text", async () => {
    const SCOPE = "EPISODE-SCOPE-SENTINEL";
    const LTM = "LTM-NOTE-SENTINEL";
    const WM = "WM-ITEM-SENTINEL";
    const stmRequests: ProviderRequest[] = [];
    const mainRequests: ProviderRequest[] = [];
    let reflected = false;
    const provider: ModelProvider = {
      id: "scripted",
      async *generate(request) {
        const names = new Set(request.tools?.map((tool) => tool.name) ?? []);
        const answered = request.messages.some((message) => message.role === "tool");
        const ids = [...userText(request).matchAll(/\[([^\]\s]+)\]/g)].map((match) => match[1]!);
        if (names.has("record_event")) {
          stmRequests.push({ ...request, messages: [...request.messages] });
          if (!answered) {
            yield providerToolCall(
              toolCallContent("o1", "record_event", {
                kind: "request",
                description: "User asked for a status update",
                sourceEntryIds: ids,
              }),
            );
          }
        } else if (names.has("judge")) {
          if (!answered) {
            reflected = true;
            const of = [...userText(request).matchAll(/^- \[r([0-9]+)\] \d{4}-/gm)].map((match) => Number(match[1]));
            yield providerToolCall(toolCallContent("r1", "judge", { summaries: [{ of, text: `${WM} summary`, relevance: "medium" }] }));
          }
        } else if (!names.has("drop_observations")) {
          mainRequests.push(request);
          yield providerTextDelta("ok");
        }
        yield providerDone();
      },
    };
    // Scope and LTM reach the main model the way those tiers do: as `context.build` blocks.
    const tiers = definePackage({
      name: "@test/scope-and-ltm",
      version: "0.0.0",
      requires: { api: 1 },
      setup(prism) {
        prism.hooks.on("context.build", (draft) => ({
          ...draft,
          context: [...(draft.context ?? []), { title: "scope", content: SCOPE }, { title: "Long-term memory", content: LTM }],
        }));
      },
    })();
    const agent = await createAgent({
      model: { provider: "scripted", model: "main" },
      packages: [
        providerPackage("scripted", [provider]),
        tiers,
        memorySystem({
          enabled: true,
          stm: { model: "scripted/stm", triggerTokens: 1 },
          wm: { model: "scripted/stm", triggerTokens: 1 },
          context: { compactAt: { maxTokens: 999_999 } },
          worker: { maxTurns: 2 },
        }),
      ],
      slots: { store: createMemorySessionStore() },
    });
    try {
      const session = await agent.session({ id: "s1", create: true });
      const waitFor = async (check: () => boolean | Promise<boolean>) => {
        for (let attempt = 0; attempt < 500 && !(await check()); attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
        assert.ok(await check(), "background pass settled");
      };
      await session.run("What is the status?");
      await waitFor(async () => reflected && foldObservationalMemoryLedger(await session.entries()).wmItems.length > 0);
      const before = stmRequests.length;
      await session.run("And now?");
      await waitFor(() => stmRequests.length > before);
      assert.ok(
        mainRequests.some((request) => JSON.stringify(request).includes(SCOPE)),
        "the scope block was live",
      );
      assert.ok(stmRequests.length >= 2);
      for (const request of stmRequests) {
        const text = JSON.stringify(request);
        for (const sentinel of [SCOPE, LTM, WM]) assert.ok(!text.includes(sentinel), `STM request carries ${sentinel}`);
      }
    } finally {
      await agent.dispose();
    }
  });

  it("consumers_read_event_shape", async () => {
    const outcome = { ...event("aaaaaaaaaaaa", "Fixed retry counter; 35 tests pass", 5, "outcome"), relevance: "high" as const };
    // Render: `kind: description`.
    assert.match(renderObservationalMemory([], [outcome]), /- \[aaaaaaaaaaaa\] 09:05 \(high\) outcome: Fixed retry counter/);
    // WM sees the kind and description.
    const requests: ProviderRequest[] = [];
    await runWm({
      client: clientFor(scripted(requests, [])),
      records: [outcome],
      ledger: foldObservationalMemoryLedger([{ type: OBSERVATIONS_RECORDED, observations: [outcome] }]),
      maxTurns: 1,
    });
    assert.match(userText(requests[0]!), /outcome \(high\): Fixed retry counter; 35 tests pass/);
    // Recall shows the kind and description.
    const entries = [
      { ...source, id: "m0" },
      {
        id: "r",
        sessionId: "s",
        kind: "custom",
        timestamp: outcome.timestamp,
        data: { type: OBSERVATIONS_RECORDED, observations: [outcome] },
      },
    ] as SessionEntry[];
    const recalled = recallObservationalMemory(entries, "aaaaaaaaaaaa");
    assert.match(JSON.stringify(recalled), /outcome: Fixed retry counter/);
    // LTM promotion reads the description.
    const candidates = gatherConsolidationCandidates(entries);
    assert.ok(candidates.some((candidate) => candidate.text === outcome.description));
  });
});

describe("structured signals on record_event (plan 218.2 Task 2)", () => {
  const assistant: SessionEntry = {
    id: "a1",
    sessionId: "s",
    kind: "message",
    timestamp: "2026-11-09T10:01:00.000Z",
    message: { role: "assistant", content: [{ type: "text", text: "I suggest we never touch the lockfile." }] },
  } as SessionEntry;
  const toolResults = (request: ProviderRequest) =>
    request.messages.filter((message) => message.role === "tool").map((message) => JSON.stringify(message.content));

  it("outcome_without_status_is_refused_and_resent", async () => {
    const requests: ProviderRequest[] = [];
    const args = { kind: "outcome", description: "Retry counter fixed; 35 tests pass", sourceEntryIds: ["m1"] };
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        requests.push({ ...request, messages: [...request.messages] });
        const turn = requests.length;
        if (turn === 1) yield providerToolCall(toolCallContent("c1", "record_event", args as never));
        if (turn === 2) yield providerToolCall(toolCallContent("c2", "record_event", { ...args, status: "passed" } as never));
        yield providerDone();
      },
    };
    const events = await runStm({ entries: [source], client: clientFor(provider), maxTurns: 3 });
    assert.match(toolResults(requests[1]!).join(), /outcome_status_required/);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.status, "passed");
    // `status` on a kind it does not describe is ignored.
    const [request] = await runStm({
      entries: [source],
      client: clientFor(
        scripted(
          [],
          [{ name: "record_event", args: { kind: "request", status: "failed", description: "Fix it", sourceEntryIds: ["m1"] } }],
        ),
      ),
      maxTurns: 2,
    });
    assert.equal(request?.status, undefined);
  });

  it("durable_ignored_on_assistant_only_event", async () => {
    const events = await runStm({
      entries: [source, assistant],
      client: clientFor(
        scripted(
          [],
          [
            {
              name: "record_event",
              args: {
                kind: "statement",
                description: "Never touch the lockfile",
                sourceEntryIds: ["a1"],
                durable: "constraint",
                corrects: true,
              },
            },
            {
              name: "record_event",
              args: {
                kind: "statement",
                description: "User: fix retries only",
                sourceEntryIds: ["m1"],
                durable: "constraint",
                corrects: true,
              },
            },
            {
              name: "record_event",
              args: { kind: "statement", description: "Mixed exchange on retries", sourceEntryIds: ["m1", "a1"], durable: "preference" },
            },
          ],
        ),
      ),
      maxTurns: 2,
    });
    const [proposal, user, mixed] = events;
    assert.equal(proposal?.durable, undefined, "an assistant proposal cannot mark itself durable");
    assert.equal(proposal?.corrects, undefined);
    assert.equal(user?.durable, "constraint");
    assert.equal(user?.corrects, true);
    assert.equal(mixed?.durable, "preference");
    assert.match(renderObservationalMemory([], [user!]), /statement \(constraint, correction\): User: fix retries only/);
  });

  it("resolves_outside_recent_index_dropped_with_warning", async () => {
    const recent = [
      event("aaaaaaaaaaaa", "User asked to fix retries", 1, "request"),
      event("bbbbbbbbbbbb", "bun test failed: 2 retry cases", 2, "error"),
      event("cccccccccccc", "Read campaign.mjs", 3, "result"),
    ];
    const requests: ProviderRequest[] = [];
    const events = await runStm({
      entries: [source],
      recent,
      client: clientFor(
        scripted(requests, [
          {
            name: "record_event",
            args: {
              kind: "outcome",
              status: "passed",
              description: "Retries fixed; 35 tests pass",
              sourceEntryIds: ["m1"],
              // A request and an error resolve; a result, an unknown id and a non-string are dropped.
              resolves: ["aaaaaaaaaaaa", "bbbbbbbbbbbb", "cccccccccccc", "dddddddddddd", 7],
            },
          },
          {
            name: "record_event",
            args: { kind: "result", status: "passed", description: "Lint clean", sourceEntryIds: ["m1"], resolves: ["aaaaaaaaaaaa"] },
          },
        ]),
      ),
      maxTurns: 2,
      endAfterCleanTurn: false,
    });
    assert.deepEqual(events[0]?.resolves, ["aaaaaaaaaaaa", "bbbbbbbbbbbb"]);
    assert.equal(events[1]?.resolves, undefined, "resolves belongs to an outcome");
    const results = toolResults(requests[1]!);
    assert.match(results[0]!, /resolvesWarning/);
    assert.match(results[0]!, new RegExp(`"id":"${events[0]!.id}"`), "the result names the new record's id");
  });

  it("stm_request_never_carries_scope_wm_or_ltm", async () => {
    // I1 extended: the new fields describe the cited messages; the schema names no scope, WM item or LTM note.
    const requests: ProviderRequest[] = [];
    await runStm({ entries: [source], client: clientFor(scripted(requests, [])), maxTurns: 1 });
    const parameters = requests[0]!.tools?.find((tool) => tool.name === "record_event")?.parameters as {
      properties: Record<string, { description?: string }>;
    };
    for (const field of ["status", "corrects", "durable", "resolves"]) {
      const text = parameters.properties[field]?.description ?? "";
      assert.ok(text.length > 0, `${field} is described in the schema`);
      assert.doesNotMatch(text, /scope|working memory|long-term|\bWM\b|\bLTM\b/i);
    }
    assert.ok(DEFAULT_STM_INSTRUCTION.length <= 2_100, "the instruction keeps its cap");
  });
});

describe("evidence kept by rule (plan 218.2 Task 4)", () => {
  const lines = Array.from({ length: 80 }, (_, index) => `ok ${index + 1} - retry case ${index + 1} passes`);
  const failing = [...lines, "not ok 81 - interrupted attempt counted", "Error: expected 2 retries, got 3", "1 failed, 80 passed"].join(
    "\n",
  );
  const result = (id: string, text: string): SessionEntry =>
    ({
      id,
      sessionId: "s",
      kind: "message",
      timestamp: "2026-11-09T10:02:00.000Z",
      message: { role: "tool", content: [{ type: "tool_result", toolCallId: `t-${id}`, name: "run_tests", result: text }] },
    }) as SessionEntry;
  const user = (id: string, text: string): SessionEntry =>
    ({
      id,
      sessionId: "s",
      kind: "message",
      timestamp: "2026-11-09T10:03:00.000Z",
      message: { role: "user", content: [{ type: "text", text }] },
    }) as SessionEntry;
  // A batch's chunk budget is a quarter of its transcript bytes; this read gives the small batches below a real one.
  const pad = result("p1", Array.from({ length: 200 }, (_, index) => `line ${index}: const retry = attempts.next();`).join("\n"));
  const record = (args: Record<string, unknown>) => ({ name: "record_event", args });
  async function run(
    entries: readonly SessionEntry[],
    calls: readonly { name: string; args: Record<string, unknown> }[],
    options: Partial<Parameters<typeof runStm>[0]> = {},
  ) {
    const stored = new Map<string, readonly { text: string; bytes: number; sourceEntryId: string }[]>();
    const events = await runStm({
      entries: [...entries, pad],
      client: clientFor(scripted([], calls)),
      maxTurns: 2,
      onChunks: (id, chunks) => stored.set(id, chunks),
      autoChunkBytes: 1_024,
      ...options,
    });
    return { events, stored };
  }

  it("error_without_chunk_gets_tail_excerpt_of_cited_result", async () => {
    const { events, stored } = await run(
      [source, result("r1", failing)],
      [
        record({ kind: "error", description: "Retry test fails: 3 retries counted", sourceEntryIds: ["r1"] }),
        record({ kind: "result", status: "failed", description: "1 failed, 80 passed", sourceEntryIds: ["r1"] }),
        record({ kind: "result", status: "passed", description: "Earlier run passed", sourceEntryIds: ["r1"] }),
      ],
    );
    assert.equal(events.length, 3);
    const [error, failedResult, passed] = events;
    const chunk = stored.get(error!.id)?.[0];
    assert.ok(chunk, "the error carries an automatic chunk");
    assert.equal(chunk.sourceEntryId, "r1");
    assert.ok(chunk.bytes <= 1_024);
    assert.ok(chunk.text.endsWith("1 failed, 80 passed"));
    assert.match(chunk.text, /Error: expected 2 retries, got 3/);
    // Cut on a line boundary: the chunk starts with a whole line of the result.
    assert.ok(failing.split("\n").includes(chunk.text.split("\n")[0]!));
    assert.equal(error!.chunkRefs?.[0]?.id, (chunk as { id?: string }).id);
    assert.ok(stored.get(failedResult!.id)?.length, "a failed result carries one");
    assert.equal(stored.get(passed!.id), undefined, "a passed result carries none");
    assert.equal(passed!.chunkRefs, undefined);
  });

  it("durable_statement_gets_its_quoted_sentence", async () => {
    const message = "Thanks for the summary. Please use pnpm for every install, never npm. Let's continue tomorrow.";
    const { events, stored } = await run(
      [user("u1", message)],
      [
        record({
          kind: "statement",
          durable: "constraint",
          description: 'User requires "pnpm" for installs, never npm',
          sourceEntryIds: ["u1"],
        }),
        record({ kind: "statement", durable: "preference", description: "User prefers short replies", sourceEntryIds: ["u1"] }),
      ],
    );
    assert.equal(stored.get(events[0]!.id)?.[0]?.text, "Please use pnpm for every install, never npm.");
    // No quoted term: the head of the message, up to the byte cap.
    assert.equal(stored.get(events[1]!.id)?.[0]?.text, message);
  });

  it("worker_chunk_is_never_replaced_and_budget_exhaustion_adds_none", async () => {
    const worker = await run(
      [source, result("r1", failing)],
      [
        record({
          kind: "error",
          description: "Retry test fails",
          sourceEntryIds: ["r1"],
          chunks: [{ sourceEntryId: "r1", text: "not ok 81 - interrupted attempt counted" }],
        }),
      ],
    );
    assert.deepEqual(
      worker.stored.get(worker.events[0]!.id)?.map((chunk) => chunk.text),
      ["not ok 81 - interrupted attempt counted"],
    );
    // A batch whose chunk budget cannot hold the automatic chunk records the event without one.
    const spent = await run(
      [source, result("r1", failing)],
      [record({ kind: "error", description: "Retry test fails", sourceEntryIds: ["r1"] })],
      { sourceText: "x".repeat(400) },
    );
    assert.equal(spent.events.length, 1);
    assert.equal(spent.events[0]!.chunkRefs, undefined);
    assert.equal(spent.stored.size, 0);
  });

  it("auto_chunk_is_redacted_before_write", async () => {
    const secret = "sk-live-0123456789abcdef0123";
    const { events, stored } = await run(
      [source, result("r1", `${failing}\nError: auth failed with token ${secret}`)],
      [record({ kind: "error", description: "Auth failed in the retry test", sourceEntryIds: ["r1"] })],
      { secrets: [secret] },
    );
    const chunk = stored.get(events[0]!.id)?.[0];
    assert.ok(chunk);
    assert.match(chunk.text, /Error: auth failed with token/);
    assert.ok(!chunk.text.includes(secret));
  });

  it("auto_chunk_bytes_zero_turns_rule_off", async () => {
    const calls = [record({ kind: "error", description: "Retry test fails", sourceEntryIds: ["r1"] })];
    const off = await run([source, result("r1", failing)], calls, { autoChunkBytes: 0 });
    assert.equal(off.events[0]!.chunkRefs, undefined);
    assert.equal(off.stored.size, 0);
    // On by default at 1,024 bytes (owner, 2026-11-15).
    const byDefault = await run([source, result("r1", failing)], calls, { autoChunkBytes: undefined });
    assert.equal(byDefault.stored.size, 1);
    assert.equal(resolveMemorySystemConfig({}).stm.autoChunkBytes, 1_024);
    // Chunks off (no chunk store) turns the rule off too.
    const noStore = await run([source, result("r1", failing)], calls, { maxChunksPerEvent: 0 });
    assert.equal(noStore.stored.size, 0);
    const small = await run([source, result("r1", failing)], calls, { autoChunkBytes: 64 });
    assert.equal(small.stored.get(small.events[0]!.id)?.[0]?.text, "Error: expected 2 retries, got 3\n1 failed, 80 passed");
  });
});
