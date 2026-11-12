import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Agent,
  type AgentEvent,
  createAgent,
  definePackage,
  type ModelProvider,
  type PackageInstance,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  providerToolCall,
  type Session,
  SlotConflictError,
  toolCallContent,
} from "@arnilo/prism";
import memoryCompaction from "@arnilo/prism-extensions/compaction";
import { sqliteStore } from "@arnilo/prism-extensions/store-sqlite";
import memorySystem from "@arnilo/prism-memory-system";

/**
 * Session memory (`@arnilo/prism-memory-system`'s session tiers), proved end to end over a durable
 * SQLite store and a two-process resume:
 *
 * 1. **The STM worker runs on its own model.** The agent runs on `mock/main`; the package config names
 *    `mock/observer`, and the demo asserts both models saw requests.
 * 2. **Compaction uses observations.** `session.compact()` writes a summary carrying the observation
 *    the observer recorded, from the ledger rather than the raw transcript.
 * 3. **A session is toggled by command.** `agent.commands.run("memory:session", …)` turns memory on for one
 *    session; a second session of the same agent stays off.
 * 4. **State survives resume.** Process A spawns `bun <file> --phase=b <dir> <sessionId> <leafId>`;
 *    B reopens the session on the same database and reports the toggle, the worker model, the ledger
 *    counts, the rendered ledger, and whether `recall` was offered to the model.
 * 5. **The host holds no memory logic.** This file lists packages, runs commands, reads the session's
 *    entries, and reads `memory.session.status` events. Nothing here touches a ledger, a worker, or a prompt.
 * 6. **The slot conflict fails closed.** Listing both memory packages without an assignment rejects
 *    with `SlotConflictError`; assigning `slots.compaction` resolves it and `inspect()` names the owner.
 *
 * Imports only `@arnilo/prism`, the two memory packages, and `@arnilo/prism-extensions/store-sqlite`; the mock
 * provider is inline, so there is no credential and no network. The first turn carries a sentinel
 * secret and the demo asserts the ledger and the events never render it. Run: `bun examples/session-memory.ts`
 */

const MAIN_MODEL = { provider: "mock", model: "main", limits: { contextWindow: 64_000, maxOutputTokens: 0 } } as const;
const OBSERVER_MODEL = "mock/observer";
const OBSERVATION = "OBSERVED-FACT: the retry budget is capped at three attempts.";
/** A secret-shaped sentinel: the ledger and the events must never render it. */
const SENTINEL_SECRET = "sk-observational-memory-demo-sentinel";
const OM_PACKAGE = "@arnilo/prism-memory-system";
const COMPACTION_PACKAGE = "@arnilo/prism-extensions/compaction";

interface Recorder {
  readonly requests: ProviderRequest[];
}

/**
 * One provider for both models: the observer answers the package's worker prompt with one
 * `record_event` call sourced from the entries the prompt lists as `[id]`, the main model
 * answers a turn. Every request is recorded, which is how the demo proves which model was asked.
 */
function demoProvider(recorder: Recorder): ModelProvider {
  return {
    id: "mock",
    async *generate(request) {
      recorder.requests.push(request);
      if (request.model.model !== "observer") {
        yield providerTextDelta("ack");
        yield providerDone();
        return;
      }
      const answered = request.messages.some((message) => message.role === "tool");
      const prompt = request.messages.find((message) => message.role === "user")?.content[0];
      const sourceId =
        prompt?.type === "text" ? /\[[^\]]+\] \[([^\]]+)\] (?:user|assistant|tool|system):/.exec(prompt.text)?.[1] : undefined;
      if (!answered && sourceId) {
        yield providerToolCall(
          toolCallContent("observe-1", "record_event", {
            kind: "statement",
            // Names its source entry, so each turn's pass records its own event (an identical one would habituate).
            description: `${OBSERVATION} (entry ${sourceId})`,
            relevance: "high",
            sourceEntryIds: [sourceId],
          }),
        );
      }
      yield providerDone();
    },
  };
}

/** Registers {@link demoProvider} as provider id `mock`, so `"mock/main"` and `"mock/observer"` resolve. */
function mockProviderPackage(recorder: Recorder): PackageInstance {
  return definePackage({
    name: "@acme/observational-memory-demo-provider",
    version: "1.0.0",
    description: "The demo's scripted provider for the main and observer models.",
    requires: { api: 1 },
    setup(prism) {
      prism.providers.register(demoProvider(recorder));
    },
  })();
}

interface DemoAgent {
  readonly agent: Agent;
  readonly events: AgentEvent[];
}

/** The whole host wiring: one store package, one provider package, one memory package. */
async function buildAgent(dir: string, recorder: Recorder): Promise<DemoAgent> {
  const events: AgentEvent[] = [];
  const agent = await createAgent({
    id: "observational-memory-demo",
    model: MAIN_MODEL,
    packages: [
      sqliteStore({ path: join(dir, "sessions.db") }),
      mockProviderPackage(recorder),
      // The package is inert until a session's `memory:session` toggle turns it on. `triggerTokens: 1` makes the
      // first eligible turn cross the observation threshold, so one pass runs in one turn.
      memorySystem({ stm: { model: OBSERVER_MODEL, triggerTokens: 1 }, context: { recentMessages: 2 } }),
    ],
    hooks: (hooks: { on: (name: "package.event", handler: (payload: unknown) => void) => void }) => {
      hooks.on("package.event", (payload) => events.push(payload as AgentEvent));
    },
  });
  return { agent, events };
}

type OmStatus = {
  readonly enabled: boolean;
  readonly contextMode: "none" | "own-compaction" | "pinned";
  readonly stm: unknown;
  readonly observations: { readonly recorded: number; readonly active: number };
  readonly wmItems: { readonly recorded: number };
};

/** Reads the package's own status command — the host's only view of memory state. */
const statusOf = async (agent: Agent, session: Session): Promise<OmStatus> =>
  (await agent.commands.run("memory:session:status", {}, { session })) as OmStatus;

/** Waits for the background observation pass a turn started; the pass is not awaited by `run()`. */
async function waitForObservations(agent: Agent, session: Session, atLeast: number): Promise<OmStatus> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const status = await statusOf(agent, session);
    if (status.observations.recorded >= atLeast) return status;
    if (Date.now() > deadline) throw new Error("timed out waiting for the observation pass");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Criterion 6: the slot conflict fails closed, and naming an owner resolves it. */
async function slotAssignment(): Promise<{ conflict: string; owner: string }> {
  const recorder: Recorder = { requests: [] };
  const both = () => [mockProviderPackage(recorder), memorySystem({}), memoryCompaction({})];
  let conflict = "";
  try {
    await createAgent({ model: MAIN_MODEL, packages: both() });
  } catch (error) {
    assert.ok(error instanceof SlotConflictError, `expected SlotConflictError, got ${String(error)}`);
    assert.equal(error.code, "ERR_PRISM_SLOT_CONFLICT");
    assert.deepEqual(error.owners, [OM_PACKAGE, COMPACTION_PACKAGE]);
    conflict = error.code;
  }
  assert.equal(conflict, "ERR_PRISM_SLOT_CONFLICT", "two providers and no assignment must fail closed");

  const resolved = await createAgent({
    model: MAIN_MODEL,
    packages: both(),
    slots: { compaction: OM_PACKAGE },
  });
  const owner = (await resolved.inspect()).slots.compaction;
  assert.equal(owner, OM_PACKAGE, "the assignment names the owner");
  await resolved.dispose();
  return { conflict, owner };
}

type PhaseB = {
  readonly phase: "b";
  readonly pid: number;
  readonly sessionId: string;
  readonly enabled: boolean;
  readonly observer: string;
  readonly observations: number;
  readonly wmItems: number;
  readonly messageCount: number;
  readonly ledgerHasObservation: boolean;
  readonly recallVisible: boolean;
};

/** Process A: toggle one session, observe, compact, then assert what a fresh process reads back. */
async function phaseA(script: string): Promise<Record<string, unknown>> {
  const dir = mkdtempSync(join(tmpdir(), "prism-observational-memory-"));
  try {
    const recorder: Recorder = { requests: [] };
    const { agent, events } = await buildAgent(dir, recorder);
    const session = await agent.session({ id: "observed", create: true });
    const untouched = await agent.session({ id: "untouched", create: true });

    // Criterion 3: the command turns memory on for one session only.
    const toggled = (await agent.commands.run("memory:session", {}, { session })) as { enabled: boolean };
    assert.equal(toggled.enabled, true, "memory:session turns memory on");
    const off = await statusOf(agent, untouched);
    assert.equal(off.enabled, false, "the other session stays off");

    // Criterion 1: two main turns, and the observer pass they trigger.
    await session.run(`Plan the migration and keep the retry budget small (demo sentinel ${SENTINEL_SECRET}).`);
    await waitForObservations(agent, session, 1);
    await session.run("Write the plan down.");
    await waitForObservations(agent, session, 2);
    const models = recorder.requests.map((request) => request.model.model);
    assert.equal(models.filter((model) => model === "main").length >= 2, true, "the turns ran on mock/main");
    assert.equal(models.filter((model) => model === "observer").length >= 1, true, "the observer ran on mock/observer");

    // Criterion 2: compaction summarizes from the ledger, not the raw transcript.
    assert.equal((await statusOf(agent, session)).contextMode, "none");
    await session.compact();
    assert.equal((await statusOf(agent, session)).contextMode, "own-compaction");
    const compaction = (await session.entries()).filter((entry) => entry.kind === "compaction").at(-1);
    assert.ok(compaction, "compaction appended an entry");
    assert.match(compaction.summary ?? "", /OBSERVED-FACT/, "the summary carries the recorded observation");
    assert.equal((compaction.data as { strategy?: string }).strategy, "session-memory");

    // Criterion 5: the host sees the pass only as a package event and through `memory:session:status`.
    assert.equal(
      events.some((event) => event.type === "package.event" && event.name === "memory.session.status"),
      true,
      "the package reports its status as an event",
    );
    const view = (await agent.commands.run("memory:session:view", {}, { session })) as { text: string };
    assert.equal(view.text.includes(SENTINEL_SECRET), false, "the ledger never renders the raw turn");
    assert.equal(JSON.stringify(events).includes(SENTINEL_SECRET), false, "no secret in the events");

    const messageCount = (await session.messages()).length;
    const leafId = session.leafId;
    assert.ok(leafId, "the session has a leaf to resume from");

    // Criterion 4: a second process over the same database.
    const child = spawnSync("bun", [script, "--phase=b", dir, session.id, leafId], { encoding: "utf8", timeout: 30_000 });
    assert.equal(child.status, 0, `phase B exited ${child.status}\n${child.stderr}`);
    const b = JSON.parse(child.stdout.trim().split("\n").at(-1) ?? "{}") as PhaseB;
    assert.equal(b.phase, "b");
    assert.notEqual(b.pid, process.pid, "phase B is another process");
    assert.equal(b.sessionId, session.id, "phase B reopened the same session");
    assert.equal(b.enabled, true, "the toggle survived the restart");
    assert.equal(b.observer, OBSERVER_MODEL, "the observer model is unchanged");
    assert.equal(b.observations >= 2, true, "the ledger still holds A's observations");
    assert.equal(b.wmItems, 0, "the WM trigger was never crossed");
    assert.equal(b.ledgerHasObservation, true, "the rendered ledger carries the observation");
    assert.equal(b.recallVisible, true, "the toggled session is offered recall");
    assert.equal(b.messageCount, messageCount, "phase B sees the same messages");

    const slots = await slotAssignment();
    await agent.dispose();
    return {
      phase: "a",
      mainRequests: models.filter((model) => model === "main").length,
      observerRequests: models.filter((model) => model === "observer").length,
      untouchedSessionEnabled: off.enabled,
      compactionStrategy: (compaction.data as { strategy?: string }).strategy,
      summaryHasObservation: true,
      sentinelSecretInLedgerOrEvents: false,
      slotConflict: slots.conflict,
      slotOwner: slots.owner,
      child: b,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Process B: a new agent over the same database, resuming the session A left behind. */
async function phaseB(dir: string, sessionId: string, leafId: string): Promise<PhaseB> {
  const recorder: Recorder = { requests: [] };
  const { agent } = await buildAgent(dir, recorder);
  const session = await agent.session({ id: sessionId, leafId });
  const status = await statusOf(agent, session);
  const view = (await agent.commands.run("memory:session:view", {}, { session })) as { text: string };
  const messageCount = (await session.messages()).length;

  // One more turn: the toggle survived, so `recall` is offered to the model for this session.
  await session.run("Continue the plan.");
  const mainRequest = recorder.requests.filter((request) => request.model.model === "main").at(-1);
  const recallVisible = (mainRequest?.tools ?? []).some((tool) => tool.name === "recall");

  await agent.dispose();
  return {
    phase: "b",
    pid: process.pid,
    sessionId: session.id,
    enabled: status.enabled,
    observer: String(status.stm),
    observations: status.observations.recorded,
    wmItems: status.wmItems.recorded,
    messageCount,
    ledgerHasObservation: view.text.includes("OBSERVED-FACT"),
    recallVisible,
  };
}

export async function demo(): Promise<Record<string, unknown>> {
  const args = process.argv.slice(2);
  const phase = args.find((arg) => arg.startsWith("--phase="))?.slice("--phase=".length) ?? "a";
  if (phase === "b") {
    const [dir, sessionId, leafId] = args.filter((arg) => !arg.startsWith("--phase="));
    if (!dir || !sessionId || !leafId) throw new Error("phase B needs a database directory, a session id, and a leaf id");
    return phaseB(dir, sessionId, leafId);
  }
  const script = process.argv[1];
  if (!script) throw new Error("phase A needs its own script path to spawn process B");
  return phaseA(script);
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
