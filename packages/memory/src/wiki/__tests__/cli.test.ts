import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { runCli } from "../cli.js";
import { initWiki } from "../index.js";

const TEST_DIR = mkdtempSync(join(tmpdir(), "prism-wiki-cli-"));

describe("prism-wiki CLI runner", () => {
  before(async () => {
    await mkdir(join(TEST_DIR, "src"), { recursive: true });
    await writeFile(join(TEST_DIR, "src/app.ts"), `export function main() {}`, "utf8");
  });

  after(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("cli_prints_help_on_help_flag", async () => {
    const code = await runCli(["node", "prism-wiki", "--help"]);
    assert.equal(code, 0);
  });

  it("cli_runs_init_and_refresh_commands", async () => {
    const wikiDir = join(TEST_DIR, ".wiki");

    const initCode = await runCli([
      "node",
      "prism-wiki",
      "init",
      "--wiki-root",
      wikiDir,
      "--workspace-root",
      TEST_DIR,
      "--profile",
      "codebase",
    ]);
    assert.equal(initCode, 0);

    const refreshCode = await runCli(["node", "prism-wiki", "refresh", "--wiki-root", wikiDir, "--workspace-root", TEST_DIR]);
    assert.equal(refreshCode, 0);

    const lintCode = await runCli(["node", "prism-wiki", "lint", "--wiki-root", wikiDir, "--workspace-root", TEST_DIR]);
    assert.equal(lintCode, 0);
  });

  it("cli_lint_prints_pruned_sources_and_still_exits_0", async () => {
    const wikiRoot = ".wiki-pruned-cli";
    await initWiki({ workspaceRoot: TEST_DIR, wikiRoot, profile: "codebase" });

    const manifestPath = join(TEST_DIR, wikiRoot, ".manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.entities = {
      ...manifest.entities,
      ghost: {
        id: "ghost",
        title: "Ghost",
        category: "entity",
        tags: [],
        rawSources: ["src/gone.ts"],
        anchors: [],
        lastCompiledAt: new Date().toISOString(),
      },
    };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    await writeFile(join(TEST_DIR, wikiRoot, "entities/ghost.md"), "# Ghost\n\n## Raw Sources\n- `src/gone.ts`\n", "utf8");

    const lines: string[] = [];
    const original = console.log;
    console.log = (...values: unknown[]) => lines.push(values.join(" "));
    let code = 1;
    try {
      code = await runCli(["node", "prism-wiki", "lint", "--wiki-root", wikiRoot, "--workspace-root", TEST_DIR]);
    } finally {
      console.log = original;
    }
    const output = lines.join("\n");

    assert.equal(code, 0, "pruned sources are maintainer work, not a failing health check");
    assert.ok(output.includes("1 entity page(s) need re-filing after source pruning"), output);
    assert.ok(output.includes("entities/ghost.md lists missing source(s): src/gone.ts"), output);
    assert.ok(!output.includes(TEST_DIR), "CLI output stays workspace-relative");
  });

  it("cli_ingest_path_exit_0", async () => {
    await writeFile(join(TEST_DIR, "ingest-note.md"), "# Ingest me", "utf8");
    const code = await runCli([
      "node",
      "prism-wiki",
      "ingest",
      "--path",
      "ingest-note.md",
      "--title",
      "Ingest Note",
      "--wiki-root",
      join(TEST_DIR, ".wiki"),
      "--workspace-root",
      TEST_DIR,
    ]);
    assert.equal(code, 0);
    const ingestDirs = await readdir(join(TEST_DIR, "raw/ingest"));
    assert.ok(ingestDirs.some((entry) => entry.endsWith("-ingest-note")));
  });

  it("cli_ingest_no_input_nonzero", async () => {
    const code = await runCli(["node", "prism-wiki", "ingest", "--workspace-root", TEST_DIR]);
    assert.equal(code, 1);
  });

  it("cli_ingest_url_usage_error", async () => {
    // The standalone CLI ships no fetch client — --url must fail loudly, not fetch.
    const code = await runCli(["node", "prism-wiki", "ingest", "--url", "https://example.com/paper.md", "--workspace-root", TEST_DIR]);
    assert.equal(code, 1);
  });
});
