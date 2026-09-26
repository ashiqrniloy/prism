import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "bun:test";

/** Plan 122 Task 5: the example is the host step-loop composition. This test runs it, reads the
 *  NDJSON ledger it wrote, and asserts correlation, no-loss trace, metadata-only persistence, and
 *  the separation of external host evidence from Prism effects. */
interface LedgerRecord {
  readonly ledgerVersion: number;
  readonly host: {
    readonly planId: string;
    readonly step: number;
    readonly stepId: string;
    readonly actionId: string;
    readonly attemptId: string;
  };
  readonly prism: { readonly sessionId: string; readonly runId: string; readonly status: string };
  readonly projection: { readonly mode: string; readonly content: string; readonly eventsPushed: number };
  readonly timeline: {
    readonly content: string;
    readonly runId: string;
    readonly sessionId?: string;
    readonly status: string;
    readonly turns?: readonly {
      readonly stopReason?: string;
      readonly budgets?: { readonly runInputUsed: number };
    }[];
    readonly steps: readonly { readonly kind: string; readonly name: string; readonly input?: unknown }[];
  };
  readonly toolCalls: readonly { readonly id: string; readonly name: string; readonly argHash: string }[];
  readonly legacyTrace480: string;
  readonly externalEvidence?: {
    readonly authority: string;
    readonly kind: string;
    readonly commitId: string;
    readonly inPrismEffects: boolean;
  };
}

function runExample(): { readonly payload: Record<string, unknown>; readonly ledger: LedgerRecord[] } {
  const result = spawnSync(process.execPath, ["examples/host-step-loop-timeline.ts"], {
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(result.status, 0, `host-step-loop-timeline.ts exited ${result.status}\n${result.stderr}`);
  const lastLine = result.stdout.trim().split("\n").at(-1);
  assert.ok(lastLine);
  const payload = JSON.parse(lastLine) as Record<string, unknown>;
  assert.equal(typeof payload.ledgerPath, "string");
  const ledger = readFileSync(payload.ledgerPath as string, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as LedgerRecord);
  return { payload, ledger };
}

test("eight steps all present with budgets and stop reasons", () => {
  const { payload, ledger } = runExample();
  assert.equal(ledger.length, 8);
  assert.equal(payload.ledgerLines, 8);
  const runIds = new Set<string>();
  for (const [index, record] of ledger.entries()) {
    assert.equal(record.host.step, index + 1);
    assert.equal(record.host.stepId, `step-${String(index + 1).padStart(2, "0")}`);
    assert.equal(record.prism.sessionId, "host-step-loop-session");
    assert.equal(record.prism.status, "succeeded");
    assert.equal(record.timeline.runId, record.prism.runId);
    assert.equal(record.timeline.sessionId, record.prism.sessionId);
    runIds.add(record.prism.runId);
    assert.ok((record.timeline.turns?.length ?? 0) >= 1, `step ${record.host.step} lost its turns`);
    for (const turn of record.timeline.turns ?? []) {
      assert.equal(typeof turn.stopReason, "string");
      assert.equal(typeof turn.budgets?.runInputUsed, "number");
    }
    assert.ok(record.timeline.steps.some((step) => step.kind === "turn"));
    assert.ok(record.timeline.steps.some((step) => step.kind === "provider"));
  }
  assert.equal(runIds.size, 8, "each step must correlate to its own Prism run id");
  // One step exercises a tool round: two turns, tool-call then end-turn.
  assert.deepEqual(
    ledger[3]?.timeline.turns?.map((turn) => turn.stopReason),
    ["tool_calls", "end_turn"],
  );
  assert.equal(ledger[3]?.timeline.steps.filter((step) => step.kind === "tool").length, 1);
});

test("metadata-only policy leaks no tool args", () => {
  const { ledger } = runExample();
  for (const record of ledger) {
    assert.equal(record.timeline.content, "metadata");
    const projected = JSON.stringify(record.timeline);
    assert.ok(!projected.includes("sk-live-never-persist-this"), "raw tool argument reached the timeline");
    assert.ok(!projected.includes("sha256:"), "the timeline itself carries no argument hashes");
    for (const step of record.timeline.steps) {
      if (step.kind === "tool") assert.equal("input" in step, false, "metadata policy must omit tool input");
    }
  }
  const toolRecord = ledger[3];
  assert.deepEqual(
    toolRecord?.toolCalls.map((call) => call.name),
    ["host_lookup"],
  );
  assert.match(toolRecord?.toolCalls[0]?.argHash ?? "", /^sha256:[0-9a-f]{64}$/);
  assert.ok(!toolRecord?.toolCalls[0]?.argHash.includes("amount"));
});

test("external commit evidence distinct from prism effects", () => {
  const { ledger } = runExample();
  assert.equal(
    ledger.slice(0, 7).every((record) => record.externalEvidence === undefined),
    true,
  );
  const external = ledger[7]?.externalEvidence;
  assert.ok(external);
  assert.equal(external.authority, "host");
  assert.equal(external.kind, "commit_and_verification");
  assert.equal(external.commitId, "commit_step-08");
  assert.equal(external.inPrismEffects, false);
  const projected = JSON.stringify(ledger[7]?.timeline);
  assert.ok(!projected.includes("commit_step-08"), "external evidence must not masquerade as a timeline step");
  assert.ok(!projected.includes("externalEvidence"));
});

test("host ids correlate with prism ids and prose is display-only", () => {
  const { payload, ledger } = runExample();
  assert.match(String(payload.correlation), /ledger envelope/);
  assert.match(String(payload.prosePolicy), /display-only/);
  for (const record of ledger) {
    assert.equal(record.host.actionId, `act-${record.host.stepId}`);
    assert.equal(record.host.attemptId, `att-${record.host.stepId}-1`);
    assert.equal(record.legacyTrace480.length, 480);
    assert.equal(record.projection.mode, "incremental_folder");
    assert.equal(record.projection.content, "metadata");
    assert.ok(record.projection.eventsPushed > 0);
  }
});
