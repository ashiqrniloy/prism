import { test } from "bun:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { assertMemoryModelFixture, MEMORY_MODEL_CRITERIA } from "../../robustness.mjs";
import {
  compactBenchWorkerMock,
  renderView,
  replayTurns,
  summarizeHistory,
  tailCap,
  transcriptLinesE1,
  transcriptLinesE2,
  transcriptView,
} from "./adapter.mjs";
import {
  allocateStrata,
  buildCompactBenchDraw,
  COMPACT_BENCH_DRAW_FILE,
  COMPACT_BENCH_EXCLUDED,
  drawRetention,
  renderDraw,
  sessionKeys,
} from "./draw.mjs";
import { COMPACT_BENCH_PIN, CompactBenchFetchError, compactBenchPaths, fetchCompactBenchData, parseSha256Sums } from "./fetch.mjs";
import { AGENT_THINKING, isLoopbackPeer, LOCAL_PLACEHOLDER_KEY, rewriteBody, startPassthrough } from "./passthrough.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const paths = compactBenchPaths(COMPACT_BENCH_PIN);
const HAVE_CODE = existsSync(join(paths.code, "harness/e1_runner.py"));
const HAVE_DATA = existsSync(join(paths.data, "SHA256SUMS"));
const python = process.env.PRISM_MEMORY_BENCH_PYTHON ?? "python3";

// --- fetch ---

function fakeDataset(files) {
  const sums = `${Object.entries(files)
    .map(([path, text]) => `${sha256(text)}  ${path}`)
    .join("\n")}\n`;
  const served = { SHA256SUMS: sums, ...files };
  const pin = {
    code: COMPACT_BENCH_PIN.code,
    dataset: { repository: "example/compact-bench", revision: "a".repeat(40), sha256sums: sha256(sums) },
  };
  const transport = (overrides = {}) =>
    async function fakeFetch(url) {
      const path = decodeURIComponent(new URL(url).pathname.split(`/resolve/${pin.dataset.revision}/`)[1]);
      const body = overrides[path] ?? served[path];
      return body === undefined ? new Response("missing", { status: 404 }) : new Response(body);
    };
  return { pin, transport, sums };
}

test("compact_bench_fetch_refuses_checksum_mismatch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cb-fetch-"));
  try {
    const { pin, transport } = fakeDataset({ "e2/sessions.jsonl": '{"sample_id":"s1"}\n', "e1/prepass24.txt": "a\nb\n" });
    // A SHA256SUMS that is not the pinned one is refused and not kept.
    await assert.rejects(
      fetchCompactBenchData({ pin, dir, fetch: transport({ SHA256SUMS: `${"0".repeat(64)}  e2/sessions.jsonl\n` }) }),
      (error) => error instanceof CompactBenchFetchError && /SHA256SUMS hash/.test(error.message),
    );
    assert.equal(existsSync(join(dir, "SHA256SUMS")), false);
    // A file whose bytes differ from SHA256SUMS is refused and never written.
    await assert.rejects(
      fetchCompactBenchData({ pin, dir, fetch: transport({ "e2/sessions.jsonl": '{"sample_id":"tampered"}\n' }) }),
      /e2\/sessions\.jsonl: downloaded sha256/,
    );
    assert.equal(existsSync(join(dir, "e2/sessions.jsonl")), false);
    // The pinned bytes verify; a later local edit is refused on re-verification, not overwritten.
    const ok = await fetchCompactBenchData({ pin, dir, fetch: transport() });
    assert.equal(ok.entries.length, 2);
    await writeFile(join(dir, "e1/prepass24.txt"), "a\nb\nc\n");
    await assert.rejects(fetchCompactBenchData({ pin, dir, fetch: transport() }), /e1\/prepass24\.txt: sha256 .* does not match/);
    assert.equal(await readFile(join(dir, "e1/prepass24.txt"), "utf8"), "a\nb\nc\n");
    // A branch name is not a pin, and a hostile path in SHA256SUMS is refused.
    await assert.rejects(fetchCompactBenchData({ pin: { ...pin, dataset: { ...pin.dataset, revision: "main" } }, dir }), /full 40-hex/);
    assert.throws(() => parseSha256Sums(`${"0".repeat(64)}  ../outside.txt\n`), /refused path/);
    assert.throws(() => parseSha256Sums(`${"0".repeat(64)}  /etc/passwd\n`), /refused path/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// --- adapter ---

/** An upstream-shaped history: E2 records carry OpenAI-style tool calls (ignored by upstream's transcript). */
function syntheticHistory(turns = 12) {
  const H = [{ role: "system", content: "You are a coding agent." }];
  for (let i = 0; i < turns; i++) {
    H.push({ role: "user", content: `Task ${i}: edit src/mod${i}/file${i}.py and fix ValueError${i}` });
    H.push({
      role: "assistant",
      content: [{ type: "text", text: `Reading src/mod${i}/file${i}.py` }],
      tool_calls: [{ id: `c${i}`, type: "function", function: { name: "Read", arguments: "{}" } }],
    });
    H.push({
      role: "tool",
      tool_call_id: `c${i}`,
      content: `contents of file${i} with SECRET_TOKEN_${i}=x${i}\n${"line of code\n".repeat(40)}`,
    });
    H.push({ role: "assistant", content: `Fixed ValueError${i} in src/mod${i}/file${i}.py` });
  }
  return H;
}

test("transcript_view_matches_upstream", async () => {
  // Expected hashes computed by the pinned upstream `cb_common.transcript` / `build_transcript` on this fixture.
  const H = [
    { role: "system", content: "sys 🚀 prompt" },
    { role: "user", content: `fix src/app/main.py: ValueError at line 3 ${"é".repeat(4100)}` },
    {
      role: "assistant",
      content: [
        { type: "think", think: "hidden" },
        { type: "text", text: "Looking at src/app/main.py" },
        { type: "tool_use", id: "t1", name: "read_file", input: { file_path: "src/app/main.py", n: 1.5, ok: true, x: null, s: "a b" } },
      ],
    },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "t1", content: `def f():\n    raise ValueError('x')\n${"😀".repeat(600)}` },
        { type: "tool_result", tool_use_id: "t2", content: [{ type: "text", text: "list content" }] },
      ],
    },
    { role: "tool", content: "   " },
    { role: "assistant", content: "Done. See https://example.com/pr/12 and API_KEY=abc" },
  ];
  assert.equal(sha256(renderView(transcriptView(H, "retention"))), "5134c91bbb62a950d98400b753aacd94e68da373513761cf223a79810082e431");
  assert.equal(sha256(renderView(tailCap(transcriptLinesE2(H), 3000))), "bfdef3ba03a85580a230be5d533f6d86b078d5a75566980ae0ca9c568ff0dc13");
  assert.equal(sha256(renderView(transcriptView(H, "outcome"))), "87cbc8a1aaa6931644eee7fd5abc47c22ace46521c449c807c601ef371ba8a0f");
  assert.equal(sha256(renderView(tailCap(transcriptLinesE1(H), 1000))), "1fc2af5739725f0ebd190c92c38b7e355f966f19d8c4c08eb9620979b318baac");
  if (!HAVE_CODE) return;
  // Live parity against the pinned checkout, on the synthetic history too.
  const dir = await mkdtemp(join(tmpdir(), "cb-parity-"));
  try {
    const synthetic = syntheticHistory(40);
    await writeFile(join(dir, "h.json"), JSON.stringify(synthetic));
    const script = `import sys,json,hashlib\nsys.path.insert(0,sys.argv[1]+'/harness')\nimport cb_common as C\nH=json.load(open(sys.argv[2]))\nprint(hashlib.sha256(C.transcript(H,2000).encode()).hexdigest(), hashlib.sha256(C.build_transcript(H,1500).encode()).hexdigest())`;
    const [e2, e1] = execFileSync(python, ["-I", "-c", script, paths.code, join(dir, "h.json")], { encoding: "utf8", timeout: 60_000 })
      .trim()
      .split(" ");
    assert.equal(sha256(renderView(tailCap(transcriptLinesE2(synthetic), 2000))), e2);
    assert.equal(sha256(renderView(tailCap(transcriptLinesE1(synthetic), 1500))), e1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("prism_summary_is_what_the_model_sees_after_compaction", async () => {
  const H = syntheticHistory(12);
  const view = transcriptView(H, "retention");
  // Upstream's E2 view drops tool_calls; the replay starts from exactly that view.
  assert.equal(renderView(view).includes('"function"'), false);
  const turns = replayTurns(view);
  // Each task is user -> assistant -> tool -> assistant: the tool line opens a second turn.
  assert.equal(turns.length, 24);
  assert.ok(turns.every((turn) => turn.reply.length > 0));

  for (const arm of ["memory-off", "WM"]) {
    const result = await summarizeHistory({
      H,
      track: "retention",
      arm,
      id: `t-${arm}`,
      workerProviders: [compactBenchWorkerMock()],
      workerModel: "cb-worker/mock",
    });
    const lines = view.map((row) => row.line);
    // S = the memory block (context blocks and summary messages, uncapped), then the kept messages as upstream lines.
    const keptPart = result.S.slice(result.block.length).replace(/^\n\n/, "");
    assert.ok(result.S.startsWith(result.block));
    // The kept part is a tail of the replayed transcript, in order, verbatim as upstream printed it.
    const tail = Array.from({ length: lines.length }, (_, k) => lines.slice(lines.length - k - 1).join("\n")).find(
      (text) => text === keptPart,
    );
    assert.equal(tail, keptPart);
    assert.ok(result.counts.keptMessages >= 1);
    assert.equal(result.S.includes("<<compact-bench-probe>>"), false);
    assert.equal(result.counts.autoCompactionsBeforeFinal, 0);
    assert.equal(result.counts.turns, 24);
    if (arm === "memory-off") {
      // The kernel's default compactor, delivered as the kernel's summary message.
      assert.ok(result.block.startsWith("Summary:\n"));
      assert.equal(result.chunks.length, 0);
    } else {
      assert.ok(result.block.includes("# Session Memory"));
      // The memory carries an early detail the kept tail does not.
      assert.ok(result.block.includes("src/mod0/file0.py"));
      assert.equal(keptPart.includes("src/mod0/file0.py"), false);
      // Recall-reachable text is returned apart from S.
      assert.ok(result.chunks.length > 0);
      assert.ok(result.counts.wm.compactions >= 1);
    }
  }
});

// --- pass-through ---

/** A fake OpenCode Go: records what arrives, answers with recorded responses. */
function fakeUpstream() {
  const seen = [];
  const messagesReply = JSON.stringify({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "minimax-m3.1-flash",
    content: [{ type: "tool_use", id: "toolu_1", name: "run_command", input: { command: "pytest -q tests/test_x.py" } }],
    stop_reason: "tool_use",
    usage: { input_tokens: 1200, output_tokens: 40, cache_read_input_tokens: 800 },
  });
  const chatReply = JSON.stringify({
    id: "chat_1",
    choices: [{ index: 0, message: { role: "assistant", content: "Summary: fixed src/a.py" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 900, completion_tokens: 12, total_tokens: 912 },
  });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const body = await req.text();
      seen.push({ path: url.pathname, headers: Object.fromEntries(req.headers), body });
      const reply = url.pathname.endsWith("/messages") ? messagesReply : chatReply;
      return new Response(reply, { headers: { "content-type": "application/json" } });
    },
  });
  return { seen, messagesReply, chatReply, url: `http://127.0.0.1:${server.port}/zen/go/v1`, stop: () => server.stop(true) };
}

/** The agent request upstream sends (`harness/e1_runner.py` `_call_agent_tools`), as recorded. */
const AGENT_REQUEST = {
  model: "minimax-m3.1-flash",
  max_tokens: 4096,
  messages: [
    { role: "user", content: "The conversation so far has been compacted. What follows is the summary:\n\nS" },
    { role: "user", content: "继续完成任务：确保修复生效并通过相关测试。" },
  ],
  tools: [
    {
      name: "read_file",
      description: "读取仓库内文件",
      input_schema: { type: "object", properties: { file_path: { type: "string" } }, required: ["file_path"] },
    },
    {
      name: "run_command",
      description: "x",
      input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
    },
  ],
};
const CHAT_REQUEST = {
  model: "muse-spark-1.3-contributor",
  max_tokens: 16384,
  messages: [{ role: "user", content: "[user] hi\n\nYour task..." }],
};
const SECRET = "sk-opencode-REAL-KEY-0123456789";

test("passthrough_adds_session_header_and_sets_agent_thinking", async () => {
  const upstream = fakeUpstream();
  const dir = await mkdtemp(join(tmpdir(), "cb-pass-"));
  const pass = await startPassthrough({
    upstream: upstream.url,
    env: { OPENCODE_GO_API_KEY: SECRET },
    session: "cb-218.1-test cell/1",
    record: join(dir, "record"),
    usageLog: join(dir, "usage.jsonl"),
  });
  try {
    const messages = await fetch(pass.messagesUrl, {
      method: "POST",
      headers: { "x-api-key": LOCAL_PLACEHOLDER_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(AGENT_REQUEST),
    });
    assert.equal(await messages.text(), upstream.messagesReply);
    const chat = await fetch(pass.chatUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${LOCAL_PLACEHOLDER_KEY}`, "content-type": "application/json" },
      body: JSON.stringify(CHAT_REQUEST),
    });
    assert.equal(await chat.text(), upstream.chatReply);
    await pass.drain();

    const [agent, summary] = upstream.seen;
    assert.equal(agent.path, "/zen/go/v1/messages");
    // Unchanged apart from the thinking field.
    assert.deepEqual(JSON.parse(agent.body), { ...AGENT_REQUEST, thinking: AGENT_THINKING });
    assert.equal(agent.headers["x-opencode-session"], "cb-218.1-test-cell-1");
    assert.equal(agent.headers["x-api-key"], SECRET);
    assert.equal(agent.headers.authorization, `Bearer ${SECRET}`);
    assert.equal(agent.headers["anthropic-version"], "2023-06-01");
    assert.equal(summary.path, "/zen/go/v1/chat/completions");
    assert.equal(summary.body, JSON.stringify(CHAT_REQUEST));
    assert.equal(summary.headers["x-opencode-session"], "cb-218.1-test-cell-1");
    assert.equal(summary.headers.authorization, `Bearer ${SECRET}`);
    assert.equal(summary.headers["x-api-key"], undefined);
    assert.equal(pass.counts.thinkingSet, 1);
    // A Messages request for another model keeps its body.
    assert.equal(rewriteBody("/v1/messages", JSON.stringify({ model: "qwen3.8-flash" })).thinking, false);
    // Every exchange is recorded with its usage, like the wire proxy.
    const usage = (await readFile(join(dir, "usage.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(
      usage.map((row) => [row.path, row.model, row.inputTokens, row.outputTokens, row.cacheKey]),
      [
        ["/messages", "minimax-m3.1-flash", 2000, 40, "cb-218.1-test-cell-1"],
        ["/chat/completions", "muse-spark-1.3-contributor", 900, 12, "cb-218.1-test-cell-1"],
      ],
    );
    assert.equal(readdirSync(join(dir, "record")).length, 2);

    // Upstream's own clients round-trip through it unchanged (the pinned checkout, when present).
    if (HAVE_CODE) {
      const script = [
        "import sys, json",
        "sys.path.insert(0, sys.argv[1] + '/harness')",
        "import cb_common as C, e1_runner as R",
        "d = R._call_agent_tools([{'role': 'user', 'content': 'go'}])",
        "s = C.summarize('muse-spark-1.3-contributor', 'text', C.key_for_model('muse-spark-1.3-contributor'))",
        "print(json.dumps({'tool': d['content'][0]['name'], 'summary': s}))",
      ].join("\n");
      // Async: the pass-through answers on this process's event loop.
      const { stdout: out } = await promisify(execFile)(python, ["-I", "-c", script, paths.code], {
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...pass.upstreamEnv },
        encoding: "utf8",
        timeout: 60_000,
      });
      assert.deepEqual(JSON.parse(out), { tool: "run_command", summary: "Summary: fixed src/a.py" });
      const [pyAgent, pySummary] = upstream.seen.slice(2);
      assert.deepEqual(JSON.parse(pyAgent.body).thinking, AGENT_THINKING);
      assert.equal(JSON.parse(pyAgent.body).max_tokens, 4096);
      assert.equal(pySummary.headers["x-opencode-session"], "cb-218.1-test-cell-1");
      assert.equal(JSON.parse(pySummary.body).thinking, undefined);
    }
  } finally {
    pass.stop();
    upstream.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("passthrough_refuses_non_local_connections_and_never_logs_the_key", async () => {
  for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "127.5.6.7"]) assert.equal(isLoopbackPeer(address), true, address);
  for (const address of ["10.0.0.2", "192.168.1.4", "::ffff:10.0.0.2", "fe80::1", "", undefined])
    assert.equal(isLoopbackPeer(address), false);
  await assert.rejects(startPassthrough({ listen: "0.0.0.0:0", env: { OPENCODE_GO_API_KEY: SECRET } }), /non-loopback/);
  await assert.rejects(
    startPassthrough({ env: {} }),
    (error) => /OPENCODE_GO_API_KEY is not set/.test(error.message) && !error.message.includes(SECRET),
  );

  const upstream = fakeUpstream();
  const dir = await mkdtemp(join(tmpdir(), "cb-pass-"));
  const logged = [];
  const originals = { log: console.log, error: console.error, warn: console.warn };
  for (const name of Object.keys(originals)) console[name] = (...args) => logged.push(args.join(" "));
  const pass = await startPassthrough({
    upstream: upstream.url,
    env: { OPENCODE_GO_API_KEY: SECRET },
    record: join(dir, "record"),
    usageLog: join(dir, "usage.jsonl"),
  });
  try {
    // The real key presented by a caller is not the local placeholder: refused, nothing forwarded.
    const wrong = await fetch(pass.messagesUrl, { method: "POST", headers: { "x-api-key": SECRET }, body: "{}" });
    assert.equal(wrong.status, 401);
    const other = await fetch(`${pass.url}/v1/models`, { method: "POST", headers: { "x-api-key": LOCAL_PLACEHOLDER_KEY } });
    assert.equal(other.status, 404);
    assert.equal(upstream.seen.length, 0);
    await fetch(pass.messagesUrl, {
      method: "POST",
      headers: { "x-api-key": LOCAL_PLACEHOLDER_KEY, "content-type": "application/json" },
      body: JSON.stringify(AGENT_REQUEST),
    });
    await pass.drain();
    assert.equal(upstream.seen.length, 1);
    // The key reaches the upstream headers only: never a record, the usage log, the counts or the console.
    const written = [
      ...readdirSync(join(dir, "record")).map((file) => readFileSync(join(dir, "record", file), "utf8")),
      readFileSync(join(dir, "usage.jsonl"), "utf8"),
      JSON.stringify(pass.counts),
      JSON.stringify(pass.upstreamEnv),
      ...logged,
    ];
    assert.equal(written.join("\n").includes(SECRET), false);
    assert.equal(pass.upstreamEnv.CB_API_KEY, LOCAL_PLACEHOLDER_KEY);
    assert.deepEqual({ refusedKey: pass.counts.refusedKey, refusedRoute: pass.counts.refusedRoute }, { refusedKey: 1, refusedRoute: 1 });
  } finally {
    Object.assign(console, originals);
    pass.stop();
    upstream.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

// --- draw ---

test("screen_draw_is_label_blind_and_frozen", async () => {
  // Only sample_id and client reach the draw: a session's history and annotations cannot move it.
  const line = JSON.stringify({
    sample_id: "s1",
    client: "opencode",
    H: [{ role: "user", content: "x" }],
    atoms: [{ kind: "path", value: "a/b.py" }],
  });
  assert.deepEqual(sessionKeys(`${line}\n`), [{ sample_id: "s1", client: "opencode" }]);
  const rows = Array.from({ length: 146 }, (_, i) => ({ sample_id: `s${i}`, client: ["a", "b", "c", "d"][i % 7 === 0 ? 3 : i % 3] }));
  const labelled = rows.map((row, i) => ({ ...row, H: [i], atoms: [{ value: String(i) }], n_atoms: i }));
  assert.deepEqual(drawRetention(labelled), drawRetention(rows));
  const strata = drawRetention(rows);
  assert.equal(Object.values(strata).flat().length, 30);
  const shares = allocateStrata({ x: 50, y: 73, z: 14, w: 9 }, 30);
  assert.equal(
    Object.values(shares).reduce((sum, n) => sum + n, 0),
    30,
  );
  assert.deepEqual(shares, { x: 10, y: 15, z: 3, w: 2 });

  // The frozen draw: 30 sessions by client, the 22 validated tasks, pins and hashes; ids only.
  const text = readFileSync(COMPACT_BENCH_DRAW_FILE, "utf8");
  const draw = JSON.parse(text);
  const ids = Object.values(draw.retention.strata).flat();
  assert.equal(ids.length, 30);
  assert.equal(draw.retention.idsHash, sha256(JSON.stringify([...ids].sort())));
  assert.equal(draw.outcome.n, 22);
  assert.equal(draw.outcome.instances.length, 22);
  for (const excluded of COMPACT_BENCH_EXCLUDED) assert.equal(draw.outcome.instances.includes(excluded), false);
  assert.equal(draw.outcome.idsHash, sha256(JSON.stringify([...draw.outcome.instances].sort())));
  assert.deepEqual(
    { code: draw.upstream.codeRevision, data: draw.upstream.datasetRevision, sums: draw.upstream.sha256sums },
    { code: COMPACT_BENCH_PIN.code.commit, data: COMPACT_BENCH_PIN.dataset.revision, sums: COMPACT_BENCH_PIN.dataset.sha256sums },
  );
  assert.equal(/"H"|"atoms"|"value"/.test(text), false);

  // Pinned in the criteria (amendment 7): both external fixtures hash the draw file and carry the pins.
  for (const id of ["compact-bench-retention", "compact-bench-outcome"]) {
    assert.equal(assertMemoryModelFixture(id), sha256(text));
    const entry = MEMORY_MODEL_CRITERIA.fixtures.index.find((row) => row.id === id);
    assert.deepEqual(
      { code: entry.codeRevision, data: entry.datasetRevision, sums: entry.sha256sums },
      { code: COMPACT_BENCH_PIN.code.commit, data: COMPACT_BENCH_PIN.dataset.revision, sums: COMPACT_BENCH_PIN.dataset.sha256sums },
    );
  }
  // Re-drawn from the pinned data, it reproduces byte for byte (when the mirror is present).
  if (HAVE_DATA) assert.equal(renderDraw(buildCompactBenchDraw()), text);
});

test("seam_self_check_holds_on_the_pinned_checkout", () => {
  if (!HAVE_CODE) return;
  const out = execFileSync(python, ["-I", join(import.meta.dir, "seam.py"), "self-check", "--code", paths.code], {
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.deepEqual(JSON.parse(out), { ok: true, checked: 4 });
});

// --- Task 3 Step 1: the WM engagement probe ---

test("wm_probe_counts_engagement_without_scoring", async () => {
  const { runWmProbe, wmProbeEvidence } = await import("./wm-probe.mjs");
  const H = syntheticHistory(12);
  let calls = 0;
  const run = await runWmProbe({
    histories: [
      { id: "a", H },
      { id: "b", H: syntheticHistory(1) },
    ],
    workerProviders: [compactBenchWorkerMock()],
    workerModel: "cb-worker/mock",
    usageNow: async () => {
      calls++;
      return { inputTokens: calls * 100, outputTokens: calls * 10, cacheReadTokens: 0 };
    },
    rule: { ...(await import("./wm-probe.mjs")).WM_PROBE_RULE, sessions: 2, threshold: 1 },
  });
  assert.equal(run.rows.length, 2);
  // The one-task history is far below every trigger: never engaged.
  assert.equal(run.rows.find((row) => row.id === "b").engaged, false);
  for (const row of run.rows) assert.deepEqual(row.worker, { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0 });
  const evidence = wmProbeEvidence({
    run,
    draw: { sha256: "d".repeat(64), retentionIdsHash: "e".repeat(64) },
    criteriaHash: "c".repeat(64),
    startedAt: "t0",
    finishedAt: "t1",
  });
  const text = JSON.stringify(evidence);
  // Ids and counts only: no S, no history line, no annotated detail, no recall score.
  for (const forbidden of ['"S"', '"block"', '"chunks"', "src/mod", "ValueError", "SECRET_TOKEN", '"recall"', '"hits"']) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
  assert.equal(evidence.summary.sessions, 2);
  assert.equal(evidence.summary.spent.inputTokens, 200);
  // A failed session's tokens count toward the spend, and the wire log (every attempt) wins when given.
  const failedRun = await runWmProbe({
    histories: [{ id: "x", H }],
    summarize: async () => {
      throw new Error("CompactBenchAdapter: the memory worker did not settle");
    },
    usageNow: async () => {
      calls++;
      return { inputTokens: calls * 100, outputTokens: 0, cacheReadTokens: 0 };
    },
  });
  assert.deepEqual(failedRun.failed[0].worker, { inputTokens: 100, outputTokens: 0, cacheReadTokens: 0 });
  const failedEvidence = (wire) =>
    wmProbeEvidence({
      run: failedRun,
      draw: { sha256: "d", retentionIdsHash: "e" },
      criteriaHash: "c",
      startedAt: "t0",
      finishedAt: "t1",
      wire,
    });
  assert.equal(failedEvidence().summary.spent.inputTokens, 100);
  const withWire = failedEvidence({ totals: { inputTokens: 900, outputTokens: 0, cacheReadTokens: 0 }, sessions: [] });
  assert.equal(withWire.summary.spent.inputTokens, 900);
  // A finished session whose id the cache key sanitizes ("cid:x" -> "cid_x") is in the log, never counted twice.
  const sanitized = wmProbeEvidence({
    run: { ...run, rows: run.rows.map((row) => ({ ...row, id: `cid:${row.id}` })), failed: [] },
    draw: { sha256: "d", retentionIdsHash: "e" },
    criteriaHash: "c",
    startedAt: "t0",
    finishedAt: "t1",
    wire: { totals: { inputTokens: 200, outputTokens: 0, cacheReadTokens: 0 }, sessions: ["cid_a", "cid_b"] },
  });
  assert.equal(sanitized.summary.spent.inputTokens, 200);
  assert.equal(evidence.rule.scoring, "none: S is discarded unread and never scored");
  // The probe module never reaches the scorer.
  const source = readFileSync(join(import.meta.dir, "wm-probe.mjs"), "utf8");
  assert.equal(/scoreRetention|child_process|execFile|\.atoms\b/.test(source), false);
});

test("screen_branch_follows_the_probe_gate", async () => {
  const { assertWmProbeGate, WM_PROBE_GATE, WM_PROBE_RULE, wmProbeBranch, wmProbeRuleHash } = await import("./wm-probe.mjs");
  const rows = (engaged) => Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, engaged: i < engaged }));
  assert.deepEqual(wmProbeBranch({ rows: rows(14) }), { branch: "B", engaged: 14, of: 30 });
  assert.deepEqual(wmProbeBranch({ rows: rows(15) }), { branch: "A", engaged: 15, of: 30 });
  assert.equal(wmProbeBranch({ rows: rows(30), ceilingHit: true }).branch, "stop");
  assert.equal(wmProbeBranch({ rows: rows(26).slice(0, 26), failures: 4 }).branch, "stop");
  assert.equal(wmProbeBranch({ rows: rows(27).slice(0, 27), failures: 3 }).branch, "A");
  assert.equal(wmProbeBranch({ rows: rows(20).slice(0, 20) }).branch, "stop");
  // The committed gate record approves exactly this rule; a changed threshold is refused, not re-approved.
  const gate = JSON.parse(readFileSync(WM_PROBE_GATE, "utf8"));
  assert.equal(assertWmProbeGate(gate).ruleHash, wmProbeRuleHash());
  assert.equal(gate.compactBenchWmProbe.rule.threshold, 15);
  assert.equal(gate.compactBenchWmProbe.drawSha256, sha256(readFileSync(COMPACT_BENCH_DRAW_FILE, "utf8")));
  assert.throws(() => assertWmProbeGate(gate, { ...WM_PROBE_RULE, threshold: 10 }), /a changed rule is a refusal/);
  assert.throws(() => assertWmProbeGate({ compactBenchWmProbe: { ...gate.compactBenchWmProbe, approved: false } }), /not approved/);
  assert.throws(() => assertWmProbeGate({}), /no compactBenchWmProbe/);
});
