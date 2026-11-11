import { test } from "bun:test";

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { HostConfig } from "../host/index.js";
import { writeObscuraFixture } from "../scenarios/fixtures/obscura-fixture.js";
import { researchCitationsFail, researchCitationsPass } from "../scenarios/research-citations.js";

const MODEL = { provider: "mock", model: "m", limits: { contextWindow: 64_000, maxOutputTokens: 0 } };
const HERE = dirname(fileURLToPath(import.meta.url));

function config(root: string, binary: string): HostConfig {
  return {
    models: { orchestrator: MODEL, coding: MODEL, research: MODEL },
    storePath: join(root, "sessions.db"),
    workspace: join(root, "workspace"),
    approval: "ask",
    web: { backend: "obscura", obscuraBinary: binary },
    maxRepairs: 1,
  };
}

test("research_report_citations_resolve", async () => {
  const root = mkdtempSync(join(tmpdir(), "prism-agent-cite-"));
  try {
    const verdict = await researchCitationsPass(config(root, writeObscuraFixture(root)));
    assert.equal(verdict.verdict, "passed");
    assert.equal(verdict.ledgerSize, 2);
    assert.deepEqual(verdict.unresolved, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("research_unresolved_citation_fails_check", async () => {
  const root = mkdtempSync(join(tmpdir(), "prism-agent-cite-fail-"));
  try {
    const verdict = await researchCitationsFail(config(root, writeObscuraFixture(root)));
    assert.equal(verdict.verdict, "failed");
    assert.deepEqual(verdict.unresolved, ["S9"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("browser_unavailable_notes_and_registers_nothing", async () => {
  const root = mkdtempSync(join(tmpdir(), "prism-agent-browser-"));
  try {
    const probe = spawnSync(
      process.execPath,
      [
        "-e",
        `
      const { mock } = await import("bun:test");
      mock.module("playwright-core", () => ({ chromium: { launch: async () => { throw new Error("playwright-core is not installed"); } } }));
      const { browserUnavailable } = await import("./browser-unavailable.ts");
      console.log(JSON.stringify(await browserUnavailable(${JSON.stringify(config(root, join(root, "missing-obscura")))})));
    `,
      ],
      { cwd: join(HERE, "../scenarios"), encoding: "utf8", timeout: 30_000 },
    );
    assert.equal(probe.status, 0, probe.stderr);
    const result = JSON.parse(probe.stdout);
    assert.equal(result.noted, true);
    assert.deepEqual(result.browserTools, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("host_load_does_not_import_playwright", () => {
  const host = join(HERE, "../host/index.ts");
  const load = "import";
  const script = [
    `await ${load}(${JSON.stringify(host)});`,
    'const seen = Object.keys(require.cache ?? {}).some((key) => key.includes("playwright-core"));',
    "console.log(JSON.stringify({ seen }));",
  ].join("\n");
  const result = spawnSync("bun", ["-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).seen, false);
});
