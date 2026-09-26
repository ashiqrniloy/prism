/**
 * Host step-loop timeline correlation composition (plan 122 Task 5).
 *
 * A host that owns an eight-step plan maps each of its own business identities
 * (`stepId` / `actionId` / `attemptId`) onto the Prism `sessionId` / `runId` of the
 * `session.run()` that performed it, and persists a metadata-only `ExecutionTimeline`
 * per step into a newline-delimited JSON ledger file.
 *
 * The projection is incremental: one `createTimelineFolder` per step receives the live
 * events as they stream (`folder.push`), and a single `snapshot()` at run end yields that
 * step's frozen timeline — no re-folding of a stored event list.
 *
 * The host's legacy 480-character prose trace is carried beside the structural timeline
 * as display-only data (`legacyTrace480`). Nothing reads it back: budgets, turns and stop
 * reasons come from the typed projection, never from parsing prose.
 *
 * External commit/verification evidence is host authority, not a Prism effect, so it is
 * attached at the ledger envelopes's top level (`externalEvidence`, `inPrismEffects: false`)
 * and never injected as a fake timeline step.
 *
 * `content: "metadata"` is the default: kinds, names, statuses, timings, usage and error
 * codes only. Tool arguments never reach the timeline; the ledger records a host-computed
 * `sha256:` hash for correlation instead of the raw arguments.
 *
 * Correlation uses existing identities only: Prism events already carry `sessionId` and
 * `runId`, so no core correlation field was added. Host ids have no Prism-side identity and
 * live in the ledger envelope.
 *
 * Run: npm run build:core && node examples/host-step-loop-timeline.ts
 */
import { createHash } from "node:crypto";
import { appendFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AIProvider,
  createAgent,
  createToolRegistry,
  type JsonObject,
  type ProviderEvent,
  providerDone,
  providerTextDelta,
  providerToolCall,
  providerUsage,
  type ToolDefinition,
} from "@arnilo/prism";
import { createTimelineFolder } from "@arnilo/prism-core/governance/observability";

const STEP_COUNT = 8;
const LEGACY_TRACE_BYTES = 480;

const lookupTool: ToolDefinition = {
  name: "host_lookup",
  description: "Look up a host record for the current step",
  execute: async (args, context) => ({
    toolCallId: context.toolCallId,
    name: "host_lookup",
    value: { found: true, recordId: String(args.recordId ?? "unknown") },
  }),
};

function textTurn(step: number): ProviderEvent[] {
  return [providerTextDelta(`step ${step} complete`), providerUsage({ inputTokens: 10, outputTokens: 5, totalTokens: 15 }), providerDone()];
}

function toolTurn(step: number): ProviderEvent[] {
  return [
    providerToolCall({
      type: "tool_call",
      id: `call_step_${step}`,
      name: "host_lookup",
      arguments: { recordId: `rec-${step}`, amount: 1_250, apiKey: "sk-live-never-persist-this" },
    }),
    providerDone(),
  ];
}

function hashArguments(args: JsonObject): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(args)).digest("hex")}`;
}

function stepId(step: number): string {
  return `step-${String(step).padStart(2, "0")}`;
}

/** Host-side prose trace in the legacy shape: truncated, lossy, display-only. */
function legacyTrace(step: number): string {
  const prose = `host decision trace for ${stepId(step)}: ${"the host selected the next action and executed it; ".repeat(24)}`;
  return prose.slice(0, LEGACY_TRACE_BYTES);
}

export async function demo(): Promise<Record<string, unknown>> {
  const ledgerDir = mkdtempSync(join(tmpdir(), "prism-host-step-loop-"));
  const ledgerPath = join(ledgerDir, "host-ledger.ndjson");

  const turns: ProviderEvent[][] = [];
  const provider: AIProvider = {
    id: "mock",
    async *generate(): AsyncIterable<ProviderEvent> {
      const events = turns.shift() ?? [providerTextDelta("fallback"), providerDone()];
      for (const event of events) yield event;
    },
  };

  const agent = createAgent({
    id: "host-step-loop-agent",
    model: { provider: "mock", model: "demo" },
    provider,
    tools: createToolRegistry([lookupTool]),
  });
  const session = agent.createSession({ id: "host-step-loop-session" });

  const records: Record<string, unknown>[] = [];
  const stepSummaries: Record<string, unknown>[] = [];

  for (let step = 1; step <= STEP_COUNT; step += 1) {
    const usesTool = step === 4;
    turns.length = 0;
    turns.push(...(usesTool ? [toolTurn(step), textTurn(step)] : [textTurn(step)]));

    const folder = createTimelineFolder({ content: "metadata" });
    const toolCalls: { readonly id: string; readonly name: string; readonly argHash: string }[] = [];
    let eventsPushed = 0;

    // Subscribe *before* starting the run so the folder receives `agent_started` too — the
    // subscriber is registered synchronously, while `session.run` emits its first event before
    // returning. Consume concurrently and drain after the run closes the subscriber.
    const subscription = session.subscribe();
    const consume = (async () => {
      for await (const event of subscription) {
        eventsPushed += 1;
        folder.push(event);
        if (event.type === "tool_execution_started") {
          toolCalls.push({ id: event.call.id, name: event.call.name, argHash: hashArguments(event.call.arguments) });
        }
      }
    })();
    const result = await session.run(`Execute ${stepId(step)}`);
    await consume;

    const timeline = folder.snapshot();
    const host = {
      planId: "host-plan-157-demo",
      step,
      stepId: stepId(step),
      actionId: `act-${stepId(step)}`,
      attemptId: `att-${stepId(step)}-1`,
    };
    const legacyTrace480 = legacyTrace(step);
    const record: Record<string, unknown> = {
      ledgerVersion: 1,
      recordedAt: new Date().toISOString(),
      host,
      prism: { sessionId: session.id, runId: result.runId, status: result.status },
      projection: { mode: "incremental_folder", content: timeline.content, eventsPushed },
      timeline,
      toolCalls,
      legacyTrace480,
      ...(step === STEP_COUNT
        ? {
            externalEvidence: {
              authority: "host",
              kind: "commit_and_verification",
              commitId: `commit_${stepId(step)}`,
              verification: { status: "verified", method: "host-ledger-audit", verifiedAt: new Date().toISOString() },
              inPrismEffects: false,
            },
          }
        : {}),
    };
    records.push(record);
    appendFileSync(ledgerPath, `${JSON.stringify(record)}\n`);

    stepSummaries.push({
      step,
      stepId: host.stepId,
      actionId: host.actionId,
      attemptId: host.attemptId,
      runId: result.runId,
      sessionId: session.id,
      status: result.status,
      turnCount: timeline.turns?.length ?? 0,
      stopReasons: timeline.turns?.map((turn) => turn.stopReason),
      budgetRunInputUsed: timeline.turns?.map((turn) => turn.budgets?.runInputUsed),
      toolSteps: timeline.steps.filter((entry) => entry.kind === "tool").length,
      legacyTraceChars: legacyTrace480.length,
    });
  }

  const ledgerLines = readFileSync(ledgerPath, "utf8").trim().split("\n").length;
  return {
    ledgerPath,
    ledgerLines,
    stepCount: STEP_COUNT,
    projectionMode: "incremental_folder",
    contentPolicy: "metadata",
    prosePolicy: "legacyTrace480 is display-only; structural fields are the source of truth",
    correlation: "host ids in ledger envelope; prism sessionId/runId come from the events themselves",
    externalEvidenceStep: STEP_COUNT,
    steps: stepSummaries,
    recordCount: records.length,
  };
}

export async function main(): Promise<void> {
  const result = await demo();
  console.log(JSON.stringify(result));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
