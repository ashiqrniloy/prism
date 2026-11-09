#!/usr/bin/env bun
// Plan 210 Task 1: build the memory feature ledger.
//
//   timeout 120 bun scripts/memory-bench/feature-ledger.mjs --out docs/_evidence/memory-bench/210/feature-ledger.json
//   timeout 120 bun scripts/memory-bench/feature-ledger.mjs --check          # committed ledger == fresh build
//   timeout 900 bun scripts/memory-bench/feature-ledger.mjs --verify-tests   # run every named safety test
//
// Offline and free: it reads the config schemas, source files, presets, defaults and evidence files. The output holds
// ids, paths, hashes, counts and short effect statements only, never note, question or answer text.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { memoryFabricConfigSchema } from "@arnilo/prism-memory-system";
import { memorySystemConfigSchema } from "@arnilo/prism-memory-system";
import wiki from "@arnilo/prism-wiki";
import { presetFields } from "../../packages/memory/system/src/ltm/config.ts";
import {
  CLOSURE_202,
  EXCLUDED,
  FEATURES,
  FINDINGS_1887,
  LIMITATIONS_18811,
  MANDATORY_CANDIDATE_TASKS,
  PLAN_HANDOFFS,
} from "./feature-ledger-features.mjs";
import { FIXES } from "./mechanism-probes/fixes.mjs";

/** Plan 210 Task 2's mechanism verdicts; absent before the first probe run. */
const MECHANISMS = "docs/_evidence/memory-bench/210/mechanisms.json";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const LEDGER_PATH = "docs/_evidence/memory-bench/210/feature-ledger.json";
export const STATUSES = Object.freeze(["benefit", "neutral", "negative", "unmeasured", "safety-proven"]);
export const CANDIDATE_STATUSES = Object.freeze(["neutral", "negative", "unmeasured"]);
export const ROLES = Object.freeze(["accuracy", "cost", "latency", "safety", "inspectability", "compatibility"]);
const SAFETY_ROLES = new Set(["safety", "inspectability"]);
const PRESETS = ["conversational", "coding"];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (path) => readFileSync(join(ROOT, path), "utf8");

/** Every property path of a JSON schema, walking anyOf/oneOf branches, in walk order and without duplicates. */
export function schemaPaths(schema, path = "", out = new Set()) {
  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    const childPath = path ? `${path}.${key}` : key;
    out.add(childPath);
    schemaPaths(child, childPath, out);
  }
  for (const branch of [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])]) schemaPaths(branch, path, out);
  return out;
}

/** The surface the ledger must cover, read from the code rather than restated. */
export function enumerateSurface() {
  const config = [
    ...[...schemaPaths(memoryFabricConfigSchema)].map((p) => `fabric:${p}`),
    // The system schema carries long-term memory under `ltm` (plan 216 Task 5); those fields are the `fabric:` rows above.
    ...[...schemaPaths(memorySystemConfigSchema)].filter((p) => p !== "ltm" && !p.startsWith("ltm.")).map((p) => `om:${p}`),
    ...[...schemaPaths(wiki.config)].map((p) => `wiki:${p}`),
  ];
  const kindsUnion = /export type MemoryNoteKind = ([^;]+);/.exec(read("packages/memory/system/src/ltm/types.ts"));
  if (!kindsUnion) throw new Error("feature-ledger: MemoryNoteKind union not found in fabric types.ts");
  const kinds = [...kindsUnion[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);

  const fabricTools = [...read("packages/memory/system/src/ltm/tools.ts").matchAll(/const \w+Name = "(memory\.[a-z]+)";/g)].map((m) => m[1]);
  const omTool = /options\.name \?\? "([a-z_]+)"/.exec(read("packages/memory/system/src/session/recall-tool.ts"))?.[1];
  const wikiTool = /WIKI_INGEST_TOOL_NAME = "([a-z_]+)"/.exec(read("packages/knowledge/wiki/src/tools/ingest.ts"))?.[1];
  if (!omTool || !wikiTool || fabricTools.length === 0) throw new Error("feature-ledger: a tool name was not found in source");
  const tools = [...fabricTools, omTool, wikiTool];

  const fabricCommands = [...read("packages/memory/system/src/ltm/index.ts").matchAll(/name: "(memory(?::[a-z]+)?)",/g)].map((m) => m[1]);
  const omCommands = [...read("packages/memory/system/src/session/commands.ts").matchAll(/name: "(memory:session(?::[a-z]+)?)",/g)].map((m) => m[1]);
  const wikiCommands = ["status", "lint", "ingest", "consolidate"].map(
    (file) => /_COMMAND_NAME = "(wiki:[a-z]+)"/.exec(read(`packages/knowledge/wiki/src/commands/${file}.ts`))?.[1],
  );
  if (wikiCommands.includes(undefined)) throw new Error("feature-ledger: a wiki command name was not found in source");
  const commands = [...new Set([...fabricCommands, ...omCommands, ...wikiCommands])];
  return { config, kinds, tools, commands };
}

/** `pkg:a.b.*` claims `pkg:a.b` and every descendant; anything else is an exact path. */
export function claims(pattern, path) {
  if (pattern.endsWith(".*")) {
    const base = pattern.slice(0, -2);
    return path === base || path.startsWith(`${base}.`);
  }
  return pattern === path;
}

function lookup(object, dotted) {
  let value = object;
  for (const key of dotted.split(".")) {
    if (value === null || typeof value !== "object" || !(key in value)) return { found: false };
    value = value[key];
  }
  return { found: true, value };
}

function presetMembership(presetKeys) {
  const out = {};
  for (const preset of PRESETS) {
    if (!presetKeys?.length) {
      out[preset] = "not-set-by-preset";
      continue;
    }
    const fields = presetFields(preset);
    const values = presetKeys.map((key) => fields[key]);
    out[preset] = values.some((v) => v !== undefined && v !== false)
      ? "member"
      : values.some((v) => v === false)
        ? "explicitly-off"
        : "absent";
  }
  return out;
}

/** The preset's own top-level fields, each mapped to the rows that claim it (`presetKeys`). */
function presetComponents(rows) {
  const out = {};
  for (const preset of PRESETS) {
    out[preset] = Object.keys(presetFields(preset))
      .sort()
      .map((field) => ({ field, features: rows.filter((f) => f.presetKeys?.includes(field)).map((f) => f.id) }));
  }
  return out;
}

function evidenceEntry(entry, problems) {
  const path = typeof entry === "string" ? entry : entry.path;
  if (!existsSync(join(ROOT, path))) {
    problems.push(`evidence file missing: ${path}`);
    return { path, sha256: null };
  }
  return { ...(typeof entry === "string" ? { path } : entry), sha256: sha256(readFileSync(join(ROOT, path))) };
}

/** A named test exists when its file holds an `it(`/`test(` call whose first argument is exactly that name. */
export function namedTestExists({ file, name }) {
  if (!existsSync(join(ROOT, file))) return false;
  const source = read(file);
  const quoted = JSON.stringify(name);
  return [`it(${quoted}`, `test(${quoted}`].some((call) => source.includes(call));
}

/**
 * `safety-proven` needs a safety or inspectability role and at least one named test that exists. A row whose only
 * claimed roles are safety or inspectability and that has no such proof is `unmeasured`, never a benefit.
 */
export function safetyStatusProblems(feature) {
  const problems = [];
  const tests = feature.tests ?? [];
  if (feature.status === "safety-proven") {
    if (!feature.roles.some((role) => SAFETY_ROLES.has(role)))
      problems.push(`${feature.id}: safety-proven without a safety or inspectability role`);
    if (tests.length === 0) problems.push(`${feature.id}: safety-proven without a named test`);
    for (const test of tests)
      if (!namedTestExists(test)) problems.push(`${feature.id}: named test not found: ${test.file} :: ${test.name}`);
  } else if (feature.roles.every((role) => SAFETY_ROLES.has(role)) && feature.status !== "unmeasured") {
    problems.push(`${feature.id}: a safety/inspectability-only row is ${feature.status}; it must be safety-proven or unmeasured`);
  }
  return problems;
}

/** Plan 202 Task 17 / F4: every extraction-gap decision in both attribution files, read from the files. */
function task17Flags() {
  const decisions = [];
  for (const path of [
    "docs/_evidence/memory-bench/202/muse13-screen-final/summary.json",
    "docs/_evidence/memory-bench/202/failure-attribution.json",
  ]) {
    const lever = JSON.parse(read(path)).levers.find((l) => l.task === 17);
    for (const d of lever?.decisions ?? [])
      decisions.push({ source: path, suite: d.suite, model: d.model, arm: d.arm, measured: d.measured === true });
  }
  return decisions;
}

/** Build the ledger. The inputs default to the checked-in lists; tests pass altered copies to prove the checks bite. */
export function buildLedger({ features: rows = FEATURES, closure: closureRows = CLOSURE_202, fixes = FIXES } = {}) {
  const problems = [];
  const mechanisms = existsSync(join(ROOT, MECHANISMS)) ? JSON.parse(read(MECHANISMS)) : undefined;
  const probeOf = new Map((mechanisms?.probes ?? []).map((row) => [row.id, row]));
  const surface = enumerateSurface();
  const defaults = JSON.parse(read("scripts/memory-bench/defaults.json")).defaults;
  const ids = new Set();

  const features = rows.map((f) => {
    if (ids.has(f.id)) problems.push(`duplicate feature id: ${f.id}`);
    ids.add(f.id);
    if (!STATUSES.includes(f.status)) problems.push(`${f.id}: unknown status ${f.status}`);
    for (const role of f.roles) if (!ROLES.includes(role)) problems.push(`${f.id}: unknown role ${role}`);
    for (const problem of safetyStatusProblems(f)) problems.push(problem);
    let defaultValue;
    if (f.defaultRef) {
      const hit = lookup(defaults, f.defaultRef);
      if (!hit.found) problems.push(`${f.id}: defaultRef ${f.defaultRef} is not in scripts/memory-bench/defaults.json`);
      defaultValue = { ref: `scripts/memory-bench/defaults.json#defaults.${f.defaultRef}`, value: hit.value ?? null };
    } else {
      defaultValue = { text: f.defaultText ?? "not configurable (always available when the owner package is on)" };
    }
    return {
      id: f.id,
      group: f.group,
      name: f.name,
      owner: f.owner,
      surface: {
        config: f.config ?? [],
        kinds: f.kinds ?? [],
        tools: f.tools ?? [],
        commands: f.commands ?? [],
      },
      default: defaultValue,
      presets: presetMembership(f.presetKeys),
      cost: f.cost,
      roles: f.roles,
      evidence: f.evidence.map((entry) => evidenceEntry(entry, problems)),
      tests: f.tests ?? [],
      ...(probeOf.has(f.id)
        ? {
            mechanism: {
              verdict: probeOf.get(f.id).verdict,
              fires: probeOf.get(f.id).fires,
              reaches: probeOf.get(f.id).reaches,
              correct: probeOf.get(f.id).correct,
              ...(probeOf.get(f.id).replay ? { rate: probeOf.get(f.id).replay.rate, rare: probeOf.get(f.id).replay.rare } : {}),
              ...(probeOf.get(f.id).fixes ? { fixes: probeOf.get(f.id).fixes } : {}),
            },
          }
        : {}),
      ...(f.roleStatus ? { roleStatus: f.roleStatus } : {}),
      ...(f.suiteStatus ? { suiteStatus: f.suiteStatus } : {}),
      ...(f.deferredFrom ? { deferredFrom: f.deferredFrom } : {}),
      status: f.status,
      statusBasis: f.statusBasis,
      candidate: CANDIDATE_STATUSES.includes(f.status),
    };
  });

  // Coverage: every config path, kind, tool and command is claimed by some row.
  const coverage = { config: {}, kinds: {}, tools: {}, commands: {} };
  for (const path of surface.config) {
    const owners = features.filter((f) => f.surface.config.some((pattern) => claims(pattern, path))).map((f) => f.id);
    if (owners.length === 0) problems.push(`config field not in the ledger: ${path}`);
    coverage.config[path] = owners;
  }
  for (const [kind, list] of [
    ["kinds", surface.kinds],
    ["tools", surface.tools],
    ["commands", surface.commands],
  ]) {
    for (const name of list) {
      const owners = features.filter((f) => f.surface[kind].includes(name)).map((f) => f.id);
      if (owners.length === 0) problems.push(`${kind.slice(0, -1)} not in the ledger: ${name}`);
      coverage[kind][name] = owners;
    }
  }
  // A row may not claim surface that does not exist (a stale row after a removal).
  for (const f of features) {
    for (const pattern of f.surface.config)
      if (!surface.config.some((path) => claims(pattern, path))) problems.push(`${f.id}: claims unknown config ${pattern}`);
    for (const kind of ["kinds", "tools", "commands"])
      for (const name of f.surface[kind])
        if (!surface[kind].includes(name)) problems.push(`${f.id}: claims unknown ${kind.slice(0, -1)} ${name}`);
  }

  const known = (list, where) => {
    for (const id of list) if (!ids.has(id)) problems.push(`${where}: unknown feature ${id}`);
    return list;
  };

  const flags = task17Flags();
  const closure = closureRows.map((row) => ({
    sourceTask: row.sourceTask,
    title: row.title,
    deferredFrom: `202-task${row.sourceTask}`,
    evidence: row.evidence.map((path) => evidenceEntry(path, problems)),
    ...(row.preserved ? { preserved: row.preserved } : {}),
    developmentTarget: row.developmentTarget,
    limitation: row.limitation,
    owningTasks: row.owningTasks,
    disposition: row.deferredLever ? "deferred-lever" : "installed-feature",
    features: known(row.features, `202 Task ${row.sourceTask}`),
    ...(row.relatedInstalled ? { relatedInstalled: known(row.relatedInstalled, `202 Task ${row.sourceTask}`) } : {}),
    ...(row.modelAnswerLimit ? { modelAnswerLimit: true } : {}),
    ...(row.sourceTask === 17
      ? {
          f4: { status: "unresolved", measured: false, value: null },
          extractionGapDecisions: { total: flags.length, measured: flags.filter((d) => d.measured).length },
        }
      : {}),
  }));

  const preserved = {
    task4BaselineComplete: JSON.parse(read("docs/_evidence/memory-bench/202/muse13-screen-final/summary.json")).baselineComplete,
    task5ScreenVerdict: JSON.parse(read("docs/_evidence/memory-bench/202/task5/development-screen-verdict.json")).screenVerdict,
  };
  if (preserved.task4BaselineComplete !== false)
    problems.push("202 Task 4 baselineComplete must stay false (read from the accepted screen)");
  if (preserved.task5ScreenVerdict !== "miss") problems.push("202 Task 5 screen verdict must stay miss (read from the verdict file)");

  const task5Manifest = JSON.parse(read("docs/_evidence/memory-bench/202/task5/development-comparison-manifest.json"));
  const handoffTask5 = {
    deferredFrom: "202-task5.4.6",
    manifest: "docs/_evidence/memory-bench/202/task5/development-comparison-manifest.json",
    manifestCells: task5Manifest.cells.length,
    manifestHash: task5Manifest.manifestHash,
    fileSha256: sha256(readFileSync(join(ROOT, "docs/_evidence/memory-bench/202/task5/development-comparison-manifest.json"))),
    note: "Plan 202 Task 5.7 cites the prefix a19a5ab7…, which matches neither the manifest's own manifestHash nor its file hash today; the values here are read from the file.",
    rows: ["write.keyword-enrichment", "navigation.agentic-lexical"],
  };

  const findings = JSON.parse(read("docs/_evidence/memory-bench/188.7/findings.json"));
  const openFindings = findings
    .filter((f) => f.verdict !== "fixed")
    .map((f) => ({ id: f.id, verdict: f.verdict, features: known(FINDINGS_1887[f.id] ?? [], `finding ${f.id}`) }));
  for (const f of openFindings) if (f.features.length === 0) problems.push(`188.7 finding ${f.id} (${f.verdict}) has no owning row`);

  const limitationIds = JSON.parse(read("docs/_evidence/memory-bench/188.11/limitations.json"));
  const limitations = (Array.isArray(limitationIds) ? limitationIds : limitationIds.limitations).map((l) => ({
    id: l.id,
    features: known(LIMITATIONS_18811[l.id] ?? [], `limitation ${l.id}`),
  }));
  for (const l of limitations) if (l.features.length === 0) problems.push(`188.11 limitation ${l.id} has no owning row`);

  const handoffs = PLAN_HANDOFFS.map((h) => ({
    ...h,
    source: evidenceEntry(h.source, problems),
    features: known(h.features, `plan ${h.plan} hand-off`),
  }));

  // Plan 202 closure: every source-task row of closure.md is imported, and unmeasured never reads as a measured zero.
  const closureTasks = [...read("docs/_evidence/memory-bench/202/closure.md").matchAll(/^\| (\d+): /gm)].map((m) => Number(m[1]));
  if (closureTasks.length === 0) problems.push("202 closure.md: no source-task rows found");
  for (const task of closureTasks)
    if (!closure.some((row) => row.sourceTask === task)) problems.push(`202 closure row missing: Task ${task}`);
  const task17 = closure.find((row) => row.sourceTask === 17);
  if (!task17) problems.push("202 Task 17 (facts / F4) is missing");
  else {
    if (task17.disposition !== "deferred-lever") problems.push("202 Task 17 must be a deferred lever, not an installed feature");
    if (task17.f4?.status !== "unresolved" || task17.f4.measured !== false || task17.f4.value !== null)
      problems.push("202 F4 must stay unresolved, unmeasured, with no value");
    if (task17.extractionGapDecisions.total === 0 || task17.extractionGapDecisions.measured !== 0)
      problems.push("202 Task 17 extraction-gap decisions must be present and all unmeasured");
  }
  const task13 = closure.find((row) => row.sourceTask === 13);
  if (task13 && task13.disposition !== "deferred-lever") problems.push("202 Task 13 must be a deferred lever");
  const byId = new Map(features.map((f) => [f.id, f]));
  for (const row of closure) {
    if (row.disposition === "deferred-lever" && row.features.length > 0)
      problems.push(`202 Task ${row.sourceTask}: a deferred lever owns no installed feature`);
    if (!MANDATORY_CANDIDATE_TASKS.includes(row.sourceTask)) continue;
    for (const id of row.features) {
      const f = byId.get(id);
      if (f && !f.candidate && f.status !== "benefit")
        problems.push(`202 Task ${row.sourceTask}: ${id} is a mandatory candidate but is ${f.status}`);
    }
  }
  for (const f of features) {
    if (["benefit", "neutral", "negative"].includes(f.status) && f.evidence.length === 0)
      problems.push(`${f.id}: ${f.status} without evidence`);
    for (const [suite, s] of Object.entries(f.suiteStatus ?? {})) {
      if (["deferred", "inconclusive"].includes(s.screen) && s.status !== "unmeasured")
        problems.push(`${f.id}: ${suite} is ${s.screen} but claims ${s.status}`);
      if (s.status !== "unmeasured" && (s.effect === null || s.pairs === 0))
        problems.push(`${f.id}: ${suite} claims ${s.status} with no measured effect`);
    }
  }

  if (problems.length > 0) throw new Error(`feature-ledger: ${problems.length} problem(s)\n- ${problems.join("\n- ")}`);

  const statusCounts = Object.fromEntries(STATUSES.map((s) => [s, features.filter((f) => f.status === s).length]));
  return {
    schemaVersion: 1,
    kind: "memory-feature-ledger",
    plan: 210,
    task: 1,
    note: "Development evidence only; no plan 210 held-out partition has been read. Candidates (neutral, negative, unmeasured) go to Tasks 2-5. Evidence entries are files and hashes; no note, question or answer text.",
    scope: {
      packages: [
        "@arnilo/prism-memory-system",
        "@arnilo/prism-memory-system",
        "@arnilo/prism-wiki",
        "@arnilo/prism-memory-core (parts only they use)",
      ],
      excluded: EXCLUDED,
    },
    statusVocabulary: STATUSES,
    summary: {
      features: features.length,
      candidates: features.filter((f) => f.candidate).length,
      byStatus: statusCounts,
      surface: {
        config: surface.config.length,
        kinds: surface.kinds.length,
        tools: surface.tools.length,
        commands: surface.commands.length,
      },
    },
    candidates: {
      features: features.filter((f) => f.candidate).map((f) => f.id),
      openMeasurements: closure
        .filter((row) => row.modelAnswerLimit)
        .map((row) => ({ sourceTask: row.sourceTask, item: "live / model-answer confirmation", features: row.features })),
      deferredLevers: closure
        .filter((row) => row.disposition === "deferred-lever")
        .map((row) => ({ sourceTask: row.sourceTask, title: row.title })),
    },
    features,
    presetComponents: presetComponents(rows),
    closure202: {
      source: evidenceEntry("docs/_evidence/memory-bench/202/closure.md", problems),
      preserved,
      mandatoryCandidateTasks: MANDATORY_CANDIDATE_TASKS,
      rows: closure,
    },
    handoffTask5,
    planHandoffs: handoffs,
    findings1887: openFindings,
    limitations18811: limitations,
    mechanismFixes: {
      source: mechanisms === undefined ? null : evidenceEntry(MECHANISMS, problems),
      fixes: fixes.map((fix) => {
        for (const id of fix.features) if (!ids.has(id)) problems.push(`mechanism fix ${fix.id} names an unknown feature: ${id}`);
        if (fix.test !== undefined && !namedTestExists(fix.test))
          problems.push(`mechanism fix ${fix.id}: named test not found: ${fix.test.name}`);
        if (fix.kind !== "task3" && fix.test === undefined) problems.push(`mechanism fix ${fix.id} has no regression test`);
        return { id: fix.id, kind: fix.kind, features: fix.features, found: fix.found, ...(fix.test ? { test: fix.test } : {}) };
      }),
    },
    coverage,
  };
}

/** Run every named test once with `bun test <file> -t <exact name>`; returns the failures. */
export function verifyNamedTests(ledger) {
  const failures = [];
  const seen = new Set();
  for (const f of ledger.features) {
    for (const test of f.tests) {
      const key = `${test.file}\0${test.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // `-t` matches the full name, which starts with any describe block, so only the end is anchored.
      const pattern = `${test.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
      const run = spawnSync("bun", ["test", "--timeout=120000", `./${test.file}`, "-t", pattern], {
        cwd: ROOT,
        encoding: "utf8",
        timeout: 300_000,
      });
      const out = `${run.stdout}\n${run.stderr}`;
      const passed = /(\d+) pass/.exec(out)?.[1];
      if (run.status !== 0 || !passed || Number(passed) < 1)
        failures.push({ ...test, feature: f.id, status: run.status, passed: Number(passed ?? 0) });
    }
  }
  return { ran: seen.size, failures };
}

export const render = (ledger) => `${JSON.stringify(ledger, null, 2)}\n`;

if (import.meta.main) {
  const args = process.argv.slice(2);
  const ledger = buildLedger();
  if (args.includes("--check")) {
    const committed = read(LEDGER_PATH);
    if (committed !== render(ledger)) {
      console.error(`feature-ledger: ${LEDGER_PATH} is stale; rebuild with --out ${LEDGER_PATH}`);
      process.exit(1);
    }
    console.log(`feature-ledger: ${LEDGER_PATH} is current (${ledger.summary.features} features)`);
  }
  const outIndex = args.indexOf("--out");
  if (outIndex !== -1) {
    const out = args[outIndex + 1];
    if (!out) throw new Error("--out needs a path");
    writeFileSync(resolve(out), render(ledger));
    console.log(`feature-ledger: wrote ${out}: ${JSON.stringify(ledger.summary)}`);
  }
  if (args.includes("--verify-tests")) {
    const result = verifyNamedTests(ledger);
    console.log(`feature-ledger: ran ${result.ran} named tests, ${result.failures.length} failed`);
    if (result.failures.length > 0) {
      console.error(JSON.stringify(result.failures, null, 2));
      process.exit(1);
    }
  }
  if (!args.includes("--check") && outIndex === -1 && !args.includes("--verify-tests"))
    console.log(JSON.stringify(ledger.summary, null, 2));
}
