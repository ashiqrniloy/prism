#!/usr/bin/env bun
// The package-skill gate (plan 215 Task 7). Loads each workspace package that ships skills on a real agent,
// then checks every skill it registered against the authoring contract in docs/packages.md
// ("Writing a package skill"). Budgets live in scripts/budgets.json (`packageSkills`), retired tool names in
// scripts/retired-tool-names.json. Used by src/__tests__/package-skills.test.ts and `release:gate`.
//
//   timeout 120 bun scripts/package-skills-conformance.mjs --json
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadBudgets, wallClockBudget } from "./budget-gates.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SPEC_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const encoder = new TextEncoder();
const bytes = (text) => encoder.encode(text).byteLength;

/** One package-skill fixture: where the package lives and how to build the packages that exercise it. */
function fixture(dir, build, dependencies = []) {
  return { dir, build, dependencies };
}

/**
 * The fullest test config of each package that ships skills. A package that ships a skill and has no entry
 * here fails the gate (see {@link findUncoveredSkillPackages}), so a new skill package cannot be skipped.
 */
export function defaultFixtures(root = REPO_ROOT) {
  const load = async (path) => import(pathToFileURL(join(root, path)).href);
  return [
    fixture("packages/tools/research", async () => {
      const { toolsResearch } = await load("packages/tools/research/src/index.ts");
      return [toolsResearch({ sourceTools: ["web_fetch"] })];
    }),
    fixture("packages/tools/computer-use", async () => {
      const { definePackage } = await import("@arnilo/prism");
      const { toolsComputerUse } = await load("packages/tools/computer-use/src/index.ts");
      const { COMPUTER_USE_LINUX_TOOL_NAMES } = await load("packages/tools/computer-use/src/classify.ts");
      const remote = COMPUTER_USE_LINUX_TOOL_NAMES.map((name) => ({
        name,
        parameters: { type: "object", additionalProperties: true },
        execute: async (_args, ctx) => ({ toolCallId: ctx.toolCallId, name, value: true }),
      }));
      const bridge = { tools: remote, refresh: async () => {}, close: async () => {} };
      const probe = definePackage({
        name: "package-skills-gate-computer-use-bridge",
        version: "0.0.0",
        requires: { api: 1 },
        setup: (prism) => prism.services.provide("computer-use.mcp", async () => bridge),
      });
      return [
        probe,
        toolsComputerUse({
          command: process.execPath,
          device: { enabled: true, requireApproval: true, sandbox: "gate-desktop" },
          runLimits: { maxTurns: 8, maxToolCalls: 20 },
        }),
      ];
    }),
    fixture("packages/tools/web", async () => {
      const { toolsWeb } = await load("packages/tools/web/src/index.ts");
      // Search backend plus Firecrawl fetch and extract: the fullest set, `web_search`, `web_fetch` and `web_extract`.
      process.env.PRISM_SKILLS_GATE_FIRECRAWL_KEY = "package-skills-gate";
      return [
        toolsWeb({
          backend: "searxng",
          searxng: { origin: "https://search.example.org" },
          fetch: { backend: "firecrawl", apiKey: "env:PRISM_SKILLS_GATE_FIRECRAWL_KEY" },
          extract: { schema: { type: "object", properties: { price: { type: "number" } } } },
        }),
      ];
    }),
    fixture("packages/tools/browser", async () => {
      const { toolsBrowser } = await load("packages/tools/browser/src/index.ts");
      const { FakeBrowser } = await load("packages/tools/browser/src/__tests__/fake-playwright.ts");
      // The package imports `playwright-core` in setup; a virtual module hands it a fake so the gate launches no browser.
      Bun.plugin({
        name: "package-skills-gate-playwright",
        setup(build) {
          build.module("playwright-core", () => ({
            exports: { chromium: { launch: async () => new FakeBrowser() } },
            loader: "object",
          }));
        },
      });
      return [toolsBrowser({ headless: true })];
    }),
    fixture("packages/integrations/delegate", async () => {
      const { default: delegate } = await load("packages/integrations/delegate/src/index.ts");
      // One visible child registers `delegate`, `delegate_wait` and `delegate_cancel`; the child inherits no package.
      return [delegate({ children: { reviewer: { inherit: [], description: "Reviews a diff.", instructions: "Review the diff." } } })];
    }),
    fixture("packages/hosts/host-builder", async () => {
      // The published package registers nothing (it has no `setup`); the installer copies its skill into the project.
      // The gate registers it under the package's own name so the skill is checked exactly like a package skill.
      const { definePackage } = await import("@arnilo/prism");
      const skills = join(root, "packages/hosts/host-builder/skills");
      return [
        definePackage({
          name: "@arnilo/prism-host-builder",
          version: "0.0.0",
          requires: { api: 1 },
          setup: (prism) => prism.skills.addDir(skills),
        }),
      ];
    }),
    fixture("packages/tools/work", async () => {
      const { definePackage } = await import("@arnilo/prism");
      const { toolsWork } = await load("packages/tools/work/src/index.ts");
      const sandbox = definePackage({
        name: "package-skills-gate-work-sandbox",
        version: "0.0.0",
        requires: { api: 1 },
        setup: (prism) => prism.services.provide("work.sandbox", { capabilities: {}, execFile: async () => ({ exitCode: 0 }) }),
      });
      return [sandbox, toolsWork({ root: tmpdir() })];
    }),
  ];
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function walk(dir, visit) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "__tests__") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, visit);
    else visit(path);
  }
}

function workspacePackageDirs(root) {
  const dirs = [];
  for (const group of readdirSync(join(root, "packages"))) {
    const groupDir = join(root, "packages", group);
    if (!statSync(groupDir).isDirectory()) continue;
    for (const name of readdirSync(groupDir)) {
      if (existsSync(join(groupDir, name, "package.json"))) dirs.push(join(groupDir, name));
    }
  }
  return dirs;
}

/** Packages that load skills from the user's files and ship none of their own. */
const SKILL_LOADER_PACKAGES = ["packages/context/files"];

/**
 * Workspace packages that ship skills (a `skills/` directory, or a non-test source file that calls
 * `skills.addDir` / `skills.register`) and have no fixture. The gate fails closed on each.
 */
export function findUncoveredSkillPackages(fixtures, root = REPO_ROOT) {
  const covered = new Set([...fixtures.map((entry) => entry.dir), ...SKILL_LOADER_PACKAGES].map((dir) => resolve(root, dir)));
  const uncovered = [];
  for (const dir of workspacePackageDirs(root)) {
    if (covered.has(dir)) continue;
    let ships = existsSync(join(dir, "skills")) && statSync(join(dir, "skills")).isDirectory();
    if (!ships && existsSync(join(dir, "src"))) {
      walk(join(dir, "src"), (file) => {
        if (!ships && /\.(?:ts|mjs|js)$/.test(file) && /\bskills\.(?:addDir|register)\(/.test(readFileSync(file, "utf8"))) ships = true;
      });
    }
    if (ships) uncovered.push(relative(root, dir));
  }
  return uncovered;
}

/**
 * Every tool name a workspace package defines, found without loading it: a `name: "snake_case"` literal in
 * a non-test source file that also defines an `execute`. Used only to recognise a tool name in a skill body.
 */
export function scanWorkspaceToolNames(root = REPO_ROOT) {
  const names = new Set();
  for (const dir of workspacePackageDirs(root)) {
    if (!existsSync(join(dir, "src"))) continue;
    walk(join(dir, "src"), (file) => {
      if (!file.endsWith(".ts")) return;
      const text = readFileSync(file, "utf8");
      if (!/\bexecute\b/.test(text)) return;
      for (const match of text.matchAll(/\bname:\s*"([a-z][a-z0-9]*(?:_[a-z0-9]+)+)"/g)) names.add(match[1]);
    });
  }
  return names;
}

export function loadRetiredToolNames(root = REPO_ROOT) {
  const file = readJson(join(root, "scripts/retired-tool-names.json"));
  return new Map(file.tools.map((entry) => [entry.name, entry.retiredBy]));
}

/**
 * The backticked tokens of a skill body that name a tool, each with the tool names its enclosing
 * "If `<tool>` is available" heading covers (empty outside one). Fenced code blocks are skipped.
 */
export function bodyToolTokens(body) {
  const tokens = [];
  const stack = [];
  let fenced = false;
  for (const line of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
      const conditional = /^If\b.*\bis available\b/i.test(heading[2]);
      stack.push({ level, covers: conditional ? [...heading[2].matchAll(/`([^`]+)`/g)].map((m) => m[1].replace(/\(\)$/, "")) : [] });
    }
    const covered = new Set(stack.flatMap((entry) => entry.covers));
    const text = heading ? "" : line;
    for (const match of text.matchAll(/`([^`\n]+)`/g)) tokens.push({ token: match[1].trim().replace(/\(\)$/, ""), covered });
  }
  return tokens;
}

function skillBodyLeaks(body, description, redactSecrets) {
  const hits = [];
  const text = `${description}\n${body}`;
  if (/\b(?:env|keyring):[A-Za-z0-9_./-]+/.test(text)) hits.push("an env:/keyring: secret ref");
  if (redactSecrets(text, []) !== text) hits.push("text redactSecrets masks");
  return hits;
}

function filesCovers(files, relPath) {
  const posix = relPath.split(sep).join("/");
  return (files ?? []).some((entry) => {
    if (typeof entry !== "string" || entry.startsWith("!")) return false;
    const clean = entry.replace(/^\.\//, "").replace(/\/+$/, "");
    return posix === clean || posix.startsWith(`${clean}/`);
  });
}

/** One catalog line as `skillMessages` renders it, plus its newline. */
export function catalogLineBytes(skill) {
  const raw = (skill.description ?? "").trim() || "(no description)";
  return bytes(`- ${skill.name}: ${raw}\n`);
}

/**
 * The catalog an agent would render: the skills whose `requiresTools` the agent registers, capped at
 * `catalogEntriesMax` by the caller's budget check. `agent` is `{ name, skills: [{name, description,
 * requiresTools?}], tools: Iterable<string> }`.
 */
export function measureCatalog(agent) {
  const tools = new Set(agent.tools);
  const listed = agent.skills.filter((skill) => (skill.requiresTools ?? []).every((name) => tools.has(name)));
  return { name: agent.name, entries: listed.length, bytes: listed.reduce((sum, skill) => sum + catalogLineBytes(skill), 0) };
}

export function checkCatalogBudget(agents, budget) {
  const failures = [];
  const measured = agents.map(measureCatalog);
  for (const item of measured) {
    if (item.entries > budget.catalogEntriesMax)
      failures.push({
        package: item.name,
        check: "catalog_budget",
        message: `${item.entries} catalog entries exceed ${budget.catalogEntriesMax}`,
      });
    if (item.bytes > budget.catalogBytesMax)
      failures.push({
        package: item.name,
        check: "catalog_budget",
        message: `${item.bytes} catalog bytes exceed ${budget.catalogBytesMax}`,
      });
  }
  return { measured, failures };
}

/** Check one built fixture: `agent` is the real agent, `owners` the package names whose tools a skill may rely on. */
function checkSkills({ packageName, packageDir, agent, skills, owners, budget, retired, universe, redactSecrets }) {
  const failures = [];
  const fail = (skill, check, message) => failures.push({ package: packageName, ...(skill ? { skill } : {}), check, message });
  const pkgJson = readJson(join(packageDir, "package.json"));
  const registered = new Map();
  for (const tool of agent.tools) {
    if (!registered.has(tool.name)) registered.set(tool.name, tool.package);
  }
  const usable = new Set([...registered].filter(([, owner]) => owners.has(owner)).map(([name]) => name));

  const own = skills.filter((entry) => entry.owner === packageName);
  if (own.length === 0 && existsSync(join(packageDir, "skills"))) {
    fail(undefined, "load", "the package has a skills/ directory but registered no skill");
  }

  for (const { skill } of own) {
    const name = skill.name;
    const description = skill.description ?? "";
    const body = skill.instructions ?? "";
    // (1) parses: registration already parsed it; hold the Agent Skills name rule the parser is wider than.
    if (!SPEC_NAME.test(name) || name.length > 64) fail(name, "name", `"${name}" is not 1-64 lowercase letters, digits and hyphens`);
    if (skill.path && basename(dirname(skill.path)) !== name)
      fail(name, "name", `the name does not match its directory "${basename(dirname(skill.path))}"`);
    // (2) caps
    if (description.trim().length === 0) fail(name, "description", "a package skill needs a description");
    if (bytes(description) > budget.descriptionBytesMax)
      fail(name, "description", `${bytes(description)} description bytes exceed ${budget.descriptionBytesMax}`);
    const vendored = Boolean(skill.path) && skill.path.split(sep).includes("vendor") && budget.vendoredBodyExceptions.includes(name);
    if (!vendored && bytes(body) > budget.bodyBytesMax)
      fail(name, "body", `${bytes(body)} body bytes exceed ${budget.bodyBytesMax}; move detail into references/`);
    // (3) requiresTools are registered by this package or a declared dependency
    const required = skill.requiresTools ?? [];
    for (const tool of required) {
      if (!usable.has(tool))
        fail(name, "requires_tools", `requiresTools names "${tool}", which ${[...owners].join(" / ")} does not register`);
    }
    // (4) tool names in the body
    const seen = new Set();
    for (const { token, covered } of bodyToolTokens(body)) {
      if (seen.has(`${token}|${[...covered].join(",")}`)) continue;
      seen.add(`${token}|${[...covered].join(",")}`);
      if (retired.has(token)) {
        fail(name, "retired_tool", `the body names \`${token}\`, retired by ${retired.get(token)}`);
      } else if (registered.has(token) || universe.has(token)) {
        if (!usable.has(token))
          fail(name, "unregistered_tool", `the body names \`${token}\`, which ${[...owners].join(" / ")} does not register`);
        else if (!required.includes(token) && !covered.has(token))
          fail(name, "optional_tool", `the body names optional tool \`${token}\` outside an "If \`${token}\` is available" heading`);
      }
    }
    // security: no secret refs or maskable strings
    for (const hit of skillBodyLeaks(body, description, redactSecrets)) fail(name, "secret", `the skill contains ${hit}`);
    // (5) package.json `files` ships the skill
    if (skill.path) {
      const rel = relative(packageDir, skill.path);
      if (rel.startsWith("..")) fail(name, "files", "the skill file is outside its package directory");
      else if (!filesCovers(pkgJson.files, rel))
        fail(name, "files", `package.json "files" does not include ${rel.split(sep).slice(0, -2).join("/") || rel}`);
    }
  }
  return failures;
}

/**
 * Build the reference host's agents on the mock provider and measure their skill catalogs. Fails closed:
 * an agent that cannot be built is a failure, not a skip.
 */
export async function measureReferenceHostAgents(root = REPO_ROOT) {
  const scratch = mkdtempSync(join(tmpdir(), "prism-skills-gate-host-"));
  const agents = [];
  const disposers = [];
  try {
    const host = await import(pathToFileURL(join(root, "apps/prism-agent/src/host/index.ts")).href);
    const { writeObscuraFixture } = await import(
      pathToFileURL(join(root, "apps/prism-agent/src/scenarios/fixtures/obscura-fixture.ts")).href
    );
    mkdirSync(join(scratch, "workspace"), { recursive: true });
    const model = { provider: "mock", model: "m", limits: { contextWindow: 64_000, maxOutputTokens: 0 } };
    const config = {
      models: { orchestrator: model, coding: model, research: model },
      storePath: join(scratch, "sessions.db"),
      workspace: join(scratch, "workspace"),
      approval: "ask",
      web: { backend: "obscura", obscuraBinary: writeObscuraFixture(scratch) },
      maxRepairs: 1,
    };
    const builders = { coding: host.createCodingWorker, research: host.createResearchWorker, orchestrator: host.createOrchestrator };
    for (const [name, build] of Object.entries(builders)) {
      const agent = await build(config);
      disposers.push(() => agent.dispose());
      agents.push({ name: `apps/prism-agent ${name}`, skills: agent.skills, tools: agent.tools.map((tool) => tool.name) });
    }
    return agents;
  } finally {
    for (const dispose of disposers) await dispose().catch(() => {});
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Run the gate. `fixtures` and `retired` are injectable so the test can build failing variants;
 * `referenceHost: false` skips the host catalog budget.
 */
export async function runPackageSkillsGate(options = {}) {
  const root = options.root ?? REPO_ROOT;
  const started = performance.now();
  const budget = (options.budgets ?? loadBudgets()).packageSkills;
  const retired = options.retired ?? loadRetiredToolNames(root);
  const fixtures = options.fixtures ?? defaultFixtures(root);
  const failures = [];
  const packages = [];
  const { createAgent, redactSecrets } = await import("@arnilo/prism");
  const { agentSkillSource } = await import("../src/agent-session/runtime-registry.ts");
  const { tryAgentRuntime } = await import("../src/agent-session/runtime-registry.ts");

  for (const uncovered of options.fixtures ? [] : findUncoveredSkillPackages(fixtures, root)) {
    failures.push({
      package: uncovered,
      check: "fixture",
      message: "ships skills but has no entry in defaultFixtures(); add its fullest test config",
    });
  }

  const built = [];
  for (const entry of fixtures) {
    const packageDir = resolve(root, entry.dir);
    const packageName = readJson(join(packageDir, "package.json")).name;
    let agent;
    try {
      agent = await createAgent({ model: { provider: "mock", model: "m" }, packages: await entry.build() });
    } catch (error) {
      failures.push({
        package: packageName,
        check: "load",
        message: `setup failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    const owners = new Map((tryAgentRuntime(agent)?.packages.skillEntries() ?? []).map((item) => [item.skill.name, item.owner]));
    const skills = agentSkillSource(agent).map((skill) => ({ skill, owner: owners.get(skill.name) ?? "host" }));
    built.push({ entry, packageName, packageDir, agent, skills });
  }

  try {
    const universe = scanWorkspaceToolNames(root);
    for (const item of built) for (const tool of item.agent.tools) universe.add(tool.name);
    const owned = new Map();
    for (const item of built) {
      const owners = new Set([item.packageName, ...item.entry.dependencies]);
      failures.push(...checkSkills({ ...item, owners, budget, retired, universe, redactSecrets }));
      const own = item.skills.filter((skill) => skill.owner === item.packageName);
      packages.push({ package: item.packageName, skills: own.map(({ skill }) => skill.name) });
      // (6) no two packages ship the same skill name
      for (const { skill } of own) {
        const first = owned.get(skill.name);
        if (first && first !== item.packageName)
          failures.push({ package: item.packageName, skill: skill.name, check: "duplicate", message: `also shipped by ${first}` });
        else owned.set(skill.name, item.packageName);
      }
    }
  } finally {
    for (const item of built) await item.agent.dispose().catch(() => {});
  }

  let hostAgents = [];
  if (options.referenceHost !== false) {
    try {
      hostAgents = options.hostAgents ?? (await measureReferenceHostAgents(root));
      failures.push(...checkCatalogBudget(hostAgents, budget).failures);
    } catch (error) {
      failures.push({
        package: "apps/prism-agent",
        check: "catalog_budget",
        message: `could not build the reference host agents: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  const ms = Math.round(performance.now() - started);
  const ceiling = wallClockBudget(budget.gateMsCeiling);
  if (ms > ceiling) failures.push({ package: "package-skills-gate", check: "time", message: `${ms} ms exceeds the ${ceiling} ms ceiling` });
  return { ok: failures.length === 0, ms, packages, catalogs: hostAgents.map(measureCatalog), failures };
}

async function main() {
  const json = process.argv.includes("--json");
  const report = await runPackageSkillsGate();
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    for (const item of report.packages) console.log(`${item.package}: ${item.skills.join(", ") || "(no skills)"}`);
    for (const item of report.catalogs) console.log(`${item.name}: ${item.entries} entries, ${item.bytes} bytes`);
    for (const failure of report.failures)
      console.error(`FAIL ${failure.package}${failure.skill ? `/${failure.skill}` : ""} [${failure.check}] ${failure.message}`);
    console.log(
      report.ok ? `package skills conform (${report.ms} ms)` : `package skills do not conform (${report.failures.length} failures)`,
    );
  }
  process.exitCode = report.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
