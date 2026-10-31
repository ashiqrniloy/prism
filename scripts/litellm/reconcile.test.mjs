import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { markdownTable, readSignal, reconcile, runReconcile } from "./reconcile.mjs";

const id = "0f2a6f0e-6a1b-4a2e-9a5a-1f0b7c9d2e11";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function row(callId, spend) {
  return { litellm_call_id: callId, model_id: "chat-scout", spend, status: "success" };
}

describe("reconcile.mjs", () => {
  it("reads a bench report and a usage log the same way", () => {
    assert.deepEqual(readSignal("report.json", JSON.stringify({ calls: [{ callId: id, cost: 0.0001 }] })), [
      { callId: id, prismCost: 0.0001 },
    ]);
    assert.deepEqual(readSignal("usage.jsonl", `${JSON.stringify({ requestId: id, costUsd: 0.0001 })}\n`), [
      { callId: id, prismCost: 0.0001 },
    ]);
    assert.deepEqual(readSignal("plain.json", JSON.stringify([{ litellmCallId: id, spend: 0.0001 }])), [{ callId: id, prismCost: 0.0001 }]);
  });

  it("repairs duplicate ids and refuses a report with no calls", () => {
    assert.equal(
      readSignal("usage.jsonl", `${JSON.stringify({ callId: id, cost: 1 })}\n${JSON.stringify({ callId: id, cost: 2 })}`).length,
      1,
    );
    assert.throws(() => readSignal("empty.json", JSON.stringify({ nothing: true })), /no calls\/rows\/usage array/);
    assert.throws(() => readSignal("bad.jsonl", "not json"), /line 1 is not JSON/);
  });

  it("reconcile_flags_delta_and_missing computes deltas and the verdict", () => {
    const signal = [
      { callId: id, prismCost: 0.00007 },
      { callId: "missing-call", prismCost: 0.0001 },
    ];
    const spend = { rows: [{ callId: id, modelId: "chat-scout", spend: 0.00007355 }], missing: ["missing-call"] };
    const report = reconcile(signal, spend, 1e-6);
    assert.equal(report.rows[0].callId, id);
    assert.equal(report.rows[0].modelId, "chat-scout");
    assert.equal(report.rows[0].prismCost, 0.00007);
    assert.equal(report.rows[0].litellmSpend, 0.00007355);
    assert.ok(Math.abs(report.rows[0].delta - 0.00000355) < 1e-12);
    assert.equal(report.rows[1].delta, null);
    assert.ok(Math.abs(report.totals.totalDelta - (0.00000355 - 0.0001)) < 1e-12);
    assert.equal(report.ok, false);
    assert.match(markdownTable(report), /\| callId \| modelId \| prismCost \| litellmSpend \| delta \|/);
    assert.match(markdownTable(report), /Verdict: FAILED/);
    assert.match(markdownTable(report), /missing-call/);
  });

  it("reconcile passes when the delta is inside tolerance and nothing is missing", () => {
    const report = reconcile(
      [{ callId: id, prismCost: 0.000073 }],
      { rows: [{ callId: id, modelId: "chat-scout", spend: 0.00007355 }], missing: [] },
      1e-6,
    );
    assert.equal(report.ok, true);
    assert.match(markdownTable(report), /Verdict: reconciled/);
    assert.equal(reconcile([{ callId: id, prismCost: 0 }], { rows: [{ callId: id, spend: 0 }], missing: [] }).ok, true);
  });

  it("runReconcile reads the key from the environment only", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-reconcile-"));
    const reportPath = join(dir, "report.json");
    writeFileSync(reportPath, JSON.stringify({ calls: [{ callId: id, cost: 0.00007355 }] }));
    const urls = [];
    const fetch = async (input) => {
      urls.push(String(input));
      return json([row(id, 0.00007355)]);
    };
    const { report } = await runReconcile({ reportPath, env: { LITELLM_API_KEY: "sk-canary" }, waitMs: 0, fetch });
    assert.equal(report.ok, true);
    assert.equal(urls.length, 1);
    assert.match(urls[0], /\/spend\/logs\?request_id=/);
    await assert.rejects(runReconcile({ reportPath, env: {}, waitMs: 0, fetch }), /LITELLM_API_KEY is not set/);
  });

  it("the CLI writes both tables and exits zero when every row reconciles", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const wanted = new URL(request.url).searchParams.get("request_id");
        return Response.json([row(wanted ?? id, 0.00007355)]);
      },
    });
    try {
      const dir = mkdtempSync(join(tmpdir(), "prism-reconcile-out-"));
      const reportPath = join(dir, "report.json");
      const out = join(dir, "reconciled");
      writeFileSync(reportPath, JSON.stringify([{ callId: id, cost: 0.00007355 }]));
      const script = join(import.meta.dir, "reconcile.mjs");
      // Bun.spawn, not spawnSync: the stub proxy runs in this process.
      const proc = Bun.spawn(
        ["bun", script, "--report", reportPath, "--base-url", `http://127.0.0.1:${server.port}`, "--wait-ms", "0", "--out", out],
        { env: { ...process.env, LITELLM_API_KEY: "sk-canary" }, stdout: "pipe", stderr: "pipe" },
      );
      const [stdout, stderr, status] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      const result = { status, stdout, stderr };
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Verdict: reconciled/);
      assert.equal(readFileSync(`${out}.md`, "utf8").includes("Verdict: reconciled"), true);
      assert.equal(JSON.parse(readFileSync(`${out}.json`, "utf8")).ok, true);
    } finally {
      server.stop(true);
    }
  });

  it("the CLI fails closed without a proxy and without a key", () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-reconcile-cli-"));
    const reportPath = join(dir, "report.json");
    writeFileSync(reportPath, JSON.stringify([{ callId: "never-written", cost: 0.1 }]));
    const script = join(import.meta.dir, "reconcile.mjs");
    // A missing row is detected without reaching a proxy only when the read fails: point it at a
    // closed port so the CLI path (arg parsing, exit code) is still exercised end to end.
    const result = spawnSync("bun", [script, "--report", reportPath, "--base-url", "http://127.0.0.1:9", "--wait-ms", "0"], {
      encoding: "utf8",
      env: { ...process.env, LITELLM_API_KEY: "sk-canary" },
      timeout: 30_000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ERR_LITELLM_SPEND_LOGS|Unable to connect|ECONNREFUSED|fetch failed/i);
    const help = spawnSync("bun", [script, "--help"], { encoding: "utf8", timeout: 30_000 });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /usage: reconcile\.mjs --report/);
    const noKey = spawnSync("bun", [script, "--report", reportPath], {
      encoding: "utf8",
      env: { ...process.env, LITELLM_API_KEY: "" },
      timeout: 30_000,
    });
    assert.equal(noKey.status, 2);
    assert.match(noKey.stderr, /LITELLM_API_KEY is not set/);
  });
});
