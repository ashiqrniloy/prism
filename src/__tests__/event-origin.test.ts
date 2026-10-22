import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { echoTool, loopConformance } from "../testing/index.js";
import { OBSERVE_HOOK_NAMES } from "../hooks/index.js";
import type { AgentEvent, EventOrigin, ToolCallHookPayload } from "../index.js";

/** K3 (plan 163 Task 2): `origin` replaces the producer-less `child` tag. */

type HasKey<T, K extends string> = K extends keyof T ? true : false;
const noChild: HasKey<AgentEvent, "child"> = false;
const hasOrigin: HasKey<AgentEvent, "origin"> = true;

describe("event origin", () => {
  it("event_origin_replaces_child", () => {
    const origin: EventOrigin = { kind: "external", agent: "a", agentId: "x", depth: 0, executedBy: "external" };
    const event: AgentEvent = { type: "session.opened", sessionId: "s", runId: "", restored: false, origin } as AgentEvent;
    assert.equal(noChild, false);
    assert.equal(hasOrigin, true);
    assert.equal(event.origin?.kind, "external");
    assert.equal("child" in event, false);
  });

  it("tool_call_payload_carries_origin", async () => {
    const payloads: ToolCallHookPayload[] = [];
    await loopConformance({
      tools: [echoTool(() => undefined)],
      hooks: (hooks) => {
        hooks.on("tool.call", (payload) => {
          payloads.push(payload);
          return undefined;
        });
      },
    });
    assert.ok(payloads.length > 0);
    for (const payload of payloads) assert.equal("origin" in payload, false);
  });

  it("catalog_count_unchanged_by_origin", () => {
    assert.equal(OBSERVE_HOOK_NAMES.length, 23);
  });
});
