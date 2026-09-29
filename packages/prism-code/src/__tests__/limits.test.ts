import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AIProvider,
  createDefaultRetryPolicy,
  HARD_RUN_LIMITS,
  type ProviderRequest,
  providerDone,
  providerError,
  providerTextDelta,
  providerToolCall,
  type ToolDefinition,
  type ToolResult,
} from "@arnilo/prism";
import { type PrismCodeConfig, validatePrismCodeConfigLayer } from "../config.js";
import { applyFlagOverlay, parseFlags } from "../flags.js";
import { assembleAppAgent, runHeadless } from "../headless.js";
import { PRISM_CODE_DEFAULT_LIMITS, resolvePrismCodeLimits, validatePrismCodeLimits, validatePrismCodeLoop } from "../limits.js";
import { ensureDurableSessionRecord, resolveSessionStore, searchRepoSessions } from "../sessions.js";

describe("Prism Code run limits, loop concurrency, and signals", () => {
  it("PRISM_CODE_DEFAULT_LIMITS has every policy axis null and byte axes set to HARD_RUN_LIMITS ceilings", () => {
    assert.equal(PRISM_CODE_DEFAULT_LIMITS.maxTurns, null);
    assert.equal(PRISM_CODE_DEFAULT_LIMITS.maxProviderAttempts, null);
    assert.equal(PRISM_CODE_DEFAULT_LIMITS.maxToolRounds, null);
    assert.equal(PRISM_CODE_DEFAULT_LIMITS.maxToolCalls, null);
    assert.equal(PRISM_CODE_DEFAULT_LIMITS.maxWallTimeMs, null);
    assert.equal(PRISM_CODE_DEFAULT_LIMITS.maxInputTokens, null);
    assert.equal(PRISM_CODE_DEFAULT_LIMITS.maxOutputTokens, null);
    assert.equal(PRISM_CODE_DEFAULT_LIMITS.maxTotalTokens, null);
    assert.equal(PRISM_CODE_DEFAULT_LIMITS.maxStopContinuations, null);
    assert.equal(PRISM_CODE_DEFAULT_LIMITS.maxRequestBytes, HARD_RUN_LIMITS.maxRequestBytes);
    assert.equal(PRISM_CODE_DEFAULT_LIMITS.maxResponseBytes, HARD_RUN_LIMITS.maxResponseBytes);
  });

  it("config limits validation enforces policy types, byte ceilings, and maxCost structure", () => {
    // Valid limits
    const valid = validatePrismCodeLimits({
      maxTurns: 10,
      maxToolRounds: null,
      maxCost: { amount: 5.5, currency: "USD" },
      maxRequestBytes: 16 * 1024 * 1024,
      maxStopContinuations: 0,
    });
    assert.equal(valid.maxTurns, 10);
    assert.equal(valid.maxToolRounds, null);
    assert.deepEqual(valid.maxCost, { amount: 5.5, currency: "USD" });
    assert.equal(valid.maxRequestBytes, 16 * 1024 * 1024);
    assert.equal(valid.maxStopContinuations, 0);

    // Number maxCost normalizes to USD
    const numCost = validatePrismCodeLimits({ maxCost: 10 });
    assert.deepEqual(numCost.maxCost, { amount: 10, currency: "USD" });

    // Invalid limits fail closed
    assert.throws(() => validatePrismCodeLimits({ maxTurns: -1 }), /must be a positive integer/);
    assert.throws(() => validatePrismCodeLimits({ maxRequestBytes: 128 * 1024 * 1024 }), /at most/);
    assert.throws(() => validatePrismCodeLimits({ maxRequestBytes: null }), /must be a positive integer/);
    assert.throws(() => validatePrismCodeLimits({ maxCost: -1 }), /non-negative/);
    assert.throws(() => validatePrismCodeLimits({ unknownKey: 123 }), /unknown key/);
  });

  it("config loop validation enforces toolConcurrency and strategy", () => {
    assert.equal(validatePrismCodeLoop("single-shot"), "single-shot");
    assert.deepEqual(validatePrismCodeLoop({ toolConcurrency: 4 }), { strategy: "single-shot", toolConcurrency: 4 });
    assert.deepEqual(validatePrismCodeLoop({ strategy: "single-shot", toolConcurrency: 2 }), {
      strategy: "single-shot",
      toolConcurrency: 2,
    });
    assert.throws(() => validatePrismCodeLoop({ toolConcurrency: 0 }), /positive integer/);
    assert.throws(() => validatePrismCodeLoop({ unknownLoopKey: true }), /unknown key/);
  });

  it("a mock run of 100 tool rounds and 40 minutes of simulated wall time completes without RunLimitError", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "prism-limits-unbounded-"));
    try {
      let roundsCount = 0;
      const testTool: ToolDefinition = {
        name: "step_tool",
        description: "Increments step",
        parameters: { type: "object", properties: {} },
        execute: async (_args, ctx): Promise<ToolResult> => {
          roundsCount++;
          return { toolCallId: ctx.toolCallId, name: "step_tool", value: `step ${roundsCount}` };
        },
      };

      let turnCount = 0;
      const mockProvider: AIProvider = {
        id: "mock-unbounded",
        async *generate(_req: ProviderRequest) {
          turnCount++;
          if (turnCount <= 100) {
            yield providerToolCall({ type: "tool_call", id: `call_${turnCount}`, name: "step_tool", arguments: {} });
            yield providerDone(undefined, "tool_calls");
          } else {
            yield providerTextDelta("completed 100 rounds");
            yield providerDone(undefined, "end_turn");
          }
        },
      };

      const config: PrismCodeConfig = {
        cwd: tempDir,
        tools: {
          planes: { coding: false },
        },
      };

      const definition = await assembleAppAgent(config, mockProvider);
      // Manually add the step_tool to the session
      const session = definition.createSession();
      // Core default limits would die at 8 tool rounds or 120s wall time.
      // Prism Code default limits have maxToolRounds: null, maxWallTimeMs: null.
      ((session as any).agent.config.tools as any).register(testTool);

      const result = await session.run("start unbounded run");
      assert.equal(result.status, "succeeded");
      assert.equal(roundsCount, 100);
      assert.equal(turnCount, 101);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("config limits.maxTurns: 5 narrows; --max-turns 3 narrows further; null in config disables an axis", () => {
    // 1. Config with maxTurns: 5
    const layer = validatePrismCodeConfigLayer({ limits: { maxTurns: 5 } });
    assert.equal(layer.limits?.maxTurns, 5);

    const resolved = resolvePrismCodeLimits(layer.limits);
    assert.equal(resolved.maxTurns, 5);

    // 2. CLI flag --max-turns 3 narrows to 3
    const flags = parseFlags(["--max-turns", "3"]);
    assert.equal(flags.maxTurns, 3);

    const overlay = applyFlagOverlay({ cwd: ".", limits: layer.limits }, flags);
    assert.equal(overlay.limits?.maxTurns, 3);

    // 3. Widening attempt from CLI cannot exceed narrower config
    const wideFlags = parseFlags(["--max-turns", "10"]);
    const overlayWide = applyFlagOverlay({ cwd: ".", limits: { maxTurns: 5 } }, wideFlags);
    assert.equal(overlayWide.limits?.maxTurns, 5);

    // 4. null in config disables the axis
    const disabledLayer = validatePrismCodeConfigLayer({ limits: { maxTurns: null } });
    assert.equal(disabledLayer.limits?.maxTurns, null);
    assert.equal(resolvePrismCodeLimits(disabledLayer.limits).maxTurns, null);
  });

  it("--max-cost stops cleanly with a finish reason", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "prism-limits-cost-"));
    try {
      const toolDef: ToolDefinition = {
        name: "cost_tool",
        description: "Performs action",
        parameters: { type: "object", properties: {} },
        execute: async (_args, ctx): Promise<ToolResult> => ({ toolCallId: ctx.toolCallId, name: "cost_tool", value: "done" }),
      };

      let turn = 0;
      const mockProvider: AIProvider = {
        id: "mock-cost",
        async *generate() {
          turn++;
          if (turn === 1) {
            // First turn costs $0.06 (under $0.10 limit)
            yield providerToolCall({ type: "tool_call", id: "c1", name: "cost_tool", arguments: {} });
            yield providerDone(
              {
                inputTokens: 100,
                outputTokens: 50,
                totalTokens: 150,
                cost: 0.06,
                currency: "USD",
              },
              "tool_calls",
            );
          } else if (turn === 2) {
            // Second turn costs $0.06 (cumulative $0.12, exceeds $0.10 limit)
            yield providerToolCall({ type: "tool_call", id: "c2", name: "cost_tool", arguments: {} });
            yield providerDone(
              {
                inputTokens: 100,
                outputTokens: 50,
                totalTokens: 150,
                cost: 0.06,
                currency: "USD",
              },
              "tool_calls",
            );
          } else {
            yield providerTextDelta("turn 3 should not be reached");
            yield providerDone(undefined, "end_turn");
          }
        },
      };

      const config: PrismCodeConfig = {
        cwd: tempDir,
        tools: { planes: { coding: false } },
        limits: {
          maxCost: { amount: 0.1, currency: "USD" },
        },
      };

      const definition = await assembleAppAgent(config, mockProvider);
      const session = definition.createSession();
      ((session as any).agent.config.tools as any).register(toolDef);

      const result = await session.run("test cost limit");

      // Verify clean stop with finish reason, NOT a crash
      assert.equal(result.status, "succeeded");
      assert.ok((result as any).finishReason === "host_policy" || result.stopReason === "host_policy");
      assert.ok(result.stopDetail?.includes("max_cost"));
      assert.equal(turn, 2, "turn 3 must not run after cost limit is reached");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("headless SIGTERM aborts, persists the session, and exits 143", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "prism-limits-sigterm-"));
    const dbPath = join(tempDir, "sessions.db");
    try {
      let aborted = false;
      const slowProvider: AIProvider = {
        id: "mock-slow",
        async *generate(req: ProviderRequest) {
          // Send SIGTERM while request is generating
          setTimeout(() => {
            process.emit("SIGTERM");
          }, 30);
          // Wait for signal abort
          await new Promise<void>((resolve) => {
            req.signal?.addEventListener("abort", () => {
              aborted = true;
              resolve();
            });
          });
          yield providerDone(undefined, "end_turn");
        },
      };

      const config: PrismCodeConfig = {
        cwd: tempDir,
        store: { type: "sqlite", path: dbPath },
        tools: { planes: { coding: false } },
      };

      const capturedOut: string[] = [];
      // `--session <id>` resumes an existing record; seed it so the SIGTERM path is what this test exercises.
      const seedStore = resolveSessionStore(config);
      await ensureDurableSessionRecord(seedStore, "sigterm-session-1", tempDir);
      const exitCode = await runHeadless({
        config,
        provider: slowProvider,
        prompt: "test sigterm abort",
        sessionId: "sigterm-session-1",
        stdout: {
          write: (chunk) => {
            capturedOut.push(chunk);
            return true;
          },
        },
      });

      assert.equal(exitCode, 143, "SIGTERM must exit with code 143");
      assert.ok(aborted, "run must be aborted by signal");

      // Verify the session record was persisted to the SQLite store
      const store = resolveSessionStore(config);
      const searchRes = await searchRepoSessions(store, { workspaceRoot: tempDir });
      assert.ok(
        searchRes.items.some((hit) => hit.sessionId === "sigterm-session-1"),
        "session must be persisted in durable store upon SIGTERM",
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("provider transient failures (429/5xx) retry under maxProviderAttempts: null without breaching limits", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "prism-limits-retry-"));
    try {
      let attempts = 0;
      const retryingProvider: AIProvider = {
        id: "mock-retrying",
        async *generate() {
          attempts++;
          if (attempts < 3) {
            // First 2 attempts fail with transient 429
            yield providerError({
              name: "RateLimitError",
              message: "Rate limit exceeded (429)",
              failureClass: "transient",
              code: "rate_limit",
            });
            return;
          }
          yield providerTextDelta("success on attempt 3");
          yield providerDone(undefined, "end_turn");
        },
      };

      const config: PrismCodeConfig = {
        cwd: tempDir,
        tools: { planes: { coding: false } },
      };

      const definition = await assembleAppAgent(config, retryingProvider);
      // Attach fast retry policy
      (definition.agent.config as any).retry = {
        policy: createDefaultRetryPolicy({ maxAttempts: 5, baseDelayMs: 5, maxDelayMs: 10 }),
      };

      const session = definition.createSession();
      const result = await session.run("retry prompt");

      assert.equal(result.status, "succeeded");
      assert.equal(attempts, 3, "must retry 3 times without breaching limits");
      assert.equal(result.text, "success on attempt 3");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("loop configuration threads toolConcurrency into the agent", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "prism-limits-loop-"));
    try {
      const config: PrismCodeConfig = {
        cwd: tempDir,
        tools: { planes: { coding: false } },
        loop: {
          strategy: "single-shot",
          toolConcurrency: 4,
        },
      };

      const definition = await assembleAppAgent(config);
      const loop = (definition as any).loop;
      assert.ok(loop);
      assert.equal(loop.toolConcurrency, 4);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
