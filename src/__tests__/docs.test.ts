import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const docsDir = "docs";
const apiPages = [
  "docs/public-contracts.md",
  "docs/agent-session-runtime.md",
  "docs/session-stores-and-branching.md",
  "docs/compaction-and-retry.md",
  "docs/provider-layer.md",
  "docs/provider-conformance.md",
  "docs/input-and-prompt-assembly.md",
  "docs/system-prompts.md",
  "docs/context-and-skills.md",
  "docs/configuration-and-manifests.md",
  "docs/contribution-registries.md",
  "docs/extensions.md",
  "docs/middleware-hooks.md",
  "docs/tools.md",
  "docs/node-filesystem-config.md",
  "docs/node-jsonl-session-store.md",
  "docs/resource-loading.md",
  "docs/credentials-and-redaction.md",
  "docs/settings-auth-trust-security.md",
  "docs/cli-rpc.md",
  "docs/providers/openai-compatible.md",
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
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
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

  it("api pages include required headings", () => {
    for (const page of apiPages) {
      const text = readFileSync(page, "utf8");
      for (const heading of requiredHeadings) assert.ok(text.includes(heading), `${page} missing ${heading}`);
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

    assert.ok(configDocs.includes("prism/node/config"));
    assert.deepEqual(packageJson.exports["./node/config"], {
      types: "./dist/node/config.d.ts",
      default: "./dist/node/config.js",
    });
    assert.ok(jsonlDocs.includes("prism/node/session-store-jsonl"));
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

  it("system prompt docs cover layers and secret warning", () => {
    const docs = readFileSync("docs/system-prompts.md", "utf8");
    for (const phrase of ["composeSystemPrompt", "package`, `app`, `user`, then `run`", "RunOptions.systemPrompt: false", "Do not put secrets in prompts"]){
      assert.ok(docs.includes(phrase), `system prompt docs missing ${phrase}`);
    }
  });

  it("provider conformance docs cover testing subpath and no network", () => {
    const docs = readFileSync("docs/provider-conformance.md", "utf8");
    for (const phrase of ["prism/testing/provider-conformance", "assertAbortIsObserved", "assertToolCallDeltasReconstruct", "No credentials", "network calls"]){
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
});
