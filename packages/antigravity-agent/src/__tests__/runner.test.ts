import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createSecretRedactor } from "@arnilo/prism";
import {
  AntigravityAuthenticationError,
  AntigravityQuotaExhaustedError,
  AntigravityRunnerError,
  AntigravityStreamError,
  type AntigravityStreamRecord,
  buildCliArgs,
  buildSafeEnvironment,
  runAntigravityCli,
  validateCommand,
} from "../index.js";

function createFakeAgy(ws: string, name: string, code: string): string {
  const scriptPath = join(ws, name);
  const fullCode = `#!/usr/bin/env node\n${code}\n`;
  writeFileSync(scriptPath, fullCode, { mode: 0o755 });
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

test("buildCliArgs: constructs argument array and never shell strings", () => {
  const args1 = buildCliArgs(
    {
      prompt: "Fix the build errors",
      cwd: "/workspace",
    },
    600_000,
  );

  assert.deepEqual(args1, ["-p", "Fix the build errors", "--output-format", "stream-json", "--print-timeout", "10m"]);

  const args2 = buildCliArgs(
    {
      prompt: "Next step",
      cwd: "/workspace",
      model: "gemini-3.5-flash-medium",
      effort: "high",
      agent: "prism-custom",
      conversationId: "conv-12345",
      addDir: ["/extra/dir1", "/extra/dir2"],
    },
    30_000,
  );

  assert.deepEqual(args2, [
    "-p",
    "Next step",
    "--output-format",
    "stream-json",
    "--print-timeout",
    "30s",
    "--model",
    "gemini-3.5-flash-medium",
    "--effort",
    "high",
    "--agent",
    "prism-custom",
    "--conversation",
    "conv-12345",
    "--add-dir",
    "/extra/dir1",
    "--add-dir",
    "/extra/dir2",
  ]);

  // Rejects invalid prompt
  assert.throws(() => buildCliArgs({ prompt: "", cwd: "/workspace" }, 60_000), AntigravityRunnerError);
});

test("buildSafeEnvironment: filters safe keys and incorporates user overrides", () => {
  const env = buildSafeEnvironment({
    CUSTOM_FLAG: "1",
  });

  assert.equal(env.CUSTOM_FLAG, "1");
  assert.ok(env.PATH !== undefined);
});

test("validateCommand: validates command and rejects control chars", () => {
  assert.equal(validateCommand("agy"), "agy");
  assert.equal(validateCommand("/usr/local/bin/agy"), "/usr/local/bin/agy");
  assert.throws(() => validateCommand(""), AntigravityRunnerError);
  assert.throws(() => validateCommand("agy\0bad"), AntigravityRunnerError);
});

test("runAntigravityCli: successful execution streams events and returns result", async () => {
  const ws = mkdtempSync(join(tmpdir(), "prism-runner-test-"));
  const fakeAgy = createFakeAgy(
    ws,
    "fake-agy-success.mjs",
    `
process.stdout.write(JSON.stringify({ type: "init", cwd: ${JSON.stringify(ws)}, tools: ["prism_echo"] }) + "\\n");
process.stdout.write(JSON.stringify({ type: "step_update", conversation_id: "conv-success", step_index: 0, state: "DONE", step_type: "tool", tool_info: { name: "prism_echo" } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "step_update", conversation_id: "conv-success", step_index: 1, state: "DONE", step_type: "assistant", text_delta: "Hello Prism" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "result", status: "SUCCESS", conversation_id: "conv-success", response: "Hello Prism", usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } }) + "\\n");
process.exit(0);
`,
  );

  const events: AntigravityStreamRecord[] = [];

  try {
    const result = await runAntigravityCli({
      command: fakeAgy,
      prompt: "Execute test task",
      cwd: ws,
      onRecord: (rec) => {
        events.push(rec);
      },
    });

    assert.equal(result.status, "SUCCESS");
    assert.equal(result.conversationId, "conv-success");
    assert.equal(result.response, "Hello Prism");
    assert.equal(result.init.type, "init");
    assert.equal(result.steps.length, 2);
    assert.equal(result.result.type, "result");
    assert.deepEqual(result.usage, { inputTokens: 100, outputTokens: 20, totalTokens: 120 });
    assert.equal(events.length, 4);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("runAntigravityCli: unauthenticated CLI run throws AntigravityAuthenticationError", async () => {
  const ws = mkdtempSync(join(tmpdir(), "prism-runner-auth-"));
  const fakeAgy = createFakeAgy(
    ws,
    "fake-agy-auth.mjs",
    `
process.stderr.write("Error: authentication required. Please run agy login to connect your Google account.\\n");
process.exit(1);
`,
  );

  try {
    await assert.rejects(
      async () => {
        await runAntigravityCli({
          command: fakeAgy,
          prompt: "Execute task",
          cwd: ws,
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof AntigravityAuthenticationError);
        assert.match((err as Error).message, /run interactive 'agy' once/i);
        return true;
      },
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("runAntigravityCli: quota exhaustion throws AntigravityQuotaExhaustedError", async () => {
  const ws = mkdtempSync(join(tmpdir(), "prism-runner-quota-"));
  const fakeAgy = createFakeAgy(
    ws,
    "fake-agy-quota.mjs",
    `
process.stderr.write("429 Too Many Requests: Antigravity quota exhausted for current tier\\n");
process.exit(1);
`,
  );

  try {
    await assert.rejects(
      async () => {
        await runAntigravityCli({
          command: fakeAgy,
          prompt: "Execute task",
          cwd: ws,
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof AntigravityQuotaExhaustedError);
        assert.match((err as Error).message, /quota exhausted/i);
        return true;
      },
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("runAntigravityCli: invalid model throws AntigravityRunnerError with code", async () => {
  const ws = mkdtempSync(join(tmpdir(), "prism-runner-model-"));
  const fakeAgy = createFakeAgy(
    ws,
    "fake-agy-model.mjs",
    `
process.stderr.write("Error: unknown model 'gemini-nonexistent'\\n");
process.exit(2);
`,
  );

  try {
    await assert.rejects(
      async () => {
        await runAntigravityCli({
          command: fakeAgy,
          prompt: "Execute task",
          cwd: ws,
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof AntigravityRunnerError);
        assert.equal((err as AntigravityRunnerError).code, "ERR_PRISM_ANTIGRAVITY_MODEL_ERROR");
        return true;
      },
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("runAntigravityCli: missing terminal result throws AntigravityStreamError", async () => {
  const ws = mkdtempSync(join(tmpdir(), "prism-runner-noresult-"));
  const fakeAgy = createFakeAgy(
    ws,
    "fake-agy-noresult.mjs",
    `
process.stdout.write(JSON.stringify({ type: "init", cwd: ${JSON.stringify(ws)} }) + "\\n");
process.stdout.write(JSON.stringify({ type: "step_update", step_index: 0, state: "DONE" }) + "\\n");
// Process exits with 0 without result
process.exit(0);
`,
  );

  try {
    await assert.rejects(
      async () => {
        await runAntigravityCli({
          command: fakeAgy,
          prompt: "Execute task",
          cwd: ws,
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof AntigravityStreamError);
        assert.match((err as Error).message, /without a terminal result/i);
        return true;
      },
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("runAntigravityCli: abort signal terminates run", async () => {
  const ws = mkdtempSync(join(tmpdir(), "prism-runner-abort-"));
  const fakeAgy = createFakeAgy(
    ws,
    "fake-agy-hang.mjs",
    `
process.stdout.write(JSON.stringify({ type: "init", cwd: ${JSON.stringify(ws)} }) + "\\n");
// Hang forever
setInterval(() => {}, 1000);
`,
  );

  const controller = new AbortController();

  try {
    const runPromise = runAntigravityCli({
      command: fakeAgy,
      prompt: "Execute task",
      cwd: ws,
      signal: controller.signal,
    });

    // Abort after 50ms
    setTimeout(() => {
      controller.abort();
    }, 50);

    await assert.rejects(runPromise);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("runAntigravityCli: redacts secrets from stderr in error diagnostic", async () => {
  const ws = mkdtempSync(join(tmpdir(), "prism-runner-redact-"));
  const secret = "SUPER_SECRET_BEARER_KEY_888";
  const fakeAgy = createFakeAgy(
    ws,
    "fake-agy-secret.mjs",
    `
process.stderr.write("CLI failed with leaked token: ${secret}\\n");
process.exit(1);
`,
  );

  const redactor = createSecretRedactor([secret]);

  try {
    await assert.rejects(
      async () => {
        await runAntigravityCli({
          command: fakeAgy,
          prompt: "Execute task",
          cwd: ws,
          redactor,
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof AntigravityRunnerError);
        assert.doesNotMatch((err as Error).message, new RegExp(secret));
        assert.match((err as Error).message, /\[REDACTED\]/);
        return true;
      },
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
