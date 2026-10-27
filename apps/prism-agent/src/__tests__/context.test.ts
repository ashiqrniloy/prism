import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AgentEvent, type ModelConfig, resolveInputCap } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import { createCodingWorker } from "../host/coding.js";
import type { HostConfig } from "../host/config.js";
import { createResearchWorker } from "../host/research.js";
import { longSession, type LongSessionResult } from "../scenarios/long-session.js";

const BUDGET_MODEL = "opencode-go/mimo-v2.5";
const MOCK = "mock/m";

function config(root: string, coding: HostConfig["models"]["coding"] = MOCK, research: HostConfig["models"]["research"] = MOCK): HostConfig {
  return {
    models: { orchestrator: MOCK, coding, research },
    storePath: join(root, "sessions.db"),
    workspace: join(root, "workspace"),
    approval: "ask",
    web: { backend: "obscura" },
  };
}

function packages(id: "opencode-go" | "mock") {
  return [mockProvider([[{ type: "done" }]], { id })];
}

function packageConfig(agent: Awaited<ReturnType<typeof createCodingWorker>>, name: string): Record<string, unknown> {
  const found = agent.inspect().packages.find((entry) => entry.name === name);
  assert.ok(found, `${name} is installed`);
  return found.config as Record<string, unknown>;
}

test("coding_worker_compacts_with_coding_profile_and_trigger", async () => {
  const root = mkdtempSync(join(tmpdir(), "prism-agent-budget-"));
  mkdirSync(join(root, "workspace"));
  try {
    const agent = await createCodingWorker(config(root, BUDGET_MODEL), { packages: packages("opencode-go") });
    try {
      const compaction = packageConfig(agent, "@arnilo/prism-memory-compaction");
      assert.equal(compaction.profile, "coding");
      assert.deepEqual(compaction.trigger, { type: "threshold_tokens", tokens: 96_000 });

      const observational = packageConfig(agent, "@arnilo/prism-memory-observational");
      assert.deepEqual(observational.context, { recentMessages: 8, compactAt: { ratio: 0.6, maxTokens: 96_000 } });

      const engineering = packageConfig(agent, "@arnilo/prism-context-engineering");
      assert.deepEqual(engineering.fold, { minAgeTurns: 2, minBytes: 2_048, keepLast: 3, clearAtLeastTokens: 9_600 });
      assert.equal(engineering.accounting, true);
      assert.equal(
        agent.inspect().statusNotes.filter((note) => note.package === "@prism-agent/context-budget").length,
        0,
        "a measured model needs no fallback note",
      );
    } finally {
      await agent.dispose();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("research_worker_caps_block_share", async () => {
  const root = mkdtempSync(join(tmpdir(), "prism-agent-research-context-"));
  mkdirSync(join(root, "workspace"));
  try {
    const agent = await createResearchWorker(config(root, MOCK, BUDGET_MODEL), { packages: packages("opencode-go") });
    try {
      const engineering = packageConfig(agent, "@arnilo/prism-context-engineering");
      assert.deepEqual(engineering.blocks, { maxShare: 0.2 });
      assert.equal(engineering.budget, undefined);
      assert.equal(engineering.attention, undefined);
      assert.equal(engineering.accounting, true);
      assert.deepEqual(packageConfig(agent, "@arnilo/prism-memory-compaction").trigger, {
        type: "threshold_tokens",
        tokens: 96_000,
      });
    } finally {
      await agent.dispose();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("unlisted_model_uses_ratio_and_notes_once", async () => {
  const root = mkdtempSync(join(tmpdir(), "prism-agent-unlisted-"));
  mkdirSync(join(root, "workspace"));
  try {
    const agent = await createCodingWorker(config(root), { packages: packages("mock") });
    try {
      assert.deepEqual(packageConfig(agent, "@arnilo/prism-memory-compaction").trigger, { type: "input_ratio", ratio: 0.6 });
      assert.deepEqual(packageConfig(agent, "@arnilo/prism-memory-observational").context, {
        recentMessages: 8,
        compactAt: { ratio: 0.6 },
      });
      assert.deepEqual(packageConfig(agent, "@arnilo/prism-context-engineering").fold, {
        minAgeTurns: 2,
        minBytes: 2_048,
        keepLast: 3,
        clearAtLeastTokens: 4_096,
      });
      const notes = agent.inspect().statusNotes.filter((note) => note.package === "@prism-agent/context-budget");
      assert.equal(notes.length, 1);
      assert.match(notes[0]!.message, /input_ratio 0\.6/);
    } finally {
      await agent.dispose();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function turnRequests(result: LongSessionResult) {
  return result.requests.filter(
    (request) =>
      !request.messages.some(
        (message) => message.role === "user" && message.content.some((part) => part.type === "text" && part.text.startsWith("<conversation>")),
      ),
  );
}

function foldedCount(request: { readonly messages: readonly unknown[] }): number {
  return (JSON.stringify(request.messages).match(/\[folded: /g) ?? []).length;
}

function accounted(result: LongSessionResult): { totalTokens: number }[] {
  return result.events.flatMap((event) =>
    event.type === "package.event" && event.name === "context.accounted" ? [event.data as unknown as { totalTokens: number }] : [],
  );
}

function compactions(result: LongSessionResult): AgentEvent[] {
  return result.events.filter((event) => event.type === "compaction.completed" && event.error === undefined);
}

test("long_session_stays_bounded", async () => {
  const root = mkdtempSync(join(tmpdir(), "prism-agent-long-"));
  mkdirSync(join(root, "workspace"));
  const model: ModelConfig = { provider: "mock", model: "long-session", limits: { contextWindow: 64_000, maxOutputTokens: 0 } };
  const started = performance.now();
  try {
    const result = await longSession(config(root, model));
    const elapsed = performance.now() - started;
    assert.equal(result.completed, true);
    assert.ok(elapsed < 30_000, `long session took ${Math.round(elapsed)} ms`);

    const turns = turnRequests(result);
    assert.ok(turns.length >= result.turns, "every turn reached the provider");
    assert.ok(compactions(result).length >= 1, "auto-compaction ran");
    assert.ok(compactions(result).some((event) => event.type === "compaction.completed" && event.trigger === "auto"), "the configured trigger voted");

    const counts = turns.map(foldedCount);
    assert.ok(Math.max(...counts) > 0, "the fold ran");
    const advances = counts.slice(1).map((count, index) => count - counts[index]!);
    assert.ok(advances.some((advance) => advance >= 2), "fold advanced in a batch");
    assert.ok(advances.some((advance) => advance === 0), "some turns held the prefix");

    for (let index = 1; index < turns.length; index += 1) {
      if (counts[index] !== counts[index - 1]) continue;
      const previous = turns[index - 1]!.messages;
      const current = turns[index]!.messages;
      if (current.length < previous.length) continue; // a compaction shortened the branch
      if (JSON.stringify(current[0]) !== JSON.stringify(previous[0])) continue; // a compaction replaced the summary
      assert.equal(
        JSON.stringify(current.slice(0, previous.length)),
        JSON.stringify(previous),
        `prefix held between fold advances at request ${index}`,
      );
    }

    const trigger = Math.floor(resolveInputCap({}, model) * 0.6);
    for (const event of accounted(result)) {
      assert.ok(event.totalTokens <= trigger + 4_000, `request accounting ${event.totalTokens} stayed within trigger ${trigger} + one turn`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("long_session_recovers_from_overflow", async () => {
  const root = mkdtempSync(join(tmpdir(), "prism-agent-long-overflow-"));
  mkdirSync(join(root, "workspace"));
  const model: ModelConfig = { provider: "mock", model: "long-session", limits: { contextWindow: 64_000, maxOutputTokens: 0 } };
  try {
    const result = await longSession(config(root, model));
    assert.equal(result.completed, true);
    assert.ok(
      compactions(result).some((event) => event.type === "compaction.completed" && event.trigger === "overflow"),
      "the turn-40 overflow recovered through an overflow compaction",
    );
    assert.ok(turnRequests(result).length > result.turns, "the rejected call was retried");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
