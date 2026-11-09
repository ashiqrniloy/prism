// scripts/registry-deprecate.mjs
// Plan 175 Task 8, narrowed by plan 215 Task 38: plan the deprecations, print the commands.
//
// npm's trusted publishing covers `npm publish`, `npm stage publish` and `npm dist-tag`; `npm
// deprecate` still needs traditional authentication, so this tool holds no credential and mutates
// nothing. It reads the registry anonymously and prints the exact `npm deprecate` commands for the
// owner to run locally with 2FA.
//
// Modes:
//   --generate         anonymous GET per name -> release-artifacts/deprecation-plan.json
//   --dry-run          print the versions in range and the message; mutates nothing
//   --commands         print the `npm deprecate` lines for the owner, in plan order
//
// The committed list is scripts/deprecations-0.13.json (plan 174 Task 1 (i)). Fixture tests inject
// `fetch` through createRegistryDeprecator (scripts/registry-deprecate.test.mjs); the registry host
// defaults to https://registry.npmjs.org and is overridable with PRISM_DEPRECATE_REGISTRY for
// offline fixtures only. No token is read, stored or logged.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compareVersions, parseRange, parseVersion, satisfies } from "../src/packages/semver.ts";
import { githubSlug } from "./phase54-legacy-registry.mjs";

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_REGISTRY = "https://registry.npmjs.org";
export const DEFAULT_LIST_REL = "scripts/deprecations-0.13.json";
export const DEFAULT_PLAN_REL = "release-artifacts/deprecation-plan.json";
export const GUIDE_REL = "docs/migrate-to-0.13.md";
/** The 0.13.0 line a reused name must already carry before its retired range is deprecated. */
export const NEW_LINE_VERSION = "0.13.0";

/** `@scope/name` -> `@scope%2fname`, the packument path npm builds from `npa().escapedName`. */
export function escapedName(name) {
  return name.replace("/", "%2f");
}

/**
 * Whether one published version is inside a deprecation range. `*` covers every published version
 * (npm's `deprecate` passes `includePrerelease: true`); the scoped form uses the kernel's parser, so
 * `<0.13.0` deliberately excludes `0.13.0-*` and a reused name's new line is never deprecated.
 */
export function versionInRange(version, range) {
  if (range === "*") return true;
  const parsed = parseVersion(version);
  return parsed !== undefined && satisfies(parsed, parseRange(range));
}

function sortVersions(versions) {
  return versions.slice().sort((a, b) => {
    const pa = parseVersion(a);
    const pb = parseVersion(b);
    return pa && pb ? compareVersions(pa, pb) : a.localeCompare(b);
  });
}

/** Anchors of every heading in the migration guide (code fences ignored). */
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

/** Every way a committed list entry is malformed, as human-readable strings. */
export function listProblems(list) {
  const problems = [];
  if (!Array.isArray(list?.names) || list.names.length === 0) return ["the list has no names"];
  for (const item of list.names) {
    const where = item?.name ?? "(unnamed)";
    for (const field of ["name", "range", "successor", "anchor", "message"]) {
      if (typeof item?.[field] !== "string" || item[field].length === 0) problems.push(`${where}: missing ${field}`);
    }
    if (typeof item?.reused !== "boolean") problems.push(`${where}: missing reused`);
    if (typeof item?.message === "string" && typeof item?.successor === "string" && !item.message.includes(item.successor)) {
      problems.push(`${where}: message does not name the successor`);
    }
    if (typeof item?.message === "string" && typeof item?.anchor === "string" && !item.message.includes(item.anchor)) {
      problems.push(`${where}: message does not carry the migration anchor`);
    }
  }
  return problems;
}

/** Every way the live packument disagrees with the generated plan, as human-readable strings. */
export function entryProblems(entry, packument) {
  const problems = [];
  const versions = Object.keys(packument?.versions ?? {});
  if (Array.isArray(entry.publishedVersions) && sortVersions(versions).join(",") !== sortVersions(entry.publishedVersions).join(",")) {
    problems.push("registry state differs from the generated plan; re-run --generate");
  }
  if (entry.reused !== true) return problems;
  const latest = packument?.["dist-tags"]?.latest;
  if (typeof latest !== "string") problems.push("no latest dist-tag");
  else if (versionInRange(latest, entry.range)) {
    problems.push(`latest ${latest} is inside ${entry.range}; publish ${NEW_LINE_VERSION} and move latest first`);
  }
  if (!versions.includes(NEW_LINE_VERSION)) problems.push(`${NEW_LINE_VERSION} is not published yet`);
  return problems;
}

/** The deprecation entries a plan holds that are already applied, so resume can skip them. */
export function alreadyDeprecated(entry, packument) {
  return entry.deprecateVersions.length > 0 && entry.deprecateVersions.every((v) => packument?.versions?.[v]?.deprecated === entry.message);
}

/**
 * The registry deprecator. Every dependency is injectable so the suite runs offline with a stub
 * `fetch`; the CLI builds one from the environment.
 */
export function createRegistryDeprecator({
  rootDir = DEFAULT_ROOT,
  registry = process.env.PRISM_DEPRECATE_REGISTRY || DEFAULT_REGISTRY,
  fetchImpl = globalThis.fetch,
  listPath = process.env.PRISM_DEPRECATE_LIST || join(rootDir, DEFAULT_LIST_REL),
  planPath = process.env.PRISM_DEPRECATE_PLAN || join(rootDir, DEFAULT_PLAN_REL),
  guidePath = join(rootDir, GUIDE_REL),
  out = (line) => console.log(line),
  err = (line) => console.error(line),
} = {}) {
  const base = String(registry).replace(/\/+$/, "");

  function loadList() {
    const list = JSON.parse(readFileSync(listPath, "utf8"));
    const problems = listProblems(list);
    if (problems.length > 0) throw new Error(`invalid ${listPath}: ${problems.join("; ")}`);
    return list;
  }

  function verifyAnchors(list) {
    const anchors = guideAnchors(guidePath);
    const missing = list.names.filter((item) => !anchors.has(item.anchor.slice(1))).map((item) => `${item.name} ${item.anchor}`);
    if (missing.length > 0) throw new Error(`migration guide anchors missing from ${GUIDE_REL}: ${missing.join(", ")}`);
  }

  function loadPlan() {
    if (!existsSync(planPath)) return null;
    return JSON.parse(readFileSync(planPath, "utf8"));
  }

  function writePlan(entries, extra = {}) {
    mkdirSync(dirname(planPath), { recursive: true });
    const summary = { total: entries.length };
    summary.pending = entries.filter((entry) => entry.status === "pending").length;
    writeFileSync(
      planPath,
      `${JSON.stringify(
        {
          $comment:
            "Plan 175 Task 8 deprecation plan, generated from scripts/deprecations-0.13.json against the live registry. `npm deprecate` is not OIDC-capable, so `bun scripts/registry-deprecate.mjs --commands` prints the commands for the owner to run locally with 2FA; this file changes no registry state.",
          generatedAt: new Date().toISOString(),
          registry: base,
          guide: GUIDE_REL,
          ...extra,
          entries,
          summary,
        },
        null,
        2,
      )}\n`,
    );
  }

  async function readPackument(name) {
    const res = await fetchImpl(`${base}/${escapedName(name)}`, { headers: { accept: "application/json" } });
    if (!res.ok) {
      // 404 is the finished state after a cleanup: the name is gone, so there is nothing to deprecate.
      const error = new Error(`GET ${name}: ${res.status}`);
      error.status = res.status;
      throw error;
    }
    return res.json();
  }

  /** Anonymous GET per name; optionally write the plan. */
  async function generate({ write = true } = {}) {
    const list = loadList();
    verifyAnchors(list);
    const entries = [];
    for (const item of list.names) {
      let packument;
      try {
        packument = await readPackument(item.name);
      } catch (error) {
        // Task 37 unpublished the legacy names: an absent name has nothing left to deprecate.
        if (error.status === 404) {
          out(`unpublished: ${item.name} (not in the plan)`);
          continue;
        }
        throw error;
      }
      const versions = sortVersions(Object.keys(packument?.versions ?? {}));
      entries.push({
        name: item.name,
        range: item.range,
        reused: item.reused,
        successor: item.successor,
        message: item.message,
        latest: packument?.["dist-tags"]?.latest ?? null,
        publishedVersions: versions,
        deprecateVersions: versions.filter((v) => versionInRange(v, item.range)),
        status: "pending",
      });
    }
    if (write) writePlan(entries, { generatedFrom: DEFAULT_LIST_REL });
    return entries;
  }

  async function dryRun(entries) {
    let problems = 0;
    let already = 0;
    let gone = 0;
    for (const entry of entries) {
      let packument;
      try {
        packument = await readPackument(entry.name);
      } catch (error) {
        if (error.status === 404) {
          gone += 1;
          out(`unpublished: ${entry.name} (nothing to deprecate)`);
          continue;
        }
        err(`DRY-RUN PROBLEM ${entry.name}: ${error.message}`);
        problems += 1;
        continue;
      }
      const found = entryProblems(entry, packument);
      if (found.length > 0) {
        for (const problem of found) err(`DRY-RUN PROBLEM ${entry.name}: ${problem}`);
        problems += 1;
        continue;
      }
      if (alreadyDeprecated(entry, packument)) {
        already += 1;
        out(`already deprecated: ${entry.name}@"${entry.range}"`);
        continue;
      }
      out(`planned: ${entry.name}@"${entry.range}" -> ${entry.deprecateVersions.length} version(s): ${entry.deprecateVersions.join(", ")}`);
      out(`  message: ${entry.message}`);
    }
    err(
      `dry-run complete: ${already} already deprecated, ${gone} unpublished, ${problems} problem(s) of ${entries.length}; no registry state was modified`,
    );
    return problems === 0 ? 0 : 1;
  }

  /** The `npm deprecate` lines for the owner: `deprecate` is the one registry write OIDC cannot do. */
  function commands(entries) {
    return entries.map((entry) => `npm deprecate '${entry.name}@${entry.range}' '${String(entry.message).replaceAll("'", "'\\''")}'`);
  }

  return { loadList, loadPlan, generate, dryRun, commands, planPath, listPath, registry: base };
}

export async function main(argv = process.argv.slice(2)) {
  const wantsGenerate = argv.includes("--generate");
  const wantsDryRun = argv.includes("--dry-run");
  const wantsCommands = argv.includes("--commands");
  if (argv.includes("--apply")) {
    console.error("no --apply: `npm deprecate` is not OIDC-capable. Run --commands and execute the lines locally with 2FA.");
    return 2;
  }
  if (!wantsGenerate && !wantsDryRun && !wantsCommands) {
    console.error("usage: bun scripts/registry-deprecate.mjs [--generate | --dry-run | --commands]");
    return 2;
  }
  const deprecator = createRegistryDeprecator();
  if (wantsGenerate) {
    const entries = await deprecator.generate();
    console.error(`deprecation plan written: ${deprecator.planPath} (${entries.length} entries)`);
    return 0;
  }
  const plan = deprecator.loadPlan();
  const entries = plan?.entries ?? (await deprecator.generate({ write: false }));
  if (wantsCommands) {
    for (const line of deprecator.commands(entries)) console.log(line);
    return 0;
  }
  return deprecator.dryRun(entries);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  main().then((code) => process.exit(code));
}
