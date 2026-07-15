import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

// ponytail: one config entry per published package; adding a package is one line
const packages = [
  { dir: ".", name: "@arnilo/prism", isCore: true },
  { dir: "packages/provider-openai", name: "@arnilo/prism-provider-openai" },
  { dir: "packages/provider-opencode-go", name: "@arnilo/prism-provider-opencode-go" },
  { dir: "packages/provider-openrouter", name: "@arnilo/prism-provider-openrouter" },
  { dir: "packages/provider-zai", name: "@arnilo/prism-provider-zai" },
  { dir: "packages/provider-kimi", name: "@arnilo/prism-provider-kimi" },
  { dir: "packages/provider-neuralwatt", name: "@arnilo/prism-provider-neuralwatt" },
  { dir: "packages/coding-agent", name: "@arnilo/prism-coding-agent" },
  { dir: "packages/compaction-llm", name: "@arnilo/prism-compaction-llm" },
  { dir: "packages/compaction-observational-memory", name: "@arnilo/prism-compaction-observational-memory" },
  { dir: "packages/observability-opentelemetry", name: "@arnilo/prism-observability-opentelemetry" },
  { dir: "packages/tool-validator-json-schema", name: "@arnilo/prism-tool-validator-json-schema" },
  { dir: "packages/mcp", name: "@arnilo/prism-mcp" },
  { dir: "packages/session-store-sqlite", name: "@arnilo/prism-session-store-sqlite" },
  { dir: "packages/session-store-postgres", name: "@arnilo/prism-session-store-postgres" },
  { dir: "packages/credentials-node", name: "@arnilo/prism-credentials-node" },
  { dir: "packages/coding-security", name: "@arnilo/prism-coding-security" },
  { dir: "packages/workflows", name: "@arnilo/prism-workflows" },
  // Pure-manifest family/profile packages (no dist/exports): pack + install, but skip dynamic-import.
  { dir: "packages/prism-providers", name: "@arnilo/prism-providers", isMeta: true },
  { dir: "packages/prism-compaction", name: "@arnilo/prism-compaction", isMeta: true },
  { dir: "packages/prism-base", name: "@arnilo/prism-base", isMeta: true },
  { dir: "packages/prism-code", name: "@arnilo/prism-code", isMeta: true },
  { dir: "packages/prism-sdk", name: "@arnilo/prism-sdk", isMeta: true },
  { dir: "packages/prism-all", name: "@arnilo/prism-all", isMeta: true },
];

// Derive every documented core import specifier from the root `exports` map so
// the smoke test cannot drift from the public contract.
function coreSpecifiers(): string[] {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  const specs = ["@arnilo/prism"];
  for (const key of Object.keys(pkg.exports)) {
    if (key === ".") continue;
    specs.push("@arnilo/prism" + key.slice(1)); // "./node/config" -> "@arnilo/prism/node/config"
  }
  return specs;
}

function* walkFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(path);
    } else if (entry.isFile()) {
      yield path;
    }
  }
}

function run(cmd: string, args: string[], cwd: string) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

const staging = mkdtempSync(join(tmpdir(), "prism-smoke-stage-"));
const consumer = mkdtempSync(join(tmpdir(), "prism-smoke-consumer-"));

const result = { installStatus: -1, smokeStatus: -1, integrationStatus: -1, smokeOut: "", integrationOut: "", junk: [] as string[], tarballNames: [] as string[] };

before(() => {
  // 1. Pack core + every first-party package into the staging dir.
  for (const pkg of packages) {
    const r = run("npm", ["pack", "--pack-destination", staging], join(repoRoot, pkg.dir));
    if (r.status !== 0) throw new Error(`npm pack failed for ${pkg.name}:\n${r.stdout}\n${r.stderr}`);
  }
  const tarballs = readdirSync(staging)
    .filter((f) => f.endsWith(".tgz"))
    .map((f) => join(staging, f));
  result.tarballNames = tarballs.map((f) => f.split("/").pop()!);

  // 2. Fresh consumer project; install all tarballs together so the required
  //    `prism` peer is satisfied locally with no registry traffic.
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({ name: "@arnilo-prism-install-smoke", type: "module" }, null, 2),
  );
  const installArgs = [
    "install",
    ...tarballs,
    "--offline",
    "--no-audit",
    "--no-fund",
    "--no-update-notifier",
  ];
  let install = run("npm", installArgs, consumer);
  if (install.status !== 0) {
    // Fallback: cold cache or offline-unfriendly environment; no runtime deps
    // means this still makes zero registry fetches.
    install = run(
      "npm",
      ["install", ...tarballs, "--no-audit", "--no-fund", "--no-update-notifier"],
      consumer,
    );
  }
  result.installStatus = install.status;
  if (install.status !== 0) {
    result.smokeOut = `install failed:\n${install.stdout}\n${install.stderr}`;
    return;
  }

  // 3. Dynamic-import every documented specifier from the fresh install.
  const specs = [...coreSpecifiers(), ...packages.filter((p) => !p.isCore && !p.isMeta).map((p) => p.name)];
  writeFileSync(
    join(consumer, "smoke.mjs"),
    `const specs = ${JSON.stringify(specs)};\n` +
      "for (const s of specs) {\n" +
      "  try { await import(s); }\n" +
      "  catch (e) { console.error('IMPORT FAILED:', s, e.message); process.exit(1); }\n" +
      "}\nconsole.log('ALL IMPORTS OK');\n",
  );
  const smoke = run("node", ["smoke.mjs"], consumer);
  result.smokeStatus = smoke.status;
  result.smokeOut = smoke.stdout + smoke.stderr;

  // 4. Exercise validator + parallel local/MCP/coding tools from packed public imports.
  writeFileSync(join(consumer, "integration.mjs"), `
import assert from "node:assert/strict";
import {
  createAgent, createSecretRedactor, createToolRegistry, dispatchToolCall,
  providerDone, providerTextDelta,
} from "@arnilo/prism";
import { createShellTool, createWriteTool } from "@arnilo/prism-coding-agent";
import { createCodingApprovalPolicy } from "@arnilo/prism-coding-security";
import { mapMcpToolsToDefinitions } from "@arnilo/prism-mcp";
import { createJsonSchemaToolArgumentValidator } from "@arnilo/prism-tool-validator-json-schema";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let active = 0;
let maxActive = 0;
const starts = [];
const run = async (name, ms, value) => {
  starts.push(name); active++; maxActive = Math.max(maxActive, active);
  await sleep(ms); active--; return value;
};
const local = {
  name: "local",
  parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },
  execute: async (args, ctx) => ({ toolCallId: ctx.toolCallId, name: "local", value: await run("local", 40, args.text) }),
};
const [mcp] = mapMcpToolsToDefinitions(
  [{ name: "echo", description: "echo", inputSchema: local.parameters }],
  {
    namePrefix: "mcp:demo:", serverId: "demo", callTimeoutMs: 1000, maxResultBytes: 1000,
    isClosed: () => false,
    callRemoteTool: async (_name, args, ctx) => ({ toolCallId: ctx.toolCallId, name: "mcp:demo:echo", value: await run("mcp", 5, args.text) }),
  },
);
const approvals = [];
const policy = createCodingApprovalPolicy({ roots: [process.cwd()], approve: (request) => { approvals.push(request.action.kind); return true; } });
const shell = createShellTool(process.cwd(), {
  executionPolicy: policy,
  operations: { exec: async () => ({ exitCode: await run("shell", 15, 0) }) },
});
const tools = [local, mcp, shell];
let turn = 0;
const provider = { id: "mock", async *generate() {
  if (turn++ === 0) {
    yield { type: "tool_call", call: { type: "tool_call", id: "c1", name: "local", arguments: { text: "slow" } } };
    yield { type: "tool_call", call: { type: "tool_call", id: "c2", name: "mcp:demo:echo", arguments: { text: "fast" } } };
    yield { type: "tool_call", call: { type: "tool_call", id: "c3", name: "shell", arguments: { command: "echo safe" } } };
  } else yield providerTextDelta("done");
  yield providerDone();
} };
const canary = "packed-integration-secret";
const agent = createAgent({
  model: { provider: "mock", model: "demo" }, provider, tools,
  validator: createJsonSchemaToolArgumentValidator(), redactor: createSecretRedactor([canary]),
  loop: { strategy: "single-shot", toolConcurrency: 3 },
});
const session = agent.createSession({ id: "packed-integration" });
const events = [];
const reader = (async () => { for await (const event of session.subscribe()) events.push(event); })();
await session.run(canary, { maxToolRounds: 1 });
await reader;
const finished = events.filter((event) => event.type === "tool_execution_finished");
assert.equal(finished.length, 3);
const entries = await session.entries();
const orderedResults = entries.flatMap((entry) => entry.message?.content ?? []).filter((block) => block.type === "tool_result");
assert.deepEqual(orderedResults.map((block) => block.toolCallId), ["c1", "c2", "c3"]);
assert.equal(maxActive, 1, "exclusive shell overlapped a sibling call");
assert.ok(approvals.includes("shell"), "shell approval was not requested");
assert.equal(JSON.stringify(entries).includes(canary), false, "canary leaked into store");

const registry = createToolRegistry(tools);
const startsBeforeInvalid = starts.length;
const invalid = await dispatchToolCall({
  registry, call: { type: "tool_call", id: "bad", name: "local", arguments: { text: 1 } },
  context: { sessionId: "s", runId: "r", toolCallId: "bad" }, validate: createJsonSchemaToolArgumentValidator(),
});
assert.match(invalid.error?.message ?? "", /string/i);
assert.equal(starts.length, startsBeforeInvalid, "invalid args reached handler");
const deniedWrite = createWriteTool(process.cwd(), {
  executionPolicy: createCodingApprovalPolicy({ roots: [process.cwd()], readOnly: true }),
  operations: { mkdir: async () => assert.fail("denied write reached mkdir"), writeFile: async () => assert.fail("denied write reached writeFile") },
});
const denied = await dispatchToolCall({
  registry: createToolRegistry([deniedWrite]), call: { type: "tool_call", id: "deny", name: "write", arguments: { path: "blocked.txt", content: "x" } },
  context: { sessionId: "s", runId: "r", toolCallId: "deny" }, validate: createJsonSchemaToolArgumentValidator(),
});
assert.ok(denied.error, "read-only policy allowed write");
console.log("PACKED INTEGRATION OK");
`);
  const integration = run("node", ["integration.mjs"], consumer);
  result.integrationStatus = integration.status;
  result.integrationOut = integration.stdout + integration.stderr;

  // 5. Walk the installed @arnilo/prism* packages for leaked test artifacts / source maps.
  // Third-party transitive deps (e.g. `diff`) may ship their own maps; we only gate Prism packages.
  const nodeModules = join(consumer, "node_modules");
  for (const file of walkFiles(nodeModules)) {
    const rel = file.slice(nodeModules.length + 1);
    if (!rel.startsWith("@arnilo/prism")) continue;
    if (rel.includes("__tests__") || rel.endsWith(".map")) {
      result.junk.push(rel);
    }
  }
});

after(() => {
  rmSync(staging, { recursive: true, force: true });
  rmSync(consumer, { recursive: true, force: true });
});

describe("install smoke (fresh offline tarball install)", () => {
  it("installs core plus all first-party packages with a satisfied @arnilo/prism peer", () => {
    assert.equal(result.installStatus, 0, result.smokeOut);
  });

  it("every documented core subpath and every first-party package imports", () => {
    assert.equal(result.smokeStatus, 0, result.smokeOut);
  });

  it("packed validator, parallel local/MCP tools, and coding approval compose", () => {
    assert.equal(result.integrationStatus, 0, result.integrationOut);
  });

  it("installed packages contain no test artifacts or source maps", () => {
    assert.deepEqual(result.junk, [], `leaked into installed node_modules: ${result.junk.join(", ")}`);
  });

  // ponytail: npm strips @scope/ from tarball names; core (@arnilo/prism) -> arnilo-prism-0.0.4.tgz.
  // Regression guard so a future rename can't silently re-mangle the published filename.
  it("core tarball filename is arnilo-prism-0.0.4.tgz (npm strips the @scope/)", () => {
    assert.ok(
      result.tarballNames.includes("arnilo-prism-0.0.4.tgz"),
      `expected 'arnilo-prism-0.0.4.tgz' in ${JSON.stringify(result.tarballNames)}`,
    );
    assert.equal(result.tarballNames.length, packages.length, "tarball count must match package count");
    // The 3 umbrella metas must be present too.
    for (const meta of ["arnilo-prism-providers-0.0.4.tgz", "arnilo-prism-compaction-0.0.4.tgz", "arnilo-prism-all-0.0.4.tgz"]) {
      assert.ok(result.tarballNames.includes(meta), `missing umbrella tarball ${meta}`);
    }
  });
});
