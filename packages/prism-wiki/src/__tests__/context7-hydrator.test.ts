import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it, before, after } from "node:test";
import { Context7Hydrator } from "../search/context7-hydrator.js";
import type { QmdSearchResult, WikiManifest } from "../types.js";

const TEST_DIR = join(process.cwd(), "dist/__tests__/scratch-context7-test");

describe("prism-wiki Context7 hydrator & response formatter", () => {
  before(async () => {
    await mkdir(join(TEST_DIR, ".wiki/entities"), { recursive: true });
    await writeFile(
      join(TEST_DIR, ".wiki/entities/module-auth.md"),
      `# Authentication Module\n\nCore JWT token validation subsystem.\n\n## Architecture Flow\nIncoming requests pass through token middleware.\n\n## Key Symbols\n- verifyToken`,
      "utf8",
    );
  });

  after(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("hydrator_extracts_breadcrumbs_and_hydrates_anchors", async () => {
    const hydrator = new Context7Hydrator(TEST_DIR);

    const manifest: WikiManifest = {
      version: "1.0.0",
      profile: "codebase",
      wikiRoot: ".wiki",
      rawRoots: ["."],
      sourceFileHashes: {
        "src/auth/jwt.ts": "hash123",
      },
      entities: {
        "module-auth": {
          id: "module-auth",
          title: "Authentication Module",
          category: "module",
          tags: ["auth", "security"],
          rawSources: ["src/auth/jwt.ts"],
          anchors: [
            {
              filePath: "src/auth/jwt.ts",
              startLine: 10,
              endLine: 40,
              symbol: "verifyToken",
              sourceHash: "hash123",
            },
          ],
          lastCompiledAt: "2026-08-24T00:00:00.000Z",
        },
      },
    };

    const searchHits: QmdSearchResult[] = [
      {
        docId: "doc_1",
        file: ".wiki/entities/module-auth.md",
        score: 0.9,
        snippet: "Core JWT token validation subsystem",
      },
    ];

    const hydrated = await hydrator.hydrate(searchHits, manifest);
    assert.equal(hydrated.length, 1);
    assert.equal(hydrated[0].title, "Authentication Module");
    assert.ok(hydrated[0].breadcrumbs.some((b) => b.includes("Architecture Flow")));
    assert.equal(hydrated[0].isStale, false);
    assert.equal(hydrated[0].anchors.length, 1);

    const response = hydrator.formatResponse("How does auth work?", "query", hydrated);
    assert.ok(response.formattedMarkdown.includes("Authentication Module"));
    assert.ok(response.formattedMarkdown.includes("file:///"));
    assert.ok(response.formattedMarkdown.includes("verifyToken"));
    assert.ok(response.formattedMarkdown.includes("Current"));
  });

  it("hydrator_detects_stale_anchor_when_source_hash_changes", async () => {
    const hydrator = new Context7Hydrator(TEST_DIR);

    const manifest: WikiManifest = {
      version: "1.0.0",
      profile: "codebase",
      wikiRoot: ".wiki",
      rawRoots: ["."],
      sourceFileHashes: {
        "src/auth/jwt.ts": "new_modified_hash_456", // Current source file changed!
      },
      entities: {
        "module-auth": {
          id: "module-auth",
          title: "Authentication Module",
          category: "module",
          tags: ["auth"],
          rawSources: ["src/auth/jwt.ts"],
          anchors: [
            {
              filePath: "src/auth/jwt.ts",
              startLine: 10,
              endLine: 40,
              symbol: "verifyToken",
              sourceHash: "old_compiled_hash_123", // Mismatched old hash
            },
          ],
          lastCompiledAt: "2026-08-20T00:00:00.000Z",
        },
      },
    };

    const searchHits: QmdSearchResult[] = [
      {
        docId: "doc_1",
        file: ".wiki/entities/module-auth.md",
        score: 0.8,
        snippet: "Core JWT token validation",
      },
    ];

    const hydrated = await hydrator.hydrate(searchHits, manifest);
    assert.equal(hydrated[0].isStale, true);

    const response = hydrator.formatResponse("auth", "search", hydrated);
    assert.ok(response.formattedMarkdown.includes("Stale"));
  });
});
