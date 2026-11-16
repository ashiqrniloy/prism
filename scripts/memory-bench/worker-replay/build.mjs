/**
 * Plan 218.2 Task 1: the worker replay fixture builder.
 *
 * The fixture is frozen STM and WM worker requests with their annotations, built from the long-session family's
 * development personas (`codingProject`, dev partition of `work-outcome-long-session.json`) and written cases:
 *
 * - `stm.json`: transcript batches (session entries), the task state and the recent-record index each STM request
 *   carries. Sets: `base` (two batches per persona), and the hard cases, each at least 6 times: `passed-outcome`
 *   ("fixed the failing test", "0 failed"), `actually` (a user "actually" that corrects nothing), `bn` / `ja` / `es`
 *   (a correction, a constraint and a failed check written in Bengali, Japanese and Spanish), `offtopic-constraint`
 *   (a constraint stated once, off the current topic).
 * - `wm.json`: an STM record batch, the current WM items, the task state, the entries salience reads and a scope.
 *   Sets: `base` (the six-step persona plan) and `long-scope` (the same batches under a plan document of >= 16 KB).
 * - `annotations.json`: what a correct recorder and a correct WM pass produce. The harness never sends it.
 *
 * Content is a function of the persona id, so `--check` rebuilds byte-identical files. `index.json` pins the three
 * files' sha256; the criteria fixture index (`worker-replay`) pins index.json by amendment.
 *
 *   bun scripts/memory-bench/worker-replay/build.mjs           # write the fixture (only before it is frozen)
 *   bun scripts/memory-bench/worker-replay/build.mjs --check   # refuse when a committed file differs from a rebuild
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { codingProject, LONG_SESSION_SEED } from "../work-outcome/long-session.mjs";

export const WORKER_REPLAY_DIR = new URL("../fixtures/memory-model/worker-replay/", import.meta.url).pathname;
export const WORKER_REPLAY_FILES = Object.freeze(["stm.json", "wm.json", "annotations.json"]);
export const WORKER_REPLAY_MAX_REQUESTS = 120;
/** STM sets; every set other than `base` is a hard case and appears at least 6 times. */
export const STM_SETS = Object.freeze(["base", "passed-outcome", "actually", "bn", "ja", "es", "offtopic-constraint"]);
export const NON_ENGLISH_SETS = Object.freeze(["bn", "ja", "es"]);
export const WM_SETS = Object.freeze(["base", "long-scope"]);
export const LONG_SCOPE_MIN_BYTES = 16_384;
/** The persona-plan WM batch stays within the product's default `wm.batchTokens`, so the flush would send it whole. */
export const WM_BATCH_TOKEN_LIMIT = 3_000;

const hex = (value) => createHash("sha256").update(value).digest("hex");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const memoryId = (...parts) => hex(parts.join("\u0000")).slice(0, 12);
/** The product's estimate (`estimateTextTokens`): 4 characters per token, rounded up. */
const tokensOf = (text) => Math.ceil(text.length / 4);

/** The development personas: the dev partition of the long-session family, in its committed order. */
export function devPersonaIds() {
  const file = JSON.parse(readFileSync(new URL("../work-outcome-long-session.json", import.meta.url), "utf8"));
  return [...file.abilities.dev["long-session-coding"]];
}

/** One persona's seeded names and files (the long-session family's own generator). */
function persona(id) {
  const { word, files, labels } = codingProject(id, LONG_SESSION_SEED);
  const pick = (key, n) => Number.parseInt(hex(`${LONG_SESSION_SEED}/${id}/replay/${key}`).slice(0, 8), 16) % n;
  return { id, word, files, ...labels, pick };
}

/** A transcript writer: message entries with ids `e01…`, a fixed clock, tool calls as call + result entries. */
function transcript(sessionId, startIso) {
  const entries = [];
  let at = Date.parse(startIso);
  let n = 0;
  let calls = 0;
  const push = (role, content) => {
    const id = `e${String(++n).padStart(2, "0")}`;
    entries.push({ id, sessionId, kind: "message", timestamp: new Date(at).toISOString(), message: { role, content } });
    at += 45_000;
    return id;
  };
  return {
    entries,
    user: (text) => push("user", [{ type: "text", text }]),
    say: (text) => push("assistant", [{ type: "text", text }]),
    tool(name, args, result) {
      const id = `c${++calls}`;
      const call = push("assistant", [{ type: "tool_call", id, name, arguments: args }]);
      const output = push("tool", [{ type: "tool_result", toolCallId: id, name, result }]);
      return { call, result: output };
    },
    at: () => new Date(at).toISOString(),
  };
}

/** Gold STM records: what a correct recorder writes (also the WM fixture's records). */
function goldEvent(requestId, n, fields) {
  const { kind, description, sources, attribution, relevance = "medium", at, ...rest } = fields;
  return {
    id: memoryId("replay", requestId, String(n)),
    kind,
    description,
    count: 1,
    timestamp: at,
    observedAt: at,
    lastAt: at,
    relevance,
    sourceEntryIds: sources,
    ...(attribution ? { attribution } : {}),
    tokenCount: tokensOf(description),
    ...rest,
  };
}

const warningsIn = (text) => text.split("\n").filter((line) => line.includes("warning:")).length;
const failedLinesIn = (text) => text.split("\n").filter((line) => line.includes("FAILED"));

function testOutput(p, { pass, fail, failure }) {
  return [
    "bun test v1.4.4",
    "",
    `test/${p.moduleBase}.test.ts:`,
    ...(failure ? [`✗ formats cents [0.42ms]`, failure, `    at test/${p.moduleBase}.test.ts:3:28`] : ["✓ formats cents [0.31ms]"]),
    "✓ cli prints the formatted total [0.12ms]",
    "",
    ` ${pass} pass`,
    ` ${fail} fail`,
    `Ran ${pass + fail} tests across 2 files. [61.00ms]`,
  ].join("\n");
}

/** A localized project check script (`scripts/check.sh` prints in the team's language). */
const LOCALIZED = {
  bn: {
    name: "Bengali",
    check: (p, failed, total) =>
      `চেক চলছে: ${p.moduleBase}\nপরীক্ষার ফলাফল: ${total}টির মধ্যে ${failed}টি ব্যর্থ হয়েছে\nব্যর্থ: test/${p.moduleBase}.test.ts › সেন্ট ফরম্যাট (প্রত্যাশিত "12.34", পাওয়া গেছে "1234")`,
    span: (_p, failed, total) => `পরীক্ষার ফলাফল: ${total}টির মধ্যে ${failed}টি ব্যর্থ হয়েছে`,
    request: (p) => `${p.from} ফাংশনটার নাম বদলে ${p.to} করো, তারপর চেক স্ক্রিপ্ট চালাও।`,
    corrections: [
      (p) => `না, এটা ভুল। আমি বলেছিলাম src/cli.ts-এর কলারটাও বদলাতে, শুধু ${p.modulePath} নয়।`,
      (p) => `তুমি ভুল ফাইল বদলেছ। ${p.configPath} নয়, ${p.modulePath} বদলানোর কথা ছিল।`,
    ],
    constraints: [
      () => `এখন থেকে test/fixtures ফোল্ডারের কোনো ফাইল কখনো বদলাবে না; ওগুলো স্বয়ংক্রিয়ভাবে তৈরি হয়।`,
      (p) => `${p.configPath}-এর timeout_ms কখনো বদলাবে না; ওটা অপস টিমের দায়িত্ব।`,
    ],
    failedReply: (_p, failed) => `আমি চেক চালিয়েছি, ${failed}টি টেস্ট ব্যর্থ হয়েছে; পরিবর্তনটি এখনো যাচাই করা হয়নি।`,
    fixReply: (p) => `ঠিক আছে, src/cli.ts-এর কলারও এখন ${p.to} ব্যবহার করে।`,
  },
  ja: {
    name: "Japanese",
    check: (p, failed, total) =>
      `チェック実行中: ${p.moduleBase}\nテスト結果: ${total} 件中 ${failed} 件が失敗しました\n失敗: test/${p.moduleBase}.test.ts › セントの整形 (期待値 "12.34"、実際 "1234")`,
    span: (_p, failed, total) => `テスト結果: ${total} 件中 ${failed} 件が失敗しました`,
    request: (p) => `関数 ${p.from} の名前を ${p.to} に変更して、チェックスクリプトを実行してください。`,
    corrections: [
      (p) => `違います。src/cli.ts の呼び出し側も変更してと言いました。${p.modulePath} だけではありません。`,
      (p) => `変更するファイルを間違えています。${p.configPath} ではなく ${p.modulePath} です。`,
    ],
    constraints: [
      () => `今後、test/fixtures 以下のファイルは絶対に編集しないでください。自動生成されたものです。`,
      (p) => `${p.configPath} の timeout_ms は決して変更しないでください。運用チームの管理です。`,
    ],
    failedReply: (_p, failed) => `チェックを実行しましたが、${failed} 件のテストが失敗しました。変更はまだ検証できていません。`,
    fixReply: (p) => `わかりました。src/cli.ts の呼び出し側も ${p.to} を使うように直しました。`,
  },
  es: {
    name: "Spanish",
    check: (p, failed, total) =>
      `Ejecutando comprobación: ${p.moduleBase}\nResultado: ${failed} de ${total} pruebas fallaron\nFallida: test/${p.moduleBase}.test.ts › formato de céntimos (se esperaba "12.34", se obtuvo "1234")`,
    span: (_p, failed, total) => `Resultado: ${failed} de ${total} pruebas fallaron`,
    request: (p) => `Cambia el nombre de la función ${p.from} a ${p.to} y luego ejecuta el script de comprobación.`,
    corrections: [
      (p) => `Eso está mal: te dije que cambiaras también la llamada en src/cli.ts, no solo ${p.modulePath}.`,
      (p) => `Te equivocaste de archivo: no era ${p.configPath}, era ${p.modulePath}.`,
    ],
    constraints: [
      () => `A partir de ahora, nunca modifiques los archivos dentro de test/fixtures; se generan automáticamente.`,
      (p) => `Nunca cambies timeout_ms en ${p.configPath}; ese valor lo gestiona el equipo de operaciones.`,
    ],
    failedReply: (_p, failed) => `Ejecuté la comprobación: ${failed} pruebas fallaron; el cambio todavía no está verificado.`,
    fixReply: (p) => `Entendido, la llamada en src/cli.ts ahora también usa ${p.to}.`,
  },
};

const OFFTOPIC = [
  "Unrelated, but for the record: never push to the main branch directly; always open a pull request.",
  "Side note for everything you do here: release notes must stay in English, even when we talk in another language.",
  "Before I forget, and it has nothing to do with this config: never add a new runtime dependency without asking me first.",
];

const ACTUALLY = [
  (p) => `Actually, could you also export ${p.to} from src/index.ts so other packages can use it?`,
  (_p) => `Actually, that looks good, thanks. Let's also keep a note of the warning count in the README.`,
  (p) => `Actually, while you are in there, add a short doc comment above ${p.to}.`,
];

/** STM base batch A: task 1 (rename, a failed check, a user correction, a passed check) and task 2 (count warnings in four logs). */
function stmBaseA(p, requestId, start) {
  const t = transcript(`wr-${requestId}`, start);
  const gold = [];
  const event = (fields) => gold.push(goldEvent(requestId, gold.length, { at: t.at(), ...fields }));
  const ask = t.user(
    `Task 1. Rename the function that formats cents (src/cli.ts uses it) to \`${p.to}\` everywhere in this project (its definition and every caller), then run the tests.`,
  );
  event({
    kind: "request",
    description: `User asked to rename the cents-formatting function used by src/cli.ts to ${p.to} everywhere, then run the tests.`,
    sources: [ask],
    attribution: "user",
    relevance: "high",
  });
  const grep = t.tool(
    "grep",
    { pattern: "cents" },
    `${p.modulePath}:1:export function ${p.from}(cents: number): string {\nsrc/cli.ts:1:import { ${p.from} } from "./${p.moduleBase}";\ntest/${p.moduleBase}.test.ts:3:test("formats cents", () => expect(${p.from}(1234)).toBe("12.34"));`,
  );
  const read = t.tool("read_file", { path: p.modulePath }, p.files[p.modulePath]);
  event({
    kind: "result",
    description: `The cents formatter is ${p.from} in ${p.modulePath}; callers: src/cli.ts and test/${p.moduleBase}.test.ts.`,
    sources: [grep.result, read.result],
    attribution: "tool",
  });
  const edit1 = t.tool("edit_file", { path: p.modulePath, find: p.from, replace: p.to }, "ok: 1 replacement");
  const edit2 = t.tool("edit_file", { path: "src/cli.ts", find: p.from, replace: p.to }, "ok: 2 replacements");
  const failure = `ReferenceError: ${p.from} is not defined`;
  const run1 = t.tool("run_tests", {}, testOutput(p, { pass: 1, fail: 1, failure }));
  event({
    kind: "error",
    description: `Tests failed after renaming in ${p.modulePath} and src/cli.ts: ${failure} in test/${p.moduleBase}.test.ts (1 pass, 1 fail).`,
    sources: [run1.result],
    attribution: "tool",
    relevance: "high",
    status: "failed",
  });
  const correction = t.user("That's not right — I said everywhere, and the test file counts too. Update it as well.");
  event({
    kind: "statement",
    description: `User corrected the assistant: the rename must also cover test/${p.moduleBase}.test.ts.`,
    sources: [correction],
    attribution: "user",
    relevance: "high",
    corrects: true,
  });
  const edit3 = t.tool("edit_file", { path: `test/${p.moduleBase}.test.ts`, find: p.from, replace: p.to }, "ok: 2 replacements");
  const run2 = t.tool("run_tests", {}, testOutput(p, { pass: 2, fail: 0 }));
  const done = t.say(
    `Renamed \`${p.from}\` to \`${p.to}\` in ${p.modulePath}, src/cli.ts and test/${p.moduleBase}.test.ts. The tests pass now: 2 pass.`,
  );
  event({
    kind: "outcome",
    description: `Task 1 done: ${p.from} → ${p.to} in ${p.modulePath}, src/cli.ts and test/${p.moduleBase}.test.ts; tests pass (2 pass). Tests run with the run_tests tool.`,
    sources: [edit1.result, edit2.result, edit3.result, run2.result, done],
    attribution: "mixed",
    relevance: "high",
    status: "passed",
  });
  const ask2 = t.user(
    "Task 2. Read the build log, in four parts logs/build-1.log to logs/build-4.log, and tell me how many lines report a warning.",
  );
  event({
    kind: "request",
    description: "User asked how many lines of logs/build-1.log to logs/build-4.log report a warning.",
    sources: [ask2],
    attribution: "user",
  });
  let warnings = 0;
  const reads = [];
  for (let part = 1; part <= 4; part++) {
    const path = `logs/build-${part}.log`;
    warnings += warningsIn(p.files[path]);
    reads.push(t.tool("read_file", { path }, p.files[path]).result);
  }
  const answer = t.say(`${warnings} lines across the four build logs report a warning (all "deprecated option").`);
  event({
    kind: "outcome",
    description: `Task 2 answered: ${warnings} warning lines in logs/build-1.log to logs/build-4.log, all "deprecated option".`,
    sources: [...reads, answer],
    attribution: "mixed",
    status: "unknown",
  });
  return {
    entries: t.entries,
    recent: [],
    gold,
    annotation: {
      outcomes: [
        { entries: [run2.result, done], status: "passed", resolves: [] },
        { entries: [answer], status: "unknown", resolves: [] },
      ],
      checks: [
        { entries: [run1.result], status: "failed" },
        { entries: [run2.result], status: "passed" },
      ],
      corrections: [{ entry: correction }],
      nonCorrections: [],
      durable: [],
      evidence: [{ entry: run1.result, text: failure }],
    },
  };
}

/** The records an earlier batch left for batch B: task 4's request and the error its first edit caused. */
function priorTask4(p, requestId, at) {
  const request = goldEvent(`${requestId}:prior`, 0, {
    kind: "request",
    description: `User asked to change ${p.key} in ${p.configPath} from ${p.before} to ${p.after}, keeping every other key, then run the tests.`,
    sources: ["p01"],
    attribution: "user",
    relevance: "high",
    at,
  });
  const error = goldEvent(`${requestId}:prior`, 1, {
    kind: "error",
    description: `After the first edit ${p.configPath} no longer parsed: SyntaxError: Unexpected token } in JSON at position 41; run_tests failed to load the config.`,
    sources: ["p04"],
    attribution: "tool",
    relevance: "high",
    status: "failed",
    at,
  });
  return { request, error };
}

/** STM base batch B: task 4 finished (resolving a recent request and error), a user constraint, task 5 (deploy logs). */
function stmBaseB(p, requestId, start, recentA) {
  const t = transcript(`wr-${requestId}`, start);
  const gold = [];
  const event = (fields) => gold.push(goldEvent(requestId, gold.length, { at: t.at(), ...fields }));
  const prior = priorTask4(p, requestId, start);
  const fixedConfig = `${JSON.stringify({ timeout_ms: 5000, [p.key]: p.after }, null, 2)}\n`;
  const read = t.tool("read_file", { path: p.configPath }, `{\n  "timeout_ms": 5000,\n  "${p.key}": ${p.after},\n}\n`);
  const write = t.tool("write_file", { path: p.configPath, content: fixedConfig }, "ok: 1 file written");
  const run = t.tool("run_tests", {}, testOutput(p, { pass: 2, fail: 0 }));
  const done = t.say(
    `Fixed the trailing comma in ${p.configPath}: ${p.key} is now ${p.after} (was ${p.before}) and timeout_ms is unchanged. Tests pass: 2 pass.`,
  );
  event({
    kind: "outcome",
    description: `Task 4 done: ${p.key} in ${p.configPath} ${p.before} → ${p.after}, timeout_ms unchanged; the JSON parse error is fixed and tests pass.`,
    sources: [read.result, write.result, run.result, done],
    attribution: "mixed",
    relevance: "high",
    status: "passed",
    resolves: [prior.request.id, prior.error.id],
  });
  const rule = t.user(
    `Keep in mind for the rest of this work: do not change timeout_ms in ${p.configPath} or any other config — the ops team owns that value.`,
  );
  event({
    kind: "statement",
    description: `User constraint: never change timeout_ms in ${p.configPath} or any other config; the ops team owns it.`,
    sources: [rule],
    attribution: "user",
    relevance: "high",
    durable: "constraint",
  });
  const ack = t.say("Understood, I will leave timeout_ms alone in every config.");
  const ask = t.user("Task 5. Read the deploy log, logs/deploy-1.log to logs/deploy-4.log, and list the steps that failed.");
  event({
    kind: "request",
    description: "User asked to list the failed steps in logs/deploy-1.log to logs/deploy-4.log.",
    sources: [ask],
    attribution: "user",
  });
  const failedLines = [];
  const reads = [];
  for (let part = 1; part <= 4; part++) {
    const path = `logs/deploy-${part}.log`;
    failedLines.push(...failedLinesIn(p.files[path]));
    reads.push(t.tool("read_file", { path }, p.files[path]).result);
  }
  const steps = failedLines.map((line) => /^\[(\w+)\] step (\d+)\//.exec(line)).map((m) => `${m[1]} step ${m[2]}`);
  const answer = t.say(`${steps.length} deploy steps are marked FAILED: ${steps.join(", ")}.`);
  event({
    kind: "outcome",
    description: `Task 5 answered: ${steps.length} deploy steps marked FAILED in logs/deploy-1.log to logs/deploy-4.log: ${steps.join(", ")}.`,
    sources: [...reads, answer],
    attribution: "mixed",
    status: "unknown",
  });
  void ack;
  return {
    entries: t.entries,
    recent: [...recentA, prior.request, prior.error],
    gold,
    prior,
    annotation: {
      outcomes: [
        { entries: [run.result, done], status: "passed", resolves: [prior.request.id, prior.error.id] },
        { entries: [answer], status: "unknown", resolves: [] },
      ],
      checks: [{ entries: [run.result], status: "passed" }],
      corrections: [],
      nonCorrections: [],
      durable: [{ entry: rule, kind: "constraint" }],
      evidence: [{ entry: reads[whichPart(p, failedLines[0])], text: failedLines[0] }],
    },
  };
}

const whichPart = (p, line) => [1, 2, 3, 4].findIndex((part) => p.files[`logs/deploy-${part}.log`].includes(line));

/** Two build logs read as the batch's leading work, so a hard-case request is 4-16K tokens like a real batch. */
function padWithLogs(t, p, parts = [1, 2]) {
  const ask = t.user(
    `Before that, skim ${parts.map((part) => `logs/build-${part}.log`).join(" and ")} and tell me whether anything looks off.`,
  );
  const reads = parts.map((part) => t.tool("read_file", { path: `logs/build-${part}.log` }, p.files[`logs/build-${part}.log`]).result);
  const warnings = parts.reduce((sum, part) => sum + warningsIn(p.files[`logs/build-${part}.log`]), 0);
  const answer = t.say(`Nothing failed in those logs; ${warnings} lines warn about a deprecated option.`);
  return { ask, reads, answer, warnings };
}

/** Hard case: a passed outcome that reads like a failure ("fixed the failing test", "0 failed"). */
function stmPassedOutcome(p, requestId, start, variant) {
  const t = transcript(`wr-${requestId}`, start);
  const pad = padWithLogs(t, p);
  const recent = [
    goldEvent(`${requestId}:prior`, 0, {
      kind: "request",
      description: `User asked to fix the failing cents test in test/${p.moduleBase}.test.ts.`,
      sources: ["p01"],
      attribution: "user",
      relevance: "high",
      at: start,
    }),
    goldEvent(`${requestId}:prior`, 1, {
      kind: "error",
      description: `test/${p.moduleBase}.test.ts › formats cents failed: expected "12.34", received "1234".`,
      sources: ["p02"],
      attribution: "tool",
      relevance: "high",
      status: "failed",
      at: start,
    }),
  ];
  t.tool("read_file", { path: p.modulePath }, `export function ${p.to}(cents: number): string {\n  return String(cents);\n}\n`);
  t.tool("edit_file", { path: p.modulePath, find: "String(cents)", replace: "(cents / 100).toFixed(2)" }, "ok: 1 replacement");
  const run = t.tool("run_tests", {}, testOutput(p, { pass: 14, fail: 0 }));
  const reply = [
    `Fixed the failing test: ${p.to} divided by 100 again. 14 pass, 0 failed.`,
    `The failing cents test is fixed (${p.modulePath} divides by 100 again); the run shows 0 fail and 14 pass.`,
  ][variant % 2];
  const done = t.say(reply);
  return {
    entries: t.entries,
    recent,
    gold: [],
    annotation: {
      outcomes: [
        { entries: [pad.answer], status: "unknown", resolves: [] },
        { entries: [run.result, done], status: "passed", resolves: [recent[1].id, recent[0].id] },
      ],
      checks: [{ entries: [run.result], status: "passed" }],
      corrections: [],
      nonCorrections: [],
      durable: [],
      evidence: [],
    },
  };
}

/** Hard case: a user "actually" that corrects nothing (a new request or an approval). */
function stmActually(p, requestId, start, variant) {
  const t = transcript(`wr-${requestId}`, start);
  const pad = padWithLogs(t, p);
  const ask = t.user(`Rename ${p.from} to ${p.to} in ${p.modulePath} and src/cli.ts, then run the tests.`);
  t.tool("edit_file", { path: p.modulePath, find: p.from, replace: p.to }, "ok: 1 replacement");
  t.tool("edit_file", { path: "src/cli.ts", find: p.from, replace: p.to }, "ok: 2 replacements");
  const run = t.tool("run_tests", {}, testOutput(p, { pass: 2, fail: 0 }));
  const done = t.say(`Renamed ${p.from} to ${p.to}; tests pass (2 pass).`);
  const actually = t.user(ACTUALLY[variant % ACTUALLY.length](p));
  const ack = t.say("Sure, done.");
  void ask;
  void ack;
  return {
    entries: t.entries,
    recent: [],
    gold: [],
    annotation: {
      outcomes: [
        { entries: [pad.answer], status: "unknown", resolves: [] },
        { entries: [run.result, done], status: "passed", resolves: [] },
      ],
      checks: [{ entries: [run.result], status: "passed" }],
      corrections: [],
      nonCorrections: [{ entry: actually }],
      durable: [],
      evidence: [],
    },
  };
}

/** Hard case: a correction, a constraint and a failed check written in Bengali, Japanese or Spanish. */
function stmLocalized(p, requestId, start, language, variant) {
  const L = LOCALIZED[language];
  const t = transcript(`wr-${requestId}`, start);
  padWithLogs(t, p);
  t.user(L.request(p));
  t.tool("edit_file", { path: p.modulePath, find: p.from, replace: p.to }, "ok: 1 replacement");
  const failed = 1 + (variant % 3);
  const total = 12 + variant;
  const check = t.tool("run_check", { script: "scripts/check.sh" }, L.check(p, failed, total));
  const report = t.say(L.failedReply(p, failed));
  const correction = t.user(L.corrections[variant % 2](p));
  t.tool("edit_file", { path: "src/cli.ts", find: p.from, replace: p.to }, "ok: 2 replacements");
  t.say(L.fixReply(p));
  const constraint = t.user(L.constraints[variant % 2](p));
  return {
    entries: t.entries,
    recent: [],
    gold: [],
    annotation: {
      outcomes: [],
      checks: [{ entries: [check.result, report], status: "failed" }],
      corrections: [{ entry: correction }],
      nonCorrections: [],
      durable: [{ entry: constraint, kind: "constraint" }],
      evidence: [{ entry: check.result, text: L.span(p, failed, total) }],
    },
  };
}

/** Hard case: a constraint stated once, off the current topic, in the middle of config work. */
function stmOfftopic(p, requestId, start, variant) {
  const t = transcript(`wr-${requestId}`, start);
  padWithLogs(t, p);
  t.user(`Change ${p.key} in ${p.configPath} from ${p.before} to ${p.after}; leave every other key alone.`);
  t.tool("read_file", { path: p.configPath }, p.files[p.configPath]);
  const rule = t.user(OFFTOPIC[variant % OFFTOPIC.length]);
  t.say("Noted.");
  const write = t.tool(
    "write_file",
    { path: p.configPath, content: `${JSON.stringify({ timeout_ms: 5000, [p.key]: p.after }, null, 2)}\n` },
    "ok: 1 file written",
  );
  const run = t.tool("run_tests", {}, testOutput(p, { pass: 2, fail: 0 }));
  const done = t.say(`${p.key} is now ${p.after} (was ${p.before}); tests pass.`);
  return {
    entries: t.entries,
    recent: [],
    gold: [],
    annotation: {
      outcomes: [{ entries: [write.result, run.result, done], status: "passed", resolves: [] }],
      checks: [{ entries: [run.result], status: "passed" }],
      corrections: [],
      nonCorrections: [],
      durable: [{ entry: rule, kind: "constraint" }],
      evidence: [],
    },
  };
}

/** The six-step persona plan (WM `base` scope). Steps 3 and 6 read what steps 1 and 4 changed without naming it. */
function personaPlan(p) {
  return [
    `# ${p.word} service: maintenance episode`,
    "",
    "Goal: finish the six tasks below in order; later steps build on what earlier ones changed.",
    "",
    "1. Rename the cents formatter used by src/cli.ts everywhere (definition and callers) and keep the tests green.",
    "2. Count the warning lines in logs/build-1.log to logs/build-4.log.",
    "3. Add src/report.ts exporting `summary(totals)` that formats each total with the function renamed in step 1, imported from its module.",
    "4. Change the retry setting in the service config to the value the user gives, keeping every other key.",
    "5. List the failed steps in logs/deploy-1.log to logs/deploy-4.log.",
    "6. Write docs/retries.md naming the config file, the retry key and its new value from step 4.",
    "",
    "Constraints the user states during the work apply to every later step.",
  ].join("\n");
}

const WORKSTREAMS = ["ci", "docs", "i18n", "billing", "search", "auth", "metrics", "release"];
const VERBS = ["Migrate", "Audit", "Document", "Benchmark", "Refactor", "Harden", "Instrument", "Review"];

/** The long-scope plan: the persona's six steps buried in a >= 16 KB multi-workstream plan document. */
function longPlan(p) {
  const lines = [
    `# ${p.word} platform: quarter plan`,
    "",
    "This plan covers several workstreams. Each step lists what it reads and what it changes.",
    "",
  ];
  let step = 0;
  const filler = (stream, i) => {
    step += 1;
    const seed = hex(`${p.id}/long/${stream}/${i}`);
    lines.push(
      `${step}. [${stream}] ${VERBS[i % VERBS.length]} the ${stream} ${seed.slice(0, 4)} component: read ${stream}/${seed.slice(4, 10)}.md and ` +
        `src/${stream}/${seed.slice(10, 16)}.ts, update the ${stream} runbook section ${seed.slice(16, 18)}, and record the owner ` +
        `(${stream}-team-${seed.slice(18, 22)}) in the tracking sheet. Done when the ${stream} smoke check passes and the change ` +
        `log names ticket ${stream.toUpperCase()}-${(Number.parseInt(seed.slice(22, 26), 16) % 9000) + 1000}.`,
    );
  };
  const persona = personaPlan(p)
    .split("\n")
    .filter((line) => /^\d\. /.test(line))
    .map((line) => line.replace(/^\d\. /, ""));
  for (let block = 0; block < 6; block++) {
    lines.push(`## Phase ${block + 1}`, "");
    for (let i = 0; i < 10; i++) filler(WORKSTREAMS[(block + i) % WORKSTREAMS.length], block * 10 + i);
    step += 1;
    lines.push(`${step}. [${p.word}] ${persona[block]}`);
    lines.push("");
  }
  lines.push("Constraints the user states during the work apply to every later step of every workstream.");
  const text = lines.join("\n");
  if (Buffer.byteLength(text, "utf8") < LONG_SCOPE_MIN_BYTES)
    throw new Error(`WorkerReplayBuild: the long plan is ${Buffer.byteLength(text, "utf8")} bytes, under 16 KB`);
  return text;
}

const scopeOf = (text) => ({
  text,
  hash: sha256(text).slice(0, 16),
  bytes: Buffer.byteLength(text, "utf8"),
  at: "2026-11-02T08:00:00.000Z",
});

/** Earlier-session records that pad a WM batch to a real batch's size: finished exploration, polls, a stated preference. */
function wmFiller(p, requestId, at, kindOfBatch) {
  const records = [];
  const add = (fields) =>
    records.push(
      goldEvent(`${requestId}:filler`, records.length, { at, sources: [`f${String(records.length + 1).padStart(2, "0")}`], ...fields }),
    );
  add({
    kind: "action",
    description: `Listed the repository root: README.md, src/, test/, config/, logs/ and package.json; no docs/ folder yet.`,
    attribution: "assistant",
  });
  add({
    kind: "result",
    description: `README.md says tests run with the run_tests tool; there is no separate lint step and no CI configuration in the repository.`,
    attribution: "tool",
  });
  for (let i = 0; i < 6; i++)
    add({
      kind: "result",
      description: `CI status poll ${i + 1} for branch ${p.word}-maintenance: pipeline ${hex(`${p.id}/ci/${i}`).slice(0, 8)} still queued behind other jobs; nothing to act on.`,
      attribution: "tool",
      relevance: "low",
    });
  add({
    kind: "result",
    description: `git status: working tree clean on branch ${p.word}-maintenance before the episode's first edit.`,
    attribution: "tool",
    relevance: "low",
  });
  add({
    kind: "statement",
    description: `User mentioned they are reviewing a different repository this afternoon and may answer slowly.`,
    attribution: "user",
    relevance: "low",
  });
  add({
    kind: "result",
    description: `package.json scripts: build runs tsc, test runs bun test; engines require bun >= 1.4.4.`,
    attribution: "tool",
  });
  if (kindOfBatch === "A")
    add({
      kind: "statement",
      description: `User preference: use pnpm for every package command in this project, never npm.`,
      attribution: "user",
      relevance: "high",
      durable: "preference",
    });
  for (let i = 0; i < 6; i++)
    add({
      kind: "result",
      description: `Read ${["src/cli.ts", "test/setup.ts", "tsconfig.json", "package.json", "README.md", "src/index.ts"][i]} to orient (${20 + i * 7} lines); nothing relevant to the current task beyond what is already recorded.`,
      attribution: "tool",
      relevance: "low",
    });
  // Earlier work in the session, finished before this batch's tasks: a real batch is mostly this (gate M-2 batches ran to
  // the 3,000-token `wm.batchTokens`). Results and actions are finished; changes and decisions are left unannotated.
  for (let i = 0; i < 50; i++) {
    const seed = hex(`${p.id}/${requestId}/earlier/${i}`);
    const file = `src/${["util", "money", "env", "args", "log", "format"][i % 6]}-${seed.slice(0, 4)}.ts`;
    const shape = i % 5;
    if (shape === 0 || shape === 3)
      add({
        kind: "result",
        description: `Ran the ${["type check", "linter", `unit tests for ${file}`, "bundle size report", "dead-code scan"][i % 5]} during earlier housekeeping: ${(Number.parseInt(seed.slice(4, 6), 16) % 40) + 10} files checked, no findings; the housekeeping item ${seed.slice(6, 12)} was closed.`,
        attribution: "tool",
        relevance: "low",
      });
    else if (shape === 1)
      add({
        kind: "action",
        description: `Opened ${file} while answering an earlier question about ${["number parsing", "argument defaults", "log levels", "env lookups"][i % 4]}; the question was answered and the file was not changed.`,
        attribution: "assistant",
        relevance: "low",
      });
    else if (shape === 2)
      add({
        kind: "change",
        description: `Earlier housekeeping change in ${file}: renamed a local variable ${seed.slice(12, 16)}Tmp → ${seed.slice(12, 16)}Value for readability; tests stayed green and nothing else references it.`,
        attribution: "assistant",
      });
    else
      add({
        kind: "decision",
        description: `Earlier decision: keep ${file} as a separate module instead of merging it into src/cli.ts, because ${["its tests are independent", "two callers import it", "it has no side effects"][i % 3]}.`,
        attribution: "mixed",
      });
  }
  return records;
}

/** A WM request: records (filler first, then the batch's gold records), the current WM items, task state, scope. */
function wmRequest({ id, set, persona: p, stm, filler, items, taskState, scope }) {
  const records = [...filler, ...stm.gold];
  const tokens = records.reduce((sum, record) => sum + record.tokenCount, 0);
  if (tokens > WM_BATCH_TOKEN_LIMIT) throw new Error(`WorkerReplayBuild: ${id} batch has ${tokens} tokens (> ${WM_BATCH_TOKEN_LIMIT})`);
  // Salience reads the user turns a record cites (a correction); the tool output stays in the STM fixture.
  const entries = stm.entries.filter((entry) => entry.message?.role === "user");
  return { id, set, persona: p.id, entries, records, wmItems: items, taskState, scope };
}

function wmAnnotation(p, stm, filler, batch) {
  const goldByKind = (kind, predicate = () => true) => stm.gold.filter((record) => record.kind === kind && predicate(record));
  const finished = filler.filter((record) => record.relevance === "low").map((record) => record.id);
  if (batch === "A") {
    const rename = goldByKind("outcome", (record) => record.description.startsWith("Task 1 done"))[0];
    const where = goldByKind("result")[0];
    const preference = filler.find((record) => record.durable === "preference");
    return {
      laterStep: [rename.id, where.id],
      changedValues: [{ record: rename.id, mustInclude: [p.to, p.modulePath] }],
      durable: [preference.id],
      finished,
    };
  }
  const task4 = goldByKind("outcome", (record) => record.description.startsWith("Task 4 done"))[0];
  const constraint = goldByKind("statement", (record) => record.durable === "constraint")[0];
  return {
    laterStep: [task4.id, constraint.id],
    changedValues: [{ record: task4.id, mustInclude: [p.key, String(p.after)] }],
    durable: [constraint.id],
    finished,
  };
}

/** The WM items batch A's pass would leave: the rename kept for step 3 and a summary of task 2. */
function itemsAfterA(p, stmA) {
  const rename = stmA.gold.find((record) => record.kind === "outcome" && record.description.startsWith("Task 1 done"));
  const task2 = stmA.gold.find((record) => record.kind === "outcome" && record.description.startsWith("Task 2 answered"));
  const item = (kind, text, cited, extra = {}) => ({
    id: memoryId("replay-wm", p.id, kind, text),
    kind,
    text,
    relevance: "high",
    citedIds: cited,
    observedFrom: rename.observedAt,
    observedTo: task2.observedAt,
    tokenCount: tokensOf(text),
    ...extra,
  });
  return [
    item("event", rename.description, [rename.id], {
      reason: "step 3 imports the renamed function from its module",
      neededLater: "step 3",
    }),
    item("summary", task2.description, [task2.id]),
  ];
}

/** Build every request and annotation. Deterministic: a function of the persona ids only. */
export function buildWorkerReplayFixture() {
  const ids = devPersonaIds();
  const base = ids.slice(0, 12);
  const stm = [];
  const wm = [];
  const annotations = { stm: {}, wm: {} };
  const stamp = (index, hour) => new Date(Date.UTC(2026, 10, 2 + (index % 9), hour, 0, 0)).toISOString();
  const addStm = (id, set, p, built) => {
    stm.push({
      id,
      set,
      persona: p.id,
      entries: built.entries,
      recent: built.recent,
      ...(built.taskState ? { taskState: built.taskState } : {}),
    });
    annotations.stm[id] = { set, ...built.annotation, gold: built.gold.map((record) => record.id) };
  };
  base.forEach((personaId, index) => {
    const p = persona(personaId);
    const a = stmBaseA(p, `stm-${personaId}-a`, stamp(index, 9));
    addStm(`stm-${personaId}-a`, "base", p, a);
    const recentA = a.gold.filter((record) => record.kind === "outcome");
    const b = stmBaseB(p, `stm-${personaId}-b`, stamp(index, 11), recentA);
    addStm(`stm-${personaId}-b`, "base", p, b);
    // WM: batch A under the plan, then batch B with A's items current. The long-scope set repeats both.
    const taskA = {
      id: memoryId("replay-task", personaId, "a"),
      goal: "Rename the cents formatter everywhere, then count build-log warnings.",
      nextSteps: ["Add src/report.ts (step 3)"],
      sourceEntryIds: [a.entries[0].id],
    };
    const taskB = {
      id: memoryId("replay-task", personaId, "b"),
      goal: `Finish the ${p.key} change, then list failed deploy steps.`,
      nextSteps: ["Write docs/retries.md (step 6)"],
      sourceEntryIds: [b.annotation.durable[0].entry],
    };
    const fillerA = wmFiller(p, `wm-${personaId}-a`, stamp(index, 8), "A");
    const fillerB = wmFiller(p, `wm-${personaId}-b`, stamp(index, 10), "B");
    const items = itemsAfterA(p, a);
    for (const [set, scopeText] of [
      ["base", personaPlan(p)],
      ["long-scope", longPlan(p)],
    ]) {
      const scope = scopeOf(scopeText);
      const suffix = set === "base" ? "" : "-long";
      const wa = wmRequest({
        id: `wm-${personaId}-a${suffix}`,
        set,
        persona: p,
        stm: a,
        filler: fillerA,
        items: [],
        taskState: taskA,
        scope,
      });
      const wb = wmRequest({ id: `wm-${personaId}-b${suffix}`, set, persona: p, stm: b, filler: fillerB, items, taskState: taskB, scope });
      wm.push(wa, wb);
      annotations.wm[wa.id] = { set, ...wmAnnotation(p, a, fillerA, "A") };
      annotations.wm[wb.id] = { set, ...wmAnnotation(p, b, fillerB, "B") };
    }
  });
  // Hard cases cycle over all sixteen dev personas.
  const hard = (set, count, make) => {
    for (let n = 0; n < count; n++) {
      const p = persona(ids[(n + STM_SETS.indexOf(set)) % ids.length]);
      const id = `stm-${set}-${n + 1}`;
      addStm(id, set, p, make(p, id, stamp(n, 14 + (n % 4)), n));
    }
  };
  hard("passed-outcome", 6, stmPassedOutcome);
  hard("actually", 6, stmActually);
  for (const language of NON_ENGLISH_SETS) hard(language, 6, (p, id, start, n) => stmLocalized(p, id, start, language, n));
  hard("offtopic-constraint", 6, stmOfftopic);
  if (stm.length + wm.length > WORKER_REPLAY_MAX_REQUESTS) throw new Error("WorkerReplayBuild: more than 120 requests");
  return {
    "stm.json": { schemaVersion: 1, kind: "worker-replay-stm", requests: stm },
    "wm.json": { schemaVersion: 1, kind: "worker-replay-wm", requests: wm },
    "annotations.json": { schemaVersion: 1, kind: "worker-replay-annotations", ...annotations },
  };
}

const serialize = (value) => `${JSON.stringify(value, null, 1)}\n`;

export function workerReplayIndex(files) {
  const counts = {
    stm: Object.fromEntries(STM_SETS.map((set) => [set, files["stm.json"].requests.filter((r) => r.set === set).length])),
    wm: Object.fromEntries(WM_SETS.map((set) => [set, files["wm.json"].requests.filter((r) => r.set === set).length])),
  };
  return {
    schemaVersion: 1,
    kind: "memory-model-worker-replay-index",
    note: "Plan 218.2 Task 1. sha256 of the built fixture files (build.mjs, from the long-session dev personas and written cases); loadWorkerReplayFixture refuses a file that does not match.",
    personas: devPersonaIds(),
    counts,
    sha256: Object.fromEntries(WORKER_REPLAY_FILES.map((name) => [name, sha256(serialize(files[name]))])),
  };
}

/** Load the committed fixture; refuses a file whose bytes do not match index.json. */
export function loadWorkerReplayFixture(dir = WORKER_REPLAY_DIR) {
  const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
  const out = { index };
  for (const name of WORKER_REPLAY_FILES) {
    const text = readFileSync(join(dir, name), "utf8");
    if (sha256(text) !== index.sha256?.[name]) throw new Error(`worker-replay fixture: ${name} does not match index.json`);
    out[name.replace(".json", "")] = JSON.parse(text);
  }
  out.indexSha256 = sha256(readFileSync(join(dir, "index.json")));
  return out;
}

if (import.meta.main) {
  const files = buildWorkerReplayFixture();
  const index = workerReplayIndex(files);
  const written = {
    ...Object.fromEntries(WORKER_REPLAY_FILES.map((name) => [name, serialize(files[name])])),
    "index.json": serialize(index),
  };
  if (process.argv.includes("--check")) {
    const drift = Object.entries(written).filter(
      ([name, text]) => !existsSync(join(WORKER_REPLAY_DIR, name)) || readFileSync(join(WORKER_REPLAY_DIR, name), "utf8") !== text,
    );
    if (drift.length) {
      console.error(`worker-replay fixture differs from a rebuild: ${drift.map(([name]) => name).join(", ")}`);
      process.exit(1);
    }
    console.log(`worker-replay fixture matches its rebuild (index ${sha256(written["index.json"])})`);
  } else {
    if (existsSync(join(WORKER_REPLAY_DIR, "index.json")) && !process.argv.includes("--force"))
      throw new Error("WorkerReplayBuild: the fixture is frozen; a deliberate rebuild passes --force and re-pins it by amendment");
    mkdirSync(WORKER_REPLAY_DIR, { recursive: true });
    for (const [name, text] of Object.entries(written)) writeFileSync(join(WORKER_REPLAY_DIR, name), text);
    console.log(JSON.stringify({ index: sha256(written["index.json"]), counts: index.counts }, null, 2));
  }
}
