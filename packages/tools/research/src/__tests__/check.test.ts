import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import type { AgentEvent, LoopStrategy } from "@arnilo/prism";
import { providerDone } from "@arnilo/prism/testing";
import { fetchCall, fetchTool, researchAgent, textTurn, verify } from "./helpers.js";

describe("research citation check", () => {
  it("run_end_passes_when_all_citations_resolve", async () => {
    const run = await researchAgent({
      tools: [fetchTool()],
      script: [[fetchCall("c1", "https://a.test/one"), providerDone()], textTurn("Claim [[cite:S1]].")],
    });
    try {
      await run.session.run("report");
      assert.equal(run.turns(), 2);
      assert.deepEqual(await verify(run), { verdict: "passed", unresolved: [], ledgerSize: 1 });
      assert.equal(run.events.some((event) => event.type === "package.event" && event.name === "research.citations.unresolved"), false);
    } finally {
      await run.dispose();
    }
  });

  it("run_end_repairs_once_then_fails", async () => {
    const run = await researchAgent({
      script: [textTurn("Claim [[cite:S9]].")],
    });
    try {
      const events: AgentEvent[] = [];
      const pump = (async () => {
        for await (const event of run.session.subscribe()) events.push(event);
      })();
      const result = await run.session.run("report");
      await pump;
      assert.equal(run.turns(), 2);
      const verdict = await verify(run);
      assert.equal(verdict.verdict, "failed");
      assert.deepEqual(verdict.unresolved, ["S9"]);
      const unresolved = events.filter((event) => event.type === "package.event" && event.name === "research.citations.unresolved");
      assert.equal(unresolved.length, 1);
      assert.match(JSON.stringify(result.messages), /Unresolved citations: S9/);
    } finally {
      await run.dispose();
    }
  });

  it("run_end_check_on_custom_loop", async () => {
    const loop: LoopStrategy = {
      name: "custom-research",
      async run(controller) {
        await controller.turn();
        await controller.end();
      },
    };
    const run = await researchAgent({
      config: { sourceTools: ["web_fetch"], maxRepairs: 0 },
      loop,
      script: [textTurn("Claim [[cite:S9]].")],
    });
    try {
      await run.session.run("report");
      assert.deepEqual(await verify(run), { verdict: "failed", unresolved: ["S9"], ledgerSize: 0 });
    } finally {
      await run.dispose();
    }
  });
});
