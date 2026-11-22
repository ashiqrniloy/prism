/**
 * Plan 218.1 Task 3, Step 2: the lean Compact-Bench retention screen, on the branch the post-218.2 probe selected.
 *
 * Branch A (WM testable): the 30 drawn retention sessions × `memory-off`, `OM-before`, `STM-only`, `WM`.
 * Branch B (WM not testable): × `memory-off`, `OM-before`, `session` (the shipped STM + WM profile, read as STM).
 * References on both branches: the Claude Code and Codex compaction prompts on Muse (upstream's own `compress_one`
 * through the local pass-through), upstream's mechanical `anchor_index`, and `mask-tail` (no model call: the session's
 * newest messages with tool output cleared, cut to the candidate arm's S character count).
 *
 * Every comparison is paired per session: the candidate minus the comparator, in points of retained details
 * (recall × 100), with a 95% bootstrap interval over sessions. The decision rule is `SCREEN_RULE`, hashed and approved
 * in the gate record before any spend; the verdict is computed from it only.
 *
 * ```sh
 * bun scripts/memory-bench/external/compact-bench/screen.mjs --offline [--limit N]      # mock worker, no model call
 * bun scripts/memory-bench/external/compact-bench/screen.mjs --arm <arm>                 # live, one Prism arm
 * bun scripts/memory-bench/external/compact-bench/screen.mjs --references                # live, Claude Code + Codex on Muse
 * bun scripts/memory-bench/external/compact-bench/screen.mjs --score                     # seam scoring, verdict, evidence
 * ```
 *
 * `OM-before` runs from gate M-2's pre-216 worktree (`--arm OM-before` with that worktree as the working directory).
 * S text stays in the bench cache; the evidence carries ids, counts, scores and hashes only.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stableHash } from "../../journal.mjs";
import { pairedClusterPermutation } from "../../stats.mjs";
import { compactBenchWorkerMock, loadDrawnHistories, renderView, scoreRetention, summarizeHistory, transcriptView } from "./adapter.mjs";
import { COMPACT_BENCH_DRAW_FILE } from "./draw.mjs";
import { COMPACT_BENCH_PIN, compactBenchPaths, verifyCompactBenchCode } from "./fetch.mjs";
import { WM_PROBE_EVIDENCE, WM_PROBE_GATE, WM_PROBE_RULE, wmProbeScreenBranch } from "./wm-probe.mjs";

export const SCREEN_EVIDENCE = "docs/_evidence/memory-bench/218/compact-bench-screen.json";
export const SCREEN_REFERENCES = Object.freeze(["claude-code", "codex", "anchor_index", "mask-tail"]);
/** A Prism arm id → the adapter arm it runs. `session` is the shipped profile, which is the adapter's `WM` arm. */
export const SCREEN_ADAPTER_ARM = Object.freeze({
  "memory-off": "memory-off",
  "OM-before": "OM-before",
  "STM-only": "STM-only",
  WM: "WM",
  session: "WM",
});

/** The pre-registered rule. Changing any field changes its hash, which the gate record pins. */
export const SCREEN_RULE = Object.freeze({
  suite: "compact-bench-retention",
  sessions: 30,
  draw: "scripts/memory-bench/work-outcome-compact-bench.json (retention, 30 sessions, label-blind)",
  worker: "opencode-go/muse-spark-1.3-contributor",
  referenceSummarizer:
    "opencode-go/muse-spark-1.3-contributor through upstream's e2_score.compress_one (CB_SUMMARIZER_API=chat, the local pass-through); upstream's default output cap",
  branches: {
    A: { arms: ["memory-off", "OM-before", "STM-only", "WM"], candidate: "WM" },
    B: { arms: ["memory-off", "OM-before", "session"], candidate: "session" },
  },
  references: [...SCREEN_REFERENCES],
  maskTail:
    "no model call: the session's transcript view, newest lines first, tool lines with their output cleared, cut to the candidate arm's S character count for the same session",
  variant:
    "every decision reads S (the memory block plus the kept messages, what the model sees after compaction); the block alone and the STM chunks are reported beside it, never decided on",
  estimate: "candidate minus comparator, points of retained details (recall x 100), paired per session",
  interval: "95% bootstrap over sessions (each session one cluster), 10,000 resamples, seed 7",
  nonInferiorPoints: 5,
  rules: {
    A: {
      ship: "STM + WM ships as the session default if WM vs the Claude Code prompt has interval lower bound >= -5 and WM vs memory-off has interval lower bound > 0",
      deterministic:
        "if WM does not beat STM-only (interval lower bound <= 0), the deterministic WM policy is the default: the same retention, no WM model call",
      loses:
        "if WM's interval upper bound is < 0 against the Claude Code prompt or anchor_index, the finding goes to the owner before any plan builds on WM; it holds the decision for the owner and does not change it",
      m5: "M5 (WM vs STM-only, criteria nonInferior) reads the paired estimate over all sessions; the sessions where this screen's WM run engaged are reported beside it",
    },
    B: {
      ship: "STM is supported as the session memory if session vs the Claude Code prompt has interval lower bound >= -5 and session vs memory-off has interval lower bound > 0",
      loses:
        "if session's interval upper bound is < 0 against the Claude Code prompt or anchor_index, the finding goes to the owner; it holds the decision for the owner and does not change it",
      m5: "M5 stays missing; the screen makes no claim about WM",
    },
    maskTail:
      "if the candidate does not beat mask-tail (interval lower bound <= 0), the finding goes to the owner with the verdict; it decides nothing by itself",
    notShown: "a candidate that neither ships nor loses clearly ships nothing; the finding goes to the owner",
  },
  cannotShow: [
    "one model family (Muse worker and summarizer)",
    "30 sessions detect large differences only",
    "histories are capped at 250,000 characters by upstream, so long-horizon WM behaviour is out of reach",
    "no long-term memory",
  ],
  maxInputTokens: { A: 30_000_000, B: 20_000_000 },
  iterations: 10_000,
  seed: 7,
});

export const screenRuleHash = (rule = SCREEN_RULE) => stableHash(rule);

/**
 * The gate record must approve this rule for the branch the post-218.2 probe selected on the current product. The probe
 * reading is checked by `wmProbeScreenBranch`; the screen approval is its own section (`compactBenchScreen`).
 */
export function assertScreenGate(gate, { probeBranch, rule = SCREEN_RULE }) {
  const screen = gate?.compactBenchScreen;
  if (!screen) throw new Error("ScreenGate: the gate record has no compactBenchScreen section");
  if (screen.approved !== true || screen.approvedBy !== "owner" || typeof screen.text !== "string" || !screen.text.trim())
    throw new Error("ScreenGate: the screen is not approved on the owner's word");
  if (screen.ruleHash !== screenRuleHash(rule) || JSON.stringify(screen.rule) !== JSON.stringify(rule))
    throw new Error("ScreenGate: the rule differs from the approved one; a changed rule is a refusal, not a re-approval");
  if (!["A", "B"].includes(probeBranch?.branch)) throw new Error(`ScreenGate: the probe selected no branch (${probeBranch?.branch})`);
  if (screen.branch !== probeBranch.branch)
    throw new Error(`ScreenGate: the approval is for Branch ${screen.branch}; the probe selected Branch ${probeBranch.branch}`);
  return screen;
}

/** `mask-tail`: the newest view lines, tool output cleared, cut to exactly `chars` code points (or the whole view). */
export function maskTail(view, chars) {
  const lines = view.map((row) => (row.role === "tool" ? "[tool] (output cleared)" : row.line));
  const kept = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0 && used < chars; i--) {
    const text = Array.from(lines[i]);
    const room = chars - used - (kept.length ? 1 : 0);
    if (room <= 0) break;
    kept.unshift(text.length <= room ? lines[i] : text.slice(text.length - room).join(""));
    used += Math.min(text.length, room) + (kept.length > 1 ? 1 : 0);
  }
  return kept.join("\n");
}

const points = (value) => Math.round(value * 100 * 100) / 100;

/** Candidate minus comparator, in points, over the sessions both read. */
export function screenPair(candidateRows, comparatorRows, { iterations = SCREEN_RULE.iterations, seed = SCREEN_RULE.seed } = {}) {
  const base = new Map(comparatorRows.map((row) => [row.id, row]));
  const ids = candidateRows.map((row) => row.id).filter((id) => base.has(id));
  if (!ids.length) return { n: 0, status: "not-computable" };
  const at = (rows, id) => rows.find((row) => row.id === id);
  const a = ids.map((id) => ({ id, cluster: id, value: at(comparatorRows, id).recall }));
  const b = ids.map((id) => ({ id, cluster: id, value: at(candidateRows, id).recall }));
  const result = pairedClusterPermutation(a, b, { cluster: (row) => row.cluster, iterations, seed });
  return {
    n: ids.length,
    unpaired: { candidate: candidateRows.length - ids.length, comparator: comparatorRows.length - ids.length },
    estimate: points(result.diff),
    ciLow: points(result.ci95[0]),
    ciHigh: points(result.ci95[1]),
  };
}

/**
 * The verdict from the pre-registered rule only. `scores[name]` is a list of `{ id, recall, engaged? }` per arm or
 * reference (recall as a share, the decision variant S). A comparison with no reading leaves the verdict `missing`.
 */
export function screenVerdict({ branch, scores, rule = SCREEN_RULE }) {
  const spec = rule.branches[branch];
  if (!spec) throw new Error(`ScreenVerdict: unknown branch ${branch}`);
  const candidate = scores[spec.candidate] ?? [];
  const comparators = [...spec.arms.filter((id) => id !== spec.candidate), ...rule.references];
  const pairs = Object.fromEntries(
    comparators.map((name) => [name, scores[name]?.length && candidate.length ? screenPair(candidate, scores[name], rule) : { n: 0 }]),
  );
  const needed = ["claude-code", "memory-off", "anchor_index", ...(branch === "A" ? ["STM-only"] : [])];
  const missing = needed.filter((name) => !pairs[name]?.n);
  const result = { branch, candidate: spec.candidate, ruleHash: screenRuleHash(rule), pairs, findings: [] };
  if (missing.length) return { ...result, decision: "missing", missing };
  const nonInferior = pairs["claude-code"].ciLow >= -rule.nonInferiorPoints;
  const beatsOff = pairs["memory-off"].ciLow > 0;
  const loses = pairs["claude-code"].ciHigh < 0 || pairs.anchor_index.ciHigh < 0;
  if (pairs["mask-tail"]?.n && pairs["mask-tail"].ciLow <= 0)
    result.findings.push("the candidate does not beat mask-tail (interval lower bound <= 0): to the owner with the verdict");
  // `loses` is a finding that holds any plan building on the candidate until the owner reads it; it does not change
  // the ship decision, which follows the ship rule alone (the two can hold together: within 5 points of Claude Code and
  // still clearly below it).
  if (loses) result.findings.push(`${spec.candidate} loses clearly against the Claude Code prompt or anchor_index: to the owner`);
  const decided = { ...result, nonInferior, beatsOff, holdForOwner: loses };
  if (!(nonInferior && beatsOff)) {
    result.findings.push(`${spec.candidate} is not shown to ship (non-inferior to Claude Code and above memory-off): to the owner`);
    return { ...decided, findings: result.findings, decision: "not-shown", toOwner: true };
  }
  if (branch === "B") return { ...decided, decision: "stm-supported", toOwner: result.findings.length > 0 };
  const wmOverStm = pairs["STM-only"].ciLow > 0;
  return {
    ...decided,
    decision: wmOverStm ? "ship-stm-wm" : "ship-deterministic-wm",
    toOwner: result.findings.length > 0,
    wmOverStmOnly: wmOverStm,
  };
}

/** M5's evidence cell (Branch A only): WM vs STM-only over all sessions, and over the sessions where WM engaged. */
export function screenM5(scores, rule = SCREEN_RULE) {
  const wm = scores.WM ?? [];
  const stm = scores["STM-only"] ?? [];
  if (!wm.length || !stm.length) return null;
  const all = screenPair(wm, stm, rule);
  const engaged = wm.filter((row) => row.engaged);
  return { model: "muse", ...all, engagedOnly: engaged.length ? screenPair(engaged, stm, rule) : { n: 0 } };
}

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** One Prism arm over the histories; S text goes to `dir` (the bench cache), counts and worker usage come back. */
export async function runScreenArm({ arm, histories, dir, workerProviders, workerModel, usageNow, settleMs, log = () => {} }) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const rows = [];
  for (const { id, H } of histories) {
    const file = join(dir, `${id}.json`);
    if (existsSync(file)) {
      rows.push(JSON.parse(readFileSync(file, "utf8")).row);
      continue;
    }
    const before = await usageNow();
    const result = await summarizeHistory({
      H,
      track: "retention",
      arm: SCREEN_ADAPTER_ARM[arm],
      id,
      workerProviders,
      workerModel,
      ...(settleMs ? { settleMs } : {}),
    });
    const after = await usageNow();
    const row = {
      id,
      arm,
      sChars: result.counts.sChars,
      blockChars: result.counts.blockChars,
      keptMessages: result.counts.keptMessages,
      engaged: result.counts.wmEngaged ?? false,
      wmPasses: result.counts.wm?.passes ?? 0,
      stmEvents: result.counts.stm?.events ?? 0,
      worker: { inputTokens: after.inputTokens - before.inputTokens, outputTokens: after.outputTokens - before.outputTokens },
    };
    await writeFile(file, JSON.stringify({ row, S: result.S, block: result.block }), { mode: 0o600 });
    rows.push(row);
    log(`${arm} ${id}: sChars=${row.sChars} engaged=${row.engaged} in=${row.worker.inputTokens}`);
  }
  return rows;
}

/** Score every cached S (arms, references, mask-tail) through upstream and build the evidence (no text). */
export function screenEvidence({ branch, histories, armDirs, referenceRows, codeDir, dataDir, workDir, meta, rule = SCREEN_RULE }) {
  const spec = rule.branches[branch];
  const records = [];
  const arms = {};
  for (const arm of spec.arms) {
    arms[arm] = [];
    for (const { id } of histories) {
      const file = join(armDirs[arm], `${id}.json`);
      if (!existsSync(file)) continue;
      const cached = JSON.parse(readFileSync(file, "utf8"));
      arms[arm].push(cached.row);
      records.push({ sample_id: id, arm, view: "context", S: cached.S });
      records.push({ sample_id: id, arm, view: "block", S: cached.block });
    }
  }
  // mask-tail at the candidate's S size, per session.
  const candidateChars = new Map(arms[spec.candidate].map((row) => [row.id, row.sChars]));
  const maskChars = {};
  for (const { id, H } of histories) {
    if (!candidateChars.has(id)) continue;
    const S = maskTail(transcriptView(H, "retention"), candidateChars.get(id));
    maskChars[id] = Array.from(S).length;
    records.push({ sample_id: id, arm: "mask-tail", view: "context", S });
  }
  for (const row of referenceRows.filter((entry) => typeof entry.S === "string"))
    records.push({ sample_id: row.sample_id, arm: row.reference, view: "context", S: row.S });
  const scored = records.length ? scoreRetention({ records, codeDir, dataDir, workDir }) : [];
  const scores = {};
  const views = {};
  for (const row of scored) {
    const key = `${row.arm}/${row.view}`;
    views[key] ??= [];
    views[key].push({
      id: row.sample_id,
      client: row.client,
      recall: row.recall,
      atoms: row.n_atoms,
      hits: row.hits.reduce((a, b) => a + b, 0),
    });
  }
  for (const [key, rows] of Object.entries(views)) {
    const [name, view] = key.split("/");
    if (view !== "context") continue;
    const engaged = new Map((arms[name] ?? []).map((row) => [row.id, row.engaged]));
    scores[name] = rows.map((row) => ({ ...row, ...(engaged.has(row.id) ? { engaged: engaged.get(row.id) } : {}) }));
  }
  const verdict = screenVerdict({ branch, scores, rule });
  const sChars = Object.fromEntries([
    ...Object.entries(arms).map(([arm, rows]) => [
      arm,
      rows.map((row) => ({ id: row.id, sChars: row.sChars, blockChars: row.blockChars })),
    ]),
    ["mask-tail", Object.entries(maskChars).map(([id, chars]) => ({ id, sChars: chars }))],
    ...SCREEN_REFERENCES.filter((name) => name !== "mask-tail").map((name) => [
      name,
      referenceRows
        .filter((row) => row.reference === name && typeof row.S === "string")
        .map((row) => ({ id: row.sample_id, sChars: Array.from(row.S).length })),
    ]),
  ]);
  const mean = (rows) => (rows?.length ? points(rows.reduce((sum, row) => sum + row.recall, 0) / rows.length) : null);
  return {
    kind: "compact-bench-screen-v1",
    plan: "218.1",
    task: 3,
    step: 2,
    branch,
    ruleHash: screenRuleHash(rule),
    rule,
    ...meta,
    upstream: { codeRevision: COMPACT_BENCH_PIN.code.commit, datasetRevision: COMPACT_BENCH_PIN.dataset.revision },
    verdict,
    m5: branch === "A" ? screenM5(scores, rule) : null,
    meanRetentionPoints: Object.fromEntries(Object.entries(views).map(([key, rows]) => [key, { n: rows.length, mean: mean(rows) }])),
    sChars,
    sessions: Object.fromEntries(Object.entries(views).map(([key, rows]) => [key, rows])),
    arms: Object.fromEntries(
      Object.entries(arms).map(([arm, rows]) => [
        arm,
        rows.map(({ id, engaged, wmPasses, stmEvents, worker, keptMessages }) => ({
          id,
          engaged,
          wmPasses,
          stmEvents,
          keptMessages,
          worker,
        })),
      ]),
    ),
    references: Object.fromEntries(
      SCREEN_REFERENCES.filter((name) => name !== "mask-tail").map((name) => [
        name,
        {
          sessions: referenceRows.filter((row) => row.reference === name && typeof row.S === "string").length,
          errors: referenceRows.filter((row) => row.reference === name && row.error).length,
        },
      ]),
    ),
  };
}

/**
 * Run upstream's references (`seam.py reference`) for `ids` into `out` (private: it holds S text); resumes.
 * Asynchronous on purpose: the live pass-through proxy serves upstream's calls from this same process, so a
 * synchronous spawn would block its event loop and every reference call would time out (2026-11-17 screen).
 */
export async function runReferences({
  ids,
  references,
  out,
  codeDir,
  dataDir,
  model,
  env = {},
  python = process.env.PRISM_MEMORY_BENCH_PYTHON ?? "python3",
}) {
  const wanted = `${out}.wanted.jsonl`;
  writeFileSync(wanted, `${ids.flatMap((id) => references.map((reference) => JSON.stringify({ sample_id: id, reference }))).join("\n")}\n`);
  const child = spawn(
    python,
    ["-I", SEAM, "reference", "--code", codeDir, "--summaries", wanted, "--out", out, ...(model ? ["--model", model] : [])],
    {
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", CB_DATA_MIRROR: dataDir, PYTHONUTF8: "1", ...env },
      stdio: ["ignore", "inherit", "inherit"],
      timeout: 14_400_000,
    },
  );
  const [code, signal] = await new Promise((done, fail) => {
    child.once("error", fail);
    child.once("close", (exitCode, exitSignal) => done([exitCode, exitSignal]));
  });
  if (code !== 0) throw new Error(`Screen: seam.py reference exited with ${signal ?? code}`);
  return readReferenceRows(out);
}

const SEAM = fileURLToPath(new URL("./seam.py", import.meta.url));

/** Input and output tokens over every `usage.jsonl` / `<provider>-usage.jsonl` under `dir` (all arms and the references). */
export function screenUsage(dir) {
  const totals = { inputTokens: 0, outputTokens: 0 };
  if (!existsSync(dir)) return totals;
  for (const entry of readdirSync(dir, { recursive: true })) {
    const file = join(dir, String(entry));
    if (!/(^|[/-])usage\.jsonl$/.test(String(entry)) || !statSync(file).isFile()) continue;
    for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
      const row = JSON.parse(line);
      totals.inputTokens += row.inputTokens ?? 0;
      totals.outputTokens += row.outputTokens ?? 0;
    }
  }
  return totals;
}

/** Rows of a reference output file (`seam.py reference --out`); a later success replaces an earlier error. */
export function readReferenceRows(file) {
  if (!existsSync(file)) return [];
  const rows = new Map();
  for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
    const row = JSON.parse(line);
    const key = `${row.sample_id}|${row.reference}`;
    if (!rows.has(key) || rows.get(key).error) rows.set(key, row);
  }
  return [...rows.values()];
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const paths = compactBenchPaths(COMPACT_BENCH_PIN);
  verifyCompactBenchCode({ dir: paths.code });
  const drawText = readFileSync(COMPACT_BENCH_DRAW_FILE, "utf8");
  const draw = JSON.parse(drawText);
  const limit = Number(flag("--limit") ?? 0);
  const histories = loadDrawnHistories({ track: "retention", draw, dataDir: paths.data, limit });
  // The fingerprints come from the main tree: OM-before runs from the pre-216 worktree, which predates wm-gate.mjs.
  const { m2MemoryFingerprint, m2ProductFingerprint } = await import(
    join(resolve(flag("--main-root") ?? "."), "scripts/memory-bench/wm-gate.mjs")
  );
  const offline = args.includes("--offline");
  let branch;
  let root;
  let meta;
  if (offline) {
    branch = flag("--branch") ?? "A";
    root = join(paths.root, "screen", "offline", new Date().toISOString().replace(/[:.]/g, "-"));
    meta = { offline: true };
  } else {
    // Live: the post-218.2 probe reading on this product selects the branch, and the owner approved the screen for it.
    // OM-before runs from the pre-216 worktree, so its product is that tree's; it reads the main tree's records.
    const mainRoot = flag("--main-root") ?? ".";
    const gate = JSON.parse(readFileSync(join(mainRoot, WM_PROBE_GATE), "utf8"));
    const productHash = await m2ProductFingerprint(mainRoot);
    const memoryHash = await m2MemoryFingerprint(mainRoot);
    const probeBranch = wmProbeScreenBranch(JSON.parse(readFileSync(join(mainRoot, WM_PROBE_EVIDENCE), "utf8")), {
      productHash,
      memoryHash,
      rule: WM_PROBE_RULE,
      rebinds: gate.compactBenchWmProbe?.reprobe?.rebinds ?? [],
    });
    const screen = assertScreenGate(gate, { probeBranch });
    branch = screen.branch;
    // Keyed by the memory packages, not the whole product: kernel edits the owner waived (`reprobe.rebinds`) must not
    // split the arms across state directories mid-screen. Each arm records the product it ran on.
    root = join(paths.root, "screen", `${screenRuleHash().slice(0, 16)}-${memoryHash.slice(0, 16)}`);
    meta = { productHash, memoryHash, probe: probeBranch, drawSha256: sha256(drawText), approvedAt: screen.approvedAt };
  }
  const spec = SCREEN_RULE.branches[branch];
  const armDirs = Object.fromEntries(spec.arms.map((arm) => [arm, join(root, "arms", arm)]));
  const referenceFile = join(root, "references.jsonl");
  const { liveProviders, loadEnv, refOf } = await import("../../run.mjs");
  if (offline) {
    // OM-before needs the pre-216 worktree (Task 2 ran it there); offline in this tree it is left out unless asked.
    const offlineArms = flag("--arms")?.split(",") ?? spec.arms.filter((arm) => arm !== "OM-before");
    for (const arm of offlineArms)
      await runScreenArm({
        arm,
        histories,
        dir: armDirs[arm],
        workerProviders: [compactBenchWorkerMock()],
        workerModel: "cb-worker/mock",
        usageNow: async () => ({ inputTokens: 0, outputTokens: 0 }),
        log: (line) => process.stderr.write(`${line}\n`),
      });
    await runReferences({
      ids: histories.map((h) => h.id),
      references: ["anchor_index"],
      out: referenceFile,
      codeDir: paths.code,
      dataDir: paths.data,
    });
  } else if (flag("--arm")) {
    const arm = flag("--arm");
    if (!spec.arms.includes(arm)) throw new Error(`Screen: Branch ${branch} runs ${spec.arms.join(", ")}, not ${arm}`);
    loadEnv();
    const wire = join(root, "wire", arm);
    const live = arm === "memory-off" ? null : await liveProviders([refOf(SCREEN_RULE.worker)], wire, { maxOutputTokens: 8192 });
    mkdirSync(join(root, "runs"), { recursive: true, mode: 0o700 });
    writeFileSync(
      join(root, "runs", `${arm}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`),
      `${JSON.stringify({ arm, ...meta, startedAt: new Date().toISOString() }, null, 2)}\n`,
    );
    // The branch ceiling covers the whole screen: every arm's and the references' usage logs under `wire/`.
    const usageNow = async () => {
      for (const { proxy } of live?.proxies ?? []) await proxy.drain();
      const totals = screenUsage(join(root, "wire"));
      if (totals.inputTokens >= SCREEN_RULE.maxInputTokens[branch]) throw new Error("ScreenTokenCeiling");
      return totals;
    };
    try {
      await runScreenArm({
        arm,
        histories,
        dir: armDirs[arm],
        workerProviders: live?.providers ?? [],
        workerModel: SCREEN_RULE.worker,
        usageNow,
        settleMs: 2_700_000,
        log: (line) => process.stderr.write(`${line}\n`),
      });
    } finally {
      for (const { proxy } of live?.proxies ?? []) proxy.stop();
    }
  } else if (args.includes("--references")) {
    loadEnv();
    const { startPassthrough } = await import("./passthrough.mjs");
    mkdirSync(join(root, "wire", "references"), { recursive: true, mode: 0o700 });
    const pass = await startPassthrough({
      record: join(root, "wire", "references", "exchanges"),
      usageLog: join(root, "wire", "references", "usage.jsonl"),
    });
    try {
      await runReferences({
        ids: histories.map((h) => h.id),
        references: SCREEN_REFERENCES.filter((name) => name !== "mask-tail"),
        out: referenceFile,
        codeDir: paths.code,
        dataDir: paths.data,
        model: SCREEN_RULE.worker.split("/")[1],
        env: pass.upstreamEnv,
      });
    } finally {
      pass.stop();
    }
  }
  if (offline || args.includes("--score")) {
    const workDir = join(root, "score");
    mkdirSync(workDir, { recursive: true, mode: 0o700 });
    const evidence = screenEvidence({
      branch,
      histories,
      armDirs,
      referenceRows: readReferenceRows(referenceFile),
      codeDir: paths.code,
      dataDir: paths.data,
      workDir,
      meta: { ...meta, finishedAt: new Date().toISOString() },
    });
    if (!offline && !limit) await writeFile(SCREEN_EVIDENCE, `${JSON.stringify(evidence, null, 2)}\n`);
    process.stdout.write(
      `${JSON.stringify({ branch, verdict: evidence.verdict, meanRetentionPoints: evidence.meanRetentionPoints }, null, 2)}\n`,
    );
  }
}

export { renderView };
