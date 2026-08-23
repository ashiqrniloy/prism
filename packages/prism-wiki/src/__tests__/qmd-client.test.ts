import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it, before, after } from "node:test";
import { QmdClient, type QmdCommandRunner } from "../search/qmd-client.js";

const TEST_DIR = join(process.cwd(), "dist/__tests__/scratch-qmd-test");

describe("prism-wiki qmd client & fallback search", () => {
  before(async () => {
    await mkdir(join(TEST_DIR, ".wiki/entities"), { recursive: true });
    await writeFile(
      join(TEST_DIR, ".wiki/entities/module-auth.md"),
      `# Authentication Module\n\nHandles JWT tokens and session verification.\n\n## Functions\n- verifyToken`,
      "utf8",
    );
  });

  after(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("qmd_client_invokes_runner_with_json_flag", async () => {
    const invokedArgs: string[][] = [];

    const mockRunner: QmdCommandRunner = async (cmd, args) => {
      invokedArgs.push([...args]);
      if (args[0] === "--version") {
        return { stdout: "qmd 0.1.0\n", stderr: "" };
      }
      if (args[0] === "search") {
        return {
          stdout: JSON.stringify([
            {
              docId: "doc_1",
              file: ".wiki/entities/module-auth.md",
              score: 0.95,
              snippet: "Handles JWT tokens",
              title: "Authentication Module",
            },
          ]),
          stderr: "",
        };
      }
      return { stdout: "[]", stderr: "" };
    };

    const client = new QmdClient({
      qmdPath: "qmd",
      runner: mockRunner,
      workspaceRoot: TEST_DIR,
      wikiRoot: ".wiki",
    });

    const isAvail = await client.isAvailable();
    assert.equal(isAvail, true);

    const hits = await client.search("JWT tokens", { mode: "search" });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].title, "Authentication Module");
    assert.equal(hits[0].docId, "doc_1");

    assert.ok(invokedArgs.some((a) => a[0] === "search" && a[1] === "JWT tokens" && a[2] === "--json"));
  });

  it("qmd_client_falls_back_to_catalog_scan_when_runner_throws", async () => {
    const failingRunner: QmdCommandRunner = async () => {
      throw new Error("qmd: command not found");
    };

    const client = new QmdClient({
      qmdPath: "non-existent-qmd",
      runner: failingRunner,
      workspaceRoot: TEST_DIR,
      wikiRoot: ".wiki",
    });

    const hits = await client.search("authentication", { mode: "search" });
    assert.ok(hits.length >= 1);
    assert.ok(hits[0].file.includes("module-auth.md"));
    assert.ok(hits[0].title?.includes("Authentication Module"));
  });
});
