import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { MemoryValidationError } from "../../errors.js";
import { createMemoryFabric } from "../../fabric/index.js";
import { createHashEmbedder, createMemory } from "../../index.js";
import { createScopedMemoryHealthCommand, createScopedMemoryPolicy, runScopedMemoryEval } from "../index.js";

function loadFixture(name: string): unknown {
  const candidates = [
    join(process.cwd(), "src/scoped/eval/fixtures", name),
    join(process.cwd(), "packages/memory/src/scoped/eval/fixtures", name),
  ];
  const path = candidates.find((item) => existsSync(item));
  if (!path) throw new Error(`missing fixture ${name}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("runScopedMemoryEval", () => {
  it("A/B win-rate rises when memory helps and stays flat when it cannot", async () => {
    const ab = loadFixture("ab.json") as { helps: never[]; cannot: never[] };
    const helps = await runScopedMemoryEval({ fixtures: { ab: { helps: ab.helps } } });
    assert.equal(helps.winRate.off, 0);
    assert.equal(helps.winRate.on, 1);
    const cannot = await runScopedMemoryEval({ fixtures: { ab: { cannot: ab.cannot } } });
    assert.equal(cannot.winRate.on, cannot.winRate.off);
  });

  it("precision@3 matches the labeled fixture and alerts below the floor", async () => {
    const precision = loadFixture("precision.json") as {
      notes: never[];
      queries: never[];
      floor: number;
    };
    const alerted = await runScopedMemoryEval({ fixtures: { precision } });
    assert.ok(Math.abs(alerted.precisionAt3 - 1 / 3) < 1e-9);
    assert.equal(alerted.precisionAlert, true);
    const quiet = await runScopedMemoryEval({ fixtures: { precision: { ...precision, floor: 0.3 } } });
    assert.equal(quiet.precisionAlert, false);
  });

  it("LoCoMo probe answers from seeded notes and fail-closes missing ids", async () => {
    const locomo = loadFixture("locomo.json") as { notes: never[]; questions: never[] };
    const report = await runScopedMemoryEval({ fixtures: { locomo } });
    assert.equal(report.locomo.total, 2);
    assert.equal(report.locomo.answered, 1);
    assert.equal(report.locomo.failedClosed, 1);
  });

  it("rejects production stores", async () => {
    await assert.rejects(runScopedMemoryEval({ fixtures: {}, policy: {} } as never), MemoryValidationError);
  });
});

describe("createScopedMemoryHealthCommand", () => {
  it("reports policy.health as command value", async () => {
    const scopeRoot = await mkdtemp(join(tmpdir(), "scoped-eval-health-"));
    const memory = createMemory({
      tenantId: "eval",
      resourceId: scopeRoot,
      threadId: "eval",
      embedder: createHashEmbedder({ dimensions: 8 }),
    });
    const policy = createScopedMemoryPolicy({
      memory,
      fabric: createMemoryFabric({ memory, consolidate: false }),
      scopeRoot,
    });
    const result = await createScopedMemoryHealthCommand({ policy }).execute({}, { sessionId: "s1" } as never);
    assert.equal(result.name, "scoped-memory:health");
    assert.equal((result.value as { notes: { candidate: number } }).notes.candidate, 0);
    assert.match(JSON.stringify(result.content), /Scoped memory:/);
  });
});
