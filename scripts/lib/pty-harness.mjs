/**
 * PTY harness for the built Prism Code TUI (plan 139 Task 7).
 *
 * Spawns the real `packages/prism-code/dist/bin/prism-code.js` under a Bun pseudo-terminal, feeds
 * the raw byte stream into a headless `@xterm/headless` screen buffer, and exposes
 * text assertions plus key/text input. Hermetic by construction: callers pass a temporary
 * `HOME`/`PRISM_HOME` and the shipped `mock` provider (optionally scripted through
 * `PRISM_CODE_MOCK_SCRIPT`), so no credential, network call, or real user state is involved.
 *
 * Import-safe: nothing runs at module scope.
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Terminal as XtermTerminal } from "@xterm/headless";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const PRISM_CODE_BIN = join(REPO_ROOT, "packages", "prism-code", "dist", "bin", "prism-code.js");

/** Named keys as the byte sequences a terminal sends. Multi-char names are aliases. */
const KEY_SEQUENCES = {
  enter: "\r",
  return: "\r",
  escape: "\x1b",
  esc: "\x1b",
  tab: "\t",
  up: "\x1b[A",
  down: "\x1b[B",
  backspace: "\x7f",
  space: " ",
  "ctrl+c": "\x03",
  "ctrl+d": "\x04",
  "ctrl+j": "\n",
  "ctrl+o": "\x0f",
  "ctrl+t": "\x14",
};

export function ptySupported() {
  return process.platform !== "win32" && typeof Bun !== "undefined" && typeof Bun.spawn === "function";
}

/** Temporary `HOME` + `PRISM_HOME` + working directory; `cleanup()` removes all of it. */
export async function makeTempEnvironment(prefix = "prism-code-pty") {
  const root = await mkdtemp(join(tmpdir(), `${prefix}-`));
  const home = join(root, "home");
  const cwd = join(root, "work");
  await mkdir(home, { recursive: true, mode: 0o700 });
  await mkdir(cwd, { recursive: true });
  return {
    root,
    home,
    cwd,
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

/**
 * Starts the built TUI in a PTY.
 *
 * @param {object} options
 * @param {string} options.cwd Working directory for the child (repo root detection, attachments).
 * @param {string} options.home Temporary HOME/PRISM_HOME.
 * @param {string[]} [options.args] Extra CLI arguments (after `--mode tui`).
 * @param {Record<string, string>} [options.env] Extra environment (overrides the hermetic base).
 * @param {number} [options.cols] PTY columns (default 100).
 * @param {number} [options.rows] PTY rows (default 30).
 * @param {string[]} [options.command] Launcher argv (default: `bun` + the built repo bin). The plan 140
 *   install smoke passes an installed `prism-code` path instead.
 */
export async function startTui({ cwd, home, args = [], env = {}, cols = 100, rows = 30, command = ["bun", PRISM_CODE_BIN] }) {
  const decoder = new TextDecoder();
  let raw = "";
  /** Serializes xterm parsing; `settled()` awaits every byte written so far. */
  let pendingWrite = Promise.resolve();
  const xterm = new XtermTerminal({ cols, rows, allowProposedApi: true, scrollback: 0 });
  const terminal = new Bun.Terminal({
    cols,
    rows,
    data: (_terminal, bytes) => {
      raw += decoder.decode(bytes, { stream: true });
      // Copy: the PTY buffer is reused by Bun, and xterm parses asynchronously. Chain the parse
      // callbacks so a screen read can wait for the complete frame instead of a torn one.
      const chunk = new Uint8Array(bytes);
      pendingWrite = pendingWrite.then(
        () =>
          new Promise((resolve) => {
            xterm.write(chunk, () => resolve(undefined));
          }),
      );
    },
  });

  const childEnv = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: home,
    PRISM_HOME: home,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    LANG: process.env.LANG ?? "C.UTF-8",
    TMPDIR: tmpdir(),
    ...env,
  };
  const proc = Bun.spawn([...command, "--mode", "tui", ...args], {
    cwd,
    env: childEnv,
    terminal,
  });

  const screenText = () => {
    const buffer = xterm.buffer.active;
    const lines = [];
    for (let row = 0; row < xterm.rows; row += 1) {
      lines.push(buffer.getLine(buffer.baseY + row)?.translateToString(true) ?? "");
    }
    return lines.join("\n");
  };

  const screenRows = () => screenText().split("\n");
  const waitFor = async (pattern, { timeoutMs = 25_000, label } = {}) => {
    const matches =
      typeof pattern === "function" ? pattern : (text) => (pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern));
    const deadline = Date.now() + timeoutMs;
    let last = "";
    while (Date.now() < deadline) {
      await pendingWrite;
      last = screenText();
      if (matches(last)) return last;
      await Bun.sleep(40);
    }
    throw new Error(`timed out waiting for ${label ?? pattern}\n--- screen ---\n${last}\n--- raw tail ---\n${raw.slice(-2000)}`);
  };

  const write = async (data) => {
    terminal.write(data);
    // A tiny yield keeps the child's read loop ahead of the next write without slowing the test.
    await Bun.sleep(20);
  };

  return {
    proc,
    /** Full raw PTY stream (ANSI included) captured so far. */
    raw: () => raw,
    screen: screenText,
    rows: screenRows,
    /** Resolves once every byte received so far has been parsed into the screen buffer. */
    settled: () => pendingWrite,
    /** Resolves with the child's exit code. */
    exited: proc.exited,
    waitFor,
    async type(text) {
      await write(text);
    },
    async press(key) {
      const sequence = KEY_SEQUENCES[String(key).toLowerCase()] ?? key;
      await write(sequence);
    },
    async submit(text) {
      if (text) await write(text);
      await write("\r");
    },
    resize(nextCols, nextRows) {
      terminal.resize(nextCols, nextRows);
      xterm.resize(nextCols, nextRows);
    },
    async stop(signal = "SIGTERM") {
      try {
        proc.kill(signal);
      } catch {
        // already gone
      }
      await Promise.race([proc.exited, Bun.sleep(3000)]);
      try {
        terminal.close();
      } catch {
        // already closed
      }
      xterm.dispose();
    },
  };
}
