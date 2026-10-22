import { mock, test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, UsageError } from "../cli/args.js";
import { runCommand } from "../cli/run.js";
import { mockPackages } from "../scenarios/mock-seam.js";

mock.module("playwright-core", () => ({
  chromium: {
    launch: async (): Promise<never> => {
      throw new Error("playwright-core is not installed");
    },
  },
}));

const MODEL = { provider: "mock", model: "m" };
const BIN = join(dirname(fileURLToPath(import.meta.url)), "../../bin/prism-agent.ts");
const PLANTED = "planted-secret-value-9f3a";

function layout(approval = "ask", web: { backend: string; apiKey?: string } = { backend: "obscura" }, maxRepairs?: number) {
  const root = mkdtempSync(join(tmpdir(), "prism-agent-cli-"));
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  const config = join(root, "prism-agent.json");
  writeFileSync(
    config,
    JSON.stringify({
      models: { orchestrator: MODEL, coding: MODEL, research: MODEL },
      storePath: join(root, "sessions.db"),
      workspace,
      approval,
      web,
      ...(maxRepairs === undefined ? {} : { maxRepairs }),
    }),
  );
  return { root, workspace, config };
}

function capture() {
  const lines: string[] = [];
  const errors: string[] = [];
  return {
    lines,
    errors,
    io: {
      write: (line: string) => lines.push(line),
      writeError: (text: string) => errors.push(text),
    },
  };
}

function approvalId(lines: readonly string[]): string | undefined {
  for (const line of lines) {
    const event = JSON.parse(line) as { interruption?: { pendingDecisions?: { approvalId?: string }[] } };
    const id = event.interruption?.pendingDecisions?.[0]?.approvalId;
    if (id) return id;
  }
  return undefined;
}

test("exit_code_table", async () => {
  const completed = layout();
  const failed = layout();
  const suspended = layout();
  const cited = layout("ask", { backend: "obscura" }, 0);
  const literal = layout("ask", { backend: "brave", apiKey: "sk-literal-secret-9f3a" });
  spawnSync("git", ["init"], { cwd: suspended.workspace });
  try {
    const ok = capture();
    assert.equal(
      await runCommand({ command: "run", agent: "orchestrator", config: completed.config, prompt: "hi" }, ok.io, {
        packages: mockPackages("text"),
      }),
      0,
    );
    const boom = capture();
    assert.equal(
      await runCommand({ command: "run", agent: "orchestrator", config: failed.config, prompt: "hi" }, boom.io, {
        packages: mockPackages("fail"),
      }),
      1,
    );
    assert.throws(() => parseArgs([]), UsageError);
    const bad = capture();
    assert.equal(await runCommand({ command: "run", agent: "research", config: literal.config, prompt: "hi" }, bad.io), 2);
    assert.match(bad.errors.join("\n"), /literal value/);
    const held = capture();
    assert.equal(
      await runCommand({ command: "run", agent: "coding", config: suspended.config, prompt: "write" }, held.io, {
        packages: mockPackages("write-suspend"),
      }),
      3,
    );
    assert.ok(approvalId(held.lines), "pending approval id is in the kernel event");
    const unverified = capture();
    assert.equal(
      await runCommand({ command: "run", agent: "research", config: cited.config, prompt: "cite" }, unverified.io, {
        packages: mockPackages("cite-fail"),
      }),
      4,
    );
  } finally {
    for (const dir of [completed, failed, suspended, cited, literal]) rmSync(dir.root, { recursive: true, force: true });
  }
});

test("resume_in_fresh_process_completes", () => {
  const host = layout();
  spawnSync("git", ["init"], { cwd: host.workspace });
  const session = "session_resume";
  try {
    const first = spawnSync("bun", [BIN, "run", "--agent", "coding", "--config", host.config, "--session", session, "write the note"], {
      encoding: "utf8",
      env: { ...process.env, PRISM_AGENT_MOCK: "write-suspend" },
    });
    assert.equal(first.status, 3, first.stderr);
    const id = approvalId(first.stdout.split("\n").filter((line) => line.length > 0));
    assert.ok(id, first.stdout);
    const second = spawnSync("bun", [BIN, "resume", "--config", host.config, "--session", session, "--decision", `${id}=allow`], {
      encoding: "utf8",
      env: { ...process.env, PRISM_AGENT_MOCK: "write-resume" },
    });
    assert.equal(second.status, 0, `${second.stderr}\n${second.stdout}`);
    assert.equal(spawnSync("test", ["-f", join(host.workspace, "note.txt")]).status, 0);
  } finally {
    rmSync(host.root, { recursive: true, force: true });
  }
});

test("jsonl_and_stderr_carry_no_secret", async () => {
  const host = layout("ask", { backend: "brave", apiKey: "env:PRISM_AGENT_PLANTED" });
  const previous = process.env.PRISM_AGENT_PLANTED;
  process.env.PRISM_AGENT_PLANTED = PLANTED;
  try {
    const out = capture();
    await runCommand({ command: "run", agent: "research", config: host.config, prompt: "hi" }, out.io, { packages: mockPackages("text") });
    const blob = `${out.lines.join("")}\n${out.errors.join("\n")}`;
    assert.equal(blob.includes(PLANTED), false);
  } finally {
    if (previous === undefined) delete process.env.PRISM_AGENT_PLANTED;
    else process.env.PRISM_AGENT_PLANTED = previous;
    rmSync(host.root, { recursive: true, force: true });
  }
});

test("usage_and_literal_secret_exit_2", () => {
  const usage = spawnSync("bun", [BIN, "nope"], { encoding: "utf8" });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /Usage/);
  const host = layout("ask", { backend: "brave", apiKey: "sk-literal-secret-9f3a" });
  try {
    const rejected = spawnSync("bun", [BIN, "run", "--agent", "research", "--config", host.config, "hi"], { encoding: "utf8" });
    assert.equal(rejected.status, 2, rejected.stderr);
    assert.match(rejected.stderr, /literal value/);
    assert.equal(rejected.stdout.includes("sk-literal-secret-9f3a"), false);
  } finally {
    rmSync(host.root, { recursive: true, force: true });
  }
});
