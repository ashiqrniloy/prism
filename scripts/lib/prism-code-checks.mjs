/**
 * Shared behavior checks for an installed or compiled `prism-code` executable (plan 140 Tasks 2–3).
 *
 * Used by scripts/prism-code-install-smoke.mjs (the `bun add -g` bin) and
 * scripts/build-prism-code-binaries.mjs (the `bun build --compile` binary self-test), so both
 * channels are held to the same bar: `--version`, the cold-start budget, a headless mock run,
 * `doctor --json`, and a TUI launch/exit over the plan 139 PTY harness.
 *
 * Hermetic by construction: a temporary HOME/PRISM_HOME/cwd, a child PATH the caller controls, the
 * credential store seeded to `memory`, and the shipped `mock` provider. The child env carries no
 * D-Bus session address, so on Linux the host Secret Service is unreachable; `auto` still runs its
 * (read-only) keychain probe before the saved choice applies, which is the shipped behavior.
 *
 * Import-safe: nothing runs at module scope.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ptySupported, startTui } from "./pty-harness.mjs";

/** Temporary home + working directory with the credential store preselected. */
export function createPrismCodeSandbox(prefix, { pathDirs = ["/usr/local/bin", "/usr/bin", "/bin"] } = {}) {
  const root = mkdtempSync(join(tmpdir(), `${prefix}-`));
  const home = join(root, "home");
  const cwd = join(root, "work");
  mkdirSync(home, { recursive: true, mode: 0o700 });
  mkdirSync(cwd, { recursive: true });
  // No first-run store-choice prompt.
  writeFileSync(join(home, "state.json"), JSON.stringify({ credentialStore: "memory" }));
  const env = {
    PATH: pathDirs.join(":"),
    HOME: home,
    PRISM_HOME: home,
    TMPDIR: tmpdir(),
    TERM: "xterm-256color",
    LANG: process.env.LANG ?? "C.UTF-8",
  };
  return {
    root,
    home,
    cwd,
    env,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** PASS/FAIL recorder that prints as it goes. */
export function createCheckRecorder() {
  const checks = [];
  return {
    checks,
    check(name, ok, detail = "") {
      checks.push({ name, ok: Boolean(ok) });
      console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
    },
    failed() {
      return checks.filter((entry) => !entry.ok);
    },
  };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Runs the shared checks against `bin`.
 *
 * @param {object} options
 * @param {string} options.bin Absolute path of the executable.
 * @param {string} options.version Expected `--version` version.
 * @param {"binary" | "bun"} options.channel Expected install channel in the `--version` output.
 * @param {ReturnType<typeof createPrismCodeSandbox>} options.sandbox
 * @param {(name: string, ok: unknown, detail?: string) => void} options.check
 * @param {number} options.versionBudgetMs Cold `--version` median budget.
 * @param {number} [options.firstFrameBudgetMs] Optional TUI first-frame budget (checked when set).
 * @param {boolean} [options.keychainProbe] Also run `doctor` with an unselected store so the real
 *   keychain probe runs; it must answer (available or unavailable) without crashing.
 * @param {boolean} [options.userToolModule] Also load a `tools.add` module from disk and run it
 *   through a scripted mock turn (the binary still imports user modules at runtime).
 * @returns {Promise<{ versionMedianMs: number, firstFrameMs?: number }>}
 */
export async function runPrismCodeChecks({
  bin,
  version,
  channel,
  sandbox,
  check,
  versionBudgetMs,
  firstFrameBudgetMs,
  keychainProbe = false,
  userToolModule = false,
}) {
  const { cwd, home, env } = sandbox;
  const app = (args, extraEnv = {}) => spawnSync(bin, args, { cwd, env: { ...env, ...extraEnv }, encoding: "utf8", timeout: 60_000 });
  const result = {};

  // ── --version + cold start ────────────────────────────────────────────────
  const versionLine = `${version} (${channel})`;
  const versionRun = app(["--version"]);
  check(
    `prism-code --version prints ${versionLine}`,
    versionRun.status === 0 && versionRun.stdout.trim() === versionLine,
    versionRun.stdout.trim(),
  );
  const samples = [];
  for (let i = 0; i < 5; i += 1) {
    const start = performance.now();
    app(["--version"]);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  result.versionMedianMs = samples[2];
  check(
    `cold --version median < ${versionBudgetMs} ms`,
    result.versionMedianMs < versionBudgetMs,
    `median ${result.versionMedianMs.toFixed(0)} ms, max ${samples[4].toFixed(0)} ms`,
  );

  // ── headless mock prompt ──────────────────────────────────────────────────
  const headless = app(["-p", "hi", "--mode", "json", "--model", "mock/default"]);
  const events = headless.stdout.trim().split("\n").filter(Boolean).map(parseJson);
  const types = events.map((line) => line?.event?.type);
  const text = events
    .filter((line) => line?.event?.type === "message_finished")
    .flatMap((line) => line.event.message?.content ?? [])
    .map((part) => part.text ?? "")
    .join("");
  check(
    "headless -p --mode json on mock/default finishes",
    headless.status === 0 && !events.includes(null) && types.at(-1) === "agent_finished" && text.includes("Mock response"),
    `exit ${headless.status}, ${events.length} events`,
  );
  if (headless.status !== 0) process.stderr.write(headless.stderr);

  // ── doctor ────────────────────────────────────────────────────────────────
  const failures = (report) => report?.checks?.filter((entry) => entry.status === "fail").map((entry) => entry.name) ?? ["unparsable"];
  const doctor = parseJson(app(["doctor", "--json", "--model", "mock/default"]).stdout);
  check(
    "doctor --json passes with --model mock/default",
    doctor?.ok === true && failures(doctor).length === 0,
    failures(doctor).join(", "),
  );
  const bare = parseJson(app(["doctor", "--json"]).stdout);
  check(
    "doctor --json without a model fails only the model check",
    bare?.ok === false && failures(bare).join(",") === "model",
    failures(bare).join(", "),
  );
  const runtime = doctor?.checks?.find((entry) => entry.name === "runtime");
  check("doctor loads OpenTUI and its native library", runtime?.status === "ok", runtime?.detail ?? "");

  if (keychainProbe) {
    // A home with no saved store choice makes doctor run the real keychain probe (embedded
    // @napi-rs/keyring addon). Headless CI runners have no Secret Service: the answer is then
    // "unavailable" (a warn row), never a crash.
    const probeHome = join(sandbox.root, "keychain-home");
    mkdirSync(probeHome, { recursive: true, mode: 0o700 });
    const probeRun = app(["doctor", "--json", "--model", "mock/default"], { HOME: probeHome, PRISM_HOME: probeHome });
    const probe = parseJson(probeRun.stdout);
    const credentials = probe?.checks?.find((entry) => entry.name === "credentials");
    check(
      "keychain probe answers without crashing",
      probe !== null && credentials !== undefined && probeRun.signal === null,
      credentials ? `${credentials.status}: ${credentials.detail}` : `exit ${probeRun.status} ${probeRun.signal ?? ""}`,
    );
  }

  if (userToolModule) {
    // A plain ToolDefinition module (no @arnilo/prism import) — the shape docs recommend for
    // binary users. The allow-list entry is an absolute prefix, as config paths require.
    const toolDir = join(sandbox.root, "tool-project");
    mkdirSync(toolDir, { recursive: true });
    writeFileSync(
      join(toolDir, "smoke-tool.mjs"),
      'export default { name: "smoke_echo", description: "Echoes a marker", execute: async (args) => "SMOKE-TOOL-OK:" + (args?.text ?? "") };\n',
    );
    writeFileSync(
      join(toolDir, "prism-code.json"),
      JSON.stringify({ tools: { add: ["./smoke-tool.mjs"], allowedModules: [`${toolDir}/`] } }),
    );
    const script = join(sandbox.root, "tool-script.json");
    writeFileSync(
      script,
      JSON.stringify([
        [{ type: "tool_call", call: { type: "tool_call", id: "c1", name: "smoke_echo", arguments: { text: "hi" } } }],
        [{ type: "content_delta", content: { type: "text", text: "done" } }, { type: "done" }],
      ]),
    );
    const toolRun = spawnSync(bin, ["-p", "hi", "--mode", "json", "--model", "mock/default", "--approve", "all"], {
      cwd: toolDir,
      env: { ...env, PRISM_CODE_MOCK_SCRIPT: script },
      encoding: "utf8",
      timeout: 60_000,
    });
    check(
      "tools.add module loads from disk and runs",
      toolRun.status === 0 && toolRun.stdout.includes("SMOKE-TOOL-OK:hi"),
      `exit ${toolRun.status}`,
    );
    if (toolRun.status !== 0) process.stderr.write(toolRun.stdout.slice(-600) + toolRun.stderr);
  }

  // ── TUI launch/exit over a PTY ────────────────────────────────────────────
  if (ptySupported() && (process.platform === "linux" || process.platform === "darwin")) {
    const launched = performance.now();
    const tui = await startTui({ cwd, home, command: [bin], args: ["--model", "mock/default"], env });
    try {
      await tui.waitFor("Type a prompt", { timeoutMs: 25_000 });
      result.firstFrameMs = performance.now() - launched;
      await tui.submit("say hello");
      await tui.waitFor("Mock response", { timeoutMs: 25_000 });
      await tui.press("ctrl+d");
      const exit = await Promise.race([tui.exited, Bun.sleep(10_000).then(() => "timeout")]);
      check("TUI launches, answers, and exits 0 over a PTY", exit === 0, `first frame ${result.firstFrameMs.toFixed(0)} ms`);
      check("TUI leaves the alternate screen on exit", tui.raw().includes("\u001b[?1049l"));
      if (firstFrameBudgetMs !== undefined) {
        check(
          `TUI first frame < ${firstFrameBudgetMs} ms`,
          result.firstFrameMs < firstFrameBudgetMs,
          `${result.firstFrameMs.toFixed(0)} ms`,
        );
      }
    } finally {
      await tui.stop();
    }
  } else {
    console.log(`SKIP TUI PTY launch/exit (${process.platform}: no PTY support)`);
  }
  return result;
}
