import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { providerDone, providerToolCall, toolCallContent } from "@arnilo/prism/testing";
import { fetchCall, fetchTool, researchAgent, textTurn, verify, writeTool } from "./helpers.js";

describe("research ledger", () => {
  it("ledger_records_every_fetched_source", async () => {
    const run = await researchAgent({
      tools: [fetchTool()],
      script: [
        [fetchCall("c1", "https://a.test/one"), fetchCall("c2", "https://b.test/two"), fetchCall("c3", "https://a.test/one"), providerDone()],
        textTurn("done"),
      ],
    });
    try {
      const result = await run.session.run("fetch");
      const text = JSON.stringify(result.messages);
      assert.equal(text.match(/ledger: S1/g)?.length, 1);
      assert.equal(text.match(/ledger: S2/g)?.length, 1);
      assert.equal((await verify(run)).ledgerSize, 2);
    } finally {
      await run.dispose();
    }
  });

  it("ledger_ignores_unlisted_tools", async () => {
    const run = await researchAgent({
      tools: [writeTool()],
      script: [[providerToolCall(toolCallContent("w1", "write", { path: "a" })), providerDone()], textTurn("done")],
    });
    try {
      const result = await run.session.run("write");
      assert.equal(JSON.stringify(result.messages).includes("ledger:"), false);
      assert.equal((await verify(run)).ledgerSize, 0);
    } finally {
      await run.dispose();
    }
  });

  it("cite_unknown_source_is_an_error_result", async () => {
    const run = await researchAgent({
      tools: [fetchTool()],
      script: [[providerToolCall(toolCallContent("cite-1", "cite", { id: "S9" })), providerDone()], textTurn("done")],
    });
    try {
      const result = await run.session.run("cite");
      const text = JSON.stringify(result.messages);
      assert.match(text, /unknown_source/);
      assert.equal(text.includes("[[cite:S9]]"), false);
    } finally {
      await run.dispose();
    }
  });

  it("ledger_strips_credentials_from_urls", async () => {
    const secret = "SECRET";
    const run = await researchAgent({
      tools: [fetchTool()],
      script: [
        [fetchCall("c1", `https://u:p@x.test/a?token=${secret}&q=1`), providerDone()],
        textTurn("done"),
      ],
    });
    try {
      await run.session.run("fetch");
      const state = JSON.stringify((await run.store.list("s")).filter((entry) => entry.kind === "package_state"));
      const inspect = JSON.stringify(await run.agent.inspect());
      const packageEvents = JSON.stringify(run.events.filter((event) => event.type === "package.event"));
      assert.equal(state.includes(secret), false);
      assert.equal(state.includes("u:p@"), false);
      assert.match(state, /https:\/\/x\.test\/a\?q=1/);
      assert.equal(inspect.includes(secret), false);
      assert.equal(packageEvents.includes(secret), false);
    } finally {
      await run.dispose();
    }
  });

  it("unlisted_source_tool_is_noted_once", async () => {
    const run = await researchAgent({
      config: { sourceTools: ["missing_tool"] },
      script: [textTurn("done")],
    });
    try {
      await run.session.run("note");
      const notes = (await run.agent.inspect()).statusNotes.filter((note) => note.level === "info");
      assert.equal(notes.length, 1);
      assert.match(notes[0]?.message ?? "", /missing_tool/);
    } finally {
      await run.dispose();
    }
  });

  it("ledger_cap_notes_once", async () => {
    const run = await researchAgent({
      config: { sourceTools: ["web_fetch"], maxSources: 1 },
      tools: [fetchTool()],
      script: [
        [fetchCall("c1", "https://a.test/one"), fetchCall("c2", "https://b.test/two"), fetchCall("c3", "https://c.test/three"), providerDone()],
        textTurn("done"),
      ],
    });
    try {
      await run.session.run("fetch");
      const notes = (await run.agent.inspect()).statusNotes.filter((note) => note.level === "warn");
      assert.equal(notes.length, 1);
      assert.match(notes[0]?.message ?? "", /maxSources/);
      assert.equal((await verify(run)).ledgerSize, 1);
    } finally {
      await run.dispose();
    }
  });
});
