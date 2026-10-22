import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { providerDone, providerError, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism";
import { codingAccess, earlierHistories, parseVibeGrade, prepareCoding, summarizeCoding } from "./coding.mjs";
import { loadPinnedArtifact, normalizeCodingItem } from "./datasets.mjs";
import dream from "./fixtures/dreambench-swe-item.json" with { type: "json" };
import vibe from "./fixtures/vibemembench-item.json" with { type: "json" };
import { replay } from "./replay.mjs";
import { writeReport } from "./report.mjs";
import { runBench } from "./run.mjs";

describe("coding benchmarks", () => {
  test("adapter_schema_smoke_on_pinned_item", async () => {
    for (const [name, sha] of [
      ["dreambench-swe", "31953d93fe6212f510c6bb02f5257ecd86ceb5de223e7f575c733bde9f7b8e31"],
      ["vibemembench", "98e1c1f02405830e711bb11e0e645e9eda8f75e53f018285ca6e8defe37bc2cd"],
    ])
      expect(
        createHash("sha256")
          .update(await readFile(new URL(`./fixtures/${name}-item.json`, import.meta.url)))
          .digest("hex"),
      ).toBe(sha);
    expect(normalizeCodingItem(dream, "dreambench-swe").sessions.length).toBe(3);
    const item = normalizeCodingItem(vibe, "vibemembench");
    expect(item.question).toBe(vibe.problem_statement);
    expect(JSON.stringify(item)).not.toContain(vibe.test_patch);
    expect(JSON.stringify(item)).not.toContain(vibe.patch);
    for (const suite of ["dreambench-swe", "vibemembench"]) {
      const report = await runBench({ suite, offline: true });
      expect(report.suite).toBe(suite);
      expect(report.status).toBe("schema-smoke");
      expect(report.results).toHaveLength(0);
      expect(report.schemaItems).toBe(1);
      expect(report.metrics).toBeDefined();
      const dir = await mkdtemp(join(tmpdir(), "coding-report-"));
      try {
        await writeReport(report, join(dir, "report.json"));
        expect(await readFile(join(dir, "report.md"), "utf8")).toContain("Paper baselines");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });
  test("unpermitted_benchmark_is_refused_with_reason", () => {
    expect(() => codingAccess("vibemembench", { license: "unknown", available: true })).toThrow(/licence/);
    expect(() => codingAccess("vibemembench", { license: "Apache-2.0", available: false, reason: "withdrawn" })).toThrow(/withdrawn/);
    expect(codingAccess("dreambench-swe").available).toBe(false);
  });
  test("history_excludes_target_future_and_other_repositories", () => {
    const entries = ["143", "553", "554"].map((n) => ({
      path: `history/python/adamchainz__flake8-comprehensions/adamchainz__flake8-comprehensions-${n}/x.traj.json`,
    }));
    entries.push({ path: "history/python/other__repo/other__repo-1/x.traj.json" });
    expect(earlierHistories(vibe, entries)).toEqual([entries[0]]);
    expect(earlierHistories({ ...vibe, repo: "AdamChainz/flake8-comprehensions" }, entries)).toEqual([entries[0]]);
    expect(normalizeCodingItem({ ...vibe, repo: "AdamChainz/flake8-comprehensions" }, "vibemembench").id).toBe(vibe.instance_id);
    expect(() => normalizeCodingItem({ ...vibe, base_commit: "bad" }, "vibemembench")).toThrow();
  });
  test("coding_schema_smoke_preserves_argument_validation_and_availability", async () => {
    await expect(runBench({ suite: "vibemembench", offline: true, config: "invalid" })).rejects.toThrow(/invalid config/);
    await expect(runBench({ suite: "vibemembench", offline: true, maxInputTokens: 0 })).rejects.toThrow(/ceiling/);
    const report = await runBench({ suite: "dreambench-swe" });
    expect(report.status).toBe("unavailable");
    expect(report.inputTokens).toBe(0);
    expect(report.coding.access.reason).toContain("hidden scoring oracles");
  });
  test("metrics_use_oracle_counts_and_agent_steps", () => {
    expect(
      summarizeCoding("vibemembench", [
        { correct: true, agentSteps: 4 },
        { correct: false, agentSteps: 8 },
      ]),
    ).toEqual({ Resolved: 0.5, agentSteps: 6 });
    expect(summarizeCoding("dreambench-swe", [])).toEqual({ passes: 0, total: 0, staleUseRate: null, repeatedErrorRate: null });
    expect(parseVibeGrade({ exitCode: 0, passed: ["a", "b"], expected: ["b", "a"] })).toBe(true);
    expect(parseVibeGrade({ exitCode: 0, passed: ["a"], expected: ["b", "a"] })).toBe(false);
    expect(parseVibeGrade({ exitCode: 1, passed: ["a"], expected: ["a"] })).toBe(false);
  });
  test("sandbox_grading_is_fresh_networkless_and_never_receives_reference_patch", async () => {
    const opened = [],
      closed = [],
      scripts = [];
    const workspace = await prepareCoding(
      vibe,
      {},
      {
        dockerCli: (args) => (args[0] === "pull" ? "" : JSON.stringify([`image@sha256:${"a".repeat(64)}`])),
        async createSandbox(options) {
          const id = opened.length;
          opened.push(options);
          return {
            async execFile(request) {
              scripts.push(request.args[1]);
              expect(request.timeout).toBeGreaterThan(0);
              request.onData?.(Buffer.from(request.args[1].includes("git diff") ? "model patch" : "test output"));
              return { exitCode: 0 };
            },
            async close() {
              closed.push(id);
            },
          };
        },
        async gradeLog(row, result) {
          expect(row).toBe(vibe);
          expect(result.text).toBe("test output");
          expect(await readFile(join(opened[1].sourceRoot, "solution.patch"), "utf8")).toBe("model patch");
          expect(await readFile(join(opened[1].sourceRoot, "tests.patch"), "utf8")).toBe(vibe.test_patch);
          return true;
        },
      },
    );
    const tool = workspace.tools[0];
    await expect(tool.execute({ command: "x".repeat(32769) }, {})).rejects.toThrow(/CommandInvalid/);
    expect((await tool.execute({ command: "pwd" }, { toolCallId: "1" })).value.exitCode).toBe(0);
    expect(await workspace.grade()).toBe(true);
    expect(opened).toHaveLength(2);
    expect(closed).toEqual([0]);
    for (const options of opened) {
      expect(options.network).toEqual({ mode: "none" });
      expect(options.user).toBe("1000:1000");
      expect(options.env).not.toHaveProperty("HYPER_API_KEY");
    }
    expect(scripts.join("\n")).not.toContain(vibe.patch);
    await workspace.close();
    expect(closed).toEqual([0, 1]);
    await expect(readFile(join(opened[0].sourceRoot, "solution.patch"))).rejects.toThrow();
  });
  test("history_blob_pins_fail_closed_on_tamper", async () => {
    const cache = await mkdtemp(join(tmpdir(), "history-pin-"));
    const bytes = Buffer.from("{}");
    const gitBlob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    const pin = { file: "history.json", bytes: bytes.length, gitBlob, url: "https://example.invalid", license: "Apache-2.0" };
    try {
      expect(await loadPinnedArtifact(pin, { cache, fetch: async () => new Response(bytes) })).toEqual(bytes);
      await expect(loadPinnedArtifact({ ...pin, gitBlob: "0".repeat(40) }, { cache })).rejects.toThrow(/Checksum/);
    } finally {
      await rm(cache, { recursive: true, force: true });
    }
  });
  test("coding_tool_runs_through_existing_replay_and_counts_solver_steps", async () => {
    let executed = 0;
    const provider = {
      id: "mock",
      async *generate(request) {
        expect(request.tools.some((t) => t.name === "sandbox_command")).toBe(true);
        if (!request.messages.some((m) => m.role === "tool"))
          yield providerToolCall(toolCallContent("cmd", "sandbox_command", { command: "pwd" }));
        else yield providerTextDelta("Done");
        yield providerDone();
      },
    };
    const tool = {
      name: "sandbox_command",
      description: "test",
      parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
      execute(args, context) {
        executed++;
        expect(args.command).toBe("pwd");
        return { name: "sandbox_command", toolCallId: context.toolCallId, content: [{ type: "text", text: "/workspace" }] };
      },
    };
    const state = {
      phase: "answer",
      calls: {},
      turns: 0,
      injections: [],
      injectionText: new Map(),
      injectedContextTokens: 0,
      ceilingReached: () => false,
    };
    const result = await replay(
      { id: "coding", question: "fix the issue", sessions: [], date: "2000-01-01T00:00:00Z" },
      { config: "full", suite: "vibemembench", codingTools: [tool], modelConfig: { provider: "mock", model: "m" }, inputCap: 128000 },
      [provider],
      state,
    );
    expect(executed).toBe(1);
    expect(result.agentSteps).toBe(2);
    expect(result.toolCalls).toBe(1);
  });
  test("coding_write_is_not_repeated_after_truncated_completion", async () => {
    let executed = 0;
    let requests = 0;
    const provider = {
      id: "mock",
      async *generate(request) {
        requests++;
        if (requests === 1) {
          expect(request.tools.some((t) => t.name === "write_file")).toBe(true);
          yield providerToolCall(toolCallContent("write", "write_file", { path: "result.txt", content: "once" }));
          yield providerDone();
          return;
        }
        yield providerTextDelta("PARTIAL_CODING_TEXT_MUST_NOT_BE_SCORED");
        yield providerError(new Error("Chat stream ended without completion evidence ([DONE]: missing, finish_reason: missing)"));
      },
    };
    const tool = {
      name: "write_file",
      description: "test",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
      execute(args, context) {
        executed++;
        expect(args).toEqual({ path: "result.txt", content: "once" });
        return { name: "write_file", toolCallId: context.toolCallId, content: [{ type: "text", text: "written" }] };
      },
    };
    const state = {
      phase: "answer",
      calls: {},
      turns: 0,
      injections: [],
      injectionText: new Map(),
      injectedContextTokens: 0,
      ceilingReached: () => false,
    };
    await expect(
      replay(
        { id: "coding-retry", question: "fix the issue", sessions: [], date: "2000-01-01T00:00:00Z" },
        { config: "full", suite: "vibemembench", codingTools: [tool], modelConfig: { provider: "mock", model: "m" }, inputCap: 128000 },
        [provider],
        state,
      ),
    ).rejects.toThrow(/MemoryBenchAnswerError/);
    expect(executed).toBe(1);
    expect(requests).toBe(2, "a coding attempt with a possible write is never replayed");
  });

  test.skipIf(process.env.PRISM_MEMORY_BENCH_DOCKER_SMOKE !== "1")(
    "vibe_official_image_rejects_base_and_accepts_reference_patch",
    async () => {
      for (const reference of [false, true]) {
        const workspace = await prepareCoding(vibe);
        try {
          if (reference) {
            const encoded = Buffer.from(vibe.patch).toString("base64");
            const result = await workspace.tools[0].execute(
              { command: `printf %s ${encoded} | base64 -d > /tmp/reference.patch && git apply /tmp/reference.patch` },
              { toolCallId: "oracle-self-check" },
            );
            expect(result.value.exitCode).toBe(0);
          }
          expect(await workspace.grade()).toBe(reference);
        } finally {
          await workspace.close();
        }
      }
    },
  );
});
