import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { createSecretRedactor, type Guardrail, runGuardrailList } from "../index.js";

const context = { sessionId: "s1", runId: "r1", metadata: {} };
const call = { type: "tool_call" as const, id: "c1", name: "echo", arguments: { text: "hi" } };

describe("guardrail stage runner", () => {
  it("bounds concurrent evaluation and reports records in declaration order", async () => {
    let active = 0;
    let peak = 0;
    const guard = (name: string): Guardrail<"tool_input"> => ({
      name,
      stage: "tool_input",
      async evaluate() {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return { action: "allow" };
      },
    });
    const result = await runGuardrailList({
      stage: "tool_input",
      guards: [guard("first"), guard("second")],
      value: call,
      context,
      guardrailsMaxConcurrency: 2,
    });
    assert.equal(peak, 2);
    assert.deepEqual(
      result.records.map((record) => record.guardrail),
      ["first", "second"],
    );
  });

  it("emits one terminal decision when a parallel sibling is cancelled", async () => {
    const result = await runGuardrailList({
      stage: "tool_input",
      guardrailsMaxConcurrency: 2,
      guards: [
        { name: "stop", stage: "tool_input", evaluate: () => ({ action: "tripwire" }) },
        {
          name: "sibling",
          stage: "tool_input",
          evaluate: async ({ signal }) => {
            if (!signal.aborted) await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
            throw new Error("cancelled");
          },
        },
      ],
      value: call,
      context,
    });
    assert.equal(result.records.filter((record) => record.action !== "allow").length, 1);
  });

  it("fails closed for malformed decisions without exposing thrown details", async () => {
    const result = await runGuardrailList({
      stage: "tool_input",
      guards: [{ name: "bad", stage: "tool_input", evaluate: () => ({ action: "nope" }) as never }],
      value: call,
      context,
    });
    assert.equal(result.terminal?.action, "tripwire");
    assert.equal(result.terminal?.reason, "guardrail_invalid_decision");
  });

  it("guardrail_failed records carry a bounded, redacted cause", async () => {
    const huge = `boom token-123 ${"x".repeat(10_000)}`;
    const result = await runGuardrailList({
      stage: "tool_input",
      guards: [
        {
          name: "throws",
          stage: "tool_input",
          evaluate: () => {
            throw new Error(huge);
          },
        },
      ],
      value: call,
      context,
      redactor: createSecretRedactor(["token-123"]),
    });
    assert.equal(result.terminal?.action, "tripwire");
    assert.equal(result.terminal?.reason, "guardrail_failed");
    const cause = result.terminal?.metadata?.error;
    assert.equal(typeof cause, "string");
    assert.ok((cause as string).startsWith("boom [REDACTED]"));
    assert.ok(new TextEncoder().encode(cause as string).length <= 4096);
  });

  it("an empty guard list allocates no records", async () => {
    const result = await runGuardrailList({ stage: "tool_input", guards: [], value: call, context });
    assert.deepEqual(result.records, []);
    assert.equal(result.terminal, undefined);
  });
});
