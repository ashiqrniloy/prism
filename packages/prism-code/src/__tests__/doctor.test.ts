import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismCodeConfig } from "../config.js";
import { type DoctorCheck, doctorReportToJson, formatDoctorTable, runDoctor } from "../doctor.js";
import { parseFlags } from "../flags.js";
import { getShippedProvider } from "../providers.js";
import { resolveSessionStore } from "../sessions.js";

async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `prism-code-doctor-${prefix}-`));
}

function baseConfig(cwd: string): PrismCodeConfig {
  return { cwd, credentials: { store: "memory" }, store: { type: "memory" } };
}

function shipped(id: string) {
  const descriptor = getShippedProvider(id);
  if (!descriptor) throw new Error(`missing shipped provider ${id}`);
  return descriptor;
}

function findCheck(checks: readonly DoctorCheck[], name: string): DoctorCheck {
  const check = checks.find((entry) => entry.name === name);
  assert.ok(check, `missing check ${name} in [${checks.map((c) => c.name).join(", ")}]`);
  return check;
}

describe("prism-code doctor", () => {
  it("fails with a clear row when no provider credentials exist", async () => {
    const dir = await makeTempDir("noproviders");
    try {
      const report = await runDoctor({
        config: baseConfig(dir),
        home: dir,
        env: {},
        providers: [shipped("anthropic")],
        mcpTimeoutMs: 500,
      });
      assert.equal(report.ok, false);
      assert.equal(report.exitCode, 1);
      const providers = findCheck(report.checks, "providers");
      assert.equal(providers.status, "fail");
      assert.match(providers.detail, /no credentials found/);
      assert.ok(providers.hint?.includes("ANTHROPIC_API_KEY"));
      const table = formatDoctorTable(report);
      assert.match(table, /fail\s+providers/);
      assert.match(table, /doctor: \d+ failed/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports ok for an ambient provider and a resolvable model", async () => {
    const dir = await makeTempDir("ok");
    try {
      const report = await runDoctor({
        config: { ...baseConfig(dir), model: { provider: "ollama", model: "llama3" } },
        home: dir,
        env: { TERM: "xterm-kitty", COLORTERM: "truecolor" },
        providers: [shipped("ollama")],
        mcpTimeoutMs: 500,
      });
      assert.equal(report.ok, true, formatDoctorTable(report));
      assert.equal(report.exitCode, 0);
      for (const check of report.checks) {
        assert.ok(check.name.length > 0);
        assert.ok(["ok", "warn", "fail"].includes(check.status));
        assert.ok(check.detail.length > 0);
      }
      assert.equal(findCheck(report.checks, "providers").status, "ok");
      assert.equal(findCheck(report.checks, "terminal").status, "ok");
      assert.ok(findCheck(report.checks, "runtime").detail.includes("bun "));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("warns on loose home permissions and a missing home", async () => {
    const dir = await makeTempDir("home");
    try {
      const loose = join(dir, "loose");
      mkdirSync(loose, { recursive: true, mode: 0o755 });
      chmodSync(loose, 0o755);
      const looseReport = await runDoctor({
        config: baseConfig(dir),
        home: loose,
        env: {},
        providers: [shipped("ollama")],
        mcpTimeoutMs: 500,
      });
      const home = findCheck(looseReport.checks, "home");
      assert.equal(home.status, "warn");
      assert.match(home.detail, /mode 755/);
      assert.ok(home.hint?.includes("0700"));

      const missingReport = await runDoctor({
        config: baseConfig(dir),
        home: join(dir, "absent"),
        env: {},
        providers: [shipped("ollama")],
        mcpTimeoutMs: 500,
      });
      assert.equal(findCheck(missingReport.checks, "home").status, "warn");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("checks the sqlite session database and fails on corruption", async () => {
    const dir = await makeTempDir("db");
    try {
      const dbPath = join(dir, "sessions.db");
      const config: PrismCodeConfig = { cwd: dir, credentials: { store: "memory" }, store: { type: "sqlite", path: dbPath } };
      const store = resolveSessionStore(config, dir);
      await store.append({
        id: "entry1",
        sessionId: "s1",
        timestamp: new Date().toISOString(),
        kind: "message",
        message: { role: "user", content: [{ type: "text", text: "hi" }] },
      });

      const healthy = await runDoctor({ config, home: dir, env: {}, providers: [shipped("ollama")], mcpTimeoutMs: 500 });
      const sessionDb = findCheck(healthy.checks, "session-db");
      assert.equal(sessionDb.status, "ok", sessionDb.detail);
      assert.match(sessionDb.detail, /quick_check ok/);

      writeFileSync(join(dir, "broken.db"), "this is not a database");
      const corrupt = await runDoctor({
        config: { ...config, store: { type: "sqlite", path: join(dir, "broken.db") } },
        home: dir,
        env: {},
        providers: [shipped("ollama")],
        mcpTimeoutMs: 500,
      });
      const corruptCheck = findCheck(corrupt.checks, "session-db");
      assert.equal(corruptCheck.status, "fail");
      assert.equal(corrupt.exitCode, 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails an MCP server that cannot connect", async () => {
    const dir = await makeTempDir("mcp");
    try {
      const config: PrismCodeConfig = {
        ...baseConfig(dir),
        mcp: { servers: [{ serverId: "broken", command: "/nonexistent-prism-mcp-binary-xyz" }] },
      };
      const report = await runDoctor({
        config,
        home: dir,
        env: {},
        providers: [shipped("ollama")],
        mcpTimeoutMs: 1000,
      });
      const check = findCheck(report.checks, "mcp:broken");
      assert.equal(check.status, "fail");
      assert.match(check.detail, /connect failed/);
      assert.equal(report.exitCode, 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("parses the doctor subcommand and --json flag", () => {
    const flags = parseFlags(["doctor", "--json"]);
    assert.equal(flags.subcommand, "doctor");
    assert.equal(flags.json, true);
    assert.equal(flags.prompt, undefined);

    const plain = parseFlags(["doctor"]);
    assert.equal(plain.subcommand, "doctor");
    assert.equal(plain.json, undefined);
  });

  it("emits a stable JSON schema", async () => {
    const dir = await makeTempDir("json");
    try {
      const report = await runDoctor({ config: baseConfig(dir), home: dir, env: {}, providers: [shipped("ollama")], mcpTimeoutMs: 500 });
      const parsed = JSON.parse(doctorReportToJson(report)) as {
        version: number;
        ok: boolean;
        exitCode: number;
        checks: { name: string; status: string; detail: string }[];
      };
      assert.equal(parsed.version, 1);
      assert.equal(parsed.ok, report.ok);
      assert.equal(parsed.exitCode, report.exitCode);
      assert.ok(parsed.checks.length >= 9);
      assert.ok(
        parsed.checks.every(
          (check) => typeof check.name === "string" && typeof check.status === "string" && typeof check.detail === "string",
        ),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
