// Focused behavior coverage for the kernel guardrail stage runner (`src/guardrails.ts`), which had no
// direct root test: plan 159 Task 5 moved the pack compile path and the pack definitions to
// `@arnilo/prism-extensions/guardrail-packs`, but this runner stays in the kernel and a package calls it through
// `@arnilo/prism` so its `guardrail.decision` events are attributed to that package. Each test asserts
// an observable outcome (a record, a thrown code, an emitted decision, an abort) rather than internals.

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import type { AgentEvent, Guardrail, GuardrailRecord, JsonObject, ToolCallContent } from "../contracts.js";
import {
  assertGuardrailsAllowed,
  GuardrailError,
  guardrailRefusalText,
  MAX_GUARDRAIL_CONCURRENCY,
  runGuardrailList,
} from "../guardrails.js";
import { createSecretRedactor } from "../redaction.js";
import { kernelEvents } from "./kernel-event-helpers.js";

type Stage = "tool_input";

const call: ToolCallContent = { type: "tool_call", id: "call-1", name: "search", arguments: { q: "x" } };
const context = { sessionId: "s1", runId: "r1", toolCallId: "call-1", toolName: "search", metadata: {} };

function guard(name: string, evaluate: Guardrail<Stage>["evaluate"] = () => ({ action: "allow" })): Guardrail<Stage> {
  return { name, stage: "tool_input", evaluate };
}

function decide(name: string, decision: unknown): Guardrail<Stage> {
  return guard(name, (() => decision) as Guardrail<Stage>["evaluate"]);
}

function run(options: {
  guards: readonly Guardrail<Stage>[];
  emit?: (event: AgentEvent) => void;
  guardrailsMaxConcurrency?: number;
  package?: string;
  signal?: AbortSignal;
  context?: typeof context;
}) {
  return runGuardrailList({
    stage: "tool_input",
    guards: options.guards,
    value: call,
    context: { ...(options.context ?? context), ...(options.signal === undefined ? {} : { signal: options.signal }) },
    ...(options.emit === undefined ? {} : { emit: options.emit }),
    ...(options.guardrailsMaxConcurrency === undefined ? {} : { guardrailsMaxConcurrency: options.guardrailsMaxConcurrency }),
    ...(options.package === undefined ? {} : { package: options.package }),
  });
}

describe("guardrail stage runner", () => {
  it("allows when every guard allows and emits one decision per record", async () => {
    const events: AgentEvent[] = [];
    const result = await run({ guards: [guard("a"), guard("b")], emit: (event) => events.push(event) });

    assert.deepEqual(
      result.records.map((record) => record.guardrail),
      ["a", "b"],
    );
    assert.equal(result.terminal, undefined);

    const decisions = kernelEvents<{ record: GuardrailRecord }>(events, "guardrail.decision");
    assert.equal(decisions.length, 2);
    const first = decisions[0];
    assert.ok(first);
    assert.equal(first.record.action, "allow");
    assert.equal(first.record.stage, "tool_input");
    assert.equal(first.sessionId, "s1");
    assert.equal(first.runId, "r1");
    assert.deepEqual(first.record.metadata, undefined);
    // The envelope's package label is the runner's attribution seam: kernel by default, the
    // calling package when the host passes one.
    const envelope = events.find((event) => event.type === "package.event");
    assert.ok(envelope && envelope.type === "package.event");
    assert.equal(envelope.package, "kernel");
  });

  it("attributes decisions to the calling package and carries the tool ids when the context has them", async () => {
    const events: AgentEvent[] = [];
    await run({ guards: [guard("a")], emit: (event) => events.push(event), package: "@arnilo/prism-extensions/governance" });

    const envelope = events[0];
    assert.ok(envelope && envelope.type === "package.event");
    assert.equal(envelope.package, "@arnilo/prism-extensions/governance");
    const data = envelope.data as unknown as { toolCallId?: string; toolName?: string; record: GuardrailRecord };
    assert.equal(data.toolCallId, "call-1");
    assert.equal(data.toolName, "search");
    assert.equal(data.record.guardrail, "a");
    assert.equal(data.record.action, "allow");
  });

  it("omits the tool ids when the stage carries no tool context", async () => {
    const events: AgentEvent[] = [];
    await runGuardrailList({
      stage: "tool_input",
      guards: [guard("a")],
      value: call,
      context: { sessionId: "s1", runId: "r1", metadata: {} },
      emit: (event) => {
        events.push(event);
      },
    });

    const envelope = events[0];
    assert.ok(envelope && envelope.type === "package.event");
    assert.deepEqual(Object.keys(envelope.data as JsonObject).sort(), ["record"]);
  });

  it("returns no records for an empty list and never evaluates anything", async () => {
    const events: AgentEvent[] = [];
    const result = await run({ guards: [], emit: (event) => events.push(event) });
    assert.deepEqual(result.records, []);
    assert.equal(result.terminal, undefined);
    assert.equal(events.length, 0);
  });

  it("stops the run at a terminal decision, drops the sibling still settling, and aborts the shared signal", async () => {
    let observedAbort: unknown = null;
    const events: AgentEvent[] = [];
    const slow = guard("slow", async ({ signal }) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      observedAbort = signal.aborted ? signal.reason : false;
      return { action: "allow" };
    });
    const result = await run({
      guards: [decide("block", { action: "block", reason: "not allowed" }), slow],
      guardrailsMaxConcurrency: 2,
      emit: (event) => events.push(event),
    });

    assert.deepEqual(
      result.records.map((record) => record.guardrail),
      ["block"],
      "the sibling that settled after the terminal decision must not be recorded",
    );
    const terminal = result.terminal;
    assert.ok(terminal);
    assert.equal(terminal.action, "block");
    assert.equal(terminal.reason, "not allowed");
    assert.ok(observedAbort instanceof GuardrailError, "a terminal decision must abort the shared signal with the GuardrailError");
    assert.equal(observedAbort.record.guardrail, "block");
    assert.equal(kernelEvents(events, "guardrail.decision").length, 1);
  });

  it("keeps a host abort signal observable to the guards", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await run({
      guards: [
        guard("aborted", ({ signal }) => {
          // The runner combines the host signal with its own stop controller, so a guard that
          // resolves after a host abort still sees the abort on the signal it was handed.
          if (!signal.aborted) return { action: "allow" };
          throw new Error("aborted before the first evaluation");
        }),
      ],
      signal: controller.signal,
    });

    const record = result.records[0];
    assert.ok(record);
    assert.equal(record.action, "tripwire");
    assert.deepEqual(record.metadata, { error: "aborted before the first evaluation" });
  });

  it("runs guards concurrently up to the configured cap and sequentially by default", async () => {
    let running = 0;
    let peak = 0;
    const probe = (name: string): Guardrail<Stage> =>
      guard(name, async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
        return { action: "allow" };
      });

    await run({ guards: [probe("a"), probe("b"), probe("c")], guardrailsMaxConcurrency: 3 });
    assert.equal(peak, 3, "a host-set cap must allow that many guards at once");

    peak = 0;
    await run({ guards: [probe("a"), probe("b"), probe("c")] });
    assert.equal(peak, 1, "the default is one guard at a time");
  });

  it("rejects an out-of-range concurrency cap and accepts the documented bounds", async () => {
    assert.equal(MAX_GUARDRAIL_CONCURRENCY, 16);
    for (const value of [0, 17, 1.5, Number.NaN]) {
      await assert.rejects(run({ guards: [guard("a")], guardrailsMaxConcurrency: value }), /must be a safe integer from 1 to 16/);
    }
    for (const value of [1, MAX_GUARDRAIL_CONCURRENCY]) {
      const result = await run({ guards: [guard("a")], guardrailsMaxConcurrency: value });
      assert.equal(result.records.length, 1);
    }
  });

  it("records a tripwire for a malformed guardrail instead of throwing", async () => {
    // A falsy guard is skipped by the runner's own index loop, so only a guard that exists but
    // fails validation reaches `evaluate`'s tripwire.
    const cases: Array<[string, Guardrail<Stage>, string]> = [
      ["empty name", { name: "", stage: "tool_input", evaluate: () => ({ action: "allow" }) }, "invalid"],
      // A 129-byte name is not a name, but the record still carries a bounded identity.
      ["long name", { name: "n".repeat(129), stage: "tool_input", evaluate: () => ({ action: "allow" }) }, "n".repeat(128)],
      ["wrong stage", { name: "g", stage: "tool_output", evaluate: () => ({ action: "allow" }) } as unknown as Guardrail<Stage>, "g"],
      ["no evaluate", { name: "g", stage: "tool_input" } as unknown as Guardrail<Stage>, "g"],
    ];
    for (const [label, malformed, expectedName] of cases) {
      const result = await run({ guards: [malformed] });
      const record = result.records[0];
      assert.ok(record, `${label} must still produce a record`);
      assert.equal(record.action, "tripwire", label);
      assert.equal(record.reason, "guardrail_invalid", label);
      assert.equal(record.guardrail, expectedName, label);
    }
  });

  it("records one terminal decision when a parallel sibling is cancelled by it", async () => {
    const result = await run({
      guards: [
        decide("stop", { action: "tripwire" }),
        guard("sibling", async ({ signal }) => {
          if (!signal.aborted) await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
          throw new Error("cancelled");
        }),
      ],
      guardrailsMaxConcurrency: 2,
    });

    // The cancelled sibling's `guardrail_failed` tripwire must not join the run: the first terminal
    // decision is the run's outcome, so the caller sees exactly one.
    assert.equal(result.records.filter((record) => record.action !== "allow").length, 1);
    assert.equal(result.terminal?.guardrail, "stop");
  });

  it("never starts the guards behind a terminal decision", async () => {
    const evaluated: string[] = [];
    const result = await run({
      guards: [
        decide("block", { action: "block" }),
        guard("second", () => {
          evaluated.push("second");
          return { action: "allow" };
        }),
      ],
    });

    assert.deepEqual(evaluated, []);
    assert.equal(result.records.length, 1);
  });
  it("records a tripwire for a decision that names no known action", async () => {
    for (const decision of [{ action: "maybe" }, null, "allow"]) {
      const result = await run({ guards: [decide("g", decision)] });
      const record = result.records[0];
      assert.ok(record);
      assert.equal(record.action, "tripwire");
      assert.equal(record.reason, "guardrail_invalid_decision");
    }
  });

  it("records a bounded, redacted tripwire when a guardrail throws", async () => {
    const redactor = createSecretRedactor(["sekret"]);
    const thrown = await runGuardrailList({
      stage: "tool_input",
      guards: [
        guard("throws", () => {
          throw new Error("boom sekret");
        }),
      ],
      value: call,
      context: { ...context },
      redactor,
    });
    // A hostile or verbose thrown message is bounded by the same byte cap as a rule reason.
    const verbose = await runGuardrailList({
      stage: "tool_input",
      guards: [
        guard("verbose", () => {
          throw new Error(`boom sekret ${"x".repeat(10_000)}`);
        }),
      ],
      value: call,
      context: { ...context },
      redactor,
    });
    const nonError = await runGuardrailList({
      stage: "tool_input",
      guards: [
        guard("throws-non-error", () => {
          throw "plain sekret";
        }),
      ],
      value: call,
      context: { ...context },
      redactor,
    });

    const failure = thrown.records[0];
    const other = nonError.records[0];
    const cause = verbose.records[0];
    assert.ok(failure && other && cause);
    assert.equal(failure.action, "tripwire");
    assert.equal(failure.reason, "guardrail_failed");
    assert.deepEqual(failure.metadata, { error: "boom [REDACTED]" });
    assert.deepEqual(other.metadata, { error: "plain [REDACTED]" });
    assert.equal(typeof cause.metadata?.error, "string");
    assert.ok(String(cause.metadata?.error).startsWith("boom [REDACTED]"));
    assert.ok(new TextEncoder().encode(String(cause.metadata?.error)).length <= 4096);
  });

  it("bounds reasons, drops non-object metadata, and flags oversized, invalid, and redacted metadata", async () => {
    const redactor = createSecretRedactor(["sekret"]);
    const unserializable = { big: 1n } as unknown as Record<string, unknown>;
    const result = await runGuardrailList({
      stage: "tool_input",
      guards: [
        decide("array-metadata", { action: "allow", metadata: [] }),
        decide("scalar-metadata", { action: "allow", metadata: "nope" }),
        decide("oversized-metadata", { action: "allow", metadata: { blob: "x".repeat(17 * 1024) } }),
        decide("invalid-metadata", { action: "allow", metadata: unserializable }),
        decide("secret-metadata", { action: "allow", metadata: { token: "sekret", nested: { key: "sekret" } } }),
        // Last: a terminal decision stops the run, so every non-terminal guard stays ahead of it.
        decide("long-reason", { action: "block", reason: "r".repeat(5000) }),
      ],
      value: call,
      context: { ...context },
      redactor,
    });

    const [arrayMetadata, scalarMetadata, oversized, invalid, secret, longReason] = result.records;
    assert.ok(arrayMetadata && scalarMetadata && oversized && invalid && secret && longReason);
    assert.equal(longReason.reason?.length, 4096, "a reason is bounded to 4096 bytes");
    assert.equal(arrayMetadata.metadata, undefined);
    assert.equal(scalarMetadata.metadata, undefined);
    assert.deepEqual(oversized.metadata, { truncated: true });
    assert.deepEqual(invalid.metadata, { invalid: true });
    assert.deepEqual(secret.metadata, { token: "[REDACTED]", nested: { key: "[REDACTED]" } });
  });

  it("throws through assertGuardrailsAllowed only for a terminal record", async () => {
    const allowed = await run({ guards: [guard("a")] });
    assertGuardrailsAllowed(allowed);

    const blocked = await run({ guards: [decide("block", { action: "block", reason: "no" })] });
    assert.throws(
      () => assertGuardrailsAllowed(blocked),
      (error: unknown) => {
        assert.ok(error instanceof GuardrailError);
        assert.equal(error.code, "ERR_PRISM_GUARDRAIL_BLOCKED");
        assert.equal(error.message, "Guardrail blocked run");
        assert.equal(error.record.reason, "no");
        return true;
      },
    );
  });

  it("names the unavailable interrupt stage in the GuardrailError", () => {
    const error = new GuardrailError({ guardrail: "pack:p/r", stage: "tool_input", action: "interrupt" });
    assert.equal(error.code, "ERR_PRISM_GUARDRAIL_INTERRUPT_UNAVAILABLE");
    assert.match(error.message, /Guardrail interruption is unavailable at stage "tool_input"/);
    assert.equal(error.name, "GuardrailError");
  });
});

describe("guardrail refusal text", () => {
  const record = (metadata: GuardrailRecord["metadata"], reason?: string): GuardrailRecord => ({
    guardrail: "pack:policy/cost",
    stage: "tool_input",
    action: "block",
    ...(reason === undefined ? {} : { reason }),
    ...(metadata === undefined ? {} : { metadata }),
  });

  it("reads the compiler's pack identity and skips its synthesized reason", () => {
    assert.equal(guardrailRefusalText(record({ pack: "policy", rule: "cost" })), "Blocked by guardrail rule pack:policy/cost");
    assert.equal(
      guardrailRefusalText(record({ pack: "policy", rule: "cost" }, "guardrail pack rule policy/cost")),
      "Blocked by guardrail rule pack:policy/cost",
    );
  });

  it("appends a real reason and honors a caller prefix", () => {
    assert.equal(
      guardrailRefusalText(record({ pack: "policy", rule: "cost" }, "amount above the cap"), "Denied"),
      "Denied by guardrail rule pack:policy/cost: amount above the cap",
    );
  });

  it("returns undefined for anything that is not a compiled pack rule", () => {
    assert.equal(guardrailRefusalText({ guardrail: "pack:policy/cost", stage: "tool_input", action: "block" }), undefined);
    assert.equal(guardrailRefusalText(record({ pack: "policy" })), undefined);
    assert.equal(guardrailRefusalText(record({ pack: 1, rule: "cost" })), undefined);
  });

  it("bounds the refusal line so no rule text can grow a model or host message", () => {
    const line = guardrailRefusalText(record({ pack: "policy", rule: "cost" }, "r".repeat(500)));
    assert.ok(line);
    assert.equal(new TextEncoder().encode(line).length, 200);
  });
});
