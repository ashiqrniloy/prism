/**
 * Prism Code live smoke (plans/136 Task 8).
 *
 * Drives the real `packages/prism-code/bin/prism-code.ts` binary against a temporary
 * `PRISM_HOME` + owner-only file credential store:
 *
 *   - stored API key: the key lives only in `auth.json` (the provider env var is stripped
 *     from the child), so a successful turn proves the durable credential path end to end.
 *   - OAuth refresh: an `openai-codex` entry with an expired access token is seeded; the run
 *     must refresh it against the real token endpoint and persist the refreshed tokens.
 *   - full journey (plan 140 Task 6): `PRISM_LIVE_PRISM_CODE_JOURNEY=1` drives `/provider`
 *     login, an ask-mode task with `todo_write`, quit, `--continue` replay, `/om:status`,
 *     a stdio MCP tool, and `doctor` on both the Bun and linux-x64 binary channels.
 *
 * Skip-not-fail: without `PRISM_LIVE_PROVIDER_TESTS=1` plus an API key (or a Codex refresh
 * token for the OAuth leg only) the suite prints SKIP and exits 0. A provider-side 401/403
 * means the credential is unavailable, not that the CLI is broken (`e2e-cli-live` convention).
 *
 * Transcripts are captured and scanned: no credential value may appear in stdout/stderr.
 */

import { afterAll as after, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempEnvironment, ptySupported, startTui } from "./lib/pty-harness.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(REPO_ROOT, "packages", "prism-code", "bin", "prism-code.ts");
const { createFileCredentialStore } = await import(join(REPO_ROOT, "packages", "prism-core", "dist", "credentials", "node", "index.js"));

const LIVE = process.env.PRISM_LIVE_PROVIDER_TESTS === "1";
const REQUESTED = process.env.PRISM_LIVE_PRISM_CODE_PROVIDER;
const API_KEY_PROVIDERS = [
  { id: "anthropic", envVar: "ANTHROPIC_API_KEY", model: process.env.PRISM_LIVE_ANTHROPIC_MODEL ?? "claude-haiku-4-5" },
  { id: "openai", envVar: "OPENAI_API_KEY", model: process.env.PRISM_LIVE_OPENAI_MODEL ?? "gpt-5.1" },
  {
    id: "opencode-go",
    envVar: "OPENCODE_GO_API_KEY",
    model: process.env.PRISM_LIVE_OPENCODE_GO_MODEL ?? "longcat-2.5-preview-free",
  },
];
const apiKeySpec = REQUESTED
  ? API_KEY_PROVIDERS.find((p) => p.id === REQUESTED && process.env[p.envVar])
  : API_KEY_PROVIDERS.find((p) => process.env[p.envVar]);
const codexRefresh = process.env.PRISM_LIVE_CODEX_REFRESH_TOKEN;
const codexModel = process.env.PRISM_LIVE_CODEX_MODEL ?? "gpt-5.1-codex";

if (!LIVE || (!apiKeySpec && !codexRefresh)) {
  // The offline journey-development path still needs the suite to run: mock provider + allow flag.
  const journeyMockDev =
    process.env.PRISM_LIVE_PRISM_CODE_JOURNEY === "1" &&
    process.env.PRISM_LIVE_PRISM_CODE_JOURNEY_PROVIDER === "mock" &&
    process.env.PRISM_LIVE_PRISM_CODE_JOURNEY_ALLOW_MOCK === "1";
  if (!journeyMockDev) {
    const why = !LIVE
      ? "set PRISM_LIVE_PROVIDER_TESTS=1 plus ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENCODE_GO_API_KEY"
      : "no provider credential found (ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENCODE_GO_API_KEY, or PRISM_LIVE_CODEX_REFRESH_TOKEN)";
    console.log(`[e2e-prism-code-live] SKIP: ${why}`);
    process.exit(0); // skip-not-fail: the matrix treats an empty run as a skip
  }
}

const PROMPT = "Reply with exactly the word: pong";
/** Task leg (opt-in, `PRISM_LIVE_PRISM_CODE_TASK=1`): a real create-file → test → green check run. */
const TASK_ENABLED = process.env.PRISM_LIVE_PRISM_CODE_TASK === "1";
const TASK_PROMPT =
  "Create src/sum.ts exporting a typed add(a: number, b: number): number, then write src/sum.test.ts with bun:test " +
  "covering add(1, 2) === 3. Run the 'test' coding_check and fix the code until the check passes. Reply DONE when green.";
/** A provider-side rejection is an unavailable credential (skip), not a CLI regression. */
function isCredentialRejected(text) {
  return (
    /\b(401|403)\b/.test(text) &&
    /invalid[_ -](x-)?api[_ -]key|missing authentication|unauthorized|authentication_error|invalid_grant|incorrect api key|expired/i.test(
      text,
    )
  );
}

const temps = [];
async function makeTemp(prefix) {
  const dir = await mkdtemp(join(tmpdir(), `prism-code-live-${prefix}-`));
  temps.push(dir);
  return dir;
}

/** Global layer pins the owner-only file store so the run never touches this host's keychain. */
async function prepareHome(extra = {}) {
  const home = await makeTemp("home");
  const workspace = await makeTemp("workspace");
  await mkdir(home, { recursive: true });
  await writeFile(join(home, "config.json"), JSON.stringify({ credentials: { store: "file" }, ...extra }));
  return { home, workspace };
}

function runBinary({ home, workspace, env }) {
  const childEnv = { ...process.env, PRISM_HOME: home };
  for (const provider of API_KEY_PROVIDERS) delete childEnv[provider.envVar];
  return spawnSync(process.execPath, [BIN, "-p", PROMPT, "--mode", "print"], {
    encoding: "utf8",
    cwd: workspace,
    env: { ...childEnv, ...env },
  });
}

/** The task leg runs with `--approve all` (the checks command is shell-equivalent) and `--mode json`. */
function runBinaryTask({ home, workspace }) {
  const childEnv = { ...process.env, PRISM_HOME: home };
  for (const provider of API_KEY_PROVIDERS) delete childEnv[provider.envVar];
  return spawnSync(process.execPath, [BIN, "-p", TASK_PROMPT, "--mode", "json", "--approve", "all"], {
    encoding: "utf8",
    cwd: workspace,
    env: childEnv,
    timeout: 300_000,
  });
}

/** Parse `--mode json` lines into the events they wrap. */
function parseJsonEvents(stdout) {
  const events = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const payload = JSON.parse(line);
      if (payload?.type === "event" && payload.event) events.push(payload.event);
    } catch {
      // Non-JSON lines (provider notices) are ignored; the exit code carries the failure.
    }
  }
  return events;
}

function assertSecretClean(result, secrets) {
  const transcript = `${result.stdout}\n${result.stderr}`;
  for (const secret of secrets) {
    if (!secret) continue;
    assert.equal(transcript.includes(secret), false, "the credential must never appear in the transcript");
  }
}

after(async () => {
  for (const dir of temps) await rm(dir, { recursive: true, force: true });
});

describe("prism-code live smoke", () => {
  const storedKeyIt = apiKeySpec ? it : it.skip;
  storedKeyIt(
    "runs a real turn from an API key stored in the owner-only file store",
    async () => {
      const spec = apiKeySpec;
      const { home, workspace } = await prepareHome({ model: { provider: spec.id, model: spec.model } });
      const store = createFileCredentialStore({ path: join(home, "auth.json") });
      await store.set({ name: "apiKey", provider: spec.id, credential: { type: "api_key", value: process.env[spec.envVar] } });
      assert.ok(existsSync(join(home, "auth.json")), "the seeded store must exist on disk");

      const result = runBinary({ home, workspace });
      assertSecretClean(result, [process.env[spec.envVar]]);
      if (result.status !== 0 && isCredentialRejected(`${result.stdout}${result.stderr}`)) {
        console.log(`[e2e-prism-code-live] SKIP stored-key leg: ${spec.envVar} was rejected by the provider`);
        return;
      }
      assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
      assert.match(result.stdout.toLowerCase(), /pong/, `stdout: ${result.stdout}`);
    },
    60_000,
  );

  const oauthIt = codexRefresh ? it : it.skip;
  oauthIt(
    "refreshes an expired openai-codex OAuth token against the real token endpoint",
    async () => {
      const { home, workspace } = await prepareHome({ model: { provider: "openai-codex", model: codexModel } });
      const store = createFileCredentialStore({ path: join(home, "auth.json") });
      const expiredAccess = "expired-access-token-placeholder";
      await store.setOAuth("openai-codex", { access: expiredAccess, refresh: codexRefresh, expires: Date.now() - 3_600_000 });

      const result = runBinary({ home, workspace });
      assertSecretClean(result, [expiredAccess, codexRefresh]);
      if (result.status !== 0 && isCredentialRejected(`${result.stdout}${result.stderr}`)) {
        console.log("[e2e-prism-code-live] SKIP OAuth leg: the supplied refresh token was rejected upstream");
        return;
      }
      assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
      assert.match(result.stdout.toLowerCase(), /pong/, `stdout: ${result.stdout}`);

      // The refresh must have been persisted back into the store, not just used in memory.
      const refreshed = await createFileCredentialStore({ path: join(home, "auth.json") }).getOAuth("openai-codex");
      assert.ok(refreshed?.access && refreshed.access !== expiredAccess, "the stored access token must be replaced");
      assert.ok(
        typeof refreshed.expires !== "number" || refreshed.expires > Date.now() - 120_000,
        `the refreshed expiry must move forward, got ${refreshed.expires}`,
      );
      assert.equal(refreshed.refresh, codexRefresh, "the refresh token is carried forward");
    },
    60_000,
  );

  const taskIt = apiKeySpec && TASK_ENABLED ? it : it.skip;
  taskIt(
    "creates a file, writes a test, and finishes with a green named check",
    async () => {
      const spec = apiKeySpec;
      const { home, workspace } = await prepareHome({ model: { provider: spec.id, model: spec.model } });
      const store = createFileCredentialStore({ path: join(home, "auth.json") });
      await store.set({ name: "apiKey", provider: spec.id, credential: { type: "api_key", value: process.env[spec.envVar] } });
      // Project config declares the named check; `--approve all` lets the agent run it without a prompt.
      await writeFile(
        join(workspace, "prism-code.json"),
        JSON.stringify({ checks: { test: { command: "bun", args: ["test"] } } }, null, 2),
      );

      const result = runBinaryTask({ home, workspace });
      assertSecretClean(result, [process.env[spec.envVar]]);
      if (result.status !== 0 && isCredentialRejected(`${result.stdout}${result.stderr}`)) {
        console.log(`[e2e-prism-code-live] SKIP task leg: ${spec.envVar} was rejected by the provider`);
        return;
      }
      assert.strictEqual(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout.slice(-2_000)}`);

      // The workspace must contain the agent's source + test files.
      const files = await readdir(workspace, { recursive: true });
      assert.ok(
        files.some((file) => /sum\.test\.(ts|tsx|js|mjs)$/.test(file)),
        `no test file written: ${files.join(", ")}`,
      );
      assert.ok(
        files.some((file) => /sum\.(ts|tsx|js|mjs)$/.test(file)),
        `no source file written: ${files.join(", ")}`,
      );

      // A green named check: `coding_check` finished with exit code 0 on the agent's own test file.
      const events = parseJsonEvents(result.stdout);
      const checks = events.filter((event) => event.type === "tool_execution_finished" && event.result?.name === "coding_check");
      assert.ok(checks.length >= 1, `the run must call coding_check: ${events.map((e) => e.type).join(", ")}`);
      assert.ok(
        checks.some((event) => event.result?.error === undefined && event.result?.metadata?.exitCode === 0),
        `no green check run: ${JSON.stringify(checks.map((event) => event.result?.metadata))}`,
      );
    },
    300_000,
  );
});

// ── Full release-acceptance journey (plan 140 Task 6) ────────────────────────
//
// One real-provider journey per channel. Enabled with PRISM_LIVE_PRISM_CODE_JOURNEY=1
// plus a provider key: ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENCODE_GO_API_KEY
// (PRISM_LIVE_PRISM_CODE_JOURNEY_PROVIDER picks one; the default key present wins).
// `..._JOURNEY_PROVIDER=mock` with `..._ALLOW_MOCK=1` drives the same journey offline (the
// harness-development path; the observation assertion is relaxed there). A provider outside the
// shipped catalog (e.g. opencode-go's live model list) reports no catalog cost, so
// `PRISM_LIVE_PRISM_CODE_JOURNEY_MAX_COST=off` drops the `--max-cost` cap for those models.
//
// Steps: /provider login → todo_write-planning task with ask-mode approvals → quit →
// --continue replay → /om:status observations → stdio MCP echo tool → doctor. The report
// (PRISM_LIVE_JOURNEY_REPORT) carries per-step times and the first-response latency.

const JOURNEY_ENABLED = process.env.PRISM_LIVE_PRISM_CODE_JOURNEY === "1";
const JOURNEY_ALLOW_MOCK = process.env.PRISM_LIVE_PRISM_CODE_JOURNEY_ALLOW_MOCK === "1";
const JOURNEY_PROVIDER = process.env.PRISM_LIVE_PRISM_CODE_JOURNEY_PROVIDER;
// A catalog-unknown model reports `observed: null` for maxCost, which fails closed before the first
// token (observed on opencode-go/longcat-2.5-preview-free), so the cap is opt-out for free models.
const JOURNEY_MAX_COST = Number(process.env.PRISM_LIVE_PRISM_CODE_JOURNEY_MAX_COST ?? 2);
const JOURNEY_MAX_COST_ARGS = Number.isFinite(JOURNEY_MAX_COST) && JOURNEY_MAX_COST > 0 ? ["--max-cost", String(JOURNEY_MAX_COST)] : [];
// 190 padded lines (~41 KB) is ONE read under the tool's 50 KB cap (a 2000-line fixture made the
// model page through the file until compaction), stays above the observational-memory 10k-token
// observation threshold so the observer actually records, and fits a 32k context.
const JOURNEY_BIG_FILE_LINES = Number(process.env.PRISM_LIVE_JOURNEY_BIG_FILE_LINES ?? 190);
const JOURNEY_REPORT = process.env.PRISM_LIVE_JOURNEY_REPORT;
const TASK_TOKEN = "JOURNEY-TASK-DONE";
const MCP_TOKEN = "MCP-JOURNEY-DONE";
const LOREM = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor";
const PROVIDER_NAMES = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI",
  "opencode-go": "OpenCode Go",
  mock: "Mock Provider",
};

const journeySpec = (() => {
  const id = JOURNEY_PROVIDER ?? apiKeySpec?.id;
  if (id === "mock") return JOURNEY_ALLOW_MOCK ? { id, name: PROVIDER_NAMES.mock, model: "default" } : undefined;
  const spec = API_KEY_PROVIDERS.find((provider) => provider.id === id);
  if (!spec || !process.env[spec.envVar]) return undefined;
  return { id: spec.id, name: PROVIDER_NAMES[spec.id], envVar: spec.envVar, model: spec.model };
})();

if (JOURNEY_ENABLED && !journeySpec) {
  console.log(
    "[e2e-prism-code-live] journey SKIP: no API key (ANTHROPIC_API_KEY/OPENAI_API_KEY/OPENCODE_GO_API_KEY) or allowed mock provider",
  );
}

/** The Bun channel is the built repo bin; the binary channel is the linux-x64 archive binary. */
function journeyChannels() {
  const wanted = new Set((process.env.PRISM_LIVE_JOURNEY_CHANNELS ?? "bun,binary").split(",").map((id) => id.trim()));
  const channels = [];
  if (wanted.has("bun")) {
    channels.push({ id: "bun", command: ["bun", join(REPO_ROOT, "packages", "prism-code", "dist", "bin", "prism-code.js")] });
  }
  if (wanted.has("binary") && process.platform === "linux" && process.arch === "x64") {
    const binary = join(REPO_ROOT, "dist-bin", "linux-x64", "prism-code");
    channels.push({ id: "binary", command: [binary], missing: !existsSync(binary) });
  }
  return channels;
}

const JOURNEY_TASK_TIMEOUT_MS = Number(process.env.PRISM_LIVE_PRISM_CODE_JOURNEY_TASK_TIMEOUT_MS ?? 600_000);
const JOURNEY_MCP_TIMEOUT_MS = Number(process.env.PRISM_LIVE_PRISM_CODE_JOURNEY_MCP_TIMEOUT_MS ?? 300_000);
const JOURNEY_NUDGE_AFTER_MS = Number(process.env.PRISM_LIVE_JOURNEY_NUDGE_AFTER_MS ?? 45_000);
const JOURNEY_MAX_NUDGES = Number(process.env.PRISM_LIVE_JOURNEY_MAX_NUDGES ?? 4);
const JOURNEY_OM_ATTEMPTS = Number(process.env.PRISM_LIVE_JOURNEY_OM_ATTEMPTS ?? 8);
const JOURNEY_NUDGE_PROMPT = "Continue with the remaining todos and finish the task now.";
// Single line: the TUI input submits on Enter and a multi-line paste is not what the journey tests.
const JOURNEY_TASK_PROMPT = [
  "Work in this workspace. Plan with todo_write first, then:",
  '1. create src/answer.ts exporting const ANSWER = "journey-ok";',
  '2. create src/answer.test.ts asserting ANSWER === "journey-ok" with bun:test,',
  "3. run `bun test` with the shell tool and fix the code until it passes,",
  // The success token lives in TOKEN.txt: a model that only plans cannot echo it, so its appearance
  // proves the run really finished the work (a token quoted in the prompt matched the plan instead).
  "4. read TOKEN.txt and reply with exactly its contents.",
].join(" ");

/** Its own turn: crossing the observer's token threshold is all this has to do. */
const JOURNEY_READ_PROMPT = "Read big.txt with the read tool, then reply with only its first line.";

const JOURNEY_MCP_PROMPT =
  "Use the MCP tool `mcp:echo:echo` (the echo server) with text 'mcp-journey-ok', then reply with exactly the three words MCP, JOURNEY, DONE joined by hyphens (uppercase).";

function journeyTextDelta(text) {
  return { type: "content_delta", content: { type: "text", text } };
}

function journeyToolCall(id, name, arguments_) {
  return { type: "tool_call", call: { type: "tool_call", id, name, arguments: arguments_ } };
}

/** Mock-provider script for the offline harness path: one file per session. */
function writeMockJourneyScript(home, kind) {
  const turns =
    kind === "task"
      ? [
          [
            journeyToolCall("j_todo", "todo_write", {
              todos: [
                { id: "s1", content: "read the long fixture", status: "pending" },
                { id: "s2", content: "write src/answer.ts", status: "pending" },
              ],
            }),
            journeyToolCall("j_write", "write", { path: "src/answer.ts", content: 'export const ANSWER = "journey-ok";\n' }),
            journeyToolCall("j_test", "write", {
              path: "src/answer.test.ts",
              content:
                'import { expect, test } from "bun:test";\nimport { ANSWER } from "./answer.js";\n\ntest("answer", () => {\n  expect(ANSWER).toBe("journey-ok");\n});\n',
            }),
          ],
          [journeyTextDelta(TASK_TOKEN), { type: "done" }],
        ]
      : [
          [journeyTextDelta(`line 1: ${LOREM}`), { type: "done" }],
          [journeyToolCall("j_mcp", "mcp:echo:echo", { text: "mcp-journey-ok" })],
          [journeyTextDelta(MCP_TOKEN), { type: "done" }],
        ];
  const script = join(home, `journey-${kind}-mock.json`);
  writeFileSync(script, JSON.stringify(turns));
  return script;
}

/**
 * The approval modal paints over existing content, so the extracted screen row can interleave
 * the two: match either intact option text or the bracketed keys.
 */
function approvalVisible(screen) {
  return screen.includes("[d] Deny (Esc)") || screen.includes("Allow once") || /\[a\][\s\S]{0,30}Allow/.test(screen);
}

/** Polls the rendered screen, answering ask-mode approval prompts, until `until` matches. */
async function pumpTui(tui, { startedAt, baseline, until, timeoutMs, label }) {
  const deadline = Date.now() + timeoutMs;
  let approvals = 0;
  let nudges = 0;
  let firstResponseMs;
  let screen = "";
  let lastScreen = "";
  let lastProgressAt = Date.now();
  for (;;) {
    await tui.settled();
    screen = tui.screen();
    if (screen !== lastScreen) {
      lastScreen = screen;
      lastProgressAt = Date.now();
    }
    if (firstResponseMs === undefined && screen !== baseline) firstResponseMs = Date.now() - startedAt;
    if (until(screen)) return { screen, approvals, nudges, firstResponseMs };
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}\n--- screen ---\n${screen.slice(-3000)}`);
    }
    if (approvalVisible(screen)) {
      await tui.press("a");
      approvals += 1;
      // Let the prompt close before looking for the next one.
      const goneBy = Date.now() + 10_000;
      while (Date.now() < goneBy) {
        await tui.settled();
        if (!approvalVisible(tui.screen())) break;
        await Bun.sleep(50);
      }
      continue;
    }
    // A weak model can narrate the remaining todos instead of acting; the agent's own continuation
    // gives up after two no-progress turns, so the journey nudges it the way an operator would.
    if (nudges < JOURNEY_MAX_NUDGES && Date.now() - lastProgressAt > JOURNEY_NUDGE_AFTER_MS) {
      await clearInput(tui);
      await submitPrompt(tui, JOURNEY_NUDGE_PROMPT);
      nudges += 1;
      lastProgressAt = Date.now();
      continue;
    }
    await Bun.sleep(120);
  }
}

/**
 * Types a filter into a picker and waits for the list to show it. `setOptions` keeps the filter and
 * the selection across a live refresh (picker.ts), so one attempt sticks; the screen check is the
 * evidence that Enter will hit the intended row.
 */
async function filterPicker(tui, query, label) {
  for (let index = 0; index < query.length + 2; index += 1) await tui.press("backspace");
  await tui.type(query);
  const deadline = Date.now() + 60_000;
  for (;;) {
    await tui.settled();
    const screen = tui.screen();
    if (screen.includes("Search") && screen.includes(query)) return screen;
    if (Date.now() > deadline) throw new Error(`could not filter ${label} to "${query}"\n${screen.slice(-2000)}`);
    await Bun.sleep(250);
  }
}

const filterProviderPicker = (tui, id, name) => filterPicker(tui, id, `the provider picker for ${name}`);

/** Types a prompt, lets the input settle, then submits: a fast Enter after a long paste is dropped. */
async function submitPrompt(tui, text) {
  await tui.type(text);
  await Bun.sleep(400);
  await tui.press("enter");
}

async function waitForEither(tui, patterns, { timeoutMs, label }) {
  const deadline = Date.now() + timeoutMs;
  let screen = "";
  for (;;) {
    await tui.settled();
    screen = tui.screen();
    for (const pattern of patterns) if (pattern.test(screen)) return { screen, pattern };
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}\n--- screen ---\n${screen.slice(-3000)}`);
    }
    await Bun.sleep(80);
  }
}

/** Clears the prompt input: Ctrl+D is delete-char on a non-empty buffer, not quit. */
async function clearInput(tui) {
  for (let index = 0; index < 40; index += 1) await tui.press("backspace");
}

async function journeyExit(tui) {
  const result = await Promise.race([tui.exited, Bun.sleep(15_000).then(() => "timeout")]);
  assert.strictEqual(result, 0, "the TUI must exit cleanly after Ctrl+D");
}

function redactSecrets(text, secrets) {
  let out = text;
  for (const secret of secrets) if (secret) out = out.split(secret).join("[redacted]");
  return out;
}

/** Runs the full journey on one channel and returns the evidence record. */
async function runJourneyChannel(channel, spec) {
  const env = await makeTempEnvironment(`prism-code-journey-${channel.id}`);
  const { home, cwd } = env;
  const steps = [];
  const secret = spec.envVar ? process.env[spec.envVar] : undefined;
  try {
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify(
        {
          credentials: { store: "file" },
          observationalMemory: { enabled: true },
          mcp: {
            servers: [
              {
                serverId: "echo",
                command: "bun",
                args: [join(REPO_ROOT, "scripts", "fixtures", "mcp-smoke-server.mjs")],
                allow: "stdio",
              },
            ],
          },
        },
        null,
        2,
      ),
    );
    writeFileSync(join(cwd, "TOKEN.txt"), `${TASK_TOKEN}\n`);
    writeFileSync(
      join(cwd, "big.txt"),
      Array.from({ length: JOURNEY_BIG_FILE_LINES }, (_, index) => `line ${index + 1}: ${LOREM} ${LOREM} ${LOREM}`).join("\n"),
    );
    // The model is preset on both sessions: `--continue` without `--model` re-runs the provider
    // picker instead of resuming (observed), and the mock provider prices calls at Infinity so the
    // real run's budget cap stays live-only. The live key is still entered through /provider below.
    const args = ["--model", `${spec.id}/${spec.model}`, "--approve", "ask", ...(spec.id === "mock" ? [] : JOURNEY_MAX_COST_ARGS)];
    const mockEnv = (kind) => (spec.id === "mock" ? { PRISM_CODE_MOCK_SCRIPT: writeMockJourneyScript(home, kind) } : {});

    // Session 1: /provider login, then the todo_write-planned task under ask-mode approvals.
    const loginAt = Date.now();
    const first = await startTui({ cwd, home, command: channel.command, args, env: mockEnv("task") });
    try {
      // A missing live credential opens the onboarding provider picker; the ambient mock does not.
      const startup = await waitForEither(first, [/Select AI Provider/, /OM: on/], {
        timeoutMs: 90_000,
        label: "the first-run UI",
      });
      if (startup.screen.includes("Select AI Provider")) {
        await filterProviderPicker(first, spec.id, spec.name);
        await first.press("enter");
        if (spec.envVar) {
          await first.waitFor(`Enter ${spec.envVar}`, { timeoutMs: 30_000, label: "the masked API-key prompt" });
          await first.type(secret);
          await first.press("enter");
          const verified = await waitForEither(first, [/Select Model \(/, /Could not verify the /], {
            timeoutMs: 60_000,
            label: "key verification",
          });
          if (/Could not verify the /.test(verified.screen)) await first.press("enter"); // "Save anyway"
        }
        // The picker lists the provider's *static catalog*; a gateway-live model (e.g. an
        // opencode-go id absent from the catalog) is not in it, so the journey keeps the pinned
        // `--model` and cancels. /provider must not have replaced it with the catalog default
        // (plan 140 Task 6 live run switched longcat-2.5-preview-free to grok-4.5 here).
        await first.waitFor(/Select Model \(/, { timeoutMs: 60_000, label: "the model picker" });
        await first.press("escape");
      }
      // Wait for the modals to be gone and the session to attach: the placeholder line is
      // visible behind an open picker, and early keystrokes before session assembly are dropped
      // (the footer flips `OM: off` → `OM: on` once the agent is attached).
      await first.waitFor((text) => text.includes("Type a prompt") && !text.includes("Select Model") && text.includes("OM: on"), {
        timeoutMs: 60_000,
        label: "the prompt input",
      });
      assert.ok(first.screen().includes(spec.model), `the footer must show the pinned model ${spec.model}`);
      await first.settled();
      steps.push({ name: "provider-login", ms: Date.now() - loginAt });
      assert.equal(first.screen().includes(secret ?? "\u0000never"), false, "the credential must not appear on screen");

      if (process.env.PRISM_LIVE_JOURNEY_DEBUG === "1") console.log(`[journey:${channel.id}] before task submit:\n${first.screen()}`);
      const taskAt = Date.now();
      const baseline = first.screen();
      await submitPrompt(first, JOURNEY_TASK_PROMPT);
      if (process.env.PRISM_LIVE_JOURNEY_DEBUG === "1") {
        await Bun.sleep(2500);
        console.log(`[journey:${channel.id}] after task submit:\n${first.screen().slice(-1500)}`);
      }
      const task = await pumpTui(first, {
        startedAt: taskAt,
        baseline,
        // Artifacts first: a model that only plans can mention the token, but it cannot have written
        // the two files (and the harness must not race the agent loop's todo-driven continuation).
        until: (screen) =>
          screen.includes(TASK_TOKEN) && existsSync(join(cwd, "src", "answer.ts")) && existsSync(join(cwd, "src", "answer.test.ts")),
        timeoutMs: JOURNEY_TASK_TIMEOUT_MS,
        label: "the task turn",
      });
      steps.push({
        name: "task",
        ms: Date.now() - taskAt,
        firstResponseMs: task.firstResponseMs,
        approvals: task.approvals,
        nudges: task.nudges,
      });
      assert.ok(existsSync(join(cwd, "src", "answer.test.ts")), `the agent must create src/answer.test.ts\n${task.screen.slice(-2000)}`);
      assert.ok(task.screen.includes("Todos ("), "the todo panel must render the todo_write list");
      if (spec.id !== "mock") assert.ok(task.approvals >= 1, "ask mode must surface an approval prompt for the write/shell calls");
      await clearInput(first);
      await first.press("ctrl+d");
      await journeyExit(first);
    } finally {
      await first.stop();
    }

    // Session 2: --continue replay, /om:status observations, and the stdio MCP tool.
    const resumeAt = Date.now();
    const second = await startTui({ cwd, home, command: channel.command, args: ["--continue", ...args], env: mockEnv("mcp") });
    let excerpt;
    try {
      await second.waitFor(TASK_TOKEN, { timeoutMs: 60_000, label: "the resumed transcript" });
      steps.push({ name: "continue-replay", ms: Date.now() - resumeAt });

      // The observation trigger is its own turn: a >10k-token read pushed into the task turn
      // exhausts a 32k context and the weak free model stalls mid-task. One cheap turn whose only
      // job is to cross the observer's token threshold.
      const readAt = Date.now();
      const readBaseline = second.screen();
      await submitPrompt(second, JOURNEY_READ_PROMPT);
      const read = await pumpTui(second, {
        startedAt: readAt,
        baseline: readBaseline,
        // The mock script answers this turn with the first line of the fixture.
        until: (screen) => /line 1:/.test(screen),
        timeoutMs: JOURNEY_MCP_TIMEOUT_MS,
        label: "the observation-trigger read",
      });
      steps.push({ name: "observation-read", ms: Date.now() - readAt, approvals: read.approvals, nudges: read.nudges });
      // The turn only exists to put a >10k-token tool result in the session; a model that answers from
      // the transcript without calling `read` leaves the observer below its threshold.
      assert.match(read.screen, /read \{"path":|"big\.txt"/, `the observation read must call the read tool\n${read.screen.slice(-2000)}`);

      const omAt = Date.now();
      let om = { active: 0, recorded: 0 };
      let omFrame = "";
      // The observer pass is an extra model round-trip that runs after the turn (45-75s observed on
      // the opencode-go gateway), so the status query retries on a wide window before failing.
      for (let attempt = 0; attempt < JOURNEY_OM_ATTEMPTS; attempt += 1) {
        await second.submit("/om:status");
        await second.press("enter");
        const frame = await second.waitFor(/Observational memory: \d+ active \/ \d+ recorded/, {
          timeoutMs: 60_000,
          label: "the /om:status output",
        });
        const match = [...frame.matchAll(/Observational memory: (\d+) active \/ (\d+) recorded/g)].at(-1);
        om = { active: Number(match[1]), recorded: Number(match[2]) };
        omFrame = frame;
        if (om.recorded > 0 || spec.id === "mock") break;
        await Bun.sleep(20_000); // the observer flush finishes asynchronously after the read run
      }
      steps.push({ name: "om-status", ms: Date.now() - omAt, ...om });
      if (spec.id !== "mock") {
        assert.ok(
          om.recorded >= 1,
          `OM must record at least one observation, got ${JSON.stringify(om)}\n${(omFrame.match(/Observational memory:.*|Pool:.*|Runtime:.*/g) ?? []).join("\n")}`,
        );
      }

      await second.waitFor((text) => text.includes("Type a prompt") && text.includes("OM: on"), {
        timeoutMs: 60_000,
        label: "the resumed prompt input",
      });
      const mcpAt = Date.now();
      const mcpBaseline = second.screen();
      await submitPrompt(second, JOURNEY_MCP_PROMPT);
      const mcp = await pumpTui(second, {
        startedAt: mcpAt,
        baseline: mcpBaseline,
        until: (screen) => screen.includes(MCP_TOKEN),
        timeoutMs: JOURNEY_MCP_TIMEOUT_MS,
        label: "the MCP turn",
      });
      assert.match(mcp.screen, /mcp-journey-ok/, `the echo tool result must be visible\n${mcp.screen.slice(-2000)}`);
      steps.push({ name: "mcp-tool", ms: Date.now() - mcpAt, approvals: mcp.approvals, nudges: mcp.nudges });
      excerpt = redactSecrets(mcp.screen.split("\n").slice(-40).join("\n"), [secret]);
      await clearInput(second);
      await second.press("ctrl+d");
      await journeyExit(second);
    } finally {
      await second.stop();
    }

    // doctor on the same home: live credential, MCP config, and OM are all diagnosed.
    const doctorAt = Date.now();
    const [command, ...commandArgs] = channel.command;
    const doctorRun = spawnSync(command, [...commandArgs, "doctor", "--json", "--model", `${spec.id}/${spec.model}`], {
      cwd,
      encoding: "utf8",
      timeout: 120_000,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, PRISM_HOME: home, TERM: "dumb" },
    });
    const doctor = JSON.parse(doctorRun.stdout);
    const failures = (doctor?.checks ?? []).filter((entry) => entry.status === "fail").map((entry) => entry.name);
    assert.ok(
      doctor?.ok === true && failures.length === 0,
      `doctor must pass, failures: ${failures.join(", ")}\n${doctorRun.stdout.slice(0, 2000)}`,
    );
    steps.push({ name: "doctor", ms: Date.now() - doctorAt });

    return { channel: channel.id, provider: spec.id, steps, excerpt };
  } finally {
    await env.cleanup();
  }
}

describe("prism-code live journey", () => {
  for (const channel of journeyChannels()) {
    const enabled = JOURNEY_ENABLED && Boolean(journeySpec) && ptySupported() && !channel.missing;
    if (JOURNEY_ENABLED && channel.missing) {
      console.log(`[e2e-prism-code-live] journey ${channel.id} SKIP: ${channel.command[0]} is missing (build it first)`);
    }
    const itJourney = enabled ? it : it.skip;
    itJourney(
      `passes on the ${channel.id} channel: provider login, ask approvals, todo, resume, OM, MCP, doctor`,
      async () => {
        const result = await runJourneyChannel(channel, journeySpec);
        if (JOURNEY_REPORT) {
          const existing = existsSync(JOURNEY_REPORT) ? JSON.parse(readFileSync(JOURNEY_REPORT, "utf8")) : { journeys: [] };
          existing.journeys = [...(existing.journeys ?? []), result];
          writeFileSync(JOURNEY_REPORT, JSON.stringify(existing, null, 2));
          console.log(`[e2e-prism-code-live] journey ${channel.id} report written to ${JOURNEY_REPORT}`);
        }
        console.log(`[e2e-prism-code-live] journey ${result.channel}: ${JSON.stringify(result.steps)}`);
      },
      1_200_000,
    );
  }
});
