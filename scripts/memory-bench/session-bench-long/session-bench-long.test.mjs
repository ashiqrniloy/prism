import { test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createWorkspace } from "../session-bench/env/workspace.mjs";
import {
  serializePartitionFile as serializeV3PartitionFile,
  CORE_FILES as V3_CORE_FILES,
  PARTITION_FILE as V3_PARTITION_FILE,
  templateHash as v3TemplateHash,
} from "../session-bench/generate.mjs";
import { assertNoMemoryImports } from "../session-bench/guardrails.mjs";
import { dependencyEvidence, runScripted } from "./agents.mjs";
import { BUCKETS, bucketOf, CLASS_LAYOUT, LAYOUT, LONG_TASKS, MAX_FIX_RULE_JOBS, MAX_SOURCES_PER_TASK, PHASE_TASKS } from "./build.mjs";
import { DEPENDENCY_CLASSES, evaluateCheck, LONG_CHECK_CLASSES, LONG_CHECK_KINDS, REVOKE_CLASS } from "./checks.mjs";
import {
  bucketCounts,
  CORE_FILES,
  createSession,
  dependencyLeaks,
  MEASURED_WORST_CASE,
  MIN_DEV_AFTER_CHECKS,
  MIN_SPAN_WINDOWS,
  PARTITION_FILE,
  partitionIds,
  SESSION_BENCH_LONG_SEED,
  SESSION_BENCH_LONG_STRATA,
  serializePartitionFile,
  sessionBenchLongIds,
  sessionBenchLongPartitions,
  sessionSizes,
  templateHash,
  WINDOW_TOKENS,
} from "./generate.mjs";
import { GATE_FILE, harnessInputCap, LONG_JOB_ARTIFACT_TOKENS, WORST_REQUEST_SHARE } from "./pressure.mjs";

/** Session-Bench v3's pins as plan 218.3 froze them (gate M-2's `sessionBench`): the long bench must not move them. */
const V3_PINS = {
  templateHash: "844cd4d21df6a3aaff1b98d733040bf5fc51a18d94ccf0dfd6bf00ff98e4fbed",
  sessionsHash: "58eb9e1660a98774f0f5685bb0c087916d151c52e49446b333066d0a88fd8413",
  idsHash: "1937178f6107526c04e10b2bf0357f20bd106874f25fe1caf1c0495ee0738bda",
};

const file = sessionBenchLongPartitions();
const dev = partitionIds(file, "dev").map((id) => createSession(id));
const one = dev[0];
const copy = (session) => structuredClone(session);
const depChecks = (session) => session.tasks.flatMap((task) => task.checks.filter((check) => check.dep).map((check) => ({ task, check })));

test("v3_core_files_are_untouched", () => {
  assert.equal(v3TemplateHash(), V3_PINS.templateHash);
  const committed = readFileSync(V3_PARTITION_FILE, "utf8");
  assert.equal(committed, serializeV3PartitionFile());
  const v3 = JSON.parse(committed);
  assert.equal(v3.sessionsHash, V3_PINS.sessionsHash);
  assert.equal(v3.idsHash, V3_PINS.idsHash);
  // Every v3 file the long bench builds on is one v3 pins, so an edit to it fails the line above.
  for (const path of CORE_FILES.filter((name) => name.startsWith("../session-bench/")))
    assert.ok(V3_CORE_FILES.includes(path.slice("../session-bench/".length)), path);
});

test("long_sessions_regenerate_byte_for_byte", () => {
  assert.equal(readFileSync(PARTITION_FILE, "utf8"), serializePartitionFile());
  assert.equal(file.seed, "prism-218.5-session-bench-long-v1");
  assert.equal(file.seed, SESSION_BENCH_LONG_SEED);
  assert.equal(file.templateHash, templateHash());
  for (const pin of ["templateHash", "sessionsHash", "scopesHash", "idsHash"]) assert.match(file[pin], /^[0-9a-f]{64}$/);
  assert.equal(file.counts.sessions, 36);
  assert.equal(sessionBenchLongIds().length, 36);
  // The draw: [4, 4, 4] per family, every id in exactly one partition.
  assert.deepEqual(SESSION_BENCH_LONG_STRATA, [4, 4, 4]);
  const drawn = ["dev", "heldout-a", "heldout-b"].flatMap((partition) => partitionIds(file, partition));
  assert.deepEqual([...drawn].sort(), sessionBenchLongIds().sort());
  assert.equal(dev.length, 12);
  // A session is a pure function of the seed and its id.
  assert.equal(JSON.stringify(createSession(one.id)), JSON.stringify(one));
});

test("sessions_run_100_tasks_in_four_scoped_phases", () => {
  for (const session of dev) {
    assert.equal(session.tasks.length, LONG_TASKS);
    assert.deepEqual(
      session.phases.map((phase) => [phase.n, phase.from, phase.to]),
      [
        [1, 1, 25],
        [2, 26, 50],
        [3, 51, 75],
        [4, 76, 100],
      ],
    );
    for (const phase of session.phases) {
      // One numbered step per task of the phase, and no other phase's steps.
      const steps = phase.scope.split("\n").slice(1);
      assert.deepEqual(
        steps.map((line) => Number(line.split(".")[0])),
        Array.from({ length: PHASE_TASKS }, (_, i) => phase.from + i),
      );
    }
    for (const task of session.tasks) {
      assert.equal(task.phase, Math.ceil(task.n / PHASE_TASKS));
      assert.ok(task.prompt.startsWith(`Task ${task.n}. `));
      // A `C` check on every task: the job's.
      assert.equal(task.checks[0].class, "C", `${session.id} task ${task.n}`);
    }
    assert.ok(session.tasks.filter((task) => task.job === "fix-rule").length <= MAX_FIX_RULE_JOBS);
  }
});

test("dependents_sit_in_the_pre_registered_buckets", () => {
  // The buckets are plan 218.5 Task 2's: before the densest session's overflow task, after the mean's plus 10.
  assert.equal(bucketOf(BUCKETS.beforeBelowTask - 1), "before");
  assert.equal(bucketOf(BUCKETS.beforeBelowTask), null);
  assert.equal(bucketOf(BUCKETS.afterAboveTask), null);
  assert.equal(bucketOf(BUCKETS.afterAboveTask + 1), "after");
  for (const session of dev) {
    const counts = bucketCounts([session]);
    for (const [cls, want] of Object.entries(CLASS_LAYOUT)) {
      assert.equal(counts.before[cls], want.before, `${session.id} ${cls} before`);
      assert.equal(counts.after[cls], want.after, `${session.id} ${cls} after`);
    }
    const perTask = new Map();
    for (const dep of session.deps) {
      assert.equal(dep.bucket, bucketOf(dep.dependent));
      assert.ok(dep.bucket === "before" || dep.bucket === "after", `${session.id} ${dep.id} sits between the buckets`);
      perTask.set(dep.dependent, (perTask.get(dep.dependent) ?? 0) + 1);
      // Sources come first: tasks 1-10, or a later change or revoke that the dependent follows.
      assert.ok(Math.min(...dep.sources) <= LAYOUT.sources[1]);
      assert.ok(Math.max(...dep.sources) < dep.dependent);
    }
    assert.ok(
      [...perTask.values()].every((count) => count === 1),
      `${session.id}: one dependent per task`,
    );
    // Every dependency check carries its row's class and bucket.
    for (const { check } of depChecks(session)) {
      const dep = session.deps.find((row) => row.id === check.dep);
      assert.equal(check.class, dep.class);
      assert.equal(check.bucket, dep.bucket);
    }
    assert.equal(depChecks(session).length, session.deps.length);
    // Sources: at most two per task (a source's part adds no dependency check).
    for (const task of session.tasks.slice(0, LAYOUT.sources[1])) assert.ok(task.notes.length - 1 <= MAX_SOURCES_PER_TASK);
  }
  // Classes are balanced across the buckets: each D1-D4 class has twice as many `after` dependents as `before`.
  for (const cls of ["D1", "D2", "D3", "D4"]) assert.equal(CLASS_LAYOUT[cls].after, 2 * CLASS_LAYOUT[cls].before);
});

test("after_bucket_holds_sixty_d2_and_d4_checks", () => {
  const after = bucketCounts(dev).after;
  assert.deepEqual(MIN_DEV_AFTER_CHECKS, { D2: 60, D4: 60 });
  assert.ok(after.D2 >= 60, `D2 after: ${after.D2}`);
  assert.ok(after.D4 >= 60, `D4 after: ${after.D4}`);
  assert.deepEqual(file.counts.devDependents, bucketCounts(dev));
  // Counted from the check rows too, not only from the dependency table.
  const rows = dev.flatMap((session) => runScripted(session, "oracle").rows).filter((row) => row.bucket === "after");
  assert.equal(rows.filter((row) => row.class === "D2").length, after.D2);
  assert.equal(rows.filter((row) => row.class === "D4").length, after.D4);
  // A standing rule is checked several times, far apart: once before the overflow and three times after it.
  for (const session of dev)
    for (const group of ["signature1", "signature2"]) {
      const own = session.deps.filter((dep) => dep.group === group);
      assert.deepEqual([own.filter((dep) => dep.bucket === "before").length, own.filter((dep) => dep.bucket === "after").length], [1, 3]);
    }
});

test("chain_dependents_require_the_current_value", () => {
  const post = (session, task, check, day) => {
    const ws = createWorkspace(session.env);
    ws.task = task.n;
    ws.call("post_message", { channel: "#release", text: `It ships on ${day}.` });
    return evaluateCheck(check, ws.state, task.n);
  };
  let chains = 0;
  for (const session of dev) {
    const trains = new Map();
    for (const dep of session.deps.filter((row) => row.class === "D4")) trains.set(dep.group, [...(trains.get(dep.group) ?? []), dep]);
    assert.equal(trains.size, 3, `${session.id}: three trains`);
    const changes = [];
    for (const rows of trains.values()) {
      const last = rows.at(-1);
      // 2 or 3 successive changes: the first statement and then each change is a source.
      changes.push(last.sources.length - 1);
      for (const dep of rows) {
        const task = session.tasks[dep.dependent - 1];
        const check = task.checks.find((row) => row.dep === dep.id);
        // The current value is the one the newest source stated; every source before it stated a superseded one.
        const newest = session.tasks[Math.max(...dep.sources) - 1].prompt;
        assert.ok(newest.includes(dep.evidence), `${session.id} ${dep.id}`);
        assert.ok(dep.superseded.length >= 1 && !dep.superseded.includes(dep.answer));
        assert.equal(dep.superseded.length, dep.sources.length - 1);
        assert.equal(post(session, task, check, dep.answer), true);
        for (const old of dep.superseded) assert.equal(post(session, task, check, old), false, `${session.id} ${dep.id} passes on ${old}`);
        // The train's document still holds its first day, which is never the current one.
        assert.equal(dep.distractor, dep.superseded[0]);
        assert.ok(session.env.files[dep.document].includes(`Ship day: ${dep.distractor}.`));
      }
      chains++;
    }
    assert.deepEqual(changes.sort(), [2, 2, 3], `${session.id}: chains of 2-3 changes`);
    // One train changes inside the `after` bucket: its two `after` dependents need different days.
    const late = [...trains.values()].find((rows) => rows.at(-1).sources.length === 4).filter((dep) => dep.bucket === "after");
    assert.equal(late.length, 2);
    assert.notEqual(late[0].answer, late[1].answer);
    assert.ok(late[1].dependent - Math.max(...late[1].sources) > LAYOUT.lateChangeGap - 1);
  }
  assert.equal(chains, 36);
});

test("revoke_check_fails_the_amnesic_agent", () => {
  assert.ok(LONG_CHECK_KINDS.includes("created-ticket-labels"));
  assert.deepEqual(LONG_CHECK_CLASSES, ["D1", "D2", "D3", "D4", REVOKE_CLASS, "C"]);
  assert.deepEqual(DEPENDENCY_CLASSES, ["D1", "D2", "D3", "D4", REVOKE_CLASS]);
  let revokes = 0;
  for (const session of dev) {
    const amnesic = runScripted(session, "amnesic").rows;
    for (const dep of session.deps.filter((row) => row.class === REVOKE_CLASS)) {
      revokes++;
      const task = session.tasks[dep.dependent - 1];
      const check = task.checks.find((row) => row.dep === dep.id);
      assert.equal(check.kind, "created-ticket-labels");
      assert.equal(amnesic.find((row) => row.check === check.id).pass, false);
      const create = (labels) => {
        const ws = createWorkspace(session.env);
        ws.task = task.n;
        if (labels) ws.call("create_ticket", { title: "follow up", labels });
        return evaluateCheck(check, ws.state, task.n);
      };
      // Scored jointly: the standing label on and the retired one off.
      assert.equal(create([dep.standing]), true);
      assert.equal(create([]), false, "no rule applied");
      assert.equal(create([dep.standing, dep.absent]), false, "the revoke forgotten");
      assert.equal(create([dep.absent]), false);
      assert.equal(create(null), false, "no ticket");
      // Its sources are both rules and the revoke, and it needs the revoke and the standing rule to be known.
      assert.equal(dep.sources.length, 3);
      assert.deepEqual(dependencyEvidence(dep), [dep.evidence, dep.standing]);
      assert.ok(session.tasks[Math.max(...dep.sources) - 1].prompt.includes(dep.evidence));
    }
  }
  assert.equal(revokes, 2 * dev.length);
  assert.throws(() => evaluateCheck({ kind: "no-such-kind" }, createWorkspace(one.env).state, 1), /unknown check kind/);
});

test("scripted_agents_calibrate_the_checks", () => {
  for (const session of dev) {
    const oracle = runScripted(session, "oracle").rows;
    assert.deepEqual(
      oracle.filter((row) => !row.pass),
      [],
      `${session.id}: the oracle fails a check`,
    );
    for (const row of runScripted(session, "amnesic").rows) {
      if (row.class === "C") assert.equal(row.pass, true, `${session.id} ${row.check}: the amnesic agent fails a control`);
      if (["D2", "D4", REVOKE_CLASS].includes(row.class))
        assert.equal(row.pass, false, `${session.id} ${row.check}: the amnesic agent passes`);
    }
  }
});

test("no_dependency_answer_leaks", () => {
  for (const session of dev) assert.deepEqual(dependencyLeaks(session), [], session.id);
  // The lint sees a leak when there is one: in a scope, in the dependent's prompt, in the workspace, in another prompt.
  const where = (session, dep) => dependencyLeaks(session).find((leak) => leak.dep === dep.id)?.where ?? [];
  const d2 = one.deps.find((dep) => dep.class === "D2");
  const scoped = copy(one);
  scoped.phases[3].scope += `\nReminder: ${d2.answer}`;
  assert.deepEqual(where(scoped, d2), ["scope"]);
  const prompted = copy(one);
  prompted.tasks[d2.dependent - 1].prompt += ` Use ${d2.answer}.`;
  assert.ok(where(prompted, d2).includes("dependent-prompt"));
  const filed = copy(one);
  filed.env.files["notes.md"] = `Remember ${d2.answer}.`;
  assert.deepEqual(where(filed, d2), ["workspace"]);
  const elsewhere = copy(one);
  elsewhere.tasks[49].prompt += ` Remember ${d2.answer}.`;
  assert.deepEqual(where(elsewhere, d2), ["prompt-50"]);
  // A superseded value: the train's own document must not hold the current day, and no earlier prompt may restate it.
  const d4 = one.deps.find((dep) => dep.class === "D4" && dep.bucket === "after");
  const stale = copy(one);
  stale.env.files[d4.document] += `\nShip day: ${d4.answer}.`;
  assert.deepEqual(where(stale, d4), ["workspace"]);
  const restated = copy(one);
  restated.tasks[d4.dependent - 2].prompt += ` Remember, ${d4.evidence}.`;
  assert.deepEqual(where(restated, d4), [`prompt-${d4.dependent - 1}`]);
  // The generator refuses a leaking session: `createSession` runs the same lint.
  for (const id of sessionBenchLongIds()) assert.doesNotThrow(() => createSession(id));
});

test("size_rules_are_refused_at_build_time", () => {
  for (const session of dev) {
    const sizes = sessionSizes(session);
    assert.ok(sizes.jobArtifactTokens[0] >= LONG_JOB_ARTIFACT_TOKENS[0] && sizes.jobArtifactTokens[1] <= LONG_JOB_ARTIFACT_TOKENS[1]);
    assert.ok(sizes.worstRequest.tokens <= WORST_REQUEST_SHARE * harnessInputCap(WINDOW_TOKENS));
    for (const span of sizes.spans) {
      assert.ok(span.tasks >= 3, `${session.id} ${span.dep}`);
      assert.ok(span.tokens >= MIN_SPAN_WINDOWS * WINDOW_TOKENS, `${session.id} ${span.dep}`);
    }
  }
  // An artifact over the range.
  const large = copy(one);
  const log = large.tasks.find((task) => task.job === "count-errors").plan[0].calls[0][1].path;
  large.env.files[log] += `\n${"x".repeat(4 * LONG_JOB_ARTIFACT_TOKENS[1])}`;
  assert.throws(() => sessionSizes(large), /job artifact of \d+ tokens, outside 6000-9000/);
  // A side output that the worst request after a compaction cannot carry.
  const heavy = copy(one);
  const train = heavy.deps.find((dep) => dep.class === "D4");
  heavy.env.files[train.document] += `\n${"x".repeat(3.5 * 9_500)}`;
  assert.throws(() => sessionSizes(heavy), /worst request after a compaction is \d+ tokens/);
  // A dependency that spans too little.
  const near = copy(one);
  const dep = near.deps[0];
  dep.sources = [dep.dependent - 2];
  assert.throws(() => sessionSizes(near), new RegExp(`${dep.id} spans 1 tasks`));
  // A dependent between the buckets, and a class out of balance.
  const between = copy(one);
  between.deps[0].bucket = null;
  assert.throws(() => sessionSizes(between), /dependents, expected/);
  const short = copy(one);
  short.tasks.pop();
  assert.throws(() => sessionSizes(short), /holds 99 tasks/);
});

test("long_bench_imports_no_memory_package", () => {
  const walked = assertNoMemoryImports(CORE_FILES.map((name) => new URL(name, import.meta.url).pathname));
  for (const name of ["build.mjs", "checks.mjs", "agents.mjs", "generate.mjs", "pressure.mjs"])
    assert.ok(walked.includes(`scripts/memory-bench/session-bench-long/${name}`), name);
  // The walk follows relative imports, so it reaches v3's files and nothing under packages/memory.
  assert.ok(walked.includes("scripts/memory-bench/session-bench/env/workspace.mjs"));
  assert.ok(walked.every((path) => !path.startsWith("packages/")));
});

test("pins_match_the_design_review", () => {
  const { design, ownerDecisions } = JSON.parse(readFileSync(GATE_FILE, "utf8"));
  assert.equal(BUCKETS.beforeBelowTask, design.buckets.beforeBelowTask);
  assert.equal(BUCKETS.afterAboveTask, design.buckets.afterAboveTask);
  assert.deepEqual([...LONG_JOB_ARTIFACT_TOKENS], design.artifactTokens);
  assert.equal(MEASURED_WORST_CASE.render.lineCharsPerDescriptionToken, design.render.lineCharsPerDescriptionToken.max);
  assert.equal(MEASURED_WORST_CASE.render.headerChars, design.render.headerChars);
  assert.equal(MEASURED_WORST_CASE.round.overheadTokens, design.rounds.overheadTokens.max);
  assert.equal(MEASURED_WORST_CASE.round.escapeRatio, design.rounds.escapeRatio);
  assert.equal(WINDOW_TOKENS, design.window);
  // The owner's length and power (Task 2): 100 tasks in phases of 25, 12 dev sessions.
  assert.match(ownerDecisions.find((row) => row.id === "tasksPerSession").decision, /^100 tasks per session, in 4 phases of 25/);
  assert.match(ownerDecisions.find((row) => row.id === "power").decision, /^12 dev sessions/);
  assert.equal(LONG_TASKS / PHASE_TASKS, 4);
  assert.equal(file.layout.tasks, 100);
  assert.equal(file.counts.tasks, 3_600);
});
