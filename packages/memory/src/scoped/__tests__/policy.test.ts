import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { MemoryValidationError } from "../../errors.js";
import { createMemoryFabric } from "../../fabric/index.js";
import { createHashEmbedder, createMemory } from "../../index.js";
import { createScopedMemoryPolicy, packageName } from "../index.js";

async function makeBound(scopeRoot?: string) {
  const root = scopeRoot ?? (await mkdtemp(join(tmpdir(), "scoped-policy-")));
  const memory = createMemory({
    tenantId: "t1",
    resourceId: root,
    threadId: "scoped",
    embedder: createHashEmbedder({ dimensions: 8 }),
  });
  return { root, memory, fabric: createMemoryFabric({ memory }) };
}

describe("createScopedMemoryPolicy", () => {
  it("throws on missing required options and applies omitted knob defaults", async () => {
    const { root, memory, fabric } = await makeBound();
    assert.throws(() => createScopedMemoryPolicy(null as never), MemoryValidationError);
    assert.throws(() => createScopedMemoryPolicy({ fabric, scopeRoot: root } as never), MemoryValidationError);
    assert.throws(() => createScopedMemoryPolicy({ memory, scopeRoot: root } as never), MemoryValidationError);
    assert.throws(() => createScopedMemoryPolicy({ memory, fabric, scopeRoot: "" }), MemoryValidationError);
    assert.throws(
      () => createScopedMemoryPolicy({ memory, fabric, scopeRoot: root, policy: { activation: { topK: 0 } } }),
      MemoryValidationError,
    );

    const policy = createScopedMemoryPolicy({
      memory,
      fabric,
      scopeRoot: root,
      policy: { promotion: { reuseThreshold: 5 } },
    });
    assert.equal(policy.scopeRoot, root);
    assert.equal(policy.settings.promotion.reuseThreshold, 5);
    assert.equal(policy.settings.decay.tauDays, 30);
    assert.equal(policy.settings.decay.candidateArchiveDays, 30);
    assert.equal(policy.settings.activation.topK, 3);
    assert.equal(policy.settings.activation.minSimilarity, 0.35);
    assert.equal(policy.settings.facts.block, "facts");
    assert.equal(policy.settings.facts.maxChars, 2200);
    assert.equal(policy.settings.approval.default, "off");
  });

  it("throws when resourceId mismatches or threadId is missing", async () => {
    const { root, fabric } = await makeBound();
    const mismatched = createMemory({
      tenantId: "t1",
      resourceId: `${root}-other`,
      threadId: "scoped",
      embedder: createHashEmbedder({ dimensions: 8 }),
    });
    assert.throws(() => createScopedMemoryPolicy({ memory: mismatched, fabric, scopeRoot: root }), MemoryValidationError);

    const noThread = createMemory({
      tenantId: "t1",
      resourceId: root,
      embedder: createHashEmbedder({ dimensions: 8 }),
    });
    assert.throws(() => createScopedMemoryPolicy({ memory: noThread, fabric, scopeRoot: root }), MemoryValidationError);
  });

  it("is inert at create: no files written under scopeRoot", async () => {
    const { root, memory, fabric } = await makeBound();
    createScopedMemoryPolicy({ memory, fabric, scopeRoot: root });
    assert.deepEqual(await readdir(root), []);
  });

  it("ships the scoped subpath from the memory family manifest", () => {
    assert.equal(packageName, "@arnilo/prism-memory/scoped");
    const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
    assert.deepEqual(pkg.exports["./scoped"], { types: "./dist/scoped/index.d.ts", default: "./dist/scoped/index.js" });
  });
});
