import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join, normalize, relative, sep } from "node:path";
import { classify, referenceHostPackages } from "./reference-host-allowlist.js";

const docsDir = "docs";

/** One transport's evidence from `examples/serve-tools.ts`, as the demo prints it. */
interface ServedLegEvidence {
  readonly transport: string;
  readonly tools: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly listed: readonly string[];
  readonly allowedEdit: { readonly isError: boolean; readonly replaced: boolean };
  readonly read: { readonly isError: boolean; readonly text: string };
  readonly declinedEdit: { readonly isError: boolean; readonly denied: boolean };
  readonly permission: { readonly denied: string; readonly allowed: string };
  readonly outsideAllowList: { readonly refused: boolean };
  readonly afterClose: { readonly refused: boolean };
}

// Plan 068: freeze = current-line contract, not changelog. Historical phrases live
// in freezeCorpus() (migration/release/readiness/performance + docs/history/).
// index.md is asserted only for the current package version, live hrefs, and
// archive links (_evidence/, history/).

const apiPages = [
  "docs/operations.md",
  "docs/disaster-recovery.md",
  "docs/hooks.md",
  "docs/manifest.md",
  "docs/models.md",
  "docs/provider-kit.md",
  "docs/testing.md",
  "docs/coding-security.md",
  "docs/node-filesystem-config.md",
  "docs/resource-loading.md",
  "docs/credentials-and-redaction.md",
  "docs/settings-auth-trust-security.md",
  "docs/host-security.md",
  "docs/performance.md",
  "docs/migration.md",
];

const requiredHeadings = [
  "## What it does",
  "## When to use it",
  "## Inputs / request",
  "## Outputs / response / events",
  "## Request/response example",
  "## Implementation example",
  "## Extension and configuration notes",
  "## Security and performance notes",
  "## Related APIs",
];

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "dist") return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
  });
}

function isArchivedDoc(relative: string): boolean {
  return relative.startsWith("_evidence/") || relative.startsWith("history/");
}

function freezeCorpus(): string {
  const roots = ["docs/migration.md", "docs/performance.md", "docs/migrate-to-0.5.md", "docs/migrate-to-0.6.md"];
  const history = existsSync("docs/history") ? markdownFiles("docs/history") : [];
  return [...roots.filter((f) => existsSync(f)), ...history].map((f) => readFileSync(f, "utf8")).join("\n");
}

// Plan 070 Task 15: the root `bun run test` entry is a one-line delegate to
// scripts/run-all-tests.mjs, so "is this gate wired into bun run test?" must read the
// runner's stage list too — `package.json` alone no longer names any gate file.
function npmTestChain(): string {
  return `${readFileSync("package.json", "utf8")}\n${readFileSync("scripts/run-all-tests.mjs", "utf8")}`;
}

// Plan 068 Task 3: the live page keeps the current-line contract; per-era records
// moved to docs/history/. Presence asserts read the live+archive union so frozen
// phrases survive the split. Absence asserts keep reading the live file only.
function withHistory(live: string, match: (file: string) => boolean): string {
  const parts = [readFileSync(live, "utf8")];
  if (existsSync("docs/history")) {
    for (const f of markdownFiles("docs/history")) {
      if (match(f)) parts.push(readFileSync(f, "utf8"));
    }
  }
  return parts.join("\n");
}
// Plan 125 Task 4: the 0.1.x Node support story moved to the archive, so the live+archive
// union carries the era phrases the 0.1.x-era gates pin (presence only; absence asserts read the
// live file directly).
const releaseDoc = () => withHistory("docs/release.md", (f) => /(?:release-handoffs|retire-node-runtime)\.md$/.test(f));

// Plan 125 Task 1 flipped the live manifests to `engines.bun`, so the era's declared Node floor is
// read from the immutable support-matrix record (scripts/phase12-freeze-manifest.json) rather than
// from package.json. The page rows these helpers pin are the 0.1.x matrix section, kept as the era
// record; the live runtime contract is Bun.
function _declaredEngines(): string {
  return (JSON.parse(readFileSync("scripts/phase12-freeze-manifest.json", "utf8")) as { support: { node: { enginesRange: string } } })
    .support.node.enginesRange;
}
const readinessDoc = () => withHistory("docs/history/0.1.0-readiness.md", () => false);

/** Every workspace package directory, one level under `packages/` and grouped one level deeper. */
function workspaceDirs(): string[] {
  const dirs: string[] = [];
  // Plan 157 Task 3: a package may nest inside a family directory (`packages/memory/compaction`), so the
  // walk descends one level past a manifest instead of stopping there.
  const walk = (dir: string, depth: number) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "node_modules" || entry.name === "dist") continue;
      const child = join(dir, entry.name);
      if (existsSync(join(child, "package.json"))) dirs.push(child);
      if (depth < 2) walk(child, depth + 1);
    }
  };
  walk("packages", 0);
  return dirs;
}

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("docs", () => {
  it("index links point to existing local markdown files", () => {
    const index = readFileSync("docs/index.md", "utf8");
    const links = [...index.matchAll(/\[[^\]]+\]\(([^)]+\.md)(?:#[^)]+)?\)/g)].map((match) => match[1]);

    assert.ok(links.length > 0);
    for (const link of links) {
      assert.equal(existsSync(normalize(join(docsDir, link))), true, `missing docs link: ${link}`);
    }
  });

  // Plan 173 Task 9: the reference host's walkthrough is a guide linked from the
  // index, its snippets must import only the boundary gate's allow-list, and it
  // must show credential refs only.
  it("docs_index_links_reference_host_walkthrough", () => {
    const index = readFileSync("docs/index.md", "utf8");
    const href = "../apps/prism-agent/README.md";
    assert.ok(index.includes(`](${href})`), `docs/index.md must link the reference host walkthrough ${href}`);
    assert.equal(existsSync(normalize(join(docsDir, href))), true, `missing walkthrough ${href}`);
  });

  it("reference_host_readme_snippets_use_public_imports", () => {
    const readmePath = "apps/prism-agent/README.md";
    const readme = readFileSync(readmePath, "utf8");
    const appRoot = join(process.cwd(), "apps/prism-agent");
    const file = join(appRoot, "README.md");
    const packages = referenceHostPackages(process.cwd());
    const blocks = [...readme.matchAll(/```ts\n([\s\S]*?)```/g)].map((match) => match[1]!);
    assert.ok(blocks.length > 0, `${readmePath} must carry at least one ts snippet`);
    const specs = blocks.flatMap((block) => [
      ...[...block.matchAll(/\bimport\s+(?:type\s+)?[^'"`;]*?\s+from\s+["']([^"']+)["']/g)].map((match) => match[1]!),
      ...[...block.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]!),
    ]);
    assert.ok(specs.length > 0, `${readmePath} snippets must import the host's packages`);
    for (const spec of specs) {
      const reason = classify(spec, file, appRoot, packages);
      assert.equal(reason, undefined, `${readmePath} snippet import ${spec} is not on the reference-host allow-list: ${reason}`);
    }
  });

  it("reference_host_readme_has_no_literal_secret", () => {
    const readmePath = "apps/prism-agent/README.md";
    const readme = readFileSync(readmePath, "utf8");
    for (const pattern of [
      /\bsk-[A-Za-z0-9_-]{8,}/g,
      /\bAKIA[0-9A-Z]{16}\b/g,
      /\bghp_[A-Za-z0-9]{20,}\b/g,
      /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
    ]) {
      const found = [...readme.matchAll(pattern)].map((match) => match[0]);
      assert.deepEqual(found, [], `${readmePath} contains a literal secret: ${found.join(", ")}`);
    }
    for (const match of readme.matchAll(/"apiKey"\s*:\s*"([^"]*)"/g)) {
      assert.match(match[1]!, /^(?:env:|keyring:)/, `${readmePath} apiKey must be a ref, got ${match[1]}`);
    }
  });

  // ponytail: guard against plan-022 regression — the buggy pattern
  // `const { api } = createExtensionKernel(); api.registerProviderPackage(...)`
  // throws on copy-paste because createExtensionKernel() returns
  // { registries, middleware, events, load } with no `api` property.
  it("all shipped markdown links resolve locally", () => {
    const files = [
      "README.md",
      "examples/README.md",
      ...markdownFiles("docs").filter((f) => !f.startsWith("docs/history/") && !f.startsWith("docs/_evidence/")),
      ...markdownFiles("packages"),
    ];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        const href = match[1]!.split("#")[0]!;
        if (!href || /^(?:https?:|mailto:)/.test(href)) continue;
        assert.ok(existsSync(normalize(join(dirname(file), href))), `${file} has broken local link ${href}`);
      }
    }
  });

  it("no broken createExtensionKernel() destructure with api.registerProviderPackage", () => {
    const files = ["README.md", ...markdownFiles("docs")];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      assert.ok(
        !text.includes("const { api } = createExtensionKernel()"),
        `${file} still has the broken 'const { api } = createExtensionKernel()' snippet`,
      );
    }
  });

  // ponytail: plan 023 Task 4 guard — no bare `prism` import/install specifiers
  // remain in shipped docs; core is `@arnilo/prism`. The `prism` CLI bin name and
  // `~/.prism` paths are allowed (brand/path, not specifiers).
  it("no bare 'prism' import/install specifiers in README or docs", () => {
    const files = ["README.md", ...markdownFiles("docs")];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const offenders = [
        ...text.matchAll(/from "prism"(?!\b)/g),
        ...text.matchAll(/from "prism\//g),
        ...text.matchAll(/npm install prism\b(?![-.])/g),
        ...text.matchAll(/"prism":(?!"\/cli\.js")/g),
      ];
      assert.equal(offenders.length, 0, `${file} has bare 'prism' specifier(s)`);
    }
  });

  // ponytail: plan 023 Task 7 guard — no old-scope `@prism/` specifiers remain
  // after the re-scope to `@arnilo/`. Double regression guard against re-scoping drift.
  it("no old-scope '@prism/' specifiers in README or docs", () => {
    const files = ["README.md", ...markdownFiles("docs")];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const offenders = [...text.matchAll(/@prism\//g)];
      assert.equal(offenders.length, 0, `${file} has old-scope '@prism/' specifier(s)`);
    }
  });

  it("api pages include required headings", () => {
    const pages = [...apiPages];
    for (const page of pages) {
      const text = readFileSync(page, "utf8");
      for (const heading of requiredHeadings) assert.ok(text.includes(heading), `${page} missing ${heading}`);
    }
  });

  // plan 068 Task 4: the index is a current-line link map — no stale readiness
  // claims, no retired package names presented as live installables.
  // `@arnilo/prism-evals` is not in this list: plan 162 Task 3 reintroduced the name as the live evals host library.
  it("docs index has no stale readiness claim or retired package as live", () => {
    const index = readFileSync("docs/index.md", "utf8");
    assert.ok(!index.includes("**0.2.5** current line"), "docs/index.md must not claim a 0.2.5 current line");
    for (const retired of [
      "@arnilo/prism-all",
      "@arnilo/prism-prompts",
      "@arnilo/prism-browser",
      "@arnilo/prism-work-tools",
      "@arnilo/prism-coding-security",
      "@arnilo/prism-impeccable",
    ]) {
      assert.ok(!index.includes(retired), `docs/index.md must not name retired package ${retired} as live`);
    }
  });

  it("docs index contains exactly one navigation link per documentation page", () => {
    const index = readFileSync("docs/index.md", "utf8");
    for (const page of markdownFiles("docs")) {
      const relative = page.replace(/^docs\//, "");
      // archived evidence (docs/_evidence/) and history (docs/history/) are
      // tarball-excluded / off hot-path and linked as one archive entry each
      // (plan 015 Task 2, plan 068 Task 2)
      if (["index.md", "api-page-template.md"].includes(relative) || isArchivedDoc(relative)) continue;
      const escaped = relative.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const links = index.match(new RegExp(`\\(${escaped}(?:#[^)]+)?\\)`, "g")) ?? [];
      assert.equal(links.length, 1, `${page} must have exactly one docs/index.md navigation link`);
    }
  });

  // The kernel pages that were staged under docs/next/ before the 0.13.0 cut. They do not all follow the
  // 0.12 API-page template, so they sit outside `apiPages` and get the checks below instead.
  const kernelPages = [
    "agent",
    "agent-adapters",
    "decisions",
    "drivers",
    "events",
    "hooks",
    "host",
    "loop",
    "manifest",
    "models",
    "packages",
    "provider-kit",
    "release",
    "slots",
    "testing",
    "tools",
  ].map((name) => `docs/${name}.md`);

  it("docs_next_is_promoted", () => {
    assert.equal(existsSync("docs/next"), false, "docs/next must not exist");
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { files: string[] };
    assert.equal(
      pkg.files.some((f) => f.includes("docs/next")),
      false,
      "package.json files must not mention docs/next",
    );
    const index = readFileSync("docs/index.md", "utf8");
    for (const page of kernelPages) {
      assert.ok(existsSync(page), `${page} is missing`);
      assert.ok(apiPages.includes(page) || kernelPages.includes(page), `${page} must be a checked page`);
      assert.equal(index.includes(`(${page.replace("docs/", "")})`), true, `docs/index.md must link ${page}`);
      const text = readFileSync(page, "utf8");
      assert.equal(/staged for the next release/i.test(text), false, `${page} still carries the staged banner`);
      assert.equal(/\bPhase \d+\b|\bplan \d{3}\b/.test(text), false, `${page} carries phase or plan narrative`);
    }
  });

  it("released_docs_describe_the_kernel_contract", () => {
    const agent = readFileSync("docs/agent.md", "utf8");
    assert.match(agent, /createAgent\(\{[^}]*packages/s, "docs/agent.md must document createAgent with packages");
    for (const page of markdownFiles("docs")) {
      if (isArchivedDoc(page.replace(/^docs\//, "")) || page === "docs/index.md") continue;
      if (page.startsWith("docs/migrat")) continue;
      const text = readFileSync(page, "utf8");
      if (!kernelPages.includes(page)) continue;
      assert.equal(/\bdefineAgent\b|\bExtensionAPI\b/.test(text), false, `${page} presents a retired name as current`);
    }
  });

  it("retired_docs_live_under_history", () => {
    const retired = [
      "a2a",
      "acp-agent",
      "agent-definitions",
      "agent-sdk",
      "batch-jobs",
      "conversations",
      "core",
      "enterprise-postgres-state",
      "impeccable",
      "language-intelligence",
      "moderation",
      "options-index",
      "prism-code",
      "process-sessions",
      "prompt-registry",
      "realtime-voice",
      "server",
      "synapta-integration-review",
      "use-case-model-selection",
    ];
    const archive = readFileSync("docs/history/README.md", "utf8");
    for (const name of retired) {
      assert.ok(existsSync(`docs/history/${name}-0.12.md`), `docs/history/${name}-0.12.md is missing`);
      assert.ok(!existsSync(`docs/${name}.md`), `docs/${name}.md must stay retired`);
      assert.ok(archive.includes(`${name}-0.12.md`), `docs/history/README.md must list ${name}-0.12.md`);
    }
  });

  // Plan 175 Task 6: the migration note must name the 0.12.1 public names the cut
  // retires. The full 0.12.1 -> 0.13.0 baseline diff is thousands of names (most of
  // them internal type aliases), so this cross-checks the mechanism-level set the
  // note maps against the frozen v0.12.1 surface instead of enumerating every alias.
  it("migration_note_names_every_removed_export", () => {
    const note = readFileSync("docs/migrate-to-0.13.md", "utf8");
    const retired = [
      "createAgentSession",
      "defineAgent",
      "createExtensionKernel",
      "ExtensionAPI",
      "runRpcServer",
      "parseRpcRequest",
      "runPromptMode",
      "CLI_PROVIDERS",
      "CheckpointStore",
      "LeaseStore",
      "createMemoryCheckpointStore",
      "createMemoryLeaseStore",
      "CheckpointConflictError",
      "LeaseConflictError",
      "createAgentRunLifecycle",
      "resumeAgentRun",
      "resumeAgentRunStream",
      "loadAgentRunState",
      "createEventMultiplexer",
      "runCheckpointRestoreHooks",
      "prepareRunFeedback",
      "describeStorage",
      "resolveDevicePolicy",
      "checkCitationIntegrity",
      "createWorkflowInstrumentation",
      "createTimelineFolder",
      "summarizeTimeline",
      "createRagTelemetry",
      "defineWorkflow",
      "runWorkflow",
      "replayWorkflow",
      "snapshotRunBundle",
      "resolveUseCaseModel",
      "createCacheTelemetry",
      "createProviderCapture",
      "createMemoryPersistenceLifecycle",
      "resolveAgentDefinition",
      "createStaticSettingsProvider",
      "createBatchedRunLedger",
      "applyCacheControl",
      "applyDefaultProviderRequestOptions",
      "DelegationTelemetry",
      "createMemoryAgentEventSource",
      "CommandDefinition",
      "CommandExecutionContext",
      "CommandDrivers",
      "CommandWorkflowRun",
      "CommandResult",
    ];
    const packages = [
      "@arnilo/prism-agent-sdk",
      "@arnilo/prism-core",
      "@arnilo/prism-providers",
      "@arnilo/prism-coding-tools",
      "@arnilo/prism-web-tools",
      "@arnilo/prism-memory",
      "@arnilo/prism-work",
      "@arnilo/prism-hooks",
      "@arnilo/prism-code",
      "@arnilo/prism-acp-agent",
      "@arnilo/prism-office",
    ];
    // Read the frozen 0.12.1 surface so the cross-check cannot drift to names that
    // never shipped. CI checkouts may be shallow (no tags), so the baseline leg is
    // best-effort; the note must name every retired name either way.
    const tree = spawnSync("git", ["ls-tree", "--name-only", "v0.12.1", "scripts/compat-baseline/"], { encoding: "utf8" });
    if (tree.status === 0) {
      const publicNames = new Set<string>();
      for (const file of tree.stdout.split("\n").filter(Boolean)) {
        const shown = spawnSync("git", ["show", `v0.12.1:${file}`], { encoding: "utf8" });
        for (const row of shown.stdout.split("\n")) {
          const name = row.split("\t")[0];
          if (name) publicNames.add(name);
        }
      }
      assert.ok(publicNames.size > 500, `the 0.12.1 baseline must enumerate the surface, got ${publicNames.size}`);
      const fromBaseline = retired.filter((name) => publicNames.has(name));
      assert.ok(fromBaseline.length >= 30, `the retired list must cross-check the baseline, matched ${fromBaseline.length}`);
    }
    const missing = [...retired, ...packages].filter((name) => !note.includes(name));
    assert.deepEqual(missing, [], "docs/migrate-to-0.13.md must name every retired name");
  });

  it("changelog_has_0_13_0_section", () => {
    const changelog = readFileSync("CHANGELOG.md", "utf8");
    assert.match(changelog, /^## \[0\.13\.0\] - \d{4}-\d{2}-\d{2}$/m, "CHANGELOG.md must carry a dated 0.13.0 section");
    assert.match(changelog, /^## \[Unreleased\]$/m, "a fresh Unreleased section stays on top");
    const section = changelog.slice(changelog.indexOf("## [0.13.0]"), changelog.indexOf("## [0.12.1]"));
    assert.ok(section.length > 0, "the 0.13.0 section must precede 0.12.1");
    for (const heading of ["### Added", "### Changed", "### Removed"]) {
      assert.ok(section.includes(heading), `the 0.13.0 section is missing ${heading}`);
    }
  });

  it("index_links_every_package_readme", () => {
    const index = readFileSync("docs/index.md", "utf8");
    const dirs: string[] = [];
    const walk = (dir: string) => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        if (!ent.isDirectory() || ent.name === "node_modules") continue;
        const full = join(dir, ent.name);
        if (existsSync(join(full, "package.json"))) dirs.push(full);
        else walk(full);
      }
    };
    walk("packages");
    assert.ok(dirs.length > 0);
    for (const dir of dirs) {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { private?: boolean };
      if (pkg.private) continue;
      assert.ok(index.includes(`(../${dir}/README.md)`), `docs/index.md must link ${dir}/README.md`);
    }
    assert.ok(index.includes("(../apps/prism-agent/README.md)"), "docs/index.md must link the Prism Agent walkthrough");
  });

  it("archived history/ and _evidence/ prefixes skip one-link indexing", () => {
    assert.equal(isArchivedDoc("history/migration-0.0.md"), true);
    assert.equal(isArchivedDoc("_evidence/foo.md"), true);
    assert.equal(isArchivedDoc("rag.md"), false);
  });

  // ponytail: historical 82-plan archive deleted; assert active plans/ only.
  it("plans index links every active numbered plan", () => {
    assert.ok(existsSync("plans/README.md"), "plans/README.md missing");
    const index = readFileSync("plans/README.md", "utf8");
    const plans = readdirSync("plans").filter((name) => /^\d{3}-.+\.md$/.test(name));
    assert.ok(plans.length >= 1, "expected at least one active numbered plan");
    for (const plan of plans) {
      assert.ok(index.includes(`(${plan})`) || index.includes(plan), `plans/README.md missing ${plan}`);
    }
  });

  // plan 013 Task 4: the canonical manifest-count statement lives in the
  // generated package-truth blocks of docs/release.md; the stale
  // off-by-one strings must not appear anywhere except docs/migration.md
  // (historical release records are kept verbatim). Authoritative source:
  // node scripts/package-truth.mjs --emit-docs + the generated-block equality
  // test in scripts/truth-current.test.mjs.
  it("canonical manifest-count narrative: one statement, no stale counts", () => {
    const canonical = readFileSync("docs/release.md", "utf8");
    const truth = JSON.parse(readFileSync("scripts/package-truth.json", "utf8"));
    for (const token of [
      `**${truth.counts.publishable} publishable manifests**`,
      `${truth.counts.workspace} workspace packages`,
      `${truth.counts.provider} provider adapters`,
      `${truth.counts.prismFamily} \`prism-*\` family packages`,
      `${truth.counts.capability} capability packages`,
      "bun scripts/package-truth.mjs",
      "scripts/package-truth.json",
    ]) {
      assert.ok(canonical.includes(token), `release.md missing canonical token: ${token}`);
    }
    const stale = [/forty-one first-party capability/, /six pure-manifest family\/profile/];
    for (const file of ["README.md", ...markdownFiles("docs")]) {
      if (file === "docs/migration.md" || file.startsWith("docs/history/")) continue;
      const text = readFileSync(file, "utf8");
      for (const pattern of stale) {
        assert.doesNotMatch(text, pattern, `${file} contains stale manifest-count string: ${pattern}`);
      }
    }
  });

  // Plan 024 Task 4: docs truth is derived from scripts/package-truth.json (the
  // manifest-derived single source), never pinned verbatim — an editorial
  // reword that keeps the derived value passes; a wrong count/closure/version
  // fails. If a membership change (0.3.0) alters the artifact, these tests
  // force the docs to follow.
  describe("plan 024 Task 4: docs truth derived from the generated artifact", () => {
    const truth = JSON.parse(readFileSync("scripts/package-truth.json", "utf8")) as {
      counts: { publishable: number; workspace: number; provider: number; prismFamily: number; capability: number };
      providers: string[];
      umbrella: {
        "prism-providers": { deps: string[]; subpaths?: string[]; omitsProviders: string[] };
        [key: string]: unknown;
        "prism-all"?: { deps: string[]; closure: number; omits: string[] };
      };
      profiles: Record<string, string[]>;
      versions: Record<string, string>;
    };
    const read = (file: string) => readFileSync(file, "utf8");
    const release = read("docs/release.md");

    it("canonical count statement equals the generated counts", () => {
      assert.ok(
        release.includes(`**${truth.counts.publishable} publishable manifests**`),
        `canonical publishable count must be ${truth.counts.publishable}`,
      );
      assert.ok(
        release.includes(`${truth.counts.workspace} workspace packages`),
        `canonical workspace count must be ${truth.counts.workspace}`,
      );
      assert.ok(
        release.includes(`${truth.counts.provider} provider adapters`),
        `canonical provider count must be ${truth.counts.provider}`,
      );
      assert.ok(
        release.includes(`${truth.counts.prismFamily} \`prism-*\` family packages`),
        `canonical family/profile count must be ${truth.counts.prismFamily}`,
      );
      assert.ok(
        release.includes(`${truth.counts.capability} capability packages`),
        `canonical capability count must be ${truth.counts.capability}`,
      );
    });

    it("plan 057 Task 5: retired 0.3-era package names stay out of current docs", () => {
      // Retired names = the phase54 package-map evidence table (the
      // consolidation spec's 55 retired manifests; draft names that were never
      // published are exempt because migration-scoped notes may name them).
      // History stays verbatim: exempt pages (migration records, the
      // self-declared 0.1.x readiness record) and lines tied to dated records
      // (release decisions, plan/phase cites, version-pinned tags).
      const retired = [...readFileSync("docs/_evidence/phase54-package-map.md", "utf8").matchAll(/^\| `(@arnilo\/prism-[a-z0-9-]+)` \|/gm)]
        .map((m) => m[1])
        // Current packages and never-published draft names are not retired. Plan 173 Task 8: the
        // Prism Code app left the repo but is not a retired 0.3 name — it is the published 0.4.1 app,
        // kept on npm until Phase 11, and the released pages still name it.
        .filter((n) => !/prism-(documents|sheets|diagrams)$/.test(n) && !(n in truth.versions) && n !== "@arnilo/prism-code");
      // 55 legacy names were retired in 0.4; the
      // two `@arnilo/prism-provider-<vendor>` packages (hyper, opencode-go, typesafe, laya) are current
      // manifests, so the live-docs sweep covers the 50 names that are not
      // publishable. The 55-entry legacy registry plan stays frozen in the evidence file
      // and is asserted by the packaging suite. (`@arnilo/prism-providers` itself is not in
      // this list: the phase54 table names it in a numbered row, not the first-cell form the
      // derivation matches — `no_workspace_imports_prism_providers` guards it instead.)
      assert.ok(retired.length === 50, `phase54 evidence must enumerate the 50 retired 0.3 packages, got ${retired.length}`);
      const exemptPages = new Set(["docs/migration.md"]); // per-era records live under docs/history/ (skipped above)
      // Lines tied to dated records (release decisions, plan/phase cites, version-pinned tags) or to
      // an explicit `formerly` alias stay exempt: the alias records where a package moved from, it
      // does not present the retired name as current.
      const historyLine =
        /@arnilo\/prism[\w-]*@\d+\.\d+\.\d+|\*\*Decision: GO|\bplan \d{3}\b|\bPhase \d+\b|lockstep|historical|\bretired\b|formerly|replaces `@arnilo\/prism-all`|deleting the `@arnilo\/prism-[\w-]+` profile|at exact `0\.\d|\b0\.0\.1\d+`? (?:graph|line)/;
      const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      for (const file of ["README.md", ...markdownFiles("docs")]) {
        if (file.startsWith("docs/_evidence/") || file.startsWith("docs/history/") || exemptPages.has(file)) continue;
        read(file)
          .split("\n")
          .forEach((line, i) => {
            if (historyLine.test(line)) return;
            for (const name of retired) {
              assert.doesNotMatch(
                line,
                new RegExp(`${esc(name)}(?![-A-Za-z0-9])`),
                `${file}:${i + 1} references retired package ${name} as current`,
              );
            }
          });
      }
    });

    it("install-profile rows exist for every generated profile", () => {
      for (const profile of Object.keys(truth.profiles)) {
        assert.ok(release.includes(`@arnilo/${profile}`), `release page must have an install row for @arnilo/${profile}`);
      }
    });

    it("current-line version equals the root manifest version", () => {
      const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
      assert.ok(read("docs/index.md").includes(`current **${pkg.version}**`), `index.md current-line must be ${pkg.version}`);
    });

    it("no stale 0.0.x/0.1.x current-line claim remains in docs or roadmap", () => {
      const stale = /current line \((?:0\.0\.\d+|0\.1\.\d+)\)/i;
      for (const file of ["README.md", "roadmap.md", ...markdownFiles("docs")]) {
        assert.doesNotMatch(read(file), stale, `${file} carries a stale current-line version`);
      }
    });

    it("roadmap carries no stray/truncated content", () => {
      const roadmap = read("roadmap.md");
      for (const pattern of [/TODO/, /FIXME/, /XXX/, /^### 0\.2\.10 /m, /Background observers/]) {
        assert.doesNotMatch(roadmap, pattern, `roadmap.md contains stray content: ${pattern}`);
      }
    });
  });

  it("phase 12 security policy is documented and wired", () => {
    const security = readFileSync(".github/workflows/security.yml", "utf8");
    const release = readFileSync(".github/workflows/release.yml", "utf8");
    const hostSecurity = readFileSync("docs/host-security.md", "utf8");
    const readiness = readinessDoc();
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    for (const workflow of [security, release]) {
      assert.ok(workflow.includes("bun audit --audit-level=moderate"), "workflows must enforce moderate audit policy");
    }
    for (const job of ["dependency-review", "codeql", "supply-chain"]) assert.ok(security.includes(job), `security.yml missing ${job}`);
    assert.ok(
      pkg.scripts["security:threat-suites"].includes("scripts/phase8-conformance.test.mjs"),
      "threat-suites leg must aggregate Phase 8 conformance",
    );
    for (const file of ["phase9-conformance.test.mjs", "phase11-conformance.test.mjs"])
      assert.ok(pkg.scripts["security:threat-suites"].includes(file), `threat-suites leg missing ${file}`);
    assert.ok(hostSecurity.includes("### 0.1.0 security evidence (plan 012 Task 6)"), "host-security missing 0.1.0 evidence section");
    for (const token of ["npm run security:threat-suites", "--audit-level=moderate", "negative fixtures", "canary-report.json"])
      assert.ok(hostSecurity.includes(token), `host-security missing ${token}`);
    assert.ok(readiness.includes("0.1.0 threat-suites leg"), "readiness missing threat-suites leg row");
    assert.ok(readiness.includes("Supply-chain negative fixtures"), "readiness missing negative-fixture row");
  });

  it("phase 12 capacity envelope is documented and wired", () => {
    const performance = readFileSync("docs/performance.md", "utf8");
    const readiness = readinessDoc();
    assert.ok(
      performance.includes("## Release 0.1.0 capacity envelopes (frozen performance contract)"),
      "performance.md missing 0.1.0 envelope section",
    );
    for (const token of [
      "benchmark-0.1.0.mjs",
      "benchmark-0.1.0.json",
      "benchmark-0.1.0.test.mjs",
      "reconnectCatchup",
      "network-free",
      "protected",
    ])
      assert.ok(performance.includes(token), `performance.md missing ${token}`);
    assert.ok(readiness.includes("0.1.0 capacity envelope (frozen performance contract)"), "readiness missing envelope gate row");
    assert.ok(npmTestChain().includes("scripts/benchmark-0.1.0.test.mjs"), "bun run test missing envelope regression gate");
    assert.ok(existsSync("scripts/benchmark-0.1.0.json"), "missing checked-in envelope evidence");
    assert.ok(freezeCorpus().includes("0.1.0 capacity envelopes"), "freeze corpus missing envelope entry");
  });

  it("phase 4 evidence freezes coding/browser scope, owners, limits, and Office exclusion", () => {
    const evidence = readFileSync("docs/_evidence/review-coverage-2026-07-20-phase-4.md", "utf8");
    const roadmap = readFileSync("roadmap.md", "utf8");

    for (const heading of [
      "## Frozen external revisions",
      "## Capability traceability matrix",
      "## Primitive and caller inventory",
      "## Frozen finite limits and charging points",
      "## Threat and authority matrix",
      "## Validation matrix for Task 0",
    ])
      assert.ok(evidence.includes(heading), `Phase 4 evidence missing ${heading}`);
    for (let task = 1; task <= 8; task += 1) {
      assert.ok(evidence.includes(`Task ${task}`), `Phase 4 evidence missing Task ${task} owner`);
    }
    for (const surface of ["Sandbox and workspace", "Repository, Git, checks, and durable work", "Browser"]) {
      assert.ok(evidence.includes(surface), `Phase 4 limits missing ${surface}`);
    }
    assert.ok(evidence.includes("Default / hard cap"), "Phase 4 limits missing default/hard-cap columns");
    for (const removed of ["createOfficeTools", "packages/work-tools` OfficeCLI", "docs/officecli.md", "OfficeCLI-native"]) {
      assert.ok(!roadmap.includes(removed), `roadmap retains removed Office implementation claim: ${removed}`);
    }
  });

  it("phase 5 evidence freezes workspace modes, owners, reused limits, and 0.0.11+ exclusions", () => {
    const evidence = readFileSync("docs/_evidence/review-coverage-2026-07-21-phase-5.md", "utf8");
    const index = readFileSync("docs/index.md", "utf8");

    for (const heading of [
      "## Frozen external revisions",
      "## Frozen workspace-mode contract",
      "## Capability traceability matrix",
      "## Primitive and caller inventory",
      "## Frozen finite limits and charging points",
      "## Threat and authority matrix",
      "## Validation matrix for Task 0",
    ])
      assert.ok(evidence.includes(heading), `Phase 5 evidence missing ${heading}`);
    for (let task = 1; task <= 7; task += 1) {
      assert.ok(evidence.includes(`Task ${task}`), `Phase 5 evidence missing Task ${task} owner`);
    }
    for (const mode of ['"host"', '"sandbox"', "allowMixedWorkspaceWiring", "SandboxCodingComposition"]) {
      assert.ok(evidence.includes(mode), `Phase 5 evidence missing mode/contract token ${mode}`);
    }
    for (const deferred of [
      "Session search/index",
      "Token/context budgeting",
      "Native Anthropic provider",
      "Native Google provider",
      "Goal→verify",
      "AG-UI/ACP-facing event adapter",
      "Coding-aware compaction preset",
    ]) {
      assert.ok(evidence.includes(deferred), `Phase 5 evidence missing out-of-scope item ${deferred}`);
    }
    assert.ok(evidence.includes("Default / hard cap"), "Phase 5 limits missing default/hard-cap columns");
    assert.ok(evidence.includes("No new core primitive"), "Phase 5 evidence missing core-primitive ban");
    assert.ok(index.includes("(_evidence/)"), "docs/index.md missing review coverage archive entry");
  });

  it("phase 6 evidence freezes SessionIndex, contextBudget, providers, owners, limits, and 0.0.12+ exclusions", () => {
    const evidence = readFileSync("docs/_evidence/review-coverage-2026-07-22-phase-6.md", "utf8");
    const index = readFileSync("docs/index.md", "utf8");

    for (const heading of [
      "## Frozen external revisions",
      "## Frozen API and mode contract",
      "## Capability traceability matrix",
      "## Primitive and caller inventory",
      "## Frozen finite limits and charging points",
      "## Threat and authority matrix",
      "## Validation matrix for Task 0",
    ])
      assert.ok(evidence.includes(heading), `Phase 6 evidence missing ${heading}`);
    for (let task = 1; task <= 9; task += 1) {
      assert.ok(evidence.includes(`Task ${task}`), `Phase 6 evidence missing Task ${task} owner`);
    }
    for (const token of [
      "SessionIndex",
      "SessionSearchQuery",
      "SessionSearchHit",
      "contextBudget",
      "getContextBudgetReport",
      "sessionSearchMode",
      '"linear"',
      '"unsupported"',
      "workspaceRoot",
      "createAnthropicProviderPackage",
      "createGoogleProviderPackage",
      "runCodingGoalVerify",
    ]) {
      assert.ok(evidence.includes(token), `Phase 6 evidence missing contract token ${token}`);
    }
    for (const deferred of [
      "Additional subscription OAuth adapters",
      "AG-UI/ACP-facing event adapter",
      "Coding-aware compaction preset",
      "Always-on FTS reindex workers",
      "Shared core Anthropic Messages serializer extraction",
      "Vertex enterprise identity",
    ]) {
      assert.ok(evidence.includes(deferred), `Phase 6 evidence missing out-of-scope item ${deferred}`);
    }
    assert.ok(evidence.includes("Default / hard cap"), "Phase 6 limits missing default/hard-cap columns");
    assert.ok(
      evidence.includes("system/AGENTS") && evidence.includes("history/tool results"),
      "Phase 6 evidence missing eviction priority order",
    );
    assert.ok(index.includes("(_evidence/)"), "docs/index.md missing review coverage archive entry");
  });

  it("phase 7 evidence freezes interoperability scope, protocol revisions, bounds, and OAuth policy", () => {
    const evidence = readFileSync("docs/_evidence/review-coverage-2026-07-22-phase-7.md", "utf8");
    const index = readFileSync("docs/index.md", "utf8");

    for (const heading of [
      "## Frozen external revisions",
      "## Frozen package and API contract",
      "## Capability traceability matrix",
      "## Primitive and caller inventory",
      "## Frozen finite limits and charging points",
      "## OAuth eligibility matrix",
      "## Threat and authority matrix",
      "## Validation matrix for Task 0",
    ])
      assert.ok(evidence.includes(heading), `Phase 7 evidence missing ${heading}`);
    for (let task = 1; task <= 8; task += 1) {
      assert.ok(evidence.includes(`Task ${task}`), `Phase 7 evidence missing Task ${task} owner`);
    }
    for (const token of [
      "@arnilo/prism-ag-ui",
      "@arnilo/prism-ag-ui/acp",
      "@ag-ui/core` **0.0.57**",
      "@agentclientprotocol/sdk` **1.3.0**",
      "resumeAgentRunStream()",
      "AgentRunLifecycle.resumeStream()",
      "createCodingCompactionStrategy()",
      "Default deny",
      "64 KiB / 1 MiB",
      "10,000 / 100,000",
      "OpenAI Codex",
      "Anthropic provider",
      "Google provider",
    ])
      assert.ok(evidence.includes(token), `Phase 7 evidence missing frozen token ${token}`);
    for (const deferred of [
      "Conversation storage/service",
      "Enterprise identity",
      "ACP terminal, filesystem, editor, process, diff, or MCP implementation",
      "Anthropic Claude Code or Google Gemini CLI subscription OAuth/token reuse",
    ]) {
      assert.ok(evidence.includes(deferred), `Phase 7 evidence missing out-of-scope item ${deferred}`);
    }
    const providerIndexes = ["packages/providers/anthropic/src/index.ts", "packages/providers/google/src/index.ts"]
      .filter((path) => existsSync(path))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    for (const forbidden of ["createAnthropicSubscriptionOAuthProvider", "createGeminiCliOAuthProvider", 'kind: "oauth"']) {
      assert.ok(!providerIndexes.includes(forbidden), `unsupported OAuth registration leaked: ${forbidden}`);
    }
    assert.ok(index.includes("(_evidence/)"), "docs/index.md missing review coverage archive entry");
  });

  it("phase 9 evidence freezes conversations, artifacts, consent, co-work, device gating, and 0.1.x exclusions", () => {
    const evidence = readFileSync("docs/_evidence/review-coverage-2026-07-25-phase-9.md", "utf8");
    const index = readFileSync("docs/index.md", "utf8");

    for (const heading of [
      "## Frozen external revisions",
      "## Frozen package and API contract",
      "## Capability traceability matrix",
      "## Primitive and caller inventory",
      "## Frozen finite limits and charging points",
      "## Channel and device capability freeze",
      "## Threat and authority matrix",
      "## Validation matrix for Task 0",
    ])
      assert.ok(evidence.includes(heading), `Phase 9 evidence missing ${heading}`);
    for (let task = 1; task <= 8; task += 1) {
      assert.ok(evidence.includes(`Task ${task}`), `Phase 9 evidence missing Task ${task} owner`);
    }
    for (const token of [
      "@arnilo/prism-server",
      "@arnilo/prism-memory",
      "@arnilo/prism-ag-ui",
      "@arnilo/prism-credentials-node",
      "@arnilo/prism-work-tools",
      "@arnilo/prism-browser",
      "MemoryScope",
      "AgentIdentity",
      "IdempotencyStore",
      "resumeAgentRunStream",
      "queryEvents",
      "tool_approval",
      "EventSchemas",
      "41 → 43",
      "disabled by default",
      "expiring",
      "Verify before side effect",
      "gate 8",
    ])
      assert.ok(evidence.includes(token), `Phase 9 evidence missing frozen token ${token}`);
    for (const deferred of [
      "Studio",
      "Slack/Teams",
      "Local Office",
      "WorkAgent",
      "second memory runtime",
      "serialized browser internals",
    ]) {
      assert.ok(evidence.includes(deferred), `Phase 9 evidence missing out-of-scope item ${deferred}`);
    }
    // Scope guard: no new channel/device/conversation/artifact packages may exist in 0.0.14 (41 → 43 freeze; only provider packages alibaba/ollama authorized).
    for (const forbidden of [
      "packages/conversations",
      "packages/artifacts",
      "packages/voice",
      "packages/desktop",
      "packages/slack",
      "packages/teams",
    ]) {
      assert.ok(!existsSync(forbidden), `Phase 9 scope guard violated: ${forbidden} must not exist`);
    }
    for (const seam of [
      "packages/hosts/ag-ui/src/handler.ts",
      "packages/memory/fabric/src/memory.ts",
      existsSync("packages/browser/src/policy.ts")
        ? "packages/browser/src/policy.ts"
        : existsSync("packages/tools/browser/src/policy.ts")
          ? "packages/tools/browser/src/policy.ts"
          : "packages/web-tools/src/browser/policy.ts",
      existsSync("packages/work-tools/src/idempotency.ts")
        ? "packages/work-tools/src/idempotency.ts"
        : existsSync("packages/tools/work/src/connectors/idempotency.ts")
          ? "packages/tools/work/src/connectors/idempotency.ts"
          : "packages/prism-work/src/connectors/idempotency.ts",
      existsSync("packages/credentials/keyring/src/resolver.ts")
        ? "packages/credentials/keyring/src/resolver.ts"
        : "packages/prism-core/src/credentials/node/resolver.ts",
      existsSync("packages/server/src/replay.ts")
        ? "packages/server/src/replay.ts"
        : existsSync("packages/prism-core/src/runtime/server/replay.ts")
          ? "packages/prism-core/src/runtime/server/replay.ts"
          : "packages/hosts/ag-ui/src/replay.ts",
    ]) {
      assert.ok(existsSync(seam), `Phase 9 must extend existing seam: ${seam}`);
    }
    assert.ok(index.includes("(_evidence/)"), "docs/index.md missing review coverage archive entry");
  });

  it("phase 10 evidence freezes provider/memory/RAG parity, 43->43 manifests, neutral provider seams, and 0.1.x exclusions", () => {
    const evidence = readFileSync("docs/_evidence/review-coverage-2026-07-26-phase-10.md", "utf8");

    for (const heading of [
      "## 1. Capability traceability (every Phase 10 roadmap criterion → Task owner)",
      "## 2. Package ownership and manifest count",
      "## 3. Primitive inventory (reused, not duplicated)",
      "## 4. Frozen finite limits (Phase 10)",
      "## 5. Threat / authority matrix",
      "## 6. Task 0 validation matrix (scope guards)",
      "## 7. Frozen decisions (binding on Tasks 1–9)",
    ])
      assert.ok(evidence.includes(heading), `Phase 10 evidence missing ${heading}`);
    for (let task = 1; task <= 9; task += 1) {
      assert.ok(evidence.includes(`Task ${task}`), `Phase 10 evidence missing Task ${task} owner`);
    }
    for (const token of [
      ["@arnilo/prism-provider-", "openai"].join(""),
      ["@arnilo/prism-provider-", "ai-sdk"].join(""),
      "provider-{anthropic,google}",
      "@arnilo/prism-rag",
      "@arnilo/prism-memory",
      "@arnilo/prism-web-tools",
      "ProviderEvent",
      "ToolCallContent",
      "provider-hosted",
      "ResourceLoader",
      "DocumentLoader",
      "Reranker",
      "replaceSource",
      "deleteSource",
      "exportMemory",
      "rebuildIndex",
      "assertFiniteVector",
      "MemoryConsent",
      "43 → 43",
      "gate 9",
    ])
      assert.ok(evidence.includes(token), `Phase 10 evidence missing frozen token ${token}`);
    for (const deferred of [
      "Studio",
      "remote-browser vendors",
      "Office runtime",
      "additional vector-store",
      "Slack/Teams/voice/desktop vendor",
      "GraphRAG",
    ]) {
      assert.ok(evidence.includes(deferred), `Phase 10 evidence missing out-of-scope item ${deferred}`);
    }
    // Scope guard: no new provider/runtime/document/vector-store packages may exist in 0.0.15 (43 -> 43 freeze).
    for (const forbidden of [
      "packages/realtime",
      "packages/document-loaders",
      "packages/reranker",
      "packages/provider-vector",
      "packages/studio",
      "packages/voice",
      "packages/desktop",
    ]) {
      assert.ok(!existsSync(forbidden), `Phase 10 scope guard violated: ${forbidden} must not exist`);
    }
    for (const seam of [
      "src/contracts.ts",
      "src/resources.ts",
      "packages/memory/rag/src/indexing.ts",
      "packages/memory/rag/src/retrieve.ts",
      "packages/memory/fabric/src/memory.ts",
      "packages/memory/fabric/src/conformance.ts",
      "packages/tools/web/src/normalize.ts",
      "src/provider-kit/openai-compatible.ts",
      "packages/providers/hyper/src/provider.ts",
    ]) {
      assert.ok(existsSync(seam), `Phase 10 must extend existing seam: ${seam}`);
    }
  });

  it("release 0.0.16 performance budget gate is documented and wired", () => {
    const performance = readFileSync("docs/performance.md", "utf8");
    for (const token of [
      "Release 0.0.16 performance budgets and artifact diet",
      "scripts/budgets.json",
      "scripts/budget-gate.test.mjs",
      "scripts/benchmark.mjs",
      "575,680",
    ]) {
      assert.ok(performance.includes(token), `performance docs missing ${token}`);
    }
    for (const file of ["scripts/budgets.json", "scripts/budget-gates.mjs", "scripts/budget-gate.test.mjs", "scripts/benchmark.mjs"]) {
      assert.ok(existsSync(file), `missing ${file}`);
    }
    const testScript = npmTestChain();
    assert.ok(testScript.includes("scripts/budget-gate.test.mjs"), "bun run test does not run the budget gate");
  });

  it("task 5 scope guard: no Slack/Teams chat-channel packages, exports, or docs pages (demand-gated)", () => {
    // Chat-channel adapters are deferred until web/AG-UI demand is measured. (The M365
    // `teams` capability op is a separate, gated workload op and is not a channel adapter.)
    for (const dir of ["packages/slack", "packages/teams", "docs/slack.md", "docs/teams.md"]) {
      assert.ok(!existsSync(dir), `Slack/Teams channel surface must not ship in 0.0.14: ${dir}`);
    }
    const barrels = [
      existsSync("packages/credentials-node/src/index.ts")
        ? "packages/credentials-node/src/index.ts"
        : existsSync("packages/prism-core/src/credentials/node/index.ts")
          ? "packages/prism-core/src/credentials/node/index.ts"
          : "packages/credentials/keyring/src/index.ts",
      existsSync("packages/work-tools/src/index.ts")
        ? "packages/work-tools/src/index.ts"
        : existsSync("packages/tools/work/src/connectors/index.ts")
          ? "packages/tools/work/src/connectors/index.ts"
          : "packages/prism-work/src/connectors/index.ts",
    ];
    for (const barrel of barrels) {
      const text = readFileSync(barrel, "utf8").toLowerCase();
      assert.ok(!text.includes("slack"), `${barrel} must not export a Slack channel adapter`);
      assert.ok(!/teams(?!.*capability)/i.test(readFileSync(barrel, "utf8")), `${barrel} must not export a Teams channel adapter`);
    }
    const index = readFileSync("docs/index.md", "utf8").toLowerCase();
    assert.ok(!index.includes("(slack.md)") && !index.includes("(teams.md)"), "docs/index.md must not link a Slack/Teams channel page");
  });

  it("task 6 scope guard: device contracts + browser checkpoint ship; voice/desktop vendor packages deferred", () => {
    // Contracts + deny-by-default policy only; vendor implementations demand-gated to 0.1.x.
    assert.ok(existsSync("packages/tools/computer-use/src/devices.ts"), "device adapter contract must ship");
    assert.ok(
      existsSync("packages/browser/src/checkpoint.ts") ||
        existsSync("packages/tools/browser/src/checkpoint.ts") ||
        existsSync("packages/web-tools/src/browser/checkpoint.ts"),
      "browser verified-state checkpoint seam must ship",
    );
    const devices = readFileSync("packages/tools/computer-use/src/devices.ts", "utf8");
    assert.ok(devices.includes("deny-by-default") || devices.includes("disabled by default"), "device contract must be deny-by-default");
    for (const dir of ["packages/voice", "packages/desktop", "packages/device"]) {
      assert.ok(!existsSync(dir), `voice/desktop vendor package must not ship in 0.0.14: ${dir}`);
    }
  });

  it("every publishable package ships current README and changelog documentation", () => {
    const dirs = [".", ...workspaceDirs()]
      .filter((dir) => existsSync(join(dir, "package.json")))
      .filter((dir) => !JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).private);
    const release = readFileSync("docs/release.md", "utf8");
    const count = (JSON.parse(readFileSync("scripts/package-truth.json", "utf8")) as { counts: { publishable: number } }).counts
      .publishable;
    assert.equal(dirs.length, count, "publishable package documentation count drifted");
    for (const dir of dirs) {
      const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name: string; files?: string[] };
      const readme = readFileSync(join(dir, "README.md"), "utf8");
      const changelog = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
      assert.ok(readme.includes(manifest.name), `${dir}/README.md missing package name ${manifest.name}`);
      assert.match(changelog, /^## \[/m, `${dir}/CHANGELOG.md has no version section`);
      assert.ok(manifest.files?.includes("CHANGELOG.md"), `${manifest.name} does not ship CHANGELOG.md`);
      assert.ok(release.includes(manifest.name), `release.md missing ${manifest.name}`);
    }
  });

  it("host_security_guide_covers_fail_closed_embedding_checklist", () => {
    const index = readFileSync("docs/index.md", "utf8");
    const page = readFileSync("docs/host-security.md", "utf8");
    const security = readFileSync("docs/settings-auth-trust-security.md", "utf8");

    assert.ok(index.includes("(host-security.md)"), "docs/index.md does not link host-security.md");
    assert.ok(security.includes("host-security.md"), "settings-auth-trust-security.md does not link host-security.md");
    assert.ok(apiPages.includes("docs/host-security.md"), "apiPages missing host-security.md");

    for (const phrase of [
      "fail-closed checklist",
      "credentials, settings, redaction, trust roots, permission policies, session and ledger persistence, extension loading, and tool validation",
      "Prism does not sandbox tools/extensions",
      "does not detect arbitrary secrets",
      "createExplicitCredentialResolver",
      "createEnvCredentialResolver",
      "resolveCredentialValue()",
      "createSecretRedactor",
      "createPathTrustPolicy",
      "createStaticPermissionPolicy",
      "createToolRegistry",
      "filterTools()",
      "AgentConfig.validator",
      "RunOptions.validate",
      "ToolValidator",
      "SessionStore",
      "assertSessionStoreConforms()",
      "RunLedger",
      "redactRunLedgerRecord()",
      "createAgent({ packages })",
      "unknown or denied tools emit `tool_execution_blocked`",
      "validator failures emit `tool_execution_blocked` with `validation_failed`",
      "no background watchers, filesystem scanners, network probes, credential polling, or automatic extension discovery",
      "`createAgent()` and `session.run()` do not automatically call `settings.get()` or `credentials.resolve()`",
      "Prism does not read `process.env` for credentials",
      "Redaction is exact known-secret replacement only",
      "Tool `parameters` metadata is not validated by default",
      "Permission checks happen before tool validation and before `tool.execute()`",
      "Provider-owned auth/content/session/cache/security headers win over caller headers",
      "no hidden global middleware, background workers, watchers, network calls, or filesystem scans",
    ]) {
      assert.ok(page.includes(phrase), `docs/host-security.md missing ${phrase}`);
    }
  });

  it("release publication is deterministic resumable and Bun-published", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    const workflow = readFileSync(".github/workflows/release.yml", "utf8");
    const release = readFileSync("scripts/release.mjs", "utf8");
    assert.equal(pkg.scripts["release:check"], "bun scripts/release.mjs check");
    assert.equal(pkg.scripts["release:publish"], "bun scripts/release.mjs publish");
    for (const phrase of ["topologicalOrder", "bun.lock", "--access", "public", "--tag", "latest"]) {
      assert.ok(release.includes(phrase), `release script missing ${phrase}`);
    }
    assert.ok(!release.includes("--provenance"), "release script must not request npm provenance (plan 164 Task 8.4)");
    for (const phrase of [
      "release:publish",
      "--resume",
      "id-token: write",
      "contents: read",
      "actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f",
      "SHA256SUMS",
      "publish-report.json",
      "bun scripts/release.mjs pack --destination release-artifacts",
      "bun scripts/sbom.mjs",
    ]) {
      assert.ok(workflow.includes(phrase), `release workflow missing ${phrase}`);
    }
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal workflow-grep target; the workflow YAML carries the real interpolation
    assert.ok(workflow.includes("NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}"), "release workflow missing npm authentication");
    assert.equal(workflow.match(/secrets\.NPM_TOKEN/g)?.length, 1, "npm credential must be scoped to one publish step");

    const docs = releaseDoc();
    const handoff = docs.slice(docs.indexOf("### 0.0.22 publish handoff"), docs.indexOf("### 0.0.21 publish handoff"));
    for (const phrase of [
      "Decision: GO",
      "46 manifests",
      "git tag -s v0.0.22",
      "git push origin v0.0.22",
      "@arnilo/prism-caveman",
      "@arnilo/prism-ponytail",
    ])
      assert.ok(handoff.includes(phrase), `publish handoff missing ${phrase}`);
    const dirs = [".", ...workspaceDirs()]
      .filter((dir) => existsSync(join(dir, "package.json")))
      .filter((dir) => !JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).private);
    for (const dir of dirs) {
      const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name: string };
      assert.ok(docs.includes(manifest.name), `release.md missing ${manifest.name}`);
    }
  });

  it("current install, coverage, and SQL adapter docs match manifests and migrations", () => {
    const truth = JSON.parse(readFileSync("scripts/package-truth.json", "utf8")) as {
      root: { version: string };
      versions: Record<string, string>;
      counts: { publishable: number; provider: number };
    };
    const readme = readFileSync("README.md", "utf8");
    const release = readFileSync("docs/release.md", "utf8");
    const index = readFileSync("docs/index.md", "utf8");
    assert.ok(
      readme.includes("provider adapters") || release.includes("provider adapters"),
      "install docs must point at the provider adapters",
    );
    const inventory = (text: string) =>
      text.match(/<!-- generated:package-truth:inventory begin -->[\s\S]*?<!-- generated:package-truth:inventory end -->/)?.[0];
    assert.ok(inventory(readme));
    assert.equal(inventory(readme), inventory(release));
    assert.equal(inventory(readme), inventory(index));
    for (const [page, text] of [
      ["README.md", readme],
      ["docs/release.md", release],
    ] as const) {
      for (const command of text.matchAll(/\bbun add ([^`\n#]+)/g)) {
        for (const spec of command[1]!
          .trim()
          .split(/\s+/)
          .filter((part) => part.startsWith("@arnilo/"))) {
          assert.ok(Object.hasOwn(truth.versions, spec), `${page}: install package, not subpath: ${spec}`);
        }
      }
    }
  });

  // Plan 125 Task 4: one install voice across the live pages. Hosts install with `bun add`; a page
  // that still tells them to `npm install @arnilo/prism`, or that states a Node support claim
  // without recording the 0.12.0 retirement, is the drift this test exists to catch. Archived pages
  // (`docs/history/**`, `docs/_evidence/**`) are era records and keep their recorded commands.
  it("live pages carry one Bun install voice and no current Node support claim", () => {
    const pages = [
      "README.md",
      ...markdownFiles("docs").filter((file) => !file.startsWith("docs/history/") && !file.startsWith("docs/_evidence/")),
      ...workspaceDirs()
        .filter((dir) => existsSync(join(dir, "README.md")))
        .map((dir) => join(dir, "README.md")),
    ];
    assert.ok(pages.length > 40, `expected the live page set, found ${pages.length}`);
    let bunAdds = 0;
    for (const page of pages) {
      const text = readFileSync(page, "utf8");
      assert.doesNotMatch(text, /npm (?:install|i) @arnilo\/prism/, `${page} still tells hosts to install Prism with npm`);
      bunAdds += [...text.matchAll(/bun add /g)].length;
      for (const line of text.split("\n")) {
        if (!/engines\.node|Node (?:22|24)[^.]{0,60}support/i.test(line)) continue;
        assert.match(
          line,
          /retired|0\.12\.0|engines\.bun|era record/i,
          `${page} states a Node support claim without retiring it: ${line.trim()}`,
        );
      }
    }
    assert.ok(bunAdds >= 30, `expected the install voice across the live pages, found ${bunAdds} bun add lines`);
  });

  it("auth docs cover explicit resolver order and no hidden env", () => {
    const docs = readFileSync("docs/credentials-and-redaction.md", "utf8");
    for (const phrase of [
      "createExplicitCredentialResolver",
      "createEnvCredentialResolver",
      "runtime override",
      "Prism does not read `process.env`",
    ]) {
      assert.ok(docs.includes(phrase), `credential docs missing ${phrase}`);
    }
  });

  it("docs avoid real-looking secret examples", () => {
    for (const file of markdownFiles(docsDir)) {
      const text = readFileSync(file, "utf8");
      // Real sk- keys are 20+ random chars; {8,} false-positived on prose paths
      // like `ask-user-decision.ts` / `task-boundary` ("sk-user-decision").
      assert.equal(/sk-[A-Za-z0-9_-]{20,}/.test(text), false, `${file} has real-looking secret`);
    }
  });

  it("middleware_hooks_page_is_released_0_12_prose_only", () => {
    // `docs/middleware-hooks.md` is released 0.12 documentation. The middleware registry left in
    // plan 145 Task 5, so the page is kept verbatim and no longer pinned against the runtime.
    const rootExports = readFileSync("src/index.ts", "utf8");
    assert.doesNotMatch(rootExports, /\bMiddlewareHookName\b/, "the middleware registry must stay retired");
    assert.doesNotMatch(rootExports, /\bcreateMiddlewareRegistry\b/, "the middleware registry must stay retired");
  });
  it("first_party_providers_do_not_implement_deprecated_provider_timeout_retry_knobs", () => {
    for (const dir of [
      "providers/hyper/src",
      "providers/opencode-go/src",
    ]) {
      const combined = tsFiles(`packages/${dir}`)
        .map((file) => readFileSync(file, "utf8"))
        .join("\n");
      for (const knob of ["timeoutMs", "maxRetries", "maxRetryDelayMs"]) {
        assert.equal(combined.includes(knob), false, `${dir} unexpectedly implements deprecated ${knob}`);
      }
    }
  });

  it("docs index links examples and examples README lists every TypeScript example", () => {
    const index = readFileSync("docs/index.md", "utf8");
    const readme = readFileSync("examples/README.md", "utf8");
    assert.ok(index.includes("examples/"), "docs/index.md does not mention examples/");
    for (const file of readdirSync("examples").filter((name) => name.endsWith(".ts"))) {
      assert.ok(readme.includes(`\`${file}\``), `examples/README.md missing ${file}`);
    }
  });

  it("host_app_sdk_examples_cover_adoption_seams_without_coding_tools", () => {
    const readme = readFileSync("examples/README.md", "utf8");
    const minimal = readFileSync("examples/minimal-host-app.ts", "utf8");
    const builders = readFileSync("examples/custom-builders.ts", "utf8");
    const store = readFileSync("examples/custom-session-store.ts", "utf8");
    const tsc = readFileSync("examples/custom-tools-skills-context.ts", "utf8");
    const ext = readFileSync("examples/define-package.ts", "utf8");

    // README lists each new example.
    for (const file of [
      "minimal-host-app.ts",
      "custom-builders.ts",
      "custom-session-store.ts",
      "custom-tools-skills-context.ts",
      "define-package.ts",
    ]) {
      assert.ok(readme.includes(file), `examples/README.md missing ${file}`);
    }

    // Minimal embed + event streaming via concurrent subscribe/run.
    assert.ok(minimal.includes("createAgent("), "minimal-host-app missing createAgent");
    assert.ok(minimal.includes("agent.session("), "minimal-host-app missing agent.session()");
    assert.ok(minimal.includes("Promise.all"), "minimal-host-app missing concurrent Promise.all drain+run");
    assert.ok(minimal.includes("session.subscribe()"), "minimal-host-app missing event streaming");

    // Host prompt composition + run.input rewrite, both on the hook bus.
    assert.ok(builders.includes('"context.build"'), "custom-builders missing a context.build hook");
    assert.ok(builders.includes('hooks.on("run.input"'), "custom-builders missing a run.input hook");

    // Custom session store seam.
    assert.ok(store.includes("SessionStore"), "custom-session-store missing SessionStore");
    assert.ok(store.includes("async append"), "custom-session-store missing append");
    assert.ok(store.includes("async list"), "custom-session-store missing list");
    assert.ok(store.includes("createSessionEntry"), "custom-session-store missing createSessionEntry");

    // Custom tools + skills + context in one agent, with a tool-call loop.
    assert.ok(tsc.includes("tools: { add:"), "custom-tools-skills-context missing the host tool-add seam");
    assert.ok(tsc.includes("skills:"), "custom-tools-skills-context missing skills");
    assert.ok(tsc.includes("registerContextSources"), "custom-tools-skills-context missing registerContextSources");
    assert.ok(tsc.includes("providerToolCall"), "custom-tools-skills-context missing tool-call loop");

    assert.ok(ext.includes("definePackage"), "define-package missing definePackage");
    assert.ok(ext.includes("packages:"), "define-package missing a packages list");

    // No filesystem/shell/browser coding-tool usage in any new example.
    const combined = `${minimal}\n${builders}\n${store}\n${tsc}\n${ext}`;
    for (const forbidden of [
      'from "fs"',
      'from "node:fs"',
      'from "node:child_process"',
      "readFileSync",
      "writeFileSync",
      "execSync",
      "spawnSync",
      "child_process",
      "glob(",
    ]) {
      assert.ok(!combined.includes(forbidden), `host-app example references coding tool: ${forbidden}`);
    }
  });

  it("phase48 cache-aware prompt assembly example covers explicit and implicit cache reporting", () => {
    const readme = readFileSync("examples/README.md", "utf8");
    const example = readFileSync("examples/cache-aware-prompt-assembly.ts", "utf8");

    assert.ok(readme.includes("cache-aware-prompt-assembly.ts"), "examples/README.md does not list cache-aware example");
    for (const phrase of [
      'inputLayout: "cache_aware"',
      "defineHyperModel",
      "defineOpenCodeGoModel",
      'cache: { kind: "cache_control"',
      'cache: { kind: "implicit"',
      "cacheUsageReport",
      "cacheHitRate",
      "cacheWriteTokens",
      "sends no explicit cache payload",
      "JSON.stringify(await demo())",
    ]) {
      assert.ok(example.includes(phrase), `cache-aware example missing ${phrase}`);
    }
  });

  it("workflow_examples_cover_required_workflow_surfaces", () => {
    const rr = readFileSync("examples/workflow-research-and-review.ts", "utf8");
    const pr = readFileSync("examples/workflow-parallel-research.ts", "utf8");
    const mm = readFileSync("examples/workflow-multimodal-document.ts", "utf8");
    const sr = readFileSync("examples/workflow-sqlite-resume.ts", "utf8");
    const pg = readFileSync("examples/workflow-postgres-resume.ts", "utf8");
    const es = readFileSync("examples/workflow-event-sink.ts", "utf8");

    for (const phrase of ["defineWorkflow", "agentNode", "runWorkflow", "createMemoryWorkflowCheckpoints", "createSecretRedactor"]) {
      assert.ok(rr.includes(phrase), `workflow-research-and-review missing ${phrase}`);
    }
    for (const phrase of ["fanOut", "joinNode", "functionNode", "maxConcurrency: 3", "findings"]) {
      assert.ok(pr.includes(phrase), `workflow-parallel-research missing ${phrase}`);
    }
    for (const phrase of ['type: "document"', "createEnvRefCredentialResolver", "createSecretRedactor", "maxNodeOutputBytes"]) {
      assert.ok(mm.includes(phrase), `workflow-multimodal-document missing ${phrase}`);
    }
    for (const phrase of ["createSqlitePersistence", "createWorkflowCheckpoints", "persistence.checkpoints", "resumeWorkflow"]) {
      assert.ok(sr.includes(phrase), `workflow-sqlite-resume missing ${phrase}`);
    }
    for (const phrase of [
      "createPostgresPersistence",
      "createWorkflowCheckpoints",
      ".checkpoints",
      "PRISM_TEST_POSTGRES_URL",
      "resumeWorkflow",
      "new Pool",
    ]) {
      assert.ok(pg.includes(phrase), `workflow-postgres-resume missing ${phrase}`);
    }
    for (const phrase of ["createWorkflowTransitionChannel", "for await", "transitions:", "conditionalNode", "node_skipped"]) {
      assert.ok(es.includes(phrase), `workflow-event-sink missing ${phrase}`);
    }
  });

  it("examples_demos_run_to_completion_and_emit_no_secret", () => {
    // Compile the examples with the repo tsc so the spawned demos run as plain JS. Running the .ts
    // files directly would make every child load the amaro type-stripping WASM module, which
    // reserves gigabytes of virtual address space per process and fails with "Cannot allocate Wasm
    // memory" on memory-constrained CI runners; compiled children stay small.
    const examplesDir = join(process.cwd(), "examples");
    const tsc = join(process.cwd(), "node_modules", "typescript", "bin", "tsc");
    // Only the demos need to sit beside their sources (`import.meta.url`-relative fixtures), so the
    // whole program emits into a throwaway tree and just the `examples/*.js` files move back.
    // Emitting in place would leave the path-mapped package sources' `.js` beside their `.ts` under
    // `packages/**/src` for the length of the demo loop, where a pack guard running concurrently in
    // the same worker pool reads them as shipped compiled output.
    const written = new Set<string>();
    const emitRoot = mkdtempSync(join(process.cwd(), "node_modules", ".prism-examples-emit-"));
    try {
      const emit = spawnSync(
        process.execPath,
        [
          tsc,
          "-p",
          join(examplesDir, "tsconfig.json"),
          "--noEmit",
          "false",
          "--declaration",
          "false",
          "--sourceMap",
          "false",
          "--listEmittedFiles",
          "--rootDir",
          process.cwd(),
          "--outDir",
          emitRoot,
        ],
        { encoding: "utf8" },
      );
      assert.equal(emit.status, 0, `examples emit failed\n${emit.stderr}`);
      for (const line of emit.stdout.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("TSFILE:")) continue;
        const file = trimmed.slice("TSFILE:".length).trim();
        if (!file.endsWith(".js")) continue;
        const rel = relative(emitRoot, file);
        if (!rel.startsWith(`examples${sep}`)) continue;
        const dest = join(process.cwd(), rel);
        renameSync(file, dest);
        written.add(dest);
      }
      const demos = [
        "examples/provider-registration.ts",
        "examples/provider-resolver.ts",
        "examples/cache-aware-prompt-assembly.ts",
        "examples/compaction.ts",
        "examples/coding-compaction.ts",
        "examples/acp.ts",
        "examples/connected-slack-mcp.ts",
        "examples/open-connector-sidecar.ts",
        "examples/scoped-memory.ts",
        "examples/memory-lifecycle.ts",
        "examples/skills-progressive-disclosure.ts",
        "examples/caveman-ponytail.ts",
        "examples/hooks-json.ts",
        "examples/cli.ts",
        "examples/discover-skills.ts",
        "examples/instruction-injection.ts",
        "examples/system-project-prompts.ts",
        "examples/external-app-db-backed.ts",
        "examples/minimal-host-app.ts",
        "examples/custom-builders.ts",
        "examples/custom-session-store.ts",
        "examples/custom-tools-skills-context.ts",
        "examples/workflow-research-and-review.ts",
        "examples/workflow-parallel-research.ts",
        "examples/workflow-multimodal-document.ts",
        "examples/workflow-sqlite-resume.ts",
        "examples/workflow-postgres-resume.ts",
        "examples/workflow-event-sink.ts",
        "examples/workflow-loop.ts",
        "examples/build-workflow.ts",
        "examples/remote-agent.ts",
        "examples/headless-host.ts",
        "examples/ag-ui-a2ui.ts",
        "examples/durable-loops-and-approvals.ts",
        "examples/custom-loop.ts",
        "examples/define-package.ts",
        "examples/session.ts",
        "examples/approval.ts",
        "examples/host-hooks.ts",
        "examples/manifest.ts",
        "examples/openai-compatible.ts",
        "examples/custom-provider.ts",
        "examples/side-call.ts",
        "examples/decision-models.ts",
        "examples/sqlite-resume.ts",
        "examples/observational-memory.ts",
        "examples/durable-approval.ts",
        "examples/coding-approval.ts",
        "examples/web-no-key.ts",
        "examples/mcp-trust.ts",
        "examples/guardrail-packs.ts",
        "examples/governance-deny.ts",
        "examples/external-agent.ts",
        "examples/serve-tools.ts",
        "examples/custom-adapter.ts",
        "examples/delegate.ts",
        "examples/advisor.ts",
        "examples/validator.ts",
      ];
      const secret = /(?:sk-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,}|ghp_[A-Za-z0-9]{20,})/;
      for (const file of demos) {
        const jsFile = join(examplesDir, file.replace(/^examples\//, "").replace(/\.ts$/, ".js"));
        // Demos that import bun:sqlite cannot load under the branch audit's node parent.
        const result = spawnSync("bun", [jsFile], { encoding: "utf8" });
        assert.equal(result.status, 0, `${file} exited ${result.status}\n${result.stderr}`);
        const out = `${result.stdout}\n${result.stderr}`;
        assert.ok(out.trim().length > 0, `${file} produced no output`);
        assert.ok(!secret.test(out), `${file} emitted a real-looking secret`);
        if (file === "examples/headless-host.ts") {
          assert.ok(out.includes('"status":"resumed"'));
          assert.ok(out.includes('"scheduledFirings":1'));
          assert.ok(out.includes('"route":"channel","kind":"confirm","status":"answered"'));
          assert.ok(!out.includes("123456:headless-demo-dummy"), "headless demo emitted its dummy credential");
        }
        if (file === "examples/connected-slack-mcp.ts") {
          assert.deepEqual(JSON.parse(out), {
            readEffect: "none",
            writeEffect: "external_mutation",
            tools: ["mcp:slack:list_channels", "mcp:slack:get_channel", "mcp:slack:search_messages", "mcp:slack:post_message"],
          });
        }
        if (file === "examples/approval.ts") {
          const approval = JSON.parse(out) as {
            inline: { status: string; executed: string[] };
            suspended: { status: string; executedWhileSuspended: number };
            resumed: { executed: string[]; events: string[] };
          };
          assert.equal(approval.inline.status, "completed");
          assert.equal(approval.suspended.status, "suspended");
          assert.equal(approval.suspended.executedWhileSuspended, 0);
          assert.deepEqual(approval.resumed.executed, ["tmp/scratch.txt"]);
          assert.equal(approval.resumed.events.at(-1), "run.completed");
        }
        if (file === "examples/guardrail-packs.ts") {
          const packs = JSON.parse(out.trim().split("\n").at(-1) ?? "{}") as {
            blockedRules: string[];
            scenarioReason: string;
            askRule: string;
            askDispatched: string[];
            secretRule: string;
            toolsExecutedInStep1: number;
          };
          assert.deepEqual(packs.blockedRules, ["pack:destructive-commands/no-force-push", "pack:coding-standard/no-test-rewrites"]);
          assert.equal(packs.toolsExecutedInStep1, 0, "both built-in packs refused their call");
          assert.match(packs.scenarioReason, /pack:destructive-commands\/no-recursive-force-delete/);
          assert.equal(packs.askRule, "pack:deploy-guard/prod-version-approval");
          assert.deepEqual(packs.askDispatched, ["deploy"], "the approved call dispatched once");
          assert.equal(packs.secretRule, "pack:secrets-hygiene/no-secret-material-in-arguments");
        }
        if (file === "examples/governance-deny.ts") {
          const deny = JSON.parse(out.trim().split("\n").at(-1) ?? "{}") as {
            runStatus: string;
            executed: string[];
            blockedTool: string;
            blockedCode: string | number;
            blockedReason: string;
            auditOutcomes: string[];
          };
          assert.equal(deny.runStatus, "completed");
          assert.deepEqual(deny.executed, ["read_file"], "only the allow-listed tool ran");
          assert.equal(deny.blockedTool, "write_file");
          assert.equal(deny.blockedCode, "hook_denied");
          assert.match(deny.blockedReason, /denied by policy/);
          assert.deepEqual(deny.auditOutcomes, ["allow", "deny"], "the audit ledger holds both decisions");
        }
        if (file === "examples/coding-approval.ts") {
          const coding = JSON.parse(out) as {
            approved: { status: string; file: string; confirmRequests: number; selectRequests: number; layers: string[] };
            disabled: { shellInTools: boolean; shellBlocked: string | null; started: boolean };
            elapsedMs: number;
          };
          assert.equal(coding.approved.status, "completed");
          assert.equal(coding.approved.file, "after", "the approved edit changed the file");
          assert.equal(coding.approved.confirmRequests, 1, "ask mode asked the host once");
          assert.equal(coding.approved.selectRequests, 1, "the always/once follow-up ran");
          assert.deepEqual(coding.approved.layers, ["system-md", "agents-md"], "both context files were layered");
          assert.equal(coding.disabled.shellInTools, false, "disable.tools removed shell");
          assert.equal(coding.disabled.shellBlocked, "unknown_tool", "a disabled tool is blocked, not run");
          assert.equal(coding.disabled.started, false, "a disabled tool never starts");
          assert.ok(coding.elapsedMs < 5000, `coding-approval took ${coding.elapsedMs}ms`);
        }
        if (file === "examples/host-hooks.ts") {
          const hooks = JSON.parse(out) as { stopReason: string; executed: string[]; tools: string[] };
          assert.equal(hooks.stopReason, "hook_stop");
          assert.deepEqual(hooks.executed, ["read_file"], "the network call was denied");
          assert.deepEqual(hooks.tools, ["fetch_url", "read_file"], "the disabled tool is gone");
        }
        if (file === "examples/manifest.ts") {
          assert.deepEqual(JSON.parse(out), {
            installed: "@acme/hello@^1.0.0",
            capabilities: ["host-ui"],
            status: "completed",
            greeted: "hello prism",
            toolAfterDisable: false,
            untrustedLoaded: 0,
            literal: "secret_literal",
            unchanged: true,
            tampered: "integrity_mismatch",
            withinBudget: true,
          });
        }
        if (file === "examples/mcp-trust.ts") {
          const trust = JSON.parse(out) as {
            sentinelCreated: boolean;
            headerReceived: boolean;
            secretLeaked: boolean;
            untrustedState: string;
            untrustedReason: string;
            docsState: string;
            brokenState: string;
          };
          assert.equal(trust.sentinelCreated, false, "the untrusted project server never spawned");
          assert.equal(trust.headerReceived, true, "the trusted server received the header ref");
          assert.equal(trust.secretLeaked, false, "the header ref was never echoed");
          assert.equal(trust.untrustedState, "disabled", "the untrusted server is reported disabled");
          assert.equal(trust.untrustedReason, "untrusted", "the reason names untrusted");
          assert.equal(trust.docsState, "connected", "the trusted fixture server connected");
          assert.equal(trust.brokenState, "failed", "the unreachable trusted server failed");
        }
        if (file === "examples/open-connector-sidecar.ts") {
          assert.deepEqual(JSON.parse(out), {
            tools: ["mcp:oc:search_actions", "mcp:oc:get_action_guide", "mcp:oc:execute_action"],
            executeEffect: "external_mutation",
            executeIdempotency: "unsupported",
            selectRejected: true,
          });
        }
        if (file === "examples/external-agent.ts") {
          // Every behavior the Phase 13 Scope lists for the example, in the order the run shows them.
          assert.deepEqual(JSON.parse(out), {
            signIn: { signedIn: true, terminalRuns: 2 },
            main: {
              status: "completed",
              thinkingDeltas: true,
              textDeltas: true,
              skillActivation: true,
              subagent: true,
              materializedSkills: ["review-notes"],
              bridgedTools: ["lookup", "note"],
              steered: true,
              confirmRequests: 1,
              allowedWriteExit: 0,
              failClosedExit: 2,
            },
            resume: { suspended: true, completed: true, gateEntries: 1 },
            search: { hits: 1, found: true },
            policy: {
              hosted: "plan_login_not_permitted",
              principal: "profile_principal_mismatch",
              busy: { completed: 1, refused: ["profile_busy"] },
            },
          });
        }
        if (file === "examples/custom-adapter.ts") {
          // Extending a reference adapter: the base's wire, plus one flag, one decoded frame, and a narrowed policy.
          const custom = JSON.parse(out) as {
            status: string;
            adapter: { name: string; revision: string; base: string; baseRevision: string };
            extraFlag: boolean;
            activity: { name: string; kind: string; depth: number }[];
            decisions: {
              allowed: { isError: boolean; text: string };
              declined: { isError: boolean; text: string };
              confirmRequests: number;
              selectRequests: number;
            };
            worktreeFile: string;
            diff: { changes: string[]; truncated: boolean };
            overlay: { path: string; presentDuringRun: boolean; excluded: boolean };
            materializedSkills: string[];
          };
          assert.equal(custom.status, "completed");
          // `inspect()` names the extension and the base it extends.
          assert.deepEqual(custom.adapter, {
            name: "custom-adapter",
            revision: "2",
            base: "@example/prism-adapter-rpc-server",
            baseRevision: "1",
          });
          assert.equal(custom.extraFlag, true, "the extension's flag reached the binary");
          // The observed activity and the served calls all carry the external origin.
          assert.deepEqual(
            custom.activity.map((entry) => entry.name),
            ["agent.file", "message.delta", "tool.completed", "tool.started"],
          );
          assert.ok(
            custom.activity.every((entry) => entry.kind === "external" && entry.depth === 0),
            "every captured event carries the external origin",
          );
          // The extension's decoder turned the base's `agent.raw` frame into `agent.file`.
          assert.equal(custom.decisions.allowed.isError, false);
          assert.match(custom.decisions.allowed.text, /Edited .*: 1 block\(s\)/);
          assert.equal(custom.decisions.declined.isError, true, "the declined edit is refused");
          assert.match(custom.decisions.declined.text, /denied/);
          assert.deepEqual(
            { confirm: custom.decisions.confirmRequests, select: custom.decisions.selectRequests },
            { confirm: 2, select: 1 },
            "the scripted host saw one allow prompt and one deny prompt",
          );
          assert.equal(custom.worktreeFile, "edited", "the allowed edit changed the file in the worktree");
          assert.deepEqual(custom.diff, { changes: ["modified a.txt"], truncated: false });
          // The adapter's overlay was in the worktree during the run and never reached the diff.
          assert.deepEqual(custom.overlay, { path: ".rpc-server/extended.json", presentDuringRun: true, excluded: true });
          assert.deepEqual(custom.materializedSkills, ["review-notes"]);
        }
        if (file === "examples/serve-tools.ts") {
          // Every behavior the Phase 14 Scope lists for the example, on both transports.
          const served = JSON.parse(out) as {
            status: string;
            worktreeFile: string;
            overlay: { path: string; excluded: boolean };
            diff: { changes: string[]; truncated: boolean };
            merge: { status: string; files: string[]; worktreeUnchanged: boolean };
            http: ServedLegEvidence;
            stdio: ServedLegEvidence;
            origins: { types: string[]; vendor: string; kind: string; depth: number };
            prompts: { confirm: number; select: number };
          };
          assert.equal(served.status, "completed");
          // The allowed edit landed in the worktree, and the overlay is on disk but not in the diff.
          assert.equal(served.worktreeFile, "served");
          assert.equal(served.overlay.excluded, true, "the MCP config overlay is git-excluded");
          assert.deepEqual(served.diff, { changes: ["modified a.txt"], truncated: false });
          // A conflict is reported with its file, and the worktree is left untouched.
          assert.deepEqual(served.merge, { status: "conflict", files: ["a.txt"], worktreeUnchanged: true });
          for (const [transport, leg] of [
            ["loopback-http", served.http],
            ["stdio-relay", served.stdio],
          ] as const) {
            assert.equal(leg.transport, transport);
            // The allow list plus the permission tool, and nothing else.
            assert.deepEqual(leg.listed, ["read", "edit", "permission"]);
            assert.equal(leg.allowedEdit.replaced, true, `${transport}: the allowed edit replaced its block`);
            assert.equal(leg.read.text, "1\tserved", `${transport}: read returns the edited file with its line number`);
            assert.deepEqual(leg.declinedEdit, { isError: true, denied: true }, `${transport}: the deny reaches the vendor`);
            assert.deepEqual(leg.permission, { denied: "deny", allowed: "allow" });
            assert.equal(leg.outsideAllowList.refused, true, `${transport}: an unserved name is a JSON-RPC error`);
            assert.equal(leg.afterClose.refused, true, `${transport}: a call after close() is refused`);
            // The token is printed as `[redacted]`, never as its value.
            assert.deepEqual(
              Object.values(leg.env).filter((value) => value !== "[redacted]"),
              [],
            );
          }
          // Served calls carry the bridge origin through to the run's events.
          assert.deepEqual(served.origins, { types: ["tool.completed", "tool.started"], vendor: "example", kind: "external", depth: 0 });
          // Two legs, each asking the host: one allowed edit, one declined edit, one allowed permission.
          assert.deepEqual(served.prompts, { confirm: 8, select: 4 });
        }
      }
    } finally {
      for (const file of written) rmSync(file, { force: true });
      rmSync(emitRoot, { recursive: true, force: true });
    }
    // Two driver demos (`external-agent.ts` and `serve-tools.ts`) spawn real processes; under the full suite's
    // parallelism the whole loop needs more than 30 s.
  }, 60_000);

  it("manifest_example_imports_only_prism_manifest_and_testing", () => {
    const source = readFileSync("examples/manifest.ts", "utf8");
    const specifiers = [...source.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']/gm)].map((match) => match[1]);
    assert.ok(specifiers.some((specifier) => specifier === "@arnilo/prism/manifest"));
    for (const specifier of specifiers) {
      if (!specifier?.startsWith("@arnilo/")) continue;
      assert.ok(
        ["@arnilo/prism", "@arnilo/prism/manifest", "@arnilo/prism/testing"].includes(specifier),
        `examples/manifest.ts imports ${specifier}`,
      );
    }
  });

  it("phase_3_examples_import_only_prism_and_testing", () => {
    for (const file of ["examples/session.ts", "examples/approval.ts", "examples/host-hooks.ts"]) {
      const source = readFileSync(file, "utf8");
      const specifiers = [...source.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']/gm)].map((match) => match[1]);
      assert.ok(specifiers.length > 0, `${file} must import from the package`);
      for (const specifier of specifiers) {
        assert.ok(
          specifier === "@arnilo/prism" || specifier === "@arnilo/prism/testing",
          `${file} imports ${specifier}; Phase 3 examples use only @arnilo/prism and @arnilo/prism/testing`,
        );
      }
      assert.ok(!/\bimport\(/.test(source), `${file} must not use a dynamic import`);
    }
  });

  it("phase_5a_examples_import_only_prism_and_testing", () => {
    for (const file of ["examples/openai-compatible.ts", "examples/side-call.ts"]) {
      const source = readFileSync(file, "utf8");
      const specifiers = [...source.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']/gm)].map((match) => match[1]);
      assert.ok(specifiers.length > 0, `${file} must import from the package`);
      for (const specifier of specifiers) {
        assert.ok(
          specifier === "@arnilo/prism" || specifier === "@arnilo/prism/testing",
          `${file} imports ${specifier}; Phase 5 examples use only @arnilo/prism and @arnilo/prism/testing`,
        );
      }
      assert.ok(!/\bimport\(/.test(source), `${file} must not use a dynamic import`);
    }
  });

  it("phase_5a_examples_cover_the_builtin_provider_and_a_side_call", () => {
    const openaiCompatible = readFileSync("examples/openai-compatible.ts", "utf8");
    for (const phrase of ["Bun.serve", "openai-compatible", "baseUrl", 'credential: "env:EXAMPLE_LOCAL_KEY"', "sawBearer"]) {
      assert.ok(openaiCompatible.includes(phrase), `examples/openai-compatible.ts missing ${phrase}`);
    }
    const sideCall = readFileSync("examples/side-call.ts", "utf8");
    for (const phrase of ['capabilities: ["models"]', 'models.client("side/side")', "sideCalls"]) {
      assert.ok(sideCall.includes(phrase), `examples/side-call.ts missing ${phrase}`);
    }
  });

  it("phase8_package_readmes_state_cost", () => {
    const files = [
      "packages/memory/observational/README.md",
      "packages/memory/compaction/README.md",
      "packages/memory/rag/README.md",
      "packages/memory/wiki/README.md",
      "packages/memory/fabric/README.md",
      "packages/context/engineering/README.md",
    ];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const heading = "## Cost, security, and failure behavior";
      assert.ok(text.includes(heading), `${file} missing ${heading}`);
      const section = text.split(heading)[1]?.split("\n## ")[0] ?? "";
      assert.match(section, /model call|embedding call/i, `${file} cost section names no model or embedding call`);
      assert.match(section, /default|opt-in|unless/i, `${file} cost section names no default`);
    }
  });

  it("phase8_om_example_imports_only_the_package_default", () => {
    const source = readFileSync("examples/observational-memory.ts", "utf8");
    const imports = source.split("\n").filter((line) => /^\s*import\b/.test(line) && line.includes("@arnilo/prism-memory-observational"));
    assert.deepEqual(imports, ['import memoryObservational from "@arnilo/prism-memory-observational";']);
    assert.ok(!/\bimport\s*\{[^}]*\}\s*from\s*["']@arnilo\/prism-memory-observational["']/.test(source));
  });

  it("phase_6_examples_import_only_prism_testing_and_store_sqlite", () => {
    const allowed = new Set(["@arnilo/prism", "@arnilo/prism/testing", "@arnilo/prism-store-sqlite"]);
    for (const file of ["examples/sqlite-resume.ts", "examples/durable-approval.ts"]) {
      const source = readFileSync(file, "utf8");
      const specifiers = [...source.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']/gm)].map((match) => match[1]);
      assert.ok(specifiers.length > 0, `${file} must import from the package`);
      for (const specifier of specifiers) {
        assert.ok(
          allowed.has(specifier) || specifier.startsWith("node:"),
          `${file} imports ${specifier}; Phase 6 examples use only @arnilo/prism, @arnilo/prism/testing, and @arnilo/prism-store-sqlite`,
        );
      }
      assert.ok(!/\bimport\(/.test(source), `${file} must not use a dynamic import`);
      for (const phrase of ["mockProvider", "sqliteStore({ path", "agent.session({ id", "spawnSync"] as const) {
        assert.ok(source.includes(phrase), `${file} missing ${phrase}`);
      }
    }
    assert.ok(readFileSync("examples/durable-approval.ts", "utf8").includes("session.resume("), "the approval example must resume");
  });

  it("external_app_example_exercises_run_ledger_branch_handle_checkout_and_resume", () => {
    const file = readFileSync("examples/external-app-db-backed.ts", "utf8");
    for (const phrase of [
      "ProductionPersistenceStore",
      "RunLedger",
      "readBranchPath",
      "SessionAppendConflictError",
      "createDbBackedReferenceStore",
      "branchHandleLeaf",
      "checkout(branchHandleLeaf)",
      "session.fork",
      "queryRuns",
      "queryEvents",
      "queryToolCalls",
      "queryUsage",
      "secretRedactedFromLedger",
      "credentialNeverLogged",
      "storeConformance",
      "storeConformance(createDbBackedReferenceStore)",
      "conformancePassed",
    ]) {
      assert.ok(file.includes(phrase), `examples/external-app-db-backed.ts missing ${phrase}`);
    }
  });

  it("readme_has_no_real_looking_secrets", () => {
    const readme = readFileSync("README.md", "utf8");
    assert.equal(/sk-[A-Za-z0-9_-]{8,}/.test(readme), false, "README.md has real-looking secret");
  });

  it("2026-07-17 provider validation matrix lists all packages and P0-P2 ids and is indexed", () => {
    const index = readFileSync("docs/index.md", "utf8");
    assert.ok(index.includes("(_evidence/)"), "docs/index.md does not link the review coverage archive");

    const coverage = readFileSync("docs/_evidence/review-coverage-2026-07-17-provider-validation.md", "utf8");
    for (const adapter of ["openai", "kimi", "zai", "openrouter", "opencode-go", "neuralwatt", "ai-sdk"]) {
      assert.ok(coverage.includes(`@arnilo/prism-providers/${adapter}`), `provider validation matrix missing ${adapter}`);
    }
    for (const id of ["R-001", "R-002", "R-003", "R-004", "R-005", "R-006", "R-008", "R-009", "R-010", "R-011", "R-012"]) {
      assert.ok(coverage.includes(id), `provider validation matrix missing review id ${id}`);
    }
    for (const phrase of [
      "official-doc",
      "Pi secondary",
      "listNeuralWattModels",
      "thinkingFormat",
      "extra.thinkingLevel",
      "workerModel",
      "package-local",
      "Never** call discovery",
    ]) {
      assert.ok(coverage.includes(phrase), `provider validation matrix missing evidence phrase ${phrase}`);
    }
  });

  it("071_release_0_6_0_contract_is_documented", () => {
    // Plan 071 Task 16: the 0.6.0 cut supersedes the never-published 0.5.7 cut.
    // The guide exists, is reachable from the index navigation, states the Node
    // floor and the folded delta, and the 0.5.x guide no longer claims 0.5.7 as
    // its own status. The index banner check tracks the root manifest, so every
    // later cut (0.7.0 included) keeps this gate instead of bypassing it.
    const index = readFileSync("docs/index.md", "utf8");
    const guide = readFileSync("docs/migrate-to-0.6.md", "utf8");
    const previous = readFileSync("docs/migrate-to-0.5.md", "utf8");
    const migration = readFileSync("docs/migration.md", "utf8");
    const changelog = readFileSync("CHANGELOG.md", "utf8");
    const version = JSON.parse(readFileSync("package.json", "utf8")).version as string;
    assert.ok(index.includes("(migrate-to-0.6.md)"), "docs/index.md missing the 0.6.0 migration navigation entry");
    assert.ok(index.includes(`Current line (${version})`), `docs/index.md current line must be ${version}`);
    for (const phrase of [
      "Node `>=22`",
      'engines": { "node": ">=22"',
      "@arnilo/prism-office",
      "playwright-core",
      "snapshotCacheTtlMs",
      "idleRunTtlMs",
      "allowedCidrs",
      "## Upgrade steps",
      "## Rollback",
    ]) {
      assert.ok(guide.includes(phrase), `migrate-to-0.6.md missing ${phrase}`);
    }
    assert.ok(previous.includes("never published"), "migrate-to-0.5.md must record that 0.5.7 was never published");
    assert.ok(!previous.includes("## 10. Host-tunable knobs"), "migrate-to-0.5.md must not keep the 0.5.7-era section");
    assert.ok(!previous.includes("On 0.5.7:"), "migrate-to-0.5.md upgrade steps must not claim a 0.5.7 release");
    assert.ok(migration.includes("## 0.5.6 → 0.6.0"), "migration.md must carry the 0.5.6 → 0.6.0 entry");
    assert.ok(migration.includes("(migrate-to-0.6.md)"), "migration.md must link the 0.6.0 guide");
    assert.ok(!migration.includes("## 0.5.6 → 0.5.7"), "migration.md must fold the never-published 0.5.7 section");
    assert.ok(changelog.includes("## [0.6.0] - 2026-09-12"), "CHANGELOG.md must carry the 0.6.0 entry");
    assert.ok(changelog.includes("0.5.7 was never published"), "CHANGELOG.md must record the superseded 0.5.7 cut");
    assert.ok(changelog.includes("## [0.7.0] - 2026-09-15"), "CHANGELOG.md must carry the 0.7.0 entry");
  });

  it("0.0.4 release scope matrix has owners/evidence and completed predecessors", () => {
    // Historical plans 053–057 deleted with the plan archive; evidence matrix + package count remain the live gates.
    const coverage = readFileSync("docs/_evidence/review-coverage-2026-07-14.md", "utf8");
    const section = coverage.split("## Frozen 0.0.4 release scope\n")[1]?.split("\n### Performance")[0];
    assert.ok(section, "review coverage missing frozen release scope matrix");
    const rows = section.split("\n").filter((line) => line.startsWith("| ") && !line.startsWith("| ---"));
    assert.ok(rows.length > 1, "frozen release scope matrix has no data rows");
    for (const row of rows.slice(1)) {
      const cells = row
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      assert.equal(cells.length, 8, `invalid frozen scope row: ${row}`);
      for (const index of [1, 3, 4, 7]) assert.ok(cells[index], `empty owner/test/docs/status cell: ${row}`);
    }

    const manifests = ["package.json", ...workspaceDirs().map((dir) => join(dir, "package.json"))]
      .filter(existsSync)
      .map((path) => JSON.parse(readFileSync(path, "utf8")) as { private?: boolean });
    const count = (JSON.parse(readFileSync("scripts/package-truth.json", "utf8")) as { counts: { publishable: number } }).counts
      .publishable;
    assert.equal(manifests.filter((manifest) => !manifest.private).length, count, "publishable package count drifted");
  });

  it("readme_and_product_describe_0_13", () => {
    const product = readFileSync("PRODUCT.md", "utf8");
    const readme = readFileSync("README.md", "utf8");
    assert.ok(
      !/Nothing here is shipped/i.test(product) && !/not shipped/i.test(readme),
      "front-door docs must not carry a not-shipped banner",
    );
    assert.ok(!/Prism Code/.test(product + readme), "Prism Agent, not Prism Code, is the reference host");
    assert.ok(product.includes("**Prism Agent** is the reference host"), "PRODUCT.md must name Prism Agent as the reference host");
    for (const phrase of [
      "@arnilo/prism-driver-process",
      "@arnilo/prism-remote",
      "@arnilo/prism-headless",
      "agent.inspect()",
      ".prism/packages.json",
    ]) {
      assert.ok(product.includes(phrase), `PRODUCT.md missing ${phrase}`);
    }
    const quickstart = readme.match(/```ts\n([\s\S]*?)```/)?.[1] ?? "";
    for (const phrase of ["await createAgent(", "packages:", "agent.session()", "session.stream(", "agent.dispose()"]) {
      assert.ok(quickstart.includes(phrase), `README quickstart missing ${phrase}`);
    }
    assert.ok(!/sk-[A-Za-z0-9_-]{8,}/.test(quickstart), "README quickstart must not carry a literal key");
    for (const token of ["createAgentSession", "defineAgent", "Current scope", "@arnilo/prism-agent-sdk"]) {
      assert.ok(!readme.includes(token), `README.md must not present retired ${token}`);
    }
    for (const match of (product + readme).matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const href = match[1]!.split("#")[0]!;
      if (!href || /^(?:https?:|mailto:)/.test(href)) continue;
      assert.ok(existsSync(normalize(href)), `broken local link ${href}`);
    }
  });
});
