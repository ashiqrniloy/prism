/**
 * Plan 139 Task 7: PTY end-to-end journeys for the built Prism Code TUI.
 *
 * Every journey spawns `packages/prism-code/dist/bin/prism-code.js` inside a real pseudo-terminal
 * (Bun.Terminal), renders the byte stream through a headless xterm screen buffer, and asserts on
 * the visible frame. Hermetic: temporary HOME/PRISM_HOME, the shipped `mock` provider, and scripted
 * provider turns (`PRISM_CODE_MOCK_SCRIPT`) — no credentials, no network, no user state.
 *
 * Run locally after `bun run build`:
 *   bun test scripts/e2e-prism-code-tui.test.mjs
 */
import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTempEnvironment, PRISM_CODE_BIN, ptySupported, startTui } from "./lib/pty-harness.mjs";

const JOURNEY_TIMEOUT_MS = 60_000;
/** Linux CI is the target platform for this harness (plan 139 Task 7); other hosts skip. */
const itPty = ptySupported() && process.platform === "linux" ? it : it.skip;

function textDelta(text) {
  return { type: "content_delta", content: { type: "text", text } };
}

function toolCall(id, name, arguments_) {
  return { type: "tool_call", call: { type: "tool_call", id, name, arguments: arguments_ } };
}

function done() {
  return { type: "done" };
}

/** Seeds the credential-store choice so journeys exercise the TUI, not the first-run store prompt. */
function seedHome(home) {
  writeFileSync(join(home, "state.json"), JSON.stringify({ credentialStore: "memory" }));
}

async function startJourney({ cwd, home, args = [], turns, env = {}, cols, rows }) {
  seedHome(home);
  let script;
  if (turns) {
    script = join(home, "mock-script.json");
    writeFileSync(script, JSON.stringify(turns));
  }
  const tui = await startTui({
    cwd,
    home,
    args: ["--model", "mock/default", ...args],
    env: { ...(script ? { PRISM_CODE_MOCK_SCRIPT: script } : {}), ...env },
    ...(cols ? { cols } : {}),
    ...(rows ? { rows } : {}),
  });
  return tui;
}

/** Runs `body` with a fresh temp environment + TUI and always tears both down. */
async function withJourney(options, body) {
  const env = await makeTempEnvironment("prism-code-tui-e2e");
  let tui;
  try {
    tui = await startJourney({ ...options, cwd: env.cwd, home: env.home });
    return await body({ tui, ...env });
  } finally {
    if (tui) await tui.stop();
    await env.cleanup();
  }
}

async function expectExit(tui, code = 0) {
  const result = await Promise.race([tui.exited, Bun.sleep(10_000).then(() => "timeout")]);
  expect(result).toBe(code);
}

/**
 * Confirms an open picker with Enter and waits for it to close. The credential-status probes
 * re-render a visible picker, and a key sent in that window is dropped, so the first Enter can leave
 * the modal up (observed locally in roughly half the runs and on the release gate).
 */
async function confirmPicker(tui, title, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await tui.press("enter");
    const closedBy = Date.now() + 2_000;
    while (Date.now() < closedBy) {
      await tui.settled();
      if (!tui.screen().includes(title)) return;
      await Bun.sleep(120);
    }
  }
  throw new Error(`picker "${title}" never closed`);
}

describe("prism-code TUI over a PTY", () => {
  itPty(
    "first run onboards a provider, runs a prompt, and exits restoring the terminal",
    async () => {
      const env = await makeTempEnvironment("prism-code-tui-onboarding");
      let tui;
      try {
        seedHome(env.home);
        tui = await startTui({ cwd: env.cwd, home: env.home });

        await tui.waitFor("Select AI Provider", { timeoutMs: 25_000 });
        await tui.type("mock");
        await tui.waitFor("Mock Provider", { timeoutMs: 10_000 });
        await confirmPicker(tui, "Select AI Provider");

        await tui.waitFor("Select Model", { timeoutMs: 25_000 });
        await confirmPicker(tui, "Select Model");
        await tui.waitFor("Type a prompt", { timeoutMs: 25_000 });
        await tui.settled();
        expect(tui.screen()).toContain("default");

        await tui.submit("say hello");
        const frame = await tui.waitFor("Mock response", { timeoutMs: 25_000 });
        expect(frame).toContain("You: say hello");
        expect(frame).toContain("(no git)");

        await tui.press("ctrl+d");
        await expectExit(tui, 0);
        // Leaving the alternate screen is the terminal-restore signal a shell sees on exit.
        expect(tui.raw()).toContain("\u001b[?1049l");
      } finally {
        if (tui) await tui.stop();
        await env.cleanup();
      }
    },
    JOURNEY_TIMEOUT_MS,
  );

  itPty(
    "renders parallel tool cards and finished output",
    async () => {
      await withJourney(
        {
          turns: [
            [toolCall("call_a", "read", { path: "a.txt" }), toolCall("call_b", "read", { path: "b.txt" })],
            [textDelta("Both files read."), done()],
          ],
        },
        async ({ tui, cwd }) => {
          writeFileSync(join(cwd, "a.txt"), "alpha marker\n");
          writeFileSync(join(cwd, "b.txt"), "beta marker\n");
          await tui.waitFor("Type a prompt", { timeoutMs: 25_000 });

          await tui.submit("read both files");
          const frame = await tui.waitFor("Both files read.", { timeoutMs: 25_000 });
          expect(frame).toContain("a.txt");
          expect(frame).toContain("b.txt");
          expect(frame).toContain("alpha marker");
          expect(frame).toContain("beta marker");
          // One card per call id: both parallel calls finished, neither stuck running.
          expect(frame).not.toContain("running");

          await tui.press("ctrl+d");
          await expectExit(tui, 0);
        },
      );
    },
    JOURNEY_TIMEOUT_MS,
  );

  itPty(
    "shows the proposed diff in the approval prompt and applies the edit when allowed",
    async () => {
      await withJourney(
        {
          turns: [
            [toolCall("edit_1", "edit", { path: "note.txt", edits: [{ oldText: "one", newText: "two" }] })],
            [textDelta("Applied the edit."), done()],
          ],
        },
        async ({ tui, cwd }) => {
          writeFileSync(join(cwd, "note.txt"), "one\n");
          await tui.waitFor("Type a prompt", { timeoutMs: 25_000 });

          await tui.submit("change the note");
          const prompt = await tui.waitFor("Allow once", { timeoutMs: 25_000 });
          expect(prompt).toContain("note.txt");
          expect(prompt).toMatch(/- *one/);
          expect(prompt).toMatch(/\+ *two/);

          await tui.press("a");
          await tui.waitFor("Applied the edit.", { timeoutMs: 25_000 });
          expect(readFileSync(join(cwd, "note.txt"), "utf8")).toBe("two\n");

          await tui.press("ctrl+d");
          await expectExit(tui, 0);
        },
      );
    },
    JOURNEY_TIMEOUT_MS,
  );

  itPty(
    "Esc aborts a running tool call and the TUI stays usable",
    async () => {
      await withJourney(
        {
          args: ["--approve", "all"],
          turns: [[toolCall("shell_1", "shell", { command: "sleep 30" })]],
        },
        async ({ tui }) => {
          await tui.waitFor("Type a prompt", { timeoutMs: 25_000 });

          await tui.submit("run a slow command");
          await tui.waitFor("sleep 30", { timeoutMs: 25_000 });
          await tui.press("escape");

          const frame = await tui.waitFor("Run cancelled by user", { timeoutMs: 25_000 });
          expect(frame).toContain("shell");

          // The aborted run released the loop: Ctrl+D still exits cleanly.
          await tui.press("ctrl+d");
          await expectExit(tui, 0);
        },
      );
    },
    JOURNEY_TIMEOUT_MS,
  );

  itPty(
    "opens /model, switches the selection, and keeps the footer in sync",
    async () => {
      await withJourney({}, async ({ tui }) => {
        await tui.waitFor("Type a prompt", { timeoutMs: 25_000 });

        // First Enter accepts the completion popup; the second submits the command.
        await tui.submit("/model");
        await tui.press("enter");
        await tui.waitFor("Mock Default Model", { timeoutMs: 25_000 });
        await tui.press("enter");

        const frame = await tui.waitFor((text) => text.includes("Mock Default Model") === false && text.includes("default"), {
          timeoutMs: 25_000,
        });
        expect(frame).toContain("Type a prompt");

        await tui.press("ctrl+d");
        await expectExit(tui, 0);
      });
    },
    JOURNEY_TIMEOUT_MS,
  );

  itPty(
    "resumes the previous session with --continue and replays its transcript",
    async () => {
      const env = await makeTempEnvironment("prism-code-tui-resume");
      let first;
      try {
        seedHome(env.home);
        first = await startTui({ cwd: env.cwd, home: env.home, args: ["--model", "mock/default"] });
        await first.waitFor("Type a prompt", { timeoutMs: 25_000 });
        await first.submit("remember this marker");
        await first.waitFor("Mock response", { timeoutMs: 25_000 });
        await first.press("ctrl+d");
        await expectExit(first, 0);
      } finally {
        if (first) await first.stop();
      }

      let second;
      try {
        second = await startTui({ cwd: env.cwd, home: env.home, args: ["--model", "mock/default", "--continue"] });
        const frame = await second.waitFor((text) => text.includes("remember this marker") && text.includes("Mock response"), {
          timeoutMs: 30_000,
          label: "replayed transcript",
        });
        expect(frame).toContain("You: remember this marker");
        await second.press("ctrl+d");
        await expectExit(second, 0);
      } finally {
        if (second) await second.stop();
        await env.cleanup();
      }
    },
    JOURNEY_TIMEOUT_MS,
  );

  itPty(
    "streams a long response without stalling",
    async () => {
      const deltas = Array.from({ length: 150 }, (_, index) => textDelta(`chunk-${index} `));
      await withJourney({ turns: [[...deltas, textDelta("STREAM-END"), done()]] }, async ({ tui }) => {
        await tui.waitFor("Type a prompt", { timeoutMs: 25_000 });

        const started = performance.now();
        await tui.submit("stream a long answer");
        await tui.waitFor("STREAM-END", { timeoutMs: 30_000 });
        const elapsed = performance.now() - started;

        const deltasPerSecond = Math.round((deltas.length / elapsed) * 1000);
        console.log(`[pty-harness] 150 streamed deltas rendered in ${elapsed.toFixed(0)}ms (~${deltasPerSecond} deltas/s end-to-end)`);
        // End-to-end ceiling that catches a stall; the in-process frame budget (p95 < 16ms) is
        // asserted tightly by src/__tests__/tui-rendering.test.ts on the render path itself.
        expect(elapsed).toBeLessThan(15_000);
        expect(deltasPerSecond).toBeGreaterThan(100);

        await tui.press("ctrl+d");
        await expectExit(tui, 0);
      });
    },
    JOURNEY_TIMEOUT_MS,
  );

  it("fails loudly when the built binary is missing", () => {
    if (existsSync(PRISM_CODE_BIN)) return;
    throw new Error(`${PRISM_CODE_BIN} is missing — run "bun run build" before the PTY journeys.`);
  });
});
