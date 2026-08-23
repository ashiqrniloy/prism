import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it, before, after } from "node:test";
import { runCli } from "../cli.js";

const TEST_DIR = join(process.cwd(), "dist/__tests__/scratch-cli-test");

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

    const initCode = await runCli(["node", "prism-wiki", "init", "--wiki-root", wikiDir, "--profile", "codebase"]);
    assert.equal(initCode, 0);

    const refreshCode = await runCli(["node", "prism-wiki", "refresh", "--wiki-root", wikiDir]);
    assert.equal(refreshCode, 0);

    const lintCode = await runCli(["node", "prism-wiki", "lint", "--wiki-root", wikiDir]);
    assert.equal(lintCode, 0);
  });
});
