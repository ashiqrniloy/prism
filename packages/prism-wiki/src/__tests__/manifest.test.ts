import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it, before, after } from "node:test";
import {
  computeSourceDelta,
  createEmptyManifest,
  hashContent,
  loadManifest,
  saveManifest,
  scanRawFiles,
  updateManifestWithEntities,
  validateAnchor,
} from "../manifest.js";
import type { WikiEntityMetadata, WikiManifest, WikiSourceAnchor } from "../types.js";

const TEST_DIR = join(process.cwd(), "dist/__tests__/scratch-manifest-test");

describe("prism-wiki manifest & drift engine", () => {
  before(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  after(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("hashContent_produces_deterministic_sha256", () => {
    const hash1 = hashContent("Hello Prism Wiki");
    const hash2 = hashContent("Hello Prism Wiki");
    const hash3 = hashContent("Different content");

    assert.equal(hash1, hash2);
    assert.notEqual(hash1, hash3);
    assert.equal(hash1.length, 64);
  });

  it("manifest_persistence_save_and_load", async () => {
    const wikiDir = join(TEST_DIR, ".wiki-persist");
    const manifest = createEmptyManifest(wikiDir, ["src"], "codebase");

    const sampleEntity: WikiEntityMetadata = {
      id: "auth-module",
      title: "Authentication Module",
      category: "module",
      tags: ["auth", "security"],
      rawSources: ["src/auth.ts"],
      anchors: [
        {
          filePath: "src/auth.ts",
          startLine: 1,
          endLine: 5,
          symbol: "verifyToken",
          sourceHash: hashContent("function verifyToken() {}"),
        },
      ],
      lastCompiledAt: new Date().toISOString(),
    };

    const updated = updateManifestWithEntities(manifest, [sampleEntity], new Map([["src/auth.ts", "hash1234"]]));

    await saveManifest(wikiDir, updated);
    const loaded = await loadManifest(wikiDir);

    assert.ok(loaded);
    assert.equal(loaded.version, "1.0.0");
    assert.equal(loaded.profile, "codebase");
    assert.equal(loaded.sourceFileHashes["src/auth.ts"], "hash1234");
    assert.ok(loaded.entities["auth-module"]);
    assert.equal(loaded.entities["auth-module"].title, "Authentication Module");
  });

  it("computeSourceDelta_detects_added_modified_deleted_and_affected_entities", () => {
    const initialManifest: WikiManifest = {
      version: "1.0.0",
      profile: "codebase",
      wikiRoot: ".wiki",
      rawRoots: ["."],
      sourceFileHashes: {
        "src/auth.ts": "hash_auth_v1",
        "src/db.ts": "hash_db_v1",
        "src/old.ts": "hash_old_v1",
      },
      entities: {
        "auth-entity": {
          id: "auth-entity",
          title: "Auth",
          category: "module",
          tags: [],
          rawSources: ["src/auth.ts"],
          anchors: [],
          lastCompiledAt: "2026-08-20T00:00:00.000Z",
        },
        "db-entity": {
          id: "db-entity",
          title: "DB",
          category: "module",
          tags: [],
          rawSources: ["src/db.ts"],
          anchors: [],
          lastCompiledAt: "2026-08-20T00:00:00.000Z",
        },
      },
    };

    const currentFiles = new Map<string, string>([
      ["src/auth.ts", "hash_auth_v2"], // modified
      ["src/db.ts", "hash_db_v1"], // unchanged
      ["src/new.ts", "hash_new_v1"], // added
      // src/old.ts was deleted
    ]);

    const delta = computeSourceDelta(initialManifest, currentFiles);

    assert.deepEqual(delta.added, ["src/new.ts"]);
    assert.deepEqual(delta.modified, ["src/auth.ts"]);
    assert.deepEqual(delta.deleted, ["src/old.ts"]);
    assert.deepEqual(delta.unchanged, ["src/db.ts"]);
    // auth-entity depends on src/auth.ts which was modified
    assert.deepEqual(delta.affectedEntities, ["auth-entity"]);
  });

  it("validateAnchor_checks_symbol_and_line_integrity", () => {
    const code = `// Auth module
export function verifyToken(token: string): boolean {
  return token.length > 0;
}
export function revokeToken(token: string): void {
  console.log("revoked");
}`;

    const validAnchor: WikiSourceAnchor = {
      filePath: "src/auth.ts",
      startLine: 2,
      endLine: 4,
      symbol: "verifyToken",
      sourceHash: hashContent(`export function verifyToken(token: string): boolean {\n  return token.length > 0;\n}`),
    };

    const resValid = validateAnchor(validAnchor, code);
    assert.equal(resValid.isValid, true);

    // Test shifted lines
    const shiftedAnchor: WikiSourceAnchor = {
      ...validAnchor,
      startLine: 50,
      endLine: 60,
    };
    const resShifted = validateAnchor(shiftedAnchor, code);
    assert.equal(resShifted.isValid, false);
    assert.equal(resShifted.reason, "lines_shifted");

    // Test missing symbol
    const missingSymbolAnchor: WikiSourceAnchor = {
      ...validAnchor,
      symbol: "nonExistentFunction",
    };
    const resMissingSymbol = validateAnchor(missingSymbolAnchor, code);
    assert.equal(resMissingSymbol.isValid, false);
    assert.equal(resMissingSymbol.reason, "symbol_missing");

    // Test symbol shifted to another line
    const symbolMovedAnchor: WikiSourceAnchor = {
      ...validAnchor,
      startLine: 5,
      endLine: 7,
      symbol: "verifyToken", // verifyToken is on lines 2-4, not 5-7
    };
    const resMoved = validateAnchor(symbolMovedAnchor, code);
    assert.equal(resMoved.isValid, false);
    assert.equal(resMoved.reason, "lines_shifted");

    // Test missing file content
    const resMissingFile = validateAnchor(validAnchor, undefined);
    assert.equal(resMissingFile.isValid, false);
    assert.equal(resMissingFile.reason, "file_missing");
  });

  it("scanRawFiles_scans_workspace_and_skips_ignored", async () => {
    const scanDir = join(TEST_DIR, "scan-workspace");
    await mkdir(join(scanDir, "src"), { recursive: true });
    await mkdir(join(scanDir, "node_modules/pkg"), { recursive: true });
    await mkdir(join(scanDir, ".git"), { recursive: true });

    await writeFile(join(scanDir, "src/index.ts"), "export const a = 1;");
    await writeFile(join(scanDir, "src/util.ts"), "export const b = 2;");
    await writeFile(join(scanDir, "node_modules/pkg/index.js"), "module.exports = {};");
    await writeFile(join(scanDir, ".git/config"), "[core]");

    const fileMap = await scanRawFiles(scanDir, ["."]);

    assert.ok(fileMap.has("src/index.ts"));
    assert.ok(fileMap.has("src/util.ts"));
    assert.equal(fileMap.has("node_modules/pkg/index.js"), false);
    assert.equal(fileMap.has(".git/config"), false);
  });
});
