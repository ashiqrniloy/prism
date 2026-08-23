import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it, before, after } from "node:test";
import { createExtensionKernel } from "@arnilo/prism";
import { createWikiExtension, initWiki, lintWiki, refreshWiki } from "../index.js";

const FIXTURE_DIR = join(process.cwd(), "dist/__tests__/fixture-e2e-codebase");

describe("prism-wiki E2E codebase lifecycle fixture", () => {
  before(async () => {
    await mkdir(join(FIXTURE_DIR, "src/auth"), { recursive: true });
    await mkdir(join(FIXTURE_DIR, "src/database"), { recursive: true });
    await mkdir(join(FIXTURE_DIR, "src/services"), { recursive: true });

    // File 1: Auth
    await writeFile(
      join(FIXTURE_DIR, "src/auth/jwt.ts"),
      `export interface TokenPayload {
  userId: string;
  role: string;
}

export function verifyToken(token: string): boolean {
  return token.startsWith("ey");
}

export function decodePayload(token: string): TokenPayload {
  return { userId: "user-1", role: "admin" };
}
`,
      "utf8",
    );

    // File 2: Database
    await writeFile(
      join(FIXTURE_DIR, "src/database/client.ts"),
      `export class DatabaseClient {
  async connect(): Promise<boolean> {
    return true;
  }
}

export function connectDb(): DatabaseClient {
  return new DatabaseClient();
}
`,
      "utf8",
    );

    // File 3: Python Service
    await writeFile(
      join(FIXTURE_DIR, "src/services/billing.py"),
      `class BillingService:
    def process_payment(self, amount: float):
        pass

def calculate_tax(amount: float) -> float:
    return amount * 0.1
`,
      "utf8",
    );
  });

  after(async () => {
    await rm(FIXTURE_DIR, { recursive: true, force: true });
  });

  it("completes_full_codebase_lifecycle_init_refresh_search_lint", async () => {
    // 1. Initial Wiki Initialization
    const initResult = await initWiki({
      workspaceRoot: FIXTURE_DIR,
      wikiRoot: ".wiki",
      profile: "codebase",
    });

    assert.equal(initResult.status, "initialized");
    assert.equal(initResult.profile, "codebase");
    assert.ok(initResult.compiledEntities >= 3);

    // Verify entity files exist and contain line anchors
    const authEntityContent = await readFile(join(FIXTURE_DIR, ".wiki/entities/module-auth.md"), "utf8");
    assert.ok(authEntityContent.includes("verifyToken"));
    assert.ok(authEntityContent.includes("decodePayload"));
    assert.ok(authEntityContent.includes("file:///"));

    // Verify skills were deployed
    const skillPath = join(FIXTURE_DIR, ".agents/skills/wiki-searcher/SKILL.md");
    const skillContent = await readFile(skillPath, "utf8");
    assert.ok(skillContent.includes("wiki-searcher"));

    // 2. Incremental Code Changes & Contradiction Logging
    // Modify src/auth/jwt.ts: Remove decodePayload, add revokeToken, modify verifyToken
    await writeFile(
      join(FIXTURE_DIR, "src/auth/jwt.ts"),
      `export interface TokenPayload {
  userId: string;
  role: string;
}

export function verifyToken(token: string): boolean {
  return token.length > 10;
}

export function revokeToken(tokenId: string): void {
  console.log("revoked");
}
`,
      "utf8",
    );

    const refreshResult = await refreshWiki({
      workspaceRoot: FIXTURE_DIR,
      wikiRoot: ".wiki",
    });

    assert.equal(refreshResult.status, "refreshed");
    assert.ok(refreshResult.delta.modified.includes("src/auth/jwt.ts"));
    assert.ok(refreshResult.delta.affectedEntities.includes("module-auth"));

    // Verify contradiction was logged in log.md for removed decodePayload
    const logContent = await readFile(join(FIXTURE_DIR, ".wiki/log.md"), "utf8");
    assert.ok(logContent.includes("contradiction"));
    assert.ok(logContent.includes("decodePayload"));

    // 3. Load Extension Kernel and Execute wiki_search
    const kernel = createExtensionKernel();
    await kernel.load([
      createWikiExtension({
        workspaceRoot: FIXTURE_DIR,
        wikiRoot: ".wiki",
      }),
    ]);

    const searchTool = kernel.registries.tools.get("wiki_search");
    assert.ok(searchTool);

    const searchRes = await searchTool.execute(
      { query: "verifyToken", mode: "search" },
      { sessionId: "s1", runId: "r1", toolCallId: "c1" },
    );

    assert.ok(searchRes.content && searchRes.content[0].type === "text");
    assert.ok(searchRes.content[0].text.includes("Auth Module"));
    assert.ok(searchRes.content[0].text.includes("verifyToken"));
    assert.ok(searchRes.content[0].text.includes("file:///"));

    // 4. Run Linter
    const lintReport = await lintWiki({
      workspaceRoot: FIXTURE_DIR,
      wikiRoot: ".wiki",
    });

    assert.equal(lintReport.ok, true);
    assert.equal(lintReport.deadAnchors.length, 0);
    assert.equal(lintReport.brokenLinks.length, 0);
  });
});
