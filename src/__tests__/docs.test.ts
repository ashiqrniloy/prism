import { existsSync, readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, normalize } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const docsDir = "docs";
const apiPages = [
  "docs/public-contracts.md",
  "docs/agent-session-runtime.md",
  "docs/agent-definitions.md",
  "docs/agent-loops.md",
  "docs/agent-events.md",
  "docs/structured-output.md",
  "docs/session-stores-and-branching.md",
  "docs/session-stores.md",
  "docs/database-persistence.md",
  "docs/compaction-and-retry.md",
  "docs/provider-layer.md",
  "docs/model-registry.md",
  "docs/provider-caching.md",
  "docs/provider-request-policies.md",
  "docs/provider-conformance.md",
  "docs/provider-packages.md",
  "docs/input-and-prompt-assembly.md",
  "docs/system-prompts.md",
  "docs/context-and-skills.md",
  "docs/configuration-and-manifests.md",
  "docs/contribution-registries.md",
  "docs/contribution-discovery.md",
  "docs/instruction-injection.md",
  "docs/extensions.md",
  "docs/middleware-hooks.md",
  "docs/tools.md",
  "docs/node-filesystem-config.md",
  "docs/node-jsonl-session-store.md",
  "docs/resource-loading.md",
  "docs/credentials-and-redaction.md",
  "docs/settings-auth-trust-security.md",
  "docs/cli-rpc.md",
  "docs/release-and-install.md",
  "docs/performance.md",
  "docs/migration.md",
];

const providerPackagePages: ReadonlyArray<[string, string]> = [
  ["docs/providers/openai.md", "packages/provider-openai/src/index.ts"],
  ["docs/providers/opencode-go.md", "packages/provider-opencode-go/src/index.ts"],
  ["docs/providers/openrouter.md", "packages/provider-openrouter/src/index.ts"],
  ["docs/providers/zai.md", "packages/provider-zai/src/index.ts"],
  ["docs/providers/kimi.md", "packages/provider-kimi/src/index.ts"],
  ["docs/providers/neuralwatt.md", "packages/provider-neuralwatt/src/index.ts"],
];

function exportedIdentifiers(packageIndex: string): string[] {
  const text = readFileSync(packageIndex, "utf8");
  const ids = new Set<string>();
  for (const m of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const id = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
      if (id) ids.add(id);
    }
  }
  for (const m of text.matchAll(/export\s+(?:function|const|class|interface|type)\s+([A-Za-z0-9_]+)/g)) {
    ids.add(m[1]);
  }
  return [...ids];
}
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
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
  });
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

  // ponytail: guard against plan-022 regression — the buggy pattern
  // `const { api } = createExtensionKernel(); api.registerProviderPackage(...)`
  // throws on copy-paste because createExtensionKernel() returns
  // { registries, middleware, events, load } with no `api` property.
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
        ...text.matchAll(/"prism":(?!\"\/cli\.js")/g),
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
    const pages = [...apiPages, ...markdownFiles("docs/providers")];
    for (const page of pages) {
      const text = readFileSync(page, "utf8");
      for (const heading of requiredHeadings) assert.ok(text.includes(heading), `${page} missing ${heading}`);
    }
  });

  it("phase42 cache provider model docs are linked and cover safety wording", () => {
    const index = readFileSync("docs/index.md", "utf8");
    for (const page of ["model-registry.md", "provider-caching.md", "provider-request-policies.md"]) {
      assert.ok(index.includes(`(${page})`), `docs/index.md does not link ${page}`);
      assert.ok(apiPages.includes(`docs/${page}`), `apiPages missing docs/${page}`);
    }

    const caching = readFileSync("docs/provider-caching.md", "utf8");
    for (const phrase of [
      "cacheKey` maps to `cache.key`",
      "Cache hints are best-effort",
      "does not guarantee cache hits",
      "Cache keys must never be credentials",
      "Provider-owned auth/session/security headers always win over caller headers",
      "sanitizeCacheKey",
      "applyCacheControl",
      "cacheHitRate",
      "cacheSavings",
      "cacheUsageReport",
    ]) assert.ok(caching.includes(phrase), `provider-caching.md missing ${phrase}`);

    const policies = readFileSync("docs/provider-request-policies.md", "utf8");
    for (const phrase of ["createSessionCachePolicy", "mergeProviderRequestOptions", "cache.breakpoints", "provider-owned auth/session/security headers"])
      assert.ok(policies.includes(phrase), `provider-request-policies.md missing ${phrase}`);

    const models = readFileSync("docs/model-registry.md", "utf8");
    for (const phrase of ["createModelRegistry", "ModelConfig.cache", "ModelCacheCapabilities", "maxBreakpoints", "longRetention"])
      assert.ok(models.includes(phrase), `model-registry.md missing ${phrase}`);
  });

  it("phase43 cache-aware ordering docs cover opt-in safety and diagnostics", () => {
    const index = readFileSync("docs/index.md", "utf8");
    for (const page of ["input-and-prompt-assembly.md", "provider-caching.md", "runs-and-usage.md"]) {
      assert.ok(index.includes(`(${page})`), `docs/index.md does not link ${page}`);
    }

    const input = readFileSync("docs/input-and-prompt-assembly.md", "utf8");
    for (const phrase of [
      'InputAssemblyLayout`: `"legacy" | "cache_aware"`',
      "Legacy layout is the default",
      'Set `inputLayout: "cache_aware"',
      "current input → attachments/resources → tool results",
      "attachments/resources → summaries → history → tool results → current input",
      "stable prefix only while those stable inputs stay byte-stable",
      "does not split tool transcripts",
      "URI attachments/resources load only through the caller-provided `ResourceLoader`",
    ]) assert.ok(input.includes(phrase), `input-and-prompt-assembly.md missing ${phrase}`);

    const caching = readFileSync("docs/provider-caching.md", "utf8");
    for (const phrase of [
      'inputLayout: "cache_aware"',
      "prefix is byte-stable only when those stable inputs are unchanged",
      "Prism still does not guarantee provider cache hits",
      "Cache keys must never be credentials or secrets",
      "cacheUsageReport",
      "do not include prompt text, cache keys, headers, credentials, or provider payloads",
    ]) assert.ok(caching.includes(phrase), `provider-caching.md missing ${phrase}`);

    const usage = readFileSync("docs/runs-and-usage.md", "utf8");
    for (const phrase of [
      "cacheUsageReport(record.usage, model)",
      "reports `cacheReadTokens` without `cacheWriteTokens`",
      "Cache diagnostics stay numeric",
      "do not add prompt text, cache keys, headers, credentials, or provider payloads",
    ]) assert.ok(usage.includes(phrase), `runs-and-usage.md missing ${phrase}`);
  });

  it("provider docs document a real export from their package", () => {
    for (const [page, packageIndex] of providerPackagePages) {
      const text = readFileSync(page, "utf8");
      const ids = exportedIdentifiers(packageIndex);
      assert.ok(ids.length > 0, `${packageIndex} has no exports`);
      assert.ok(
        ids.some((id) => text.includes(id)),
        `${page} does not document any export from ${packageIndex}`,
      );
    }
  });

  it("phase 3 docs are linked from the docs index", () => {
    const index = readFileSync("docs/index.md", "utf8");

    for (const page of ["configuration-and-manifests.md", "node-filesystem-config.md", "resource-loading.md"]) {
      assert.ok(index.includes(`(${page})`), `docs/index.md does not link ${page}`);
    }
  });

  it("phase 2 and 3 docs reference existing root exports", () => {
    const rootExports = readFileSync("src/index.ts", "utf8");
    const documentedExports = [
      ["docs/configuration-and-manifests.md", "mergeConfigLayers"],
      ["docs/configuration-and-manifests.md", "definePrismManifest"],
      ["docs/configuration-and-manifests.md", "parsePrismManifest"],
      ["docs/resource-loading.md", "loadTextResource"],
      ["docs/resource-loading.md", "loadJsonResource"],
      ["docs/resource-loading.md", "loadManifestResource"],
      ["docs/contribution-registries.md", "createContributionRegistry"],
      ["docs/contribution-registries.md", "createContributionRegistries"],
      ["docs/extensions.md", "createExtensionKernel"],
      ["docs/extensions.md", "createExtensionEventBus"],
      ["docs/middleware-hooks.md", "createMiddlewareRegistry"],
      ["docs/tools.md", "createToolRegistry"],
      ["docs/tools.md", "filterTools"],
      ["docs/tools.md", "dispatchToolCall"],
      ["docs/input-and-prompt-assembly.md", "createDefaultInputBuilder"],
      ["docs/input-and-prompt-assembly.md", "assembleProviderInput"],
      ["docs/input-and-prompt-assembly.md", "renderPromptTemplate"],
      ["docs/context-and-skills.md", "resolveContextProviders"],
      ["docs/context-and-skills.md", "createSkillRegistry"],
      ["docs/context-and-skills.md", "resolveActiveSkills"],
      ["docs/agent-session-runtime.md", "createAgent"],
      ["docs/agent-session-runtime.md", "createAgentSession"],
      ["docs/session-stores-and-branching.md", "createSessionEntry"],
      ["docs/session-stores-and-branching.md", "createMemorySessionStore"],
      ["docs/session-stores-and-branching.md", "rebuildSessionContext"],
      ["docs/compaction-and-retry.md", "createDefaultCompactionStrategy"],
      ["docs/compaction-and-retry.md", "createDefaultRetryPolicy"],
    ] as const;

    for (const [page, exportName] of documentedExports) {
      assert.ok(readFileSync(page, "utf8").includes(exportName), `${page} does not document ${exportName}`);
      assert.match(rootExports, new RegExp(`\\b${exportName}\\b`), `src/index.ts does not export ${exportName}`);
    }
  });

  it("phase 5 and 6 docs are linked from the docs index", () => {
    const index = readFileSync("docs/index.md", "utf8");

    assert.ok(index.includes("(input-and-prompt-assembly.md)"));
    assert.ok(index.includes("(context-and-skills.md)"));
    assert.ok(index.includes("(agent-session-runtime.md)"));
    assert.ok(index.includes("(session-stores-and-branching.md)"));
    assert.ok(index.includes("(compaction-and-retry.md)"));
  });

  it("compaction and retry docs cover public surfaces and safety boundaries", () => {
    const rootExports = readFileSync("src/index.ts", "utf8");
    const compactionRetry = readFileSync("docs/compaction-and-retry.md", "utf8");
    const index = readFileSync("docs/index.md", "utf8");
    const registries = readFileSync("docs/contribution-registries.md", "utf8");
    const extensions = readFileSync("docs/extensions.md", "utf8");
    const manifests = readFileSync("docs/configuration-and-manifests.md", "utf8");
    const middleware = readFileSync("docs/middleware-hooks.md", "utf8");
    const provider = readFileSync("docs/provider-layer.md", "utf8");

    for (const exportName of [
      "createDefaultCompactionStrategy",
      "isCompactionEntryData",
      "createDefaultRetryPolicy",
      "isTransientErrorInfo",
      "waitForRetry",
    ]) {
      assert.match(rootExports, new RegExp(`\\b${exportName}\\b`), `src/index.ts does not export ${exportName}`);
      assert.ok(compactionRetry.includes(exportName), `docs/compaction-and-retry.md does not document ${exportName}`);
    }

    for (const phrase of [
      "compaction_started",
      "compaction_finished",
      "retry_scheduled",
      "AgentConfig.compaction",
      "RunOptions.compaction",
      "AgentConfig.retry",
      "RunOptions.retry",
      "RetryMiddlewarePayload",
      "provider request messages/content",
      "credential resolvers",
      "Raw session entries are never deleted",
    ]) {
      assert.ok(compactionRetry.includes(phrase), `compaction/retry docs missing ${phrase}`);
    }

    assert.ok(index.includes("retry transient provider failures"));
    assert.ok(registries.includes("retryPolicies"));
    assert.ok(extensions.includes("registerRetryPolicy"));
    assert.ok(manifests.includes("retryPolicy"));
    assert.ok(middleware.includes("invokes `retry`"));
    assert.ok(provider.includes("ErrorInfo.code"));
  });

  it("phase 3 docs state explicit non-goals", () => {
    const combined = [
      "docs/configuration-and-manifests.md",
      "docs/node-filesystem-config.md",
      "docs/resource-loading.md",
    ].map((page) => readFileSync(page, "utf8")).join("\n");

    for (const phrase of ["package discovery", "dynamic import", "trust policy", "agent/session runtime"]) {
      assert.match(combined, new RegExp(phrase), `phase 3 docs do not mention ${phrase}`);
    }
  });

  it("node docs reference existing package subpaths", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { exports: Record<string, unknown> };
    const configDocs = readFileSync("docs/node-filesystem-config.md", "utf8");
    const jsonlDocs = readFileSync("docs/node-jsonl-session-store.md", "utf8");

    assert.ok(configDocs.includes("@arnilo/prism/node/config"));
    assert.deepEqual(packageJson.exports["./node/config"], {
      types: "./dist/node/config.d.ts",
      default: "./dist/node/config.js",
    });
    assert.ok(jsonlDocs.includes("@arnilo/prism/node/session-store-jsonl"));
    assert.deepEqual(packageJson.exports["./node/session-store-jsonl"], {
      types: "./dist/node/session-store-jsonl.d.ts",
      default: "./dist/node/session-store-jsonl.js",
    });
  });

  it("phase 10 docs link security auth trust surfaces", () => {
    const index = readFileSync("docs/index.md", "utf8");
    const docs = readFileSync("docs/settings-auth-trust-security.md", "utf8");
    const rootExports = readFileSync("src/index.ts", "utf8");
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { exports: Record<string, unknown> };

    assert.ok(index.includes("(settings-auth-trust-security.md)"));
    for (const name of ["createStaticSettingsProvider", "createMemoryCredentialStore", "assertTrusted", "assertPermission", "createSecretRedactor"]) {
      assert.ok(docs.includes(name), `security docs missing ${name}`);
      assert.match(rootExports, new RegExp(`\\b${name}\\b`), `src/index.ts does not export ${name}`);
    }
    for (const phrase of ["does not sandbox", "does not read environment variables", "no persistent secret store", "auto-load project-local"]) {
      assert.ok(docs.includes(phrase), `security docs missing ${phrase}`);
    }
    assert.deepEqual(packageJson.exports["./node/settings"], { types: "./dist/node/settings.d.ts", default: "./dist/node/settings.js" });
    assert.deepEqual(packageJson.exports["./node/trust"], { types: "./dist/node/trust.d.ts", default: "./dist/node/trust.js" });
  });

  it("docs_index_links_cli_rpc_page", () => {
    const index = readFileSync("docs/index.md", "utf8");
    assert.ok(index.includes("(cli-rpc.md)"));
  });

  it("contribution_discovery_docs_cover_layout_trust_cli_flags_and_non_goals", () => {
    const index = readFileSync("docs/index.md", "utf8");
    const cli = readFileSync("docs/cli-rpc.md", "utf8");
    const page = readFileSync("docs/contribution-discovery.md", "utf8");
    const registries = readFileSync("docs/contribution-registries.md", "utf8");
    const context = readFileSync("docs/context-and-skills.md", "utf8");
    const extensions = readFileSync("docs/extensions.md", "utf8");
    const manifests = readFileSync("docs/configuration-and-manifests.md", "utf8");
    const trust = readFileSync("docs/settings-auth-trust-security.md", "utf8");

    assert.ok(index.includes("(contribution-discovery.md)"), "docs/index.md does not link contribution-discovery.md");
    // Required section headings are enforced by the apiPages loop below; assert
    // the page is in the apiPages list so the headings are checked.
    assert.ok(apiPages.includes("docs/contribution-discovery.md"), "apiPages missing contribution-discovery.md");

    for (const phrase of [
      ".agents/{skills,tools,context,instructions}/<name>/",
      "SKILL.md",
      "AGENTS.md",
      "manifest.json",
      "createPathTrustPolicy",
      "isPathInsideReal",
      "opt-in",
      "does not `import()`",
      "No auto-activate",
      "No provider scanning",
      "examples/discover-skills.ts",
    ]) {
      assert.ok(page.includes(phrase), `docs/contribution-discovery.md missing ${phrase}`);
    }

    // The CLI flags appear in the CLI reference.
    for (const flag of ["--discover", "--discover-kinds", "--no-discovery"]) {
      assert.ok(cli.includes(flag), `docs/cli-rpc.md missing ${flag}`);
    }

    // Cross-references reciprocate from the related pages.
    assert.ok(registries.includes("contribution-discovery.md"), "contribution-registries.md does not cross-reference discovery");
    assert.ok(context.includes("contribution-discovery.md"), "context-and-skills.md does not cross-reference discovery");
    assert.ok(extensions.includes("contribution-discovery.md"), "extensions.md does not cross-reference discovery");
    assert.ok(manifests.includes("contribution-discovery.md"), "configuration-and-manifests.md does not cross-reference discovery");
    assert.ok(trust.includes("contribution-discovery.md"), "settings-auth-trust-security.md does not cross-reference discovery");
    assert.ok(cli.includes("contribution-discovery.md"), "cli-rpc.md does not cross-reference discovery");
  });

  it("release_and_install_page_is_linked_from_index", () => {
    const index = readFileSync("docs/index.md", "utf8");
    const docs = readFileSync("docs/release-and-install.md", "utf8");
    assert.ok(index.includes("(release-and-install.md)"), "docs/index.md does not link release-and-install.md");
    for (const phrase of ["required `@arnilo/prism` peer", "map-retention knob", "offline test budget", "sideEffects", "peerDependencies"]) {
      assert.ok(docs.includes(phrase), `docs/release-and-install.md missing ${phrase}`);
    }
  });

  it("release_and_install_docs_list_every_live_test_gate_env_var", () => {
    const docs = readFileSync("docs/release-and-install.md", "utf8");
    // Every opt-in gate var read by a live.test.ts must be enumerated here.
    for (const gate of [
      "PRISM_LIVE_PROVIDER_TESTS",
      "PRISM_LIVE_COMPACTION_TESTS",
      "PRISM_LIVE_OBSERVATIONAL_MEMORY_TESTS",
    ]) {
      assert.ok(docs.includes(gate), `docs/release-and-install.md does not document ${gate}`);
    }
    // The default suite must be stated as network-free so the opt-in status is unambiguous.
    assert.ok(/network-free/.test(docs), "docs/release-and-install.md must state default suite is network-free");
    // The guarded bodies are fake-safe placeholders and never read real provider keys.
    assert.ok(docs.includes("placeholder"), "docs/release-and-install.md must mark live tests as placeholder");
  });

  it("release_checklist_maps_each_gate_to_its_enforcement_test", () => {
    const docs = readFileSync("docs/release-and-install.md", "utf8");
    // The release checklist must be an executable gate table covering the new
    // persistence/runtime/migration surfaces, package exports/subpaths,
    // examples compile+listing, tarball exclusions, and public-API drift.
    assert.ok(docs.includes("## Release checklist"), "docs/release-and-install.md missing Release checklist section");
    for (const phrase of [
      "Docs coverage for persistence/runtime/migration surfaces",
      "Package exports/subpaths resolve to built output",
      "Public-API drift",
      "Examples compile and are listed",
      "Tarball excludes built tests, source maps, and source",
      "public-export-contract.test.ts",
      "docs.test.ts",
      "packaging.test.ts",
      "network-free-guard.test.ts",
      "migration.md",
      "no built-in app tools",
      "no hidden provider/credential globals",
      "no auto package discovery",
      "no secret persistence in core",
    ]) {
      assert.ok(docs.includes(phrase), `docs/release-and-install.md checklist missing ${phrase}`);
    }
  });

  it("cli_rpc_docs_cover_modes_flags_and_rpc_commands", () => {
    const docs = readFileSync("docs/cli-rpc.md", "utf8");
    for (const phrase of ["--mode print", "--provider", "--model", "prompt", "abort", "compact", "cloneSession", "No built-in app tools", "No full TUI"]) {
      assert.ok(docs.includes(phrase), `cli/rpc docs missing ${phrase}`);
    }
  });

  it("auth docs cover explicit resolver order and no hidden env", () => {
    const docs = readFileSync("docs/credentials-and-redaction.md", "utf8");
    for (const phrase of ["createExplicitCredentialResolver", "createEnvCredentialResolver", "refreshOAuthCredential", "runtime override", "Prism does not read `process.env`"]){
      assert.ok(docs.includes(phrase), `credential docs missing ${phrase}`);
    }
  });

  it("agent config inert fields are documented as host-owned", () => {
    const combined = [
      "docs/agent-session-runtime.md",
      "docs/extensions.md",
      "docs/credentials-and-redaction.md",
      "docs/settings-auth-trust-security.md",
      "docs/public-contracts.md",
    ].map((file) => readFileSync(file, "utf8")).join("\n");
    for (const phrase of [
      "AgentConfig.extensions",
      "AgentConfig.settings",
      "AgentConfig.credentials",
      "host-owned metadata",
      "do not call `settings.get()`",
      "do not call `credentials.resolve()`",
      "does not load extensions or call `Extension.setup()`",
    ]) {
      assert.ok(combined.includes(phrase), `inert AgentConfig docs missing ${phrase}`);
    }
  });

  it("system prompt docs cover layers and secret warning", () => {
    const docs = readFileSync("docs/system-prompts.md", "utf8");
    for (const phrase of ["composeSystemPrompt", "`user`, `package`, `app`, then `run`", "RunOptions.systemPrompt: false", "Do not put secrets in prompts"]){
      assert.ok(docs.includes(phrase), `system prompt docs missing ${phrase}`);
    }
  });

  it("system_prompt_docs_cover_agents_md_and_system_md_files_phase_31", () => {
    // Phase 31 Task 7 enforcement: the AGENTS.md / SYSTEM.md file-loader section,
    // CLI flags, trust model, SDK escape hatch, and behavior-change callout.
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { exports: Record<string, unknown> };
    const page = readFileSync("docs/system-prompts.md", "utf8");
    const cli = readFileSync("docs/cli-rpc.md", "utf8");
    const discovery = readFileSync("docs/contribution-discovery.md", "utf8");
    const index = readFileSync("docs/index.md", "utf8");

    // The Node subpath ships.
    assert.deepEqual(packageJson.exports["./node/system-prompts"], {
      types: "./dist/node/system-project-prompts.d.ts",
      default: "./dist/node/system-project-prompts.js",
    });

    // Layering order + behavior-change callout.
    for (const phrase of [
      "AGENTS.md and SYSTEM.md files",
      "loadSystemPromptFiles",
      "source: \"user\"",
      "source: \"app\"",
      "`SYSTEM.md` (user) → package → `AGENTS.md` (app) → host `AgentConfig.systemPrompt` → `RunOptions.systemPrompt`",
      "Behavior change (Phase 31)",
      "SDK escape hatch",
      "trust-gated",
      "redactProviderRequest",
      "examples/system-project-prompts.ts",
      "@arnilo/prism/node/system-prompts",
    ]) {
      assert.ok(page.includes(phrase), `docs/system-prompts.md missing ${phrase}`);
    }

    // The four CLI flags are documented in the CLI reference.
    for (const flag of ["--no-agents-md", "--no-system-md", "--agents-md-file", "--system-md-file"]) {
      assert.ok(cli.includes(flag), `docs/cli-rpc.md missing ${flag}`);
    }
    // The CLI documents the print/json auto-load + RPC host-owned exception.
    assert.ok(cli.includes("auto-loads"), "docs/cli-rpc.md does not document AGENTS.md/SYSTEM.md auto-load");

    // Discovery page cross-references the sibling loader (AGENTS.md/SYSTEM.md are not a scanner kind).
    assert.ok(discovery.includes("loadSystemPromptFiles"), "docs/contribution-discovery.md does not cross-reference loadSystemPromptFiles");
    assert.ok(discovery.includes("sibling"), "docs/contribution-discovery.md does not describe the loader as a sibling");

    // Index entry mentions walk-up loading.
    assert.ok(index.includes("AGENTS.md"), "docs/index.md System prompts entry does not mention AGENTS.md");
    assert.ok(index.includes("SYSTEM.md"), "docs/index.md System prompts entry does not mention SYSTEM.md");
  });

  it("provider conformance docs cover testing subpath and no network", () => {
    const docs = readFileSync("docs/provider-conformance.md", "utf8");
    for (const phrase of ["@arnilo/prism/testing/provider-conformance", "assertAbortIsObserved", "assertToolCallDeltasReconstruct", "No credentials", "network calls"]){
      assert.ok(docs.includes(phrase), `provider conformance docs missing ${phrase}`);
    }
  });

  it("provider request policy docs cover runtime timing and cache usage", () => {
    const combined = [
      "docs/provider-packages.md",
      "docs/provider-layer.md",
      "docs/middleware-hooks.md",
      "docs/agent-session-runtime.md",
    ].map((file) => readFileSync(file, "utf8")).join("\n");
    for (const phrase of ["createSessionCachePolicy", "ProviderRequest.options", "cacheRetention", "provider_request", "cache read/write"]){
      assert.ok(combined.includes(phrase), `provider request docs missing ${phrase}`);
    }
  });

  it("docs avoid real-looking secret examples", () => {
    for (const file of markdownFiles(docsDir)) {
      const text = readFileSync(file, "utf8");
      assert.equal(/sk-[A-Za-z0-9_-]{8,}/.test(text), false, `${file} has real-looking secret`);
    }
  });

  it("docs_provider_conformance_lists_new_helpers", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { exports: Record<string, unknown> };
    const docs = readFileSync("docs/provider-conformance.md", "utf8");

    assert.deepEqual(packageJson.exports["./testing/provider-conformance"], {
      types: "./dist/testing/provider-conformance.d.ts",
      default: "./dist/testing/provider-conformance.js",
    });
    for (const helper of ["assertSerializedRequestCoversContent", "assertNoSecretLeak"]) {
      assert.ok(docs.includes(helper), `docs/provider-conformance.md does not document ${helper}`);
    }
  });

  it("docs_middleware_hooks_match_runtime_supported_hooks", () => {
    const rootExports = readFileSync("src/index.ts", "utf8");
    const middlewareTs = readFileSync("src/middleware.ts", "utf8");
    const docs = readFileSync("docs/middleware-hooks.md", "utf8");
    const supported = [
      "provider_request",
      "input_assembly",
      "prompt_build",
      "context",
      "tool_call",
      "tool_result",
      "retry",
      "compaction",
      "session_start",
      "session_shutdown",
    ];

    assert.match(rootExports, /\bMiddlewareHookName\b/, "src/index.ts does not export MiddlewareHookName");
    for (const hook of supported) {
      assert.ok(middlewareTs.includes(`"${hook}"`), `src/middleware.ts missing hook ${hook}`);
      assert.ok(docs.includes(hook), `docs/middleware-hooks.md missing hook ${hook}`);
    }
    assert.ok(!middlewareTs.includes('"provider_response"'), "src/middleware.ts still contains removed provider_response hook");
    assert.ok(docs.includes("There is no `provider_response` hook"), "docs/middleware-hooks.md does not state provider_response is removed");
  });

  it("docs_manifest_kinds_include_current_provider_primitives", () => {
    const rootExports = readFileSync("src/index.ts", "utf8");
    const manifests = readFileSync("docs/configuration-and-manifests.md", "utf8");

    assert.match(rootExports, /\bManifestContributionKind\b/, "src/index.ts does not export ManifestContributionKind");
    for (const kind of [
      "providerPackage",
      "authMethod",
      "providerRequestPolicy",
      "systemPromptContribution",
      "instructionInjector",
    ]) {
      assert.ok(manifests.includes(kind), `docs/configuration-and-manifests.md does not document ${kind}`);
    }
  });

  it("provider_packages_docs_cover_cache_policy_and_request_options", () => {
    const docs = readFileSync("docs/provider-packages.md", "utf8");
    for (const phrase of ["cache policy", "createSessionCachePolicy", "ProviderRequest.options", "cacheRetention"]) {
      assert.ok(docs.includes(phrase), `docs/provider-packages.md missing ${phrase}`);
    }
  });

  it("llm_compaction_max_output_docs_match_provider_wire_fields", () => {
    const docs = ["docs/compaction-llm.md", "docs/compaction-and-retry.md", "docs/provider-packages.md"].map((file) => readFileSync(file, "utf8")).join("\n");
    for (const phrase of ["maxOutputTokens", "maxSummaryTokens", "model.parameters.maxTokens", "max_output_tokens", "max_tokens"]) {
      assert.ok(docs.includes(phrase), `LLM compaction max-output docs missing ${phrase}`);
    }
  });

  it("provider_timeout_retry_knobs_are_deprecated_with_runtime_migration", () => {
    const docs = [
      "docs/provider-packages.md",
      "docs/provider-layer.md",
      "docs/provider-conformance.md",
      "docs/agent-session-runtime.md",
      "docs/public-contracts.md",
      "docs/index.md",
    ].map((file) => readFileSync(file, "utf8")).join("\n");

    for (const phrase of ["timeoutMs", "maxRetries", "maxRetryDelayMs", "deprecated", "RunOptions.signal", "RunOptions.retry", "AgentConfig.retry"]) {
      assert.ok(docs.includes(phrase), `provider timeout/retry migration docs missing ${phrase}`);
    }
    assert.equal(docs.includes("retry/timeouts"), false, "docs still advertise provider-level retry/timeouts as supported");
  });

  it("first_party_providers_do_not_implement_deprecated_provider_timeout_retry_knobs", () => {
    for (const dir of ["provider-openai", "provider-openrouter", "provider-opencode-go", "provider-zai", "provider-kimi"]) {
      const combined = tsFiles(`packages/${dir}/src`).map((file) => readFileSync(file, "utf8")).join("\n");
      for (const knob of ["timeoutMs", "maxRetries", "maxRetryDelayMs"]) {
        assert.equal(combined.includes(knob), false, `${dir} unexpectedly implements deprecated ${knob}`);
      }
    }
  });

  it("phase39_protocol_docs_and_regressions_cover_end_to_end_paths", () => {
    const docs = [
      "docs/provider-conformance.md",
      "docs/agent-session-runtime.md",
      "docs/agent-loops.md",
      "docs/agent-events.md",
      "docs/compaction-llm.md",
      "docs/compaction-observational-memory.md",
      "docs/provider-packages.md",
      "docs/index.md",
    ].map((file) => readFileSync(file, "utf8")).join("\n");
    for (const phrase of [
      "tool_call_delta",
      "turn_started",
      "turn_finished",
      "timeoutMs",
      "deprecated",
      "model.parameters.maxTokens",
      "appendEntry",
      "tool_call",
      "tool_result",
    ]) assert.ok(docs.includes(phrase), `phase 39 docs missing ${phrase}`);

    const tests = [
      "src/__tests__/agents.test.ts",
      "src/__tests__/agent-loops.test.ts",
      "src/__tests__/docs.test.ts",
      "packages/compaction-llm/src/__tests__/strategy.test.ts",
      "packages/compaction-observational-memory/src/__tests__/runtime.test.ts",
      "packages/compaction-observational-memory/src/__tests__/workers.test.ts",
    ].map((file) => readFileSync(file, "utf8")).join("\n");
    for (const name of [
      "runtime_reconstructs_tool_call_delta_executes_persists_and_replays",
      "emits turn events and pushes first input to history once",
      "provider_timeout_retry_knobs_are_deprecated_with_runtime_migration",
      "llm_compaction_strategy_maps_max_output_tokens_to_request_model",
      "runtime_rejects_legacy_store_option_and_wrong_append_owner",
      "worker_transcript_replays_assistant_tool_call_before_tool_result",
    ]) assert.ok(tests.includes(name), `phase 39 regression missing ${name}`);
  });

  it("phase37_security_boundary_docs_cover_hardening_summary", () => {
    const index = readFileSync("docs/index.md", "utf8");
    const security = readFileSync("docs/settings-auth-trust-security.md", "utf8");
    const discovery = readFileSync("docs/contribution-discovery.md", "utf8");
    const injection = readFileSync("docs/instruction-injection.md", "utf8");
    const prompts = readFileSync("docs/system-prompts.md", "utf8");
    const manifests = readFileSync("docs/configuration-and-manifests.md", "utf8");
    const providers = readFileSync("docs/provider-packages.md", "utf8");
    const openrouter = readFileSync("docs/providers/openrouter.md", "utf8");

    for (const phrase of [
      "security-boundary hardening summary",
      "realpath-contained",
      "prototype-pollution key rejection",
      "provider-owned header precedence",
    ]) {
      assert.ok(index.includes(phrase), `docs/index.md missing ${phrase}`);
    }
    for (const phrase of [
      "Boundary hardening summary",
      "Contribution files",
      "Instruction resources",
      "Injector context",
      "System prompt sources",
      "Config/manifest JSON",
      "Provider headers",
      "add no workers, watchers, retries, network, or filesystem scans",
    ]) {
      assert.ok(security.includes(phrase), `settings-auth-trust-security.md missing ${phrase}`);
    }
    assert.ok(discovery.includes("entry-file symlink cannot escape"));
    assert.ok(injection.includes("already redacted by the runtime"));
    assert.ok(injection.includes("resourceTrust"));
    assert.ok(injection.includes("No privilege grant"));
    assert.ok(prompts.includes("Unknown custom sources sort between `package` and `app`"));
    assert.ok(manifests.includes("`__proto__`, `prototype`, and `constructor` keys at every depth"));
    assert.ok(providers.includes("provider-owned headers last"));
    assert.ok(openrouter.includes("OpenRouter-owned headers are applied last"));
  });

  it("phase38_docs_index_summarizes_api_cleanup", () => {
    const index = readFileSync("docs/index.md", "utf8");
    for (const phrase of [
      "fail-closed omitted capabilities",
      "migration-only `activateAllCapabilities`",
      "host-owned metadata",
      "replace-or-error duplicate policy",
      "`toolNames` fail closed before provider turns",
      "`duplicate: \"error\"` strict mode",
      "host-owned `AgentConfig.settings`/`credentials`",
      "avoid eager `AgentConfig.credentials` resolution",
    ]) {
      assert.ok(index.includes(phrase), `docs/index.md missing ${phrase}`);
    }
  });

  it("readme_describes_current_runtime_provider_packages_cli_and_examples", () => {
    const readme = readFileSync("README.md", "utf8");
    for (const name of ["createAgent", "createAgentSession"]) {
      assert.ok(readme.includes(name), `README.md does not mention ${name}`);
    }
    for (const pkg of [
      "@arnilo/prism-provider-openai",
      "@arnilo/prism-provider-opencode-go",
      "@arnilo/prism-provider-openrouter",
      "@arnilo/prism-provider-zai",
      "@arnilo/prism-provider-kimi",
    ]) {
      assert.ok(readme.includes(pkg), `README.md does not mention ${pkg}`);
    }
    for (const mode of ["--mode print", "--mode json", "--mode rpc"]) {
      assert.ok(readme.includes(mode), `README.md does not document CLI ${mode}`);
    }
    assert.ok(readme.includes("examples/"), "README.md does not reference examples/");
  });

  // ponytail: plan 042 Task 2 guard — the README quickstart must run the event
  // consumer concurrently with session.run(). The old form awaited the unbounded
  // `for await (const event of session.subscribe())` loop before calling
  // `session.run(...)`, which deadlocks because subscribe() only emits during a
  // live run. The quickstart must use a concurrent pattern (Promise.all with a
  // separate consumer, or launching run without awaiting before the loop) and
  // must NOT await the subscribe loop before starting the run.
  it("readme_quickstart_runs_subscribe_and_run_concurrently", () => {
    const readme = readFileSync("README.md", "utf8");
    const start = readme.indexOf("## Quick start");
    const end = readme.indexOf("## ", start + 1); // next top-level section
    const quickstart = readme.slice(start, end === -1 ? undefined : end);
    assert.ok(start !== -1, "README.md missing ## Quick start");
    assert.ok(quickstart.includes("session.subscribe()"), "README quickstart does not subscribe");
    assert.ok(quickstart.includes("session.run("), "README quickstart does not call session.run");
    assert.ok(
      quickstart.includes("Promise.all([consumer, session.run"),
      "README quickstart must run the subscribe consumer and session.run concurrently via Promise.all (the old form awaited the subscribe loop before session.run and deadlocked)",
    );
  });

  it("examples_files_exist_and_index_links_examples", () => {
    const index = readFileSync("docs/index.md", "utf8");
    assert.ok(index.includes("examples/"), "docs/index.md does not mention examples/");
    assert.ok(existsSync("examples/README.md"), "missing examples/README.md");
    const exampleFiles = [
      "examples/sdk-basics.ts",
      "examples/provider-registration.ts",
      "examples/provider-resolver.ts",
      "examples/api-key-auth.ts",
      "examples/oauth-login.ts",
      "examples/openrouter-model-cache-override.ts",
      "examples/tools.ts",
      "examples/context.ts",
      "examples/skills.ts",
      "examples/extensions.ts",
      "examples/manifests.ts",
      "examples/config-settings.ts",
      "examples/system-prompts.ts",
      "examples/system-project-prompts.ts",
      "examples/jsonl-stores-branching.ts",
      "examples/compaction.ts",
      "examples/observational-memory-recall-status-view.ts",
      "examples/cli.ts",
      "examples/rpc.ts",
      "examples/discover-skills.ts",
      "examples/instruction-injection.ts",
      "examples/external-app-db-backed.ts",
    ];
    for (const file of exampleFiles) {
      assert.equal(existsSync(file), true, `missing example file: ${file}`);
    }
  });

  it("examples_demos_run_to_completion_and_emit_no_secret", () => {
    // Node 24 strips TypeScript types natively; building core (the test suite
    // already built dist/) is enough for the `prism` and @arnilo/prism-* resolvers.
    const demos = [
      "examples/provider-registration.ts",
      "examples/provider-resolver.ts",
      "examples/compaction.ts",
      "examples/observational-memory-recall-status-view.ts",
      "examples/cli.ts",
      "examples/rpc.ts",
      "examples/discover-skills.ts",
      "examples/instruction-injection.ts",
      "examples/system-project-prompts.ts",
      "examples/external-app-db-backed.ts",
    ];
    const secret = /(?:sk-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,}|ghp_[A-Za-z0-9]{20,})/;
    for (const file of demos) {
      const result = spawnSync(process.execPath, [file], { encoding: "utf8" });
      assert.equal(result.status, 0, `${file} exited ${result.status}\n${result.stderr}`);
      const out = `${result.stdout}\n${result.stderr}`;
      assert.ok(out.trim().length > 0, `${file} produced no output`);
      assert.ok(!secret.test(out), `${file} emitted a real-looking secret`);
    }
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
    ]) {
      assert.ok(file.includes(phrase), `examples/external-app-db-backed.ts missing ${phrase}`);
    }
  });

  it("phase41_external_app_surfaces_are_gated_network_free", () => {
    // Consolidated Phase 41 release gate: migration guide + reference example +
    // index navigation all resolve, and each surface asserts its core behavior.
    assert.ok(existsSync("docs/migration.md"), "missing docs/migration.md");
    assert.ok(existsSync("examples/external-app-db-backed.ts"), "missing examples/external-app-db-backed.ts");

    const index = readFileSync("docs/index.md", "utf8");
    assert.ok(index.includes("migration.md"), "docs/index.md does not link migration.md");
    assert.ok(index.includes("examples/"), "docs/index.md does not mention examples/");

    const migration = readFileSync("docs/migration.md", "utf8");
    for (const phrase of [
      "JSONL → database-backed persistence",
      "ProductionPersistenceStore",
      "RunLedger",
      "explicit capability activation",
      "activateAllCapabilities",
      "readBranchPath",
    ]) {
      assert.ok(migration.includes(phrase), `docs/migration.md missing ${phrase}`);
    }

    const examplesReadme = readFileSync("examples/README.md", "utf8");
    assert.ok(examplesReadme.includes("external-app-db-backed.ts"), "examples/README.md does not list external-app-db-backed.ts");
  });

  it("readme_has_no_real_looking_secrets", () => {
    const readme = readFileSync("README.md", "utf8");
    assert.equal(/sk-[A-Za-z0-9_-]{8,}/.test(readme), false, "README.md has real-looking secret");
  });

  it("provider_resolver_docs_cover_resolver_and_third_party_packaging", () => {
    const providerLayer = readFileSync("docs/provider-layer.md", "utf8");
    assert.ok(providerLayer.includes("### Provider resolver"), "provider-layer.md missing Provider resolver section");
    assert.ok(providerLayer.includes("createProviderResolver"), "provider-layer.md does not surface createProviderResolver");
    assert.ok(providerLayer.includes("RunOptions.providerSource"), "provider-layer.md does not document RunOptions.providerSource");
    assert.ok(providerLayer.includes("AgentConfig.provider"), "provider-layer.md does not document direct provider precedence");

    const packages = readFileSync("docs/provider-packages.md", "utf8");
    assert.ok(packages.includes("## Third-party provider packaging"), "provider-packages.md missing Third-party provider packaging section");
    assert.ok(packages.includes("providerSource"), "provider-packages.md does not mention providerSource");
    assert.ok(packages.includes("opt-in and individually installable"), "provider-packages.md does not state first-party packages are opt-in");

    const runtime = readFileSync("docs/agent-session-runtime.md", "utf8");
    assert.ok(runtime.includes("providerSource"), "agent-session-runtime.md does not mention providerSource");
  });

  it("tools_docs_cover_runtime_validator_seam", () => {
    const tools = readFileSync("docs/tools.md", "utf8");
    const rootExports = readFileSync("src/index.ts", "utf8");
    const contracts = readFileSync("src/contracts.ts", "utf8");

    assert.match(rootExports, /\bToolValidator\b/, "src/index.ts does not export ToolValidator");
    assert.ok(contracts.includes("validator?: ToolValidator"), "AgentConfig does not declare validator");
    assert.ok(contracts.includes("validate?: ToolValidator"), "RunOptions does not declare validate");

    for (const phrase of [
      "Runtime-supplied validators",
      "AgentConfig.validator?",
      "RunOptions.validate?",
      "RunOptions.validate ?? AgentConfig.validator",
      "validation_failed",
      "SecretRedactor",
      "runs after the permission assertion",
    ]) {
      assert.ok(tools.includes(phrase), `docs/tools.md missing ${phrase}`);
    }
  });

  it("context_and_skills_docs_cover_runtime_selection_and_activation", () => {
    const page = readFileSync("docs/context-and-skills.md", "utf8");
    const rootExports = readFileSync("src/index.ts", "utf8");
    const contracts = readFileSync("src/contracts.ts", "utf8");

    assert.match(rootExports, /\bresolveActiveSkills\b/, "src/index.ts does not export resolveActiveSkills");
    assert.ok(contracts.includes("activeSkills?: readonly string[]"), "RunOptions does not declare activeSkills");
    assert.ok(contracts.includes("readonly skills?: readonly Skill[]"), "RunOptions does not declare skills override");

    for (const phrase of [
      "Runtime skill selection and activation",
      "RunOptions.activeSkills",
      "RunOptions.skills",
      "names win when a registry exists",
      "Skill.context",
      "after",
      "toolNames",
      "requires inactive tool",
      "before the first provider turn",
    ]) {
      assert.ok(page.includes(phrase), `docs/context-and-skills.md missing ${phrase}`);
    }
  });

  it("explicit capability migration docs cover old new and compatibility paths", () => {
    const agentDefinitions = readFileSync("docs/agent-definitions.md", "utf8");
    const contextSkills = readFileSync("docs/context-and-skills.md", "utf8");
    const registries = readFileSync("docs/contribution-registries.md", "utf8");
    const combined = `${agentDefinitions}\n${contextSkills}\n${registries}`;

    for (const phrase of [
      "Migration: explicit capability activation",
      "Old Phase 37 behavior",
      "omitted `tools` and omitted `skills` mean no active capabilities",
      "tools: [\"read\"]",
      "skills: [\"brief\"]",
      "activateAllCapabilities: true",
      "temporary all-skills/all-tools compatibility opt-in",
      "createContributionRegistries({ duplicate: \"error\" })",
      "silently shadow a capability name",
    ]) {
      assert.ok(combined.includes(phrase), `explicit capability migration docs missing ${phrase}`);
    }
  });

  it("registry docs cover strict duplicate policy", () => {
    const combined = [
      "docs/contribution-registries.md",
      "docs/provider-layer.md",
      "docs/tools.md",
      "docs/context-and-skills.md",
    ].map((file) => readFileSync(file, "utf8")).join("\n");
    for (const phrase of [
      "duplicate?: \"replace\" | \"error\"",
      "Duplicate provider",
      "Duplicate model",
      "Duplicate tool",
      "Duplicate skill",
      "Map.has()",
      "silent shadowing",
    ]) {
      assert.ok(combined.includes(phrase), `registry duplicate docs missing ${phrase}`);
    }
  });

  it("agent_loops_docs_cover_loop_strategies_and_artifact_contracts", () => {
    const page = readFileSync("docs/agent-loops.md", "utf8");
    const index = readFileSync("docs/index.md", "utf8");
    const runtime = readFileSync("docs/agent-session-runtime.md", "utf8");
    const contracts = readFileSync("docs/public-contracts.md", "utf8");
    const barrel = readFileSync("src/index.ts", "utf8");

    // required headings covered by the apiPages loop; assert key content here.
    assert.ok(index.includes("agent-loops.md"), "docs/index.md does not link agent-loops.md");
    assert.ok(runtime.includes("agent-loops.md"), "docs/agent-session-runtime.md does not cross-reference agent-loops.md");
    for (const name of ["singleShotLoop", "generateValidateReviseLoop", "resolveLoop"]) {
      assert.ok(new RegExp(`\\b${name}\\b`).test(barrel), `src/index.ts does not export ${name}`);
      assert.ok(page.includes(name), `docs/agent-loops.md missing ${name}`);
    }
    assert.ok(barrel.includes("isAgentLoopOptions"), "src/index.ts does not export isAgentLoopOptions");
    for (const phrase of [
      "AgentLoopStrategy",
      "AgentLoopOptions",
      "LoopContext",
      "ProviderTurnResult",
      "ArtifactValidation",
      "ArtifactContext",
      "ArtifactParser",
      "ArtifactValidator",
      "ArtifactRepairer",
      "RunOptions.loop",
      "AgentConfig.loop",
      "generate-validate-revise",
      "maxRevisions",
      "never instantiates",
    ]) {
      assert.ok(page.includes(phrase), `docs/agent-loops.md missing ${phrase}`);
    }
    for (const phrase of ["AgentLoopStrategy", "AgentLoopOptions", "LoopContext", "ProviderTurnResult", "ArtifactValidation", "ArtifactValidator"]) {
      assert.ok(contracts.includes(phrase), `docs/public-contracts.md missing ${phrase}`);
    }
  });

  it("agent_events_docs_cover_artifact_variants", () => {
    const page = readFileSync("docs/agent-events.md", "utf8");
    const index = readFileSync("docs/index.md", "utf8");
    for (const phrase of [
      "artifact_validation_started",
      "artifact_validation_finished",
      "artifact_revision_started",
      "artifact_finished",
      "artifact_failed",
      "attempt",
      "retry_scheduled",
      "tool_execution_blocked",
      "redactAgentEvent",
      "recoverable",
      "budget exhausted",
      "singleShotLoop",
      "generateValidateReviseLoop",
    ]) {
      assert.ok(page.includes(phrase), `docs/agent-events.md missing ${phrase}`);
    }
    assert.ok(index.includes("agent-events.md"), "docs/index.md does not link agent-events.md");
  });

  it("structured_output_docs_cover_parser_validator_repairer", () => {
    const page = readFileSync("docs/structured-output.md", "utf8");
    const index = readFileSync("docs/index.md", "utf8");
    for (const phrase of [
      "ArtifactParser",
      "ArtifactValidator",
      "ArtifactRepairer",
      "ArtifactValidation",
      "ArtifactContext",
      "ArtifactParseResult",
      "never instantiates",
      "generate-validate-revise",
      "maxRevisions",
      "redactAgentEvent",
      "createSecretRedactor",
    ]) {
      assert.ok(page.includes(phrase), `docs/structured-output.md missing ${phrase}`);
    }
    // ponytail: boundary guard — page states the Synapta-free lock (not absence of the
    // consuming-app name, which legitimately appears as "Synapta-style").
    assert.ok(page.includes("never instantiates"), "docs/structured-output.md missing never-instantiates lock");
    assert.ok(/no .*domain (control-flow )?vocabulary/.test(page), "docs/structured-output.md missing domain-vocabulary lock");
    assert.ok(index.includes("structured-output.md"), "docs/index.md does not link structured-output.md");
  });

  it("instruction_injection_page_is_linked_from_index_and_follows_api_structure", () => {
    // Phase 30 Task 9 enforcement: the docs page is present, linked from the index,
    // and carries the required prism-wiki API page headings (enforced by the apiPages
    // loop above — membership is the gate). This assertion pins index linkage + content.
    const index = readFileSync("docs/index.md", "utf8");
    const page = readFileSync("docs/instruction-injection.md", "utf8");
    assert.ok(index.includes("(instruction-injection.md)"), "docs/index.md does not link instruction-injection.md");
    for (const phrase of [
      "InstructionInjector",
      "InstructionContribution",
      "InstructionContext",
      "registerInstructionInjector",
      "resolveInstructionInjectors",
      "first_turn",
      "every_turn",
      "on_input",
      "AgentConfig.instructionInjectors",
      "RunOptions.instructionInjectors",
    ]) {
      assert.ok(page.includes(phrase), `docs/instruction-injection.md missing ${phrase}`);
    }
  });

  it("database_persistence_docs_cover_phase_34_schema_indexes_retention_migrations_and_nosql", () => {
    const page = readFileSync("docs/database-persistence.md", "utf8");
    const sessionStores = readFileSync("docs/session-stores.md", "utf8");

    // Required entities from roadmap Phase 34.
    for (const entity of [
      "prism_tenants",
      "prism_accounts",
      "prism_users",
      "prism_agent_definitions",
      "prism_sessions",
      "prism_branches",
      "prism_session_entries",
      "prism_runs",
      "prism_agent_events",
      "prism_tool_calls",
      "prism_usage",
      "prism_retention_policies",
      "prism_migrations",
    ]) {
      assert.ok(page.includes(entity), `docs/database-persistence.md missing entity ${entity}`);
    }

    // Required index/query keys.
    for (const key of [
      "session_id",
      "run_id",
      "parent_id",
      "leaf_entry_id",
      "timestamp",
      "tenant_id",
      "account_id",
      "user_id",
      "type",
      "kind",
      "expires_at",
      "idempotency_key",
    ]) {
      assert.ok(page.includes(key), `docs/database-persistence.md missing index/key ${key}`);
    }

    // Retention and migration sections.
    for (const phrase of ["Retention policies", "Migrations", "NoSQL mapping notes", "JSONL"]) {
      assert.ok(page.includes(phrase), `docs/database-persistence.md missing section ${phrase}`);
    }

    // Performance adapter guidance.
    for (const phrase of [
      "Adapter performance guidance",
      "Cursor pagination",
      "Batch appends",
      "Event sequence allocation",
      "Run/event/usage query shapes",
      "Host-owned sizing",
      "(run_id, sequence)",
      "(run_id, recorded_at, id)",
    ]) {
      assert.ok(page.includes(phrase), `docs/database-persistence.md missing performance guidance ${phrase}`);
    }

    // Security locks.
    assert.ok(page.includes("never stores provider credentials"), "docs/database-persistence.md missing credentials lock");
    assert.ok(page.includes("redacted"), "docs/database-persistence.md missing redaction mention");

    // session-stores.md cross-links the schema.
    assert.ok(sessionStores.includes("database-persistence.md"), "docs/session-stores.md does not link database-persistence.md");
  });

  it("performance docs keep long-session and JSONL boundaries explicit", () => {
    const performance = readFileSync("docs/performance.md", "utf8");
    const jsonl = readFileSync("docs/node-jsonl-session-store.md", "utf8");
    const database = readFileSync("docs/database-persistence.md", "utf8");
    const runs = readFileSync("docs/runs-and-usage.md", "utf8");

    for (const phrase of ["SessionStore.readBranchPath", "`SessionStore.list(sessionId)` is a full-session read", "cursor", "event `sequence`", "JSONL store rereads/parses the file", "page-size caps", "(run_id, sequence)", "(run_id, recorded_at, id)"]) {
      assert.ok(performance.includes(phrase), `docs/performance.md missing ${phrase}`);
    }
    for (const phrase of ["production multi-writer storage", "Reads are linear in file size", "no cross-process lock"]) {
      assert.ok(jsonl.includes(phrase), `docs/node-jsonl-session-store.md missing ${phrase}`);
    }
    assert.ok(database.includes("readBranchPath"), "docs/database-persistence.md missing readBranchPath guidance");
    assert.ok(database.includes("cursor"), "docs/database-persistence.md missing cursor guidance");
    assert.ok(runs.includes("preserve per-run order before acknowledging a batch"), "docs/runs-and-usage.md missing batch ordering guidance");
  });

  it("phase47 neuralwatt cache/reasoning/tool docs cover required topics and index links them", () => {
    const index = readFileSync("docs/index.md", "utf8");
    for (const page of ["providers/neuralwatt.md", "provider-caching.md", "agent-session-runtime.md"]) {
      assert.ok(index.includes(`(${page})`), `docs/index.md does not link ${page}`);
    }

    const neuralwatt = readFileSync("docs/providers/neuralwatt.md", "utf8");
    // Cache + cache-aware limiter.
    for (const phrase of ["implicit prefix caching", "Cache-aware limiter behavior", "cached_tokens", "cacheRetention: \"none\""]) {
      assert.ok(neuralwatt.includes(phrase), `docs/providers/neuralwatt.md missing ${phrase}`);
    }
    // Reasoning controls (all five).
    for (const phrase of ["reasoning_effort", "thinking_token_budget", "enable_thinking", "preserve_thinking", "clear_thinking"]) {
      assert.ok(neuralwatt.includes(phrase), `docs/providers/neuralwatt.md missing reasoning control ${phrase}`);
    }
    // Reasoning preservation + tool-call loop.
    assert.ok(neuralwatt.includes("Reasoning preservation across turns"), "neuralwatt.md missing reasoning preservation section");
    assert.ok(neuralwatt.includes("Tool calls and the tool-call loop"), "neuralwatt.md missing tool-call loop section");
    assert.ok(neuralwatt.includes("reasoning_content"), "neuralwatt.md missing reasoning_content field");

    const caching = readFileSync("docs/provider-caching.md", "utf8");
    // NeuralWatt implicit caching covered in the shared caching page.
    for (const phrase of ["NeuralWatt", "implicit", "cached_input_per_million", "does not guarantee cache hits"]) {
      assert.ok(caching.includes(phrase), `docs/provider-caching.md missing ${phrase}`);
    }

    const runtime = readFileSync("docs/agent-session-runtime.md", "utf8");
    // Runtime carries prior reasoning and tool transcripts forward.
    for (const phrase of ["thinking", "tool_call", "tool_result", "reasoning_content"]) {
      assert.ok(runtime.includes(phrase), `docs/agent-session-runtime.md missing ${phrase}`);
    }
    // No cache-hit guarantees anywhere in the four pages.
    for (const page of ["docs/providers/neuralwatt.md", "docs/provider-caching.md", "docs/agent-session-runtime.md", "docs/index.md"]) {
      const text = readFileSync(page, "utf8").toLowerCase();
      assert.ok(!/guaranteed cache hit|will always cache|cache will hit/.test(text), `${page} promises cache hits`);
    }
  });
});
