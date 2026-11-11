import assert from "node:assert/strict";
import { test } from "bun:test";
import type { AgentEvent } from "@arnilo/prism";
import { projectAgentTimeline, projectWorkflowTimeline } from "../timeline.js";

const ev = (type: string, runId: string, origin: Record<string, unknown> | undefined, extra: Record<string, unknown> = {}) =>
  ({ type, sessionId: `s-${runId}`, runId, ...(origin ? { origin } : {}), ...extra }) as AgentEvent;
const host = { kind: "prism", agent: "host", agentId: "h", depth: 0 };
const ui = {
  kind: "external",
  agent: "ui-engineer",
  agentId: "u",
  vendor: "claude-code",
  profile: "work",
  depth: 0,
  executedBy: "external",
};
const sub = { ...ui, depth: 1, subagentId: "reviewer" };
const tool = (id: string) => ({ call: { id, name: "read", arguments: {} } });

test("timeline_groups_by_origin", () => {
  const timeline = projectAgentTimeline([
    ev("run.started", "r", ui),
    ev("tool.started", "r", ui, tool("a")),
    ev("tool.started", "r", sub, tool("b")),
    ev("tool.started", "r", host, tool("c")),
  ]);
  const groups = timeline.byOrigin!;
  assert.deepEqual(
    groups.map((g) => [g.agent, g.subagentId ?? null]),
    [
      ["host", null],
      ["ui-engineer", null],
      ["ui-engineer", "reviewer"],
    ],
  );
  const hostGroup = groups[0];
  assert.equal(hostGroup.observed, false);
  assert.equal(hostGroup.executedBy, "prism");
  assert.equal(groups[1].observed, true);
  assert.equal(groups[1].executedBy, "external");
  assert.deepEqual(groups[1].stepIds, ["run:r", "tool:a"]);
  for (const step of timeline.steps) assert.ok(step.origin);
  assert.equal(JSON.stringify(timeline).includes("/home"), false);
});

test("timeline without origin has no groups", () => {
  assert.equal(projectAgentTimeline([ev("run.started", "r", undefined)]).byOrigin, undefined);
});

test("workflow timeline groups child agent steps; node steps stay unattributed", () => {
  const base = { workflowId: "w", runId: "wf", timestamp: "2026-01-01T00:00:00.000Z" };
  const timeline = projectWorkflowTimeline([
    { ...base, type: "workflow_started", sequence: 1 },
    { ...base, type: "node_started", nodeId: "ui", sequence: 2 },
    { ...base, type: "agent_event", nodeId: "ui", sequence: 3, event: ev("run.started", "c", ui) },
    { ...base, type: "agent_event", nodeId: "ui", sequence: 4, event: ev("tool.started", "c", ui, tool("a")) },
    { ...base, type: "node_finished", nodeId: "ui", sequence: 5 },
    { ...base, type: "workflow_finished", status: "succeeded", sequence: 6 },
  ] as never);
  assert.equal(timeline.byOrigin?.length, 1);
  assert.equal(timeline.byOrigin![0].observed, true);
  assert.equal(timeline.steps.find((s) => s.kind === "workflow_node")?.origin, undefined);
});
