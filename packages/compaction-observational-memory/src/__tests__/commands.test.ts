import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionEntry } from "prism";
import { createMemoryStatusCommand, createMemoryViewCommand, createObservationalMemoryCommands, OBSERVATIONS_RECORDED, type MemoryObservation } from "../index.js";

const now = "2026-06-20T00:00:00.000Z";
const observation: MemoryObservation = { id: "aaaaaaaaaaaa", content: "Visible memory", timestamp: now, relevance: "medium", sourceEntryIds: ["m1"], tokenCount: 6 };
const entries = [
  createSessionEntry({ id: "m1", sessionId: "s1", timestamp: now, kind: "message", message: { role: "user", content: [{ type: "text", text: "hello" }] } }),
  createSessionEntry({ id: "om1", sessionId: "s1", parentId: "m1", timestamp: now, kind: "custom", data: { type: OBSERVATIONS_RECORDED, observations: [observation], coversUpToId: "m1" } }),
];

describe("observational memory commands", () => {
  it("status_command_reports_counts_progress_visible_full_and_in_flight_state", async () => {
    const command = createMemoryStatusCommand({ getEntries: () => entries, settings: { observationsPoolTargetTokens: 10, observationsPoolMaxTokens: 20 }, runtimeStatus: () => ({ inFlight: true, lastError: "none" }) });
    const result = await command.execute({}, { sessionId: "s1" });
    assert.equal((result.value as any).observations.recorded, 1);
    assert.equal((result.value as any).observations.active, 1);
    assert.equal((result.value as any).runtime.inFlight, true);
    assert.match(result.content?.[0]?.type === "text" ? result.content[0].text : "", /1 active/);
  });

  it("view_command_renders_visible_and_full_memory", async () => {
    const command = createMemoryViewCommand({ getEntries: () => entries });
    const visible = await command.execute({}, { sessionId: "s1" });
    const full = await command.execute({ mode: "full" }, { sessionId: "s1" });
    assert.match(visible.content?.[0]?.type === "text" ? visible.content[0].text : "", /Visible memory/);
    assert.equal((full.value as any).mode, "full");
  });

  it("view_command_rejects_unknown_modes", async () => {
    const command = createMemoryViewCommand({ getEntries: () => entries });
    const result = await command.execute({ mode: "bad" }, { sessionId: "s1" });
    assert.equal(result.error?.message, "Usage: /om:view [full]");
  });

  it("tool_and_commands_are_inert_until_registered_by_host", () => {
    const commands = createObservationalMemoryCommands({ getEntries: () => entries });
    assert.deepEqual(commands.map((command) => command.name), ["om:status", "om:view"]);
  });
});
