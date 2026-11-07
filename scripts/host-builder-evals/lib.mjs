/**
 * Pure helpers for the host-builder evaluation (plan 215 Task 20): the staged "installed" tree, the per-trial
 * workspace, the hidden checks and their scorers, and the pre-registered claim rules. Nothing here calls a model.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { compareExperiments, defineScorer } from "@arnilo/prism-evals";
import { sha256 } from "../skill-evals/lib.mjs";

export { canonicalJson, sha256 } from "../skill-evals/lib.mjs";

export const ROOT = import.meta.dir;
export const REPO = resolve(ROOT, "../..");
export const CRITERIA_PATH = join(ROOT, "criteria.json");
export const LOCK_PATH = join(ROOT, "criteria.lock.json");
export const EVIDENCE_DIR = join(REPO, "docs/_evidence/host-builder/212");
export const WORKSPACES = join(ROOT, "workspaces");
export const HIDDEN = join(ROOT, "hidden");
export const SOLUTIONS = join(ROOT, "solutions");
export const BIN = join(REPO, "packages/hosts/host-builder/bin/prism-host-builder.ts");
export const ARMS = Object.freeze(["none", "skill", "skill+mcp"]);
export const KIT_PACKAGE = "@arnilo/prism-host-builder";

export function loadCriteria() {
  const text = readFileSync(CRITERIA_PATH, "utf8");
  return { criteria: JSON.parse(text), hash: sha256(text) };
}

// ── hashing the registered inputs ──────────────────────────────────────────────

function walkFiles(directory) {
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.push(path);
    }
  };
  if (existsSync(directory)) walk(directory);
  return files.sort();
}

/** A stable hash of every file under `directory`: relative path and bytes. */
export function treeHash(directory) {
  return `sha256:${sha256(
    walkFiles(directory)
      .map((path) => `${relative(directory, path)}\n${readFileSync(path, "utf8")}`)
      .join("\n--\n"),
  )}`;
}

/** What the lock pins: the workspaces, the hidden tests, the oracle solutions and the kit under test. */
export function registeredInputs() {
  return {
    workspaces: treeHash(WORKSPACES),
    hidden: treeHash(HIDDEN),
    solutions: treeHash(SOLUTIONS),
    skill: treeHash(join(REPO, "packages/hosts/host-builder/skills")),
    indexes: treeHash(join(REPO, "packages/hosts/host-builder/data")),
  };
}

// ── the staged "installed" tree ─────────────────────────────────────────────────

const KERNEL_ENTRIES = ["src", "docs", "templates", "package.json", "README.md", "CHANGELOG.md", "manifest/schema.json"];
const PACKAGE_ENTRIES = ["src", "bin", "data", "skills", "package.json", "README.md", "CHANGELOG.md"];
const SKIP_DIRS = new Set(["__tests__", "_evidence", "node_modules", ".git"]);

function copyFiltered(source, destination) {
  if (!existsSync(source)) return;
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, {
    recursive: true,
    filter: (path) => {
      const name = path.split(sep).at(-1);
      if (SKIP_DIRS.has(name)) return false;
      return !/\.test\.(?:ts|mjs)$/.test(name);
    },
  });
}

/** Non-private packages under `packages/<group>/<name>`: `{ name, dir, subpaths }`. */
export function repoPackages() {
  const found = [];
  for (const group of readdirSync(join(REPO, "packages"))) {
    const groupDir = join(REPO, "packages", group);
    if (!statSync(groupDir).isDirectory() || existsSync(join(groupDir, "package.json"))) continue;
    for (const name of readdirSync(groupDir)) {
      const manifestPath = join(groupDir, name, "package.json");
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (manifest.private === true || typeof manifest.name !== "string") continue;
      const subpaths = new Set(
        Object.keys(manifest.exports ?? {})
          .filter((key) => key.startsWith("./") && key !== ".")
          .map((key) => key.slice(2)),
      );
      found.push({ name: manifest.name, dir: join(groupDir, name), subpaths });
    }
  }
  return found;
}

/**
 * Builds `<dest>/node_modules`: real copies of `@arnilo/prism` and every published package, as an install lays them
 * out (the read tools refuse a symlink that leaves the project), and symlinks to every other dependency the
 * repository has. `withKit: false` leaves out the host-builder package, which is the `none` arm.
 */
export function stageInstalled(dest, { withKit }) {
  const modules = join(dest, "node_modules");
  const scope = join(modules, "@arnilo");
  mkdirSync(scope, { recursive: true });
  for (const entry of KERNEL_ENTRIES) copyFiltered(join(REPO, entry), join(scope, "prism", entry));
  for (const pkg of repoPackages()) {
    if (!withKit && pkg.name === KIT_PACKAGE) continue;
    const target = join(scope, pkg.name.split("/")[1]);
    for (const entry of PACKAGE_ENTRIES) copyFiltered(join(pkg.dir, entry), join(target, entry));
  }
  const repoModules = join(REPO, "node_modules");
  for (const name of readdirSync(repoModules)) {
    if (name === "@arnilo" || (name.startsWith(".") && name !== ".bin")) continue;
    symlinkSync(join(repoModules, name), join(modules, name));
  }
  return modules;
}

const staged = new Map();

/** One staged tree per kit setting and process, copied into each trial. */
export function stagedTree(withKit) {
  const key = withKit ? "kit" : "bare";
  if (!staged.has(key)) {
    const dir = mkdtempSync(join(tmpdir(), `hbe-staged-${key}-`));
    stageInstalled(dir, { withKit });
    staged.set(key, dir);
  }
  return staged.get(key);
}

export function disposeStaged() {
  for (const dir of staged.values()) rmSync(dir, { recursive: true, force: true });
  staged.clear();
}

// ── one trial's workspace ───────────────────────────────────────────────────────

const CHILD_ENV_KEYS = ["PATH", "HOME", "TMPDIR", "LANG", "TERM"];

export function childEnv() {
  const env = { NO_COLOR: "1" };
  for (const key of CHILD_ENV_KEYS) if (process.env[key] !== undefined) env[key] = process.env[key];
  return env;
}

/**
 * Creates the builder's copy of a task: the common files, the task's seed, the staged install, and (for the `skill`
 * arms) the skill copied by the shipped installer. The hidden tests and solutions are never copied here.
 */
export function buildWorkspace({ task, arm }) {
  if (!ARMS.includes(arm)) throw new TypeError(`HostBuilderEvalArm: unknown arm ${arm}`);
  const dir = mkdtempSync(join(tmpdir(), `hbe-${task}-`));
  cpSync(join(WORKSPACES, "_common"), dir, { recursive: true });
  cpSync(join(WORKSPACES, task), dir, { recursive: true });
  cpSync(join(stagedTree(arm !== "none"), "node_modules"), join(dir, "node_modules"), { recursive: true, verbatimSymlinks: true });
  if (arm !== "none") {
    const install = spawnSync(process.execPath, [BIN, "install", "--target", "agents", "--root", dir], {
      encoding: "utf8",
      timeout: 60_000,
      env: childEnv(),
    });
    if (install.status !== 0) throw new Error(`HostBuilderEvalInstall: ${install.stderr || install.stdout}`);
  }
  return { dir, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

// ── checks on the finished workspace ────────────────────────────────────────────

const truncate = (text, length = 1500) => (text.length > length ? `${text.slice(0, length)}…` : text);

function run(command, args, { cwd, timeoutMs }) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: timeoutMs, env: childEnv(), maxBuffer: 4 * 1024 * 1024 });
  return {
    ok: result.status === 0 && !result.error,
    output: truncate(`${result.stdout ?? ""}${result.stderr ?? ""}${result.error ? String(result.error.message) : ""}`),
  };
}

/**
 * `typecheck_passes`: `tsc -p tsconfig.json` in the project. Diagnostics inside `node_modules` are ignored: the
 * installed TypeScript sources are checked by the repository's own gates under its own settings, and the builder
 * cannot change them.
 */
export function typecheck(dir) {
  const result = spawnSync(join(REPO, "node_modules/.bin/tsc"), ["-p", "tsconfig.json"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 120_000,
    env: childEnv(),
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) return { ok: false, output: truncate(String(result.error.message)) };
  const lines = `${result.stdout ?? ""}${result.stderr ?? ""}`.split("\n");
  const own = lines.filter((line) => /\(\d+,\d+\): error TS\d+/.test(line) && !line.startsWith("node_modules/"));
  const ignored = lines.filter((line) => /\(\d+,\d+\): error TS\d+/.test(line) && line.startsWith("node_modules/")).length;
  return {
    ok: own.length === 0,
    output: truncate(own.join("\n") || (ignored > 0 ? `(${ignored} diagnostic(s) inside node_modules ignored)` : "")),
  };
}

function sourceFiles(dir) {
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "__acceptance__" || entry.name.startsWith(".")) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".ts") || entry.name.endsWith(".mjs") || entry.name.endsWith(".js")) files.push(path);
    }
  };
  walk(dir);
  return files;
}

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " ")).replace(/\/\/.*$/gm, (line) => " ".repeat(line.length));
}

const FROM_CLAUSE = /\b(?:import|export)\s+(?:type\s+)?([^'"`;]*?)\s*from\s*["']([^"']+)["']/g;
const BARE_IMPORT = /\bimport\s*["']([^"']+)["']/g;
const LITERAL_CALL = /\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g;
const NON_LITERAL = /\b(?:import|require)\s*\(\s*(?!["'])/g;
const BUILTINS = new Set(builtinModules);
const KERNEL_SUBPATHS = new Set(["manifest", "driver-kit", "provider-kit", "testing"]);
const REJECTED_PACKAGES = new Set(
  ["core", "coding-tools", "agent-sdk", "code", "web-tools", "memory", "work", "hooks", "all", "providers", "acp-agent", "office"].map(
    (name) => `@arnilo/prism-${name}`,
  ),
);

let packageIndex;
function allowedPackages() {
  packageIndex ??= new Map(repoPackages().map((pkg) => [pkg.name, pkg.subpaths]));
  return packageIndex;
}

/** Reasons a specifier leaves the public surface; `undefined` when it stays on it. */
export function classifySpecifier(spec, file, dir) {
  if (spec.startsWith(".")) {
    const target = resolve(dirname(file), spec);
    if (target !== dir && !target.startsWith(dir + sep)) return `relative import leaves the project: ${spec}`;
    if (target.includes(`${sep}node_modules${sep}`)) return `relative import reaches into node_modules: ${spec}`;
    return undefined;
  }
  if (spec.startsWith("node:") || spec.startsWith("bun:") || spec === "bun" || BUILTINS.has(spec)) return undefined;
  if (spec === "@arnilo/prism") return undefined;
  if (spec.startsWith("@arnilo/prism/")) {
    const sub = spec.slice("@arnilo/prism/".length);
    if (!KERNEL_SUBPATHS.has(sub)) return `kernel subpath is not public: ${spec}`;
    if (sub === "testing" && !/\.test\.ts$|__tests__/.test(file)) return `testing import outside a test: ${spec}`;
    return undefined;
  }
  const match = /^(@arnilo\/prism-[^/]+)(?:\/(.*))?$/.exec(spec);
  if (match) {
    if (REJECTED_PACKAGES.has(match[1])) return `retired package: ${spec}`;
    const subpaths = allowedPackages().get(match[1]);
    if (!subpaths) return `not a published Prism package: ${spec}`;
    if (match[2] && !subpaths.has(match[2])) return `deep or undeclared package path: ${spec}`;
    return undefined;
  }
  if (spec.startsWith("@arnilo/")) return `not a Prism package: ${spec}`;
  if (spec.includes("node_modules/")) return `path into node_modules: ${spec}`;
  return undefined;
}

/** `public_surface_only`: the reference-host allow-list rules, applied to the builder's project. */
export function surfaceViolations(dir) {
  const violations = [];
  for (const file of sourceFiles(dir)) {
    if (!file.endsWith(".ts")) continue;
    const text = stripComments(readFileSync(file, "utf8"));
    const where = relative(dir, file);
    if ([...text.matchAll(NON_LITERAL)].length > 0) violations.push(`${where}: non-literal dynamic import`);
    const specs = [...text.matchAll(FROM_CLAUSE)]
      .map((m) => m[2])
      .concat(
        [...text.matchAll(BARE_IMPORT)].map((m) => m[1]),
        [...text.matchAll(LITERAL_CALL)].map((m) => m[1]),
      );
    for (const spec of specs) {
      const reason = classifySpecifier(spec, file, dir);
      if (reason) violations.push(`${where}: ${reason}`);
    }
  }
  return violations;
}

/** Names an agent trained on 0.12 reaches for (docs/migrate-to-0.13.md). */
export const RETIRED_PATTERNS = [
  /@arnilo\/prism-(?:core|coding-tools|web-tools|memory|work|hooks|agent-sdk|code|all|providers|acp-agent|office)(?![\w-])/,
  /\bdefineAgent\b/,
  /\bactivateKernel\b/,
  /\bcreateExtensionKernel\b/,
  /\bcreateAgentSession\b/,
  /\bstopHooks\b/,
  /\btools\s*:\s*\{\s*use\b/,
  /\bstore\s*:\s*["']memory["']/,
  /\bidentity\s*:\s*\{\s*profile\b/,
  /\bextensions\s*:\s*\[/,
  /\bmiddleware\s*:/,
  /\bturnPolicy\b/,
  /\bguardrails\s*:/,
  /\bpromptBuilder\b/,
  /\binputBuilder\b/,
  /\btoolNarrowing\b/,
];

/** `no_retired_names`: retired 0.12 names in the builder's source. */
export function retiredNames(dir) {
  const hits = [];
  for (const file of sourceFiles(dir)) {
    const text = stripComments(readFileSync(file, "utf8"));
    for (const pattern of RETIRED_PATTERNS) {
      const found = pattern.exec(text);
      if (found) hits.push(`${relative(dir, file)}: ${found[0]}`);
    }
  }
  return hits;
}

/** `acceptance_tests_pass`: the hidden test is copied in only now, run, and removed. */
export function acceptance(dir, task, spec) {
  const required = spec.requireFiles ?? [];
  const missing = required.filter((file) => !existsSync(join(dir, file)));
  if (missing.length > 0) return { ok: false, output: `missing required file(s): ${missing.join(", ")}` };
  for (const [file, needles] of Object.entries(spec.requireContains ?? {})) {
    const text = existsSync(join(dir, file)) ? readFileSync(join(dir, file), "utf8") : "";
    for (const needle of needles) if (!text.includes(needle)) return { ok: false, output: `${file} does not mention ${needle}` };
  }
  const outputs = [];
  for (const own of spec.runOwnTests ?? []) {
    const own1 = run(process.execPath, ["test", own, "--timeout", "60000"], { cwd: dir, timeoutMs: 120_000 });
    outputs.push(`own tests (${own}): ${own1.ok ? "pass" : "fail"}\n${own1.ok ? "" : own1.output}`);
    if (!own1.ok) return { ok: false, output: outputs.join("\n") };
  }
  const folder = join(dir, "__acceptance__");
  mkdirSync(folder, { recursive: true });
  try {
    cpSync(join(HIDDEN, `${task}.test.ts`), join(folder, `${task}.test.ts`));
    const hidden = run(process.execPath, ["test", `__acceptance__/${task}.test.ts`, "--timeout", "60000"], {
      cwd: dir,
      timeoutMs: 180_000,
    });
    outputs.push(hidden.output);
    return { ok: hidden.ok, output: truncate(outputs.join("\n")) };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/** Every check on a finished workspace, as one JSON-serializable snapshot. */
export function checkWorkspace({ dir, task, spec }) {
  const check = typecheck(dir);
  const surface = surfaceViolations(dir);
  const retired = retiredNames(dir);
  const tests = acceptance(dir, task, spec);
  return { typecheck: check, surface: { violations: surface }, retired: { hits: retired }, acceptance: tests };
}

// ── scoring ────────────────────────────────────────────────────────────────────

const toolSteps = (timeline) => (timeline?.steps ?? []).filter((step) => step.kind === "tool");

export function toolCallCount(timeline) {
  return toolSteps(timeline).length;
}

export function loadedSkill(timeline) {
  return toolSteps(timeline).some((step) => step.name === "load_skill");
}

export function usedMcp(timeline) {
  return toolSteps(timeline).some((step) => String(step.name).startsWith("mcp:"));
}

function checkScorer(id, read) {
  return defineScorer({
    id,
    requires: ["environment", "timeline"],
    score: ({ environment, timeline }) => {
      // A provider or harness failure says nothing about the builder: throw so the record is `failed`, not a 0.
      // A run that hit a run limit is the builder failing the task: that scores 0.
      if (environment?.__run?.status === "failed" && !environment.__run.limited)
        throw new Error(`run failed: ${environment.__run.error ?? "unknown error"}`);
      const verdict = read(environment?.checks);
      return {
        score: verdict.pass ? 1 : 0,
        reason: verdict.reason,
        metadata: {
          toolCalls: toolCallCount(timeline),
          loadedSkill: loadedSkill(timeline),
          usedMcp: usedMcp(timeline),
          limited: environment?.__run?.limited === true,
          stopReason: environment?.__run?.stopReason,
        },
      };
    },
  });
}

export function createScorers() {
  return [
    checkScorer("typecheck_passes", (checks) => ({
      pass: checks?.typecheck?.ok === true,
      reason: checks?.typecheck?.ok ? undefined : truncate(checks?.typecheck?.output ?? "no checks", 300),
    })),
    checkScorer("acceptance_tests_pass", (checks) => ({
      pass: checks?.acceptance?.ok === true,
      reason: checks?.acceptance?.ok ? undefined : truncate(checks?.acceptance?.output ?? "no checks", 300),
    })),
    checkScorer("public_surface_only", (checks) => ({
      pass: (checks?.surface?.violations ?? ["no checks"]).length === 0,
      reason: (checks?.surface?.violations ?? []).slice(0, 3).join("; ") || undefined,
    })),
    checkScorer("no_retired_names", (checks) => ({
      pass: (checks?.retired?.hits ?? ["no checks"]).length === 0,
      reason: (checks?.retired?.hits ?? []).slice(0, 3).join("; ") || undefined,
    })),
    defineScorer({
      id: "tool_calls",
      requires: ["timeline"],
      score: ({ timeline }) => {
        const count = toolCallCount(timeline);
        return { score: 1 / (1 + count), metadata: { count } };
      },
    }),
  ];
}

// ── claim rules ────────────────────────────────────────────────────────────────

const unscoredCount = (report) => report.aggregate?.failedCount ?? 0;

/**
 * The pre-registered claim rules. A claim ("<candidate> improves <scorer> over <baseline>") needs a significant
 * improvement at alpha .05 from `compareExperiments`. A significant regression of either skill arm against `none`
 * blocks the plan. An uncomputable comparison or any unscored record is `inconclusive`, never a claim.
 */
export function decideClaims({ reports, criteria }) {
  const rule = criteria.claims;
  const unscored = Object.values(reports).reduce((sum, report) => sum + unscoredCount(report), 0);
  const comparisons = [];
  const claims = [];
  const regressions = [];
  for (const pair of rule.comparisons) {
    let result;
    try {
      result = compareExperiments(reports[pair.baseline], reports[pair.candidate], {
        scorers: rule.scorers,
        alpha: rule.alpha,
        seed: criteria.seed,
      });
    } catch (error) {
      return {
        verdict: "inconclusive",
        reason: `comparison ${pair.id} failed: ${error instanceof Error ? error.message : String(error)}`,
        comparisons,
        claims: [],
        regressions: [],
      };
    }
    const scorers = {};
    for (const id of rule.scorers) {
      const entry = result.scorers[id];
      if (!entry) continue;
      const improved = entry.significant === true && entry.difference > 0;
      const regressed = entry.significant === true && entry.difference < 0;
      scorers[id] = {
        difference: entry.difference,
        ci95: entry.ci95,
        qValue: entry.qValue,
        significant: entry.significant === true,
        improved,
        regressed,
      };
      if (improved)
        claims.push({
          comparison: pair.id,
          scorer: id,
          text: `${pair.candidate} improves ${id} over ${pair.baseline}`,
          difference: entry.difference,
        });
      if (regressed && pair.baseline === "none") regressions.push({ comparison: pair.id, scorer: id, difference: entry.difference });
    }
    comparisons.push({ id: pair.id, baseline: pair.baseline, candidate: pair.candidate, scorers });
  }
  if (unscored > 0)
    return {
      verdict: "inconclusive",
      reason: `${unscored} unscored record(s) from provider or harness failures; rerun`,
      comparisons,
      claims: [],
      regressions,
    };
  if (regressions.length > 0)
    return {
      verdict: "blocked",
      reason: `significant regression against none on ${regressions.map((r) => `${r.comparison}/${r.scorer}`).join(", ")}`,
      comparisons,
      claims: [],
      regressions,
    };
  return {
    verdict: claims.length > 0 ? "claims" : "no-claims",
    reason: claims.length > 0 ? `${claims.length} claim(s) passed` : "no significant improvement; nothing to claim",
    comparisons,
    claims,
    regressions,
  };
}

/** Round rule: a block in round 1 means fix and re-measure once; a block in round 2 goes to the owner. */
export function applyRound(decision, round) {
  if (decision.verdict !== "blocked") return decision.verdict;
  return round >= 2 ? "owner-decision" : "fix-and-remeasure";
}
