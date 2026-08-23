import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it, before, after } from "node:test";
import { createExtensionKernel } from "@arnilo/prism";
import { createWikiExtension, initWiki, lintWiki } from "../index.js";

const FIXTURE_DIR = join(process.cwd(), "dist/__tests__/fixture-e2e-pkm");

describe("prism-wiki E2E PKM note vault fixture", () => {
  before(async () => {
    await mkdir(join(FIXTURE_DIR, "notes"), { recursive: true });

    // Note 1
    await writeFile(
      join(FIXTURE_DIR, "notes/quantum-computing.md"),
      `# Quantum Computing
An introduction to quantum information and #physics.
Qubits leverage superposition and entanglement.
`,
      "utf8",
    );

    // Note 2
    await writeFile(
      join(FIXTURE_DIR, "notes/shors-algorithm.md"),
      `# Shor's Algorithm
Polynomial time integer factorization algorithm using [[quantum-computing]]. #algorithms #cryptography
`,
      "utf8",
    );

    // Note 3
    await writeFile(
      join(FIXTURE_DIR, "notes/journal.md"),
      `# Research Journal
Studying quantum complexity and [[shors-algorithm]]. #journal
`,
      "utf8",
    );
  });

  after(async () => {
    await rm(FIXTURE_DIR, { recursive: true, force: true });
  });

  it("completes_full_pkm_vault_lifecycle", async () => {
    // 1. Initial Wiki Initialization under PKM profile
    const initResult = await initWiki({
      workspaceRoot: FIXTURE_DIR,
      wikiRoot: ".wiki",
      profile: "pkm",
    });

    assert.equal(initResult.status, "initialized");
    assert.equal(initResult.profile, "pkm");
    assert.ok(initResult.compiledEntities >= 3);

    // Verify index.md catalogs concepts
    const indexContent = await readFile(join(FIXTURE_DIR, ".wiki/index.md"), "utf8");
    assert.ok(indexContent.includes("Quantum Computing"));
    assert.ok(indexContent.includes("Shor's Algorithm"));

    // 2. Load Extension Kernel and record insight
    const kernel = createExtensionKernel();
    await kernel.load([
      createWikiExtension({
        workspaceRoot: FIXTURE_DIR,
        wikiRoot: ".wiki",
      }),
    ]);

    const recordInsightTool = kernel.registries.tools.get("wiki_record_insight");
    assert.ok(recordInsightTool);

    const recordRes = await recordInsightTool.execute(
      {
        title: "Grover Search Algorithm",
        content: "Quadratic speedup for unstructured database search using quantum amplitude amplification.",
        category: "concept",
      },
      { sessionId: "s1", runId: "r1", toolCallId: "c1" },
    );

    assert.ok(recordRes.content && recordRes.content[0].type === "text");
    assert.ok(recordRes.content[0].text.includes("Successfully recorded"));

    // 3. Search for recorded insight
    const searchTool = kernel.registries.tools.get("wiki_search");
    assert.ok(searchTool);

    const searchRes = await searchTool.execute(
      { query: "Grover Search", mode: "search" },
      { sessionId: "s1", runId: "r1", toolCallId: "c2" },
    );

    assert.ok(searchRes.content && searchRes.content[0].type === "text");
    assert.ok(searchRes.content[0].text.includes("Grover Search"));

    // 4. Run Linter
    const lintReport = await lintWiki({
      workspaceRoot: FIXTURE_DIR,
      wikiRoot: ".wiki",
    });

    assert.equal(lintReport.ok, true);
    assert.equal(lintReport.brokenLinks.length, 0);
  });
});
