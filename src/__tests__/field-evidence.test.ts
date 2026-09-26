import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  type AgentEvent,
  type AIProvider,
  createAgent,
  createFieldEvidenceGuardrail,
  createToolRegistry,
  type FieldEvidenceGuardrailOptions,
  type FieldEvidenceRecord,
  type JsonObject,
  type JsonValue,
  providerDone,
  providerTextDelta,
  providerToolCall,
  runGuardrails,
  type ToolDefinition,
} from "../index.js";

const PROPOSAL = "synapta:proposal";
const INVOICE = "tool:invoice_fetch";

function claim(
  value: JsonValue,
  overrides: { readonly source?: string; readonly path?: string; readonly revision?: string | number } = {},
): JsonObject {
  return {
    value,
    source: overrides.source ?? INVOICE,
    path: overrides.path ?? "invoice.total",
    ...(overrides.revision === undefined ? {} : { revision: overrides.revision }),
  };
}

function evidence(records: readonly FieldEvidenceRecord[]): FieldEvidenceGuardrailOptions["evidence"] {
  return () => records;
}

async function evaluate(
  guard: ReturnType<typeof createFieldEvidenceGuardrail>,
  args: JsonObject,
  toolName = PROPOSAL,
): Promise<{ readonly action: string; readonly reason?: string; readonly metadata?: Readonly<Record<string, unknown>> }> {
  const result = await runGuardrails({
    stage: "tool_input",
    guardrails: { toolInput: [guard] },
    value: { type: "tool_call", id: "call_1", name: toolName, arguments: args },
    context: { sessionId: "session", runId: "run", toolName, metadata: {} },
  });
  return result.terminal ?? { action: "allow" };
}

describe("field evidence guardrail", () => {
  it("typed authorized evidence accepted", async () => {
    const guard = createFieldEvidenceGuardrail({
      toolName: PROPOSAL,
      required: ["amount"],
      evidence: evidence([{ source: INVOICE, path: "invoice.total", value: 1250, revision: 7 }]),
    });
    const terminal = await evaluate(guard, { amount: claim(1250, { revision: 7 }) });
    assert.equal(terminal.action, "allow");
  });

  it("uses the host normalizer for unit/currency-aware comparison", async () => {
    const seen: string[] = [];
    const guard = createFieldEvidenceGuardrail({
      toolName: PROPOSAL,
      required: ["amount"],
      evidence: evidence([{ source: INVOICE, path: "invoice.total", value: 1250, revision: 7 }]),
      normalize: (value, field) => {
        seen.push(field);
        return typeof value === "string" ? Number(value.replace(/[$,]/g, "")) : value;
      },
    });
    const terminal = await evaluate(guard, { amount: claim("$1,250.00", { revision: 7 }) });
    assert.equal(terminal.action, "allow");
    assert.deepEqual(seen, ["amount", "amount"]);
  });

  it("invented value rejected", async () => {
    const guard = createFieldEvidenceGuardrail({
      toolName: PROPOSAL,
      required: ["amount"],
      evidence: evidence([{ source: INVOICE, path: "invoice.currency", value: "USD", revision: 7 }]),
    });
    const terminal = await evaluate(guard, { amount: claim(1250, { revision: 7 }) });
    assert.equal(terminal.action, "block");
    assert.equal(terminal.reason, "field_evidence");
    assert.deepEqual(terminal.metadata, { field: "amount", violation: "unknown_source" });
  });

  it("correct value wrong object rejected", async () => {
    const guard = createFieldEvidenceGuardrail({
      toolName: PROPOSAL,
      required: ["amount"],
      evidence: evidence([{ source: "tool:other_invoice", path: "invoice.total", value: 1250, revision: 7 }]),
    });
    const terminal = await evaluate(guard, { amount: claim(1250, { revision: 7 }) });
    assert.equal(terminal.action, "block");
    assert.deepEqual(terminal.metadata, { field: "amount", violation: "unknown_source" });
  });

  it("stale revision rejected", async () => {
    const guard = createFieldEvidenceGuardrail({
      toolName: PROPOSAL,
      required: ["amount"],
      evidence: evidence([{ source: INVOICE, path: "invoice.total", value: 1250, revision: 8 }]),
    });
    const terminal = await evaluate(guard, { amount: claim(1250, { revision: 7 }) });
    assert.equal(terminal.action, "block");
    assert.deepEqual(terminal.metadata, { field: "amount", violation: "stale_revision" });
  });

  it("fail-closed on missing host evidence", async () => {
    const guard = createFieldEvidenceGuardrail({ toolName: PROPOSAL, required: ["amount"], evidence: evidence([]) });
    const terminal = await evaluate(guard, { amount: claim(1250, { revision: 7 }) });
    assert.equal(terminal.action, "block");
    assert.deepEqual(terminal.metadata, { field: "amount", violation: "missing_evidence" });
  });

  it("missing, malformed, and mismatched claims are typed violations", async () => {
    const guard = createFieldEvidenceGuardrail({
      toolName: PROPOSAL,
      required: ["amount", "vendor.id"],
      evidence: evidence([{ source: INVOICE, path: "invoice.total", value: 1250, revision: 7 }]),
    });
    assert.deepEqual((await evaluate(guard, {})).metadata, { field: "amount", violation: "missing_field" });
    assert.deepEqual((await evaluate(guard, { amount: 1250 })).metadata, { field: "amount", violation: "malformed_claim" });
    assert.deepEqual((await evaluate(guard, { amount: claim(1250, { revision: 7 }), vendor: { id: "v-1" } })).metadata, {
      field: "vendor.id",
      violation: "malformed_claim",
    });
    assert.deepEqual((await evaluate(guard, { amount: claim(1251, { revision: 7 }) })).metadata, {
      field: "amount",
      violation: "value_mismatch",
    });
  });

  it("no authority granted", async () => {
    const guard = createFieldEvidenceGuardrail({
      toolName: PROPOSAL,
      required: ["amount"],
      evidence: evidence([{ source: INVOICE, path: "invoice.total", value: 1250, revision: 7 }]),
    });
    const terminal = await evaluate(guard, { amount: claim(999, { revision: 7 }) });
    assert.equal(terminal.action, "block");
    assert.equal(terminal.reason, "field_evidence");
    assert.deepEqual(terminal.metadata, { field: "amount", violation: "value_mismatch" });
    assert.doesNotMatch(JSON.stringify(terminal), /commit|approve|grant|authoriz/i);
    // The guardrail only selects its configured tool; other tool calls pass untouched.
    const other = await evaluate(guard, { amount: 1 }, "other:tool");
    assert.equal(other.action, "allow");
  });

  it("fails closed when the evidence set exceeds the bound", async () => {
    const records = Array.from({ length: 4097 }, (_, index) => ({ source: INVOICE, path: `p${index}`, value: index, revision: 1 }));
    const guard = createFieldEvidenceGuardrail({ toolName: PROPOSAL, required: ["amount"], evidence: evidence(records) });
    const terminal = await evaluate(guard, { amount: claim(0, { path: "p0", revision: 1 }) });
    assert.equal(terminal.action, "block");
    assert.deepEqual(terminal.metadata, { violation: "evidence_over_limit" });
  });

  it("rejects malformed options at construction", () => {
    assert.throws(() => createFieldEvidenceGuardrail({ toolName: "", required: ["a"], evidence: evidence([]) }), /toolName/);
    assert.throws(() => createFieldEvidenceGuardrail({ toolName: PROPOSAL, required: [], evidence: evidence([]) }), /required/);
    assert.throws(
      () => createFieldEvidenceGuardrail({ toolName: PROPOSAL, required: ["a"], evidence: undefined as never }),
      /evidence source/,
    );
  });

  it("blocks the tool call before dispatch through the session seam", async () => {
    let executions = 0;
    const proposal: ToolDefinition = {
      name: PROPOSAL,
      description: "Host proposal tool",
      execute: async (_args, context) => {
        executions += 1;
        return { toolCallId: context.toolCallId, name: PROPOSAL, value: { committed: true } };
      },
    };
    let turns = 0;
    const provider: AIProvider = {
      id: "mock",
      async *generate() {
        if (turns++ === 0) {
          yield providerToolCall({
            type: "tool_call",
            id: "call_1",
            name: PROPOSAL,
            arguments: { amount: claim(999, { revision: 7 }) },
          });
          yield providerDone();
          return;
        }
        yield providerTextDelta("proposal not sent: evidence mismatch");
        yield providerDone();
      },
    };
    const guardrail = createFieldEvidenceGuardrail({
      toolName: PROPOSAL,
      required: ["amount"],
      evidence: evidence([{ source: INVOICE, path: "invoice.total", value: 1250, revision: 7 }]),
    });
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider,
      tools: createToolRegistry([proposal]),
      guardrails: { toolInput: [guardrail] },
    });
    const session = agent.createSession();
    const events: AgentEvent[] = [];
    const subscription = session.subscribe();
    const consume = (async () => {
      for await (const event of subscription) events.push(event);
    })();
    const result = await session.run("propose the total");
    await consume;

    assert.equal(result.status, "succeeded");
    assert.equal(executions, 0, "a rejected provenance claim must never reach the tool");
    const decision = events.find((event) => event.type === "guardrail_decision");
    assert.ok(decision && decision.type === "guardrail_decision");
    assert.equal(decision.record.action, "block");
    assert.deepEqual(decision.record.metadata, { field: "amount", violation: "value_mismatch" });
  });
});
