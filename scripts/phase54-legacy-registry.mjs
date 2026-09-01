// scripts/phase54-legacy-registry.mjs
// Plan 054 Task 7: generate, verify, and apply legacy npm lifecycle markers for the 54
// retired 0.3.x package names: a `legacy` dist-tag on each final release plus a `<0.4.0`
// deprecation warning naming the exact 0.4 successor (or profile recipe) and the stable
// anchor in docs/migrate-to-0.4.md.
//
// Single source of truth: CONSOLIDATION_SPEC.retiredPackages from the Task 1 map
// (scripts/phase54-package-map.mjs). Final published versions are resolved from the
// registry (one bounded `npm view <name> version` query per retired name) so the plan
// tags the actual last-published release, never a guessed one.
//
// Modes:
//   --generate            resolve versions + verify guide anchors, write the plan JSON
//   --dry-run             verify target versions exist and `latest` is unchanged;
//                         print the planned commands; never mutates registry state
//   --apply --confirm     idempotent apply: pre-flights every entry and fails closed
//                         (zero mutations) on any mismatch; correct entries are skipped;
//                         per-entry status is written back to the plan for safe resume
//
// Apply is only valid AFTER the 0.4 packages and the migration guide are public (Task 9).
//
// Offline fixture tests override the npm executable via PRISM_LEGACY_NPM and the plan
// path via PRISM_LEGACY_PLAN (see scripts/phase54-legacy-registry.test.mjs).

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONSOLIDATION_SPEC } from "./phase54-package-map.mjs";

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GUIDE_REL = "docs/migrate-to-0.4.md";
const GUIDE_URL = "https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md";
export const DEPRECATE_RANGE = "<0.4.0";
export const LEGACY_TAG = "legacy";
export const PLAN_REL = "release-artifacts/legacy-registry-plan.json";

const NPM = process.env.PRISM_LEGACY_NPM || "npm";

function npm(args) {
  const res = spawnSync(NPM, args, { encoding: "utf8" });
  if (res.error) throw new Error(`failed to spawn ${NPM}: ${res.error.message}`);
  return { ok: res.status === 0, stdout: (res.stdout ?? "").trim(), stderr: (res.stderr ?? "").trim() };
}

// GitHub heading slug (lowercase, punctuation stripped, spaces -> hyphens).
export function githubSlug(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

// Anchors of every heading in the migration guide (code fences ignored).
export function guideAnchors(guidePath) {
  const slugs = new Set();
  let inFence = false;
  for (const line of readFileSync(guidePath, "utf8").split("\n")) {
    if (line.startsWith("```")) inFence = !inFence;
    if (inFence) continue;
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) slugs.add(githubSlug(heading[2]));
  }
  return slugs;
}

// The one uniform warning format, derived from the Task 1 map entry.
export function legacyMessage(item) {
  const anchor = item.migrationAnchor;
  if (item.targetPackage) {
    const successor = item.targetSubpath ? `${item.targetPackage}${item.targetSubpath}` : item.targetPackage;
    return `Legacy 0.3 package. Prism 0.4+: ${successor}. ${GUIDE_URL}${anchor}`;
  }
  return `Legacy 0.3 profile. Prism 0.4+: Install explicit family packages. ${GUIDE_URL}${anchor}`;
}

// Offline plan entries; versions come from the registry in generate mode. Retired names
// that were never published (no registry presence) are recorded but get no mutations.
export function buildPlanEntries(versions = {}) {
  return CONSOLIDATION_SPEC.retiredPackages.map((item) => {
    const message = legacyMessage(item);
    const version = versions[item.name];
    const published = typeof version === "string" && version.length > 0;
    return {
      name: item.name,
      category: item.category,
      registry: published ? "published" : "unpublished",
      finalVersion: published ? version : null,
      successor: item.targetPackage
        ? item.targetSubpath
          ? `${item.targetPackage}${item.targetSubpath}`
          : item.targetPackage
        : "Install explicit family packages (see guide recipe)",
      migrationAnchor: item.migrationAnchor,
      message,
      distTagCommand: published ? `npm dist-tag add ${item.name}@${version} ${LEGACY_TAG}` : null,
      deprecateCommand: published ? `npm deprecate ${item.name}@"${DEPRECATE_RANGE}" "${message}"` : null,
      status: published ? "pending" : "unpublished",
    };
  });
}

function parseDistTags(stdout) {
  const tags = {};
  for (const line of stdout.split("\n")) {
    const m = /^(\S+): (\S+)$/.exec(line.trim());
    if (m) tags[m[1]] = m[2];
  }
  return tags;
}

// Current registry state for one entry, via bounded single-package queries.
function readEntryState(entry) {
  const exists = npm(["view", `${entry.name}@${entry.finalVersion}`, "version"]);
  if (!exists.ok) return { problem: `final version ${entry.finalVersion} not found in registry` };
  const tags = parseDistTags(npm(["dist-tag", "ls", entry.name]).stdout || "");
  if (!tags.latest) return { problem: "no latest dist-tag" };
  const deprecated = npm(["view", `${entry.name}@${entry.finalVersion}`, "deprecated"]).stdout || "";
  return { tags, deprecated };
}

export function entryProblems(entry, { tags, deprecated }) {
  const problems = [];
  if (tags.latest !== entry.finalVersion) {
    problems.push(`latest moved to ${tags.latest} (expected ${entry.finalVersion})`);
  }
  const legacy = tags[LEGACY_TAG];
  if (legacy !== undefined && legacy !== entry.finalVersion) {
    problems.push(`${LEGACY_TAG} tag points at ${legacy} (expected ${entry.finalVersion})`);
  }
  if (deprecated !== undefined && deprecated !== "" && deprecated !== entry.message) {
    problems.push("existing deprecation message differs from the plan");
  }
  return problems;
}

function verifyAnchors(entries, rootDir) {
  const anchors = guideAnchors(join(rootDir, GUIDE_REL));
  const bad = entries.filter((e) => !anchors.has(e.migrationAnchor.slice(1)));
  if (bad.length > 0) {
    throw new Error(`migration guide anchors missing from ${GUIDE_REL}: ${bad.map((b) => b.migrationAnchor).join(", ")}`);
  }
}

function resolveVersions(names) {
  const versions = {};
  for (const name of names) {
    const r = npm(["view", name, "version"]);
    // A 404 means the retired name was never published; nothing to tag or deprecate.
    versions[name] = r.ok && r.stdout ? r.stdout : null;
  }
  return versions;
}

function planPath(rootDir) {
  return process.env.PRISM_LEGACY_PLAN || join(rootDir, PLAN_REL);
}

function loadPlan(rootDir) {
  const p = planPath(rootDir);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

function writePlan(rootDir, entries, extra = {}) {
  const p = planPath(rootDir);
  mkdirSync(dirname(p), { recursive: true });
  const summary = { total: entries.length };
  for (const s of ["unpublished", "pending", "applied", "skipped", "failed"]) {
    summary[s] = entries.filter((e) => e.status === s).length;
  }
  writeFileSync(
    p,
    `${JSON.stringify(
      {
        $comment:
          "Plan 054 Task 7 legacy registry plan. Generated from the Task 1 map (scripts/phase54-package-map.mjs CONSOLIDATION_SPEC) + registry-resolved final versions. Apply only after the 0.4 packages and docs/migrate-to-0.4.md are public (Task 9). Idempotent: --apply --confirm skips already-correct entries and fails closed on mismatches.",
        generatedAt: new Date().toISOString(),
        guide: GUIDE_REL,
        guideUrl: GUIDE_URL,
        deprecateRange: DEPRECATE_RANGE,
        legacyTag: LEGACY_TAG,
        ...extra,
        entries,
        summary,
      },
      null,
      2,
    )}\n`,
  );
  return p;
}

function generate(rootDir) {
  const names = CONSOLIDATION_SPEC.retiredPackages.map((r) => r.name);
  const versions = resolveVersions(names);
  const entries = buildPlanEntries(versions);
  verifyAnchors(entries, rootDir);
  const p = writePlan(rootDir, entries, { generatedFrom: "scripts/phase54-package-map.mjs CONSOLIDATION_SPEC" });
  console.error(`legacy registry plan written: ${p} (${entries.length} entries)`);
  return entries;
}

function ensurePlan(rootDir) {
  const existing = loadPlan(rootDir);
  if (existing?.entries?.length === CONSOLIDATION_SPEC.retiredPackages.length) return existing;
  return { entries: generate(rootDir) };
}

function dryRun(rootDir, entries) {
  verifyAnchors(entries, rootDir);
  let problems = 0;
  let done = 0;
  for (const entry of entries) {
    if (entry.status === "unpublished") {
      console.log(`not published (no registry action): ${entry.name}`);
      continue;
    }
    const state = readEntryState(entry);
    if (state.problem) {
      console.error(`DRY-RUN PROBLEM ${entry.name}: ${state.problem}`);
      problems += 1;
      continue;
    }
    const errs = entryProblems(entry, state);
    if (errs.length > 0) {
      for (const e of errs) console.error(`DRY-RUN PROBLEM ${entry.name}: ${e}`);
      problems += 1;
      continue;
    }
    if (state.tags[LEGACY_TAG] === entry.finalVersion && state.deprecated === entry.message) {
      done += 1;
      console.log(`already applied: ${entry.name}@${entry.finalVersion}`);
      continue;
    }
    console.log(`planned:\n  ${entry.distTagCommand}\n  ${entry.deprecateCommand}`);
  }
  console.error(`dry-run complete: ${done}/${entries.length} already applied, ${problems} problem(s); no registry state was modified`);
  return problems === 0 ? 0 : 1;
}

function apply(rootDir, plan) {
  const entries = plan.entries;
  verifyAnchors(entries, rootDir);
  // Fail closed: pre-flight every entry; any mismatch aborts with zero mutations.
  const states = new Map();
  const mismatched = [];
  for (const entry of entries) {
    if (entry.status === "unpublished") continue; // never published: no registry mutations possible
    const state = readEntryState(entry);
    if (state.problem) {
      mismatched.push(`${entry.name}: ${state.problem}`);
      continue;
    }
    states.set(entry.name, state);
    const errs = entryProblems(entry, state);
    if (errs.length > 0) mismatched.push(`${entry.name}: ${errs.join("; ")}`);
  }
  if (mismatched.length > 0) {
    for (const m of mismatched) console.error(`APPLY ABORT (no state modified): ${m}`);
    const unmodified = entries.filter((e) => !mismatched.some((m) => m.startsWith(`${e.name}: `))).map((e) => e.name);
    console.error(`unmodified names safe for resume: ${unmodified.join(", ")}`);
    return 1;
  }
  let failed = 0;
  for (const entry of entries) {
    if (entry.status === "unpublished") continue; // never published: nothing to tag or deprecate
    const state = states.get(entry.name);
    if (state.tags[LEGACY_TAG] === entry.finalVersion && state.deprecated === entry.message) {
      entry.status = "skipped";
      continue;
    }
    if (state.tags[LEGACY_TAG] !== entry.finalVersion) {
      const r = npm(["dist-tag", "add", `${entry.name}@${entry.finalVersion}`, LEGACY_TAG]);
      if (!r.ok) {
        entry.status = "failed";
        entry.detail = `dist-tag add failed: ${r.stderr}`;
        failed += 1;
        continue;
      }
    }
    if (state.deprecated !== entry.message) {
      // spawnSync has no shell, so the range carries no shell quotes here; the plan's
      // deprecateCommand keeps them for human copy-paste.
      const r = npm(["deprecate", `${entry.name}@${DEPRECATE_RANGE}`, entry.message]);
      if (!r.ok) {
        entry.status = "failed";
        entry.detail = `deprecate failed: ${r.stderr}`;
        failed += 1;
        continue;
      }
    }
    entry.status = "applied";
    console.log(`applied: ${entry.name}@${entry.finalVersion}`);
  }
  writePlan(rootDir, entries, { lastApplyAt: new Date().toISOString() });
  if (failed > 0) {
    console.error(`${failed} mutation(s) failed; re-run --apply --confirm to resume (applied entries are skipped)`);
    return 1;
  }
  console.error(`legacy registry apply complete: ${entries.length} entries`);
  return 0;
}

export async function main(argv = process.argv.slice(2)) {
  const wantsGenerate = argv.includes("--generate");
  const wantsDryRun = argv.includes("--dry-run");
  const wantsApply = argv.includes("--apply");
  const confirmed = argv.includes("--confirm");
  const rootDir = DEFAULT_ROOT;
  if (!wantsGenerate && !wantsDryRun && !wantsApply) {
    console.error("usage: node scripts/phase54-legacy-registry.mjs [--generate | --dry-run | --apply --confirm]");
    return 2;
  }
  if (wantsApply && !confirmed) {
    console.error("refusing to mutate the registry without explicit --confirm");
    return 2;
  }
  if (wantsApply) {
    const plan = ensurePlan(rootDir);
    return apply(rootDir, plan);
  }
  const existing = loadPlan(rootDir);
  const entries = wantsGenerate || !existing ? generate(rootDir) : existing.entries;
  if (wantsGenerate && !wantsDryRun) return 0;
  return dryRun(rootDir, entries);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  main().then((code) => process.exit(code));
}
