import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import type { AgentEvent, EventOrigin } from "@arnilo/prism";
import { createInMemoryTelemetry, createOpenTelemetryInstrumentation } from "../instrumentation.js";
import { ORIGIN_ATTRIBUTES } from "../origin.js";

const origin = (extra: Partial<EventOrigin> = {}): EventOrigin => ({
  kind: "external",
  agent: "ui-engineer",
  agentId: "a1",
  vendor: "claude-code",
  profile: "work-max",
  delegationId: "d1",
  subagentId: "sub1",
  depth: 1,
  executedBy: "external",
  ...extra,
});

function run(extra: Partial<EventOrigin> | undefined, fieldPolicy?: Parameters<typeof createOpenTelemetryInstrumentation>[0]) {
  const memory = createInMemoryTelemetry();
  const instrumentation = createOpenTelemetryInstrumentation({ tracer: memory.tracer, meter: memory.meter, ...fieldPolicy });
  const o = extra === undefined ? undefined : origin(extra);
  instrumentation.handleAgentEvent({ type: "run.started", sessionId: "s", runId: "r", origin: o } as AgentEvent);
  instrumentation.handleAgentEvent({
    type: "tool.started",
    sessionId: "s",
    runId: "r",
    call: { id: "t1", name: "read", arguments: {} },
    origin: o,
  } as AgentEvent);
  return memory;
}

describe("origin span attributes", () => {
  it("spans_carry_origin_attributes", () => {
    const memory = run({});
    assert.equal(memory.spans.length, 2);
    for (const span of memory.spans) {
      assert.equal(span.attributes[ORIGIN_ATTRIBUTES.agent], "ui-engineer");
      assert.equal(span.attributes[ORIGIN_ATTRIBUTES.vendor], "claude-code");
      assert.equal(span.attributes[ORIGIN_ATTRIBUTES.profile], "work-max");
      assert.equal(span.attributes[ORIGIN_ATTRIBUTES.executedBy], "external");
      assert.equal(span.attributes[ORIGIN_ATTRIBUTES.delegationId], "d1");
      assert.equal(span.attributes[ORIGIN_ATTRIBUTES.subagentId], "sub1");
    }
  });

  it("no origin adds no origin attributes", () => {
    const memory = run(undefined);
    for (const span of memory.spans) assert.equal(Object.keys(span.attributes).some((k) => k.startsWith("prism.origin.")), false);
  });

  it("origin_profile_is_name_only", () => {
    for (const profile of ["/home/arn/.claude", "~/.config/x", "C:\\Users\\a", "sk-live key with spaces", "a/b"]) {
      const memory = run({ profile });
      assert.equal(JSON.stringify(memory.spans).includes(profile), false, profile);
      assert.equal(ORIGIN_ATTRIBUTES.profile in memory.spans[0].attributes, false);
    }
  });

  it("field policy drops and hashes origin attributes", () => {
    const memory = run(
      {},
      {
        fieldPolicy: ({ path }) =>
          path === ORIGIN_ATTRIBUTES.vendor
            ? { action: "deny" }
            : path === ORIGIN_ATTRIBUTES.profile
              ? { action: "tokenize" }
              : { action: "allow" },
      },
    );
    const attrs = memory.spans[0].attributes;
    assert.equal(ORIGIN_ATTRIBUTES.vendor in attrs, false);
    assert.match(String(attrs[ORIGIN_ATTRIBUTES.profile]), /^tok_/);
    assert.equal(attrs[ORIGIN_ATTRIBUTES.agent], "ui-engineer");
  });
});
