import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ContradictionEngine } from "../engine/contradictions.js";
import type { ExtractedEntityDraft } from "../profiles/codebase.js";
import type { WikiEntityMetadata } from "../types.js";

describe("prism-wiki contradiction engine", () => {
  it("detects_removed_symbols_and_sources", () => {
    const engine = new ContradictionEngine();

    const existingEntity: WikiEntityMetadata = {
      id: "module-auth",
      title: "Auth Module",
      category: "module",
      tags: ["auth"],
      rawSources: ["src/auth.ts", "src/old-session.ts"],
      anchors: [
        {
          filePath: "src/auth.ts",
          startLine: 1,
          endLine: 5,
          symbol: "verifyToken",
          sourceHash: "hash1",
        },
        {
          filePath: "src/old-session.ts",
          startLine: 1,
          endLine: 5,
          symbol: "legacySessionCheck",
          sourceHash: "hash2",
        },
      ],
      lastCompiledAt: "2026-08-20T00:00:00.000Z",
    };

    const newDraft: ExtractedEntityDraft = {
      id: "module-auth",
      title: "Auth Module",
      category: "module",
      tags: ["auth"],
      rawSources: ["src/auth.ts"], // removed src/old-session.ts
      symbols: [
        {
          name: "verifyToken",
          kind: "function",
          startLine: 1,
          endLine: 5,
        },
        // legacySessionCheck removed
      ],
    };

    const contradictions = engine.detectContradictions(existingEntity, newDraft);

    assert.equal(contradictions.length, 2);
    assert.ok(contradictions.some((c) => c.type === "symbol_removed" && c.previousClaim.includes("legacySessionCheck")));
    assert.ok(contradictions.some((c) => c.type === "source_removed" && c.previousClaim.includes("old-session.ts")));

    const formattedLog = engine.formatContradictionLogEntry(contradictions);
    assert.ok(formattedLog.includes("Reconciled"));
    assert.ok(formattedLog.includes("contradiction"));
    assert.ok(formattedLog.includes("legacySessionCheck"));
  });
});
