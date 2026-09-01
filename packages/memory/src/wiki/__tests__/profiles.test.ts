import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CodebaseProfile } from "../profiles/codebase.js";
import { resolveProfile } from "../profiles/hybrid.js";
import { PkmProfile } from "../profiles/pkm.js";

describe("prism-wiki domain profilers", () => {
  it("CodebaseProfile_extracts_ts_py_rust_symbols", () => {
    const profile = new CodebaseProfile();

    const tsFile = {
      relativePath: "src/auth/jwt.ts",
      content: `export interface TokenPayload { id: string; }
export type TokenExpiry = number;
export const DEFAULT_EXPIRY = 3600;
export async function verifyToken(token: string): Promise<boolean> {
  return true;
}
export class TokenManager {
  revoke() {}
}`,
      hash: "hash1",
      extension: ".ts",
    };

    const symbols = profile.extractSymbols(tsFile);
    assert.equal(symbols.length, 5);
    assert.ok(symbols.some((s) => s.name === "TokenPayload" && s.kind === "interface"));
    assert.ok(symbols.some((s) => s.name === "TokenExpiry" && s.kind === "type"));
    assert.ok(symbols.some((s) => s.name === "DEFAULT_EXPIRY" && s.kind === "variable"));
    assert.ok(symbols.some((s) => s.name === "verifyToken" && s.kind === "function"));
    assert.ok(symbols.some((s) => s.name === "TokenManager" && s.kind === "class"));

    // Python file
    const pyFile = {
      relativePath: "lib/service.py",
      content: `class UserService:
    def get_user(self):
        pass

async def authenticate():
    pass`,
      hash: "hash2",
      extension: ".py",
    };

    const pySymbols = profile.extractSymbols(pyFile);
    assert.equal(pySymbols.length, 2);
    assert.ok(pySymbols.some((s) => s.name === "UserService" && s.kind === "class"));
    assert.ok(pySymbols.some((s) => s.name === "authenticate" && s.kind === "function"));

    // Rust file
    const rsFile = {
      relativePath: "src/engine.rs",
      content: `pub struct Engine { id: u64 }
pub async fn run_engine() {}`,
      hash: "hash3",
      extension: ".rs",
    };

    const rsSymbols = profile.extractSymbols(rsFile);
    assert.equal(rsSymbols.length, 2);
    assert.ok(rsSymbols.some((s) => s.name === "Engine" && s.kind === "class"));
    assert.ok(rsSymbols.some((s) => s.name === "run_engine" && s.kind === "function"));
  });

  it("PkmProfile_extracts_headings_and_tags", () => {
    const profile = new PkmProfile();

    const noteFile = {
      relativePath: "notes/second-brain.md",
      content: `# Building a Second Brain
A note about #pkm and #knowledge management.

## Core Pillars
1. Capture
2. Organize
#productivity`,
      hash: "hash4",
      extension: ".md",
    };

    const symbols = profile.extractSymbols(noteFile);
    assert.ok(symbols.some((s) => s.name === "Building a Second Brain" && s.kind === "heading"));
    assert.ok(symbols.some((s) => s.name === "Core Pillars" && s.kind === "heading"));
    assert.ok(symbols.some((s) => s.name === "pkm" && s.kind === "tag"));
    assert.ok(symbols.some((s) => s.name === "productivity" && s.kind === "tag"));

    const entities = profile.deriveEntities([noteFile]);
    assert.equal(entities.length, 1);
    assert.equal(entities[0].title, "Building a Second Brain");
    assert.ok(entities[0].tags.includes("pkm"));
  });

  it("resolveProfile_detects_appropriate_profile", () => {
    const codeFiles = ["src/index.ts", "src/auth.ts", "package.json"];
    const pkmFiles = ["notes/journal.md", "notes/reading.md", "notes/ideas.md"];

    assert.equal(resolveProfile("auto", codeFiles).name, "codebase");
    assert.equal(resolveProfile("auto", pkmFiles).name, "pkm");
    assert.equal(resolveProfile("codebase", pkmFiles).name, "codebase");
    assert.equal(resolveProfile("pkm", codeFiles).name, "pkm");
    assert.equal(resolveProfile("hybrid", codeFiles).name, "hybrid");
  });
});
