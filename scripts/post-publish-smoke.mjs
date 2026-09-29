#!/usr/bin/env node
import { spawnSync } from "node:child_process";
// Post-publish verification: install the release packages into a fresh consumer project
// and exercise one real behavior per headline surface.
//
//   bun scripts/post-publish-smoke.mjs                    # from the registry (after publish)
//   bun scripts/post-publish-smoke.mjs --local            # from local tarballs (pre-publish parity)
//   bun scripts/post-publish-smoke.mjs --version 0.11.0   # pin the version
//   bun scripts/post-publish-smoke.mjs --prism-code       # also smoke the Prism Code app install
//   bun scripts/post-publish-smoke.mjs --prism-code --prism-code-version 0.4.0
//
// Registry mode is the post-publish gate: it proves the published artifacts (not the working
// tree) resolve `./fabric`, `./scoped`, the hooks adapter, and the work `./document-extraction`
// subpath with and without its optional `@firecrawl/anydoc` peer. `--local` runs the same checks
// against `npm pack` output, so a broken `files` entry or subpath export fails before the tag
// is pushed. Network-free after install; exit code 1 on any failed check.
//
// Plan 140 Task 2: `--prism-code` appends the app surface — a global `bun add -g` of
// `@arnilo/prism-code` (independently versioned, so it has its own `--prism-code-version`, default
// its manifest version) checked by scripts/prism-code-install-smoke.mjs: version, headless mock
// run, doctor, PTY launch/exit, a single `@arnilo/prism`, and `bunx` in registry mode.
//
// Plan 125 Task 2: tarballs still come from `npm pack` (the release-host registry toolchain) and
// the registry specs are still npm's names, but the consumer installs and runs on Bun.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const local = argv.includes("--local");
const versionIndex = argv.indexOf("--version");
const version = versionIndex === -1 ? null : argv[versionIndex + 1];
if (versionIndex !== -1 && !version) throw new Error("--version requires a value");
const prismCode = argv.includes("--prism-code");
const prismCodeVersionIndex = argv.indexOf("--prism-code-version");
const prismCodeVersion = prismCodeVersionIndex === -1 ? null : argv[prismCodeVersionIndex + 1];
if (prismCodeVersionIndex !== -1 && !prismCodeVersion) throw new Error("--prism-code-version requires a value");
if (prismCodeVersion && !prismCode) throw new Error("--prism-code-version requires --prism-code");

const PACKAGES = ["@arnilo/prism", "@arnilo/prism-memory", "@arnilo/prism-hooks", "@arnilo/prism-work"];
const resolvedVersion = version ?? JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const anydocPin = JSON.parse(readFileSync(join(root, "packages/prism-work/package.json"), "utf8")).peerDependencies["@firecrawl/anydoc"];
const odtFixture = join(root, "packages/prism-work/src/document-extraction/__tests__/fixtures/hello.odt");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: options.quiet ? "pipe" : "inherit", ...options });
  if (result.status !== 0) {
    if (options.quiet && result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
  return result.stdout ?? "";
}

const workdir = mkdtempSync(join(tmpdir(), "prism-post-publish-smoke-"));
const consumer = join(workdir, "consumer");
run("mkdir", ["-p", consumer]);
writeFileSync(
  join(consumer, "package.json"),
  `${JSON.stringify({ name: "prism-post-publish-smoke", private: true, type: "module" }, null, 2)}\n`,
);

let specs;
if (local) {
  specs = PACKAGES.map((pkg) => {
    const workspace = pkg === "@arnilo/prism" ? [] : ["--workspace", pkg];
    // release-host registry toolchain — runner images ship Node; contributors never invoke npm
    const packed = run("npm", ["pack", "--silent", "--pack-destination", workdir, ...workspace], { cwd: root, quiet: true })
      .trim()
      .split("\n")
      .pop();
    return join(workdir, packed);
  });
} else {
  specs = PACKAGES.map((pkg) => `${pkg}@${resolvedVersion}`);
}
console.log(`post-publish smoke: ${local ? "local tarballs" : "registry"} — ${specs.join(" ")}`);

run("bun", ["install", ...specs, "--no-audit", "--no-fund", ...(local ? ["--prefer-offline"] : [])], { cwd: consumer });
writeFileSync(join(consumer, "smoke.mjs"), smokeSource());
run("bun", ["smoke.mjs"], { cwd: consumer });

// Work family: default import with no optional peers, then the opt-in anydoc route.
writeFileSync(join(consumer, "smoke-work.mjs"), workSmokeSource({ consumer, odt: odtFixture, anydocPin }));
run("bun", ["smoke-work.mjs"], { cwd: consumer });
run("bun", ["add", `@firecrawl/anydoc@${anydocPin}`, "--prefer-offline", "--no-audit", "--no-fund"], { cwd: consumer });
writeFileSync(join(consumer, "smoke-anydoc.mjs"), anydocSmokeSource({ odt: odtFixture, anydocPin }));
run("bun", ["smoke-anydoc.mjs"], { cwd: consumer });

if (prismCode) {
  const appArgs = local ? [] : ["--registry", ...(prismCodeVersion ? ["--version", prismCodeVersion] : [])];
  run("bun", [join(root, "scripts", "prism-code-install-smoke.mjs"), ...appArgs], { cwd: root });
}

console.log(`post-publish smoke: PASS (${local ? "local tarballs" : `registry @${resolvedVersion}`})`);

// The consumer-side checks: one import per headline surface plus one real behavior each.
function smokeSource() {
  return `import { mkdtemp } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgent, forwardAgentEvents, createExtensionKernel, activateKernel, providerTextDelta, providerDone } from "@arnilo/prism";
import { createMemory, createHashEmbedder } from "@arnilo/prism-memory";
import { createMemoryFabric } from "@arnilo/prism-memory/fabric";
import { createScopedMemoryPolicy } from "@arnilo/prism-memory/scoped";
import { parseHooksConfig, createHooksExtension } from "@arnilo/prism-hooks";

const checks = [];
checks.push(["root: createAgent + event bridge + kernel", [createAgent, forwardAgentEvents, createExtensionKernel, activateKernel].every((f) => typeof f === "function")]);
checks.push(["memory root: createMemory", typeof createMemory === "function"]);
checks.push(["memory ./fabric subpath", typeof createMemoryFabric === "function"]);
checks.push(["memory ./scoped subpath", typeof createScopedMemoryPolicy === "function"]);
checks.push(["hooks adapter exports", typeof parseHooksConfig === "function" && typeof createHooksExtension === "function"]);

const codex = parseHooksConfig({ hooks: { UserPromptSubmit: [{ matcher: "*", hooks: [{ type: "command", command: "true" }] }] } });
const claude = parseHooksConfig({ UserPromptSubmit: [{ matcher: "*", hooks: [{ type: "command", command: "true" }] }] });
checks.push(["parseHooksConfig accepts both shapes", Array.isArray(codex.events?.UserPromptSubmit) && Array.isArray(claude.events?.UserPromptSubmit)]);
const hooks = createHooksExtension(codex);
checks.push(["createHooksExtension returns extension + guardrails", typeof hooks?.setup === "function" && typeof hooks?.guardrails === "object"]);

const scopeRoot = await mkdtemp(join(tmpdir(), "prism-scoped-smoke-"));
const memory = createMemory({ tenantId: "smoke", resourceId: scopeRoot, threadId: "scoped", embedder: createHashEmbedder({ dimensions: 8 }) });
const fabric = createMemoryFabric({ memory, consolidate: false });
const policy = createScopedMemoryPolicy({ memory, fabric, scopeRoot });
const miss = await policy.recall("unladenswallow airspeed");
checks.push(["scoped recall abstains below the floor", miss.hits.length === 0 && miss.abstained === true]);
await policy.reviewSession("remember", { reviewer: async () => [{ kind: "fact", content: "alphazebra uniquequeryxyz staging ssh listens on port 2222", sourceEntryIds: ["aaaaaaaaaaaa"] }] });
const hit = await policy.recall("alphazebra uniquequeryxyz staging ssh");
checks.push(["scoped write then recall above the floor", !hit.abstained && hit.hits.length >= 1]);
checks.push(["scoped ledger written", readFileSync(join(scopeRoot, ".memory", "state.json"), "utf8").length > 0]);

const provider = { id: "mock", async *generate() { yield providerTextDelta("ok"); yield providerDone(); } };
const agent = createAgent({ model: { provider: "mock", model: "smoke" }, provider, stopHooks: [{ name: "smoke", decide: async () => ({ action: "stop" }) }] });
const session = agent.createSession({ id: "post-publish-smoke" });
const result = await session.run("hi");
checks.push(["run with a stop hook settles", typeof result?.status === "string"]);
checks.push(["AgentSession.close() present", typeof session.close === "function"]);
await session.close();
await session.close();
checks.push(["close() is idempotent", true]);

for (const [name, ok] of checks) console.log(\`\${ok ? "PASS" : "FAIL"} \${name}\`);
if (checks.some(([, ok]) => !ok)) process.exit(1);
`;
}

// Work-family consumer checks: the optional peer stays absent, extraction fails closed, the wiki
// hook and RAG parser seams compose, and the shipped bytes keep their manifest claims.
function workSmokeSource({ consumer, odt, anydocPin }) {
  return `import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const consumer = ${JSON.stringify(consumer)};
const odt = readFileSync(${JSON.stringify(odt)});
const checks = [];

const documentsStart = performance.now();
const documents = await import("@arnilo/prism-work/documents");
const documentsMs = performance.now() - documentsStart;
const extractionStart = performance.now();
const extraction = await import("@arnilo/prism-work/document-extraction");
const extractionMs = performance.now() - extractionStart;
checks.push(["work ./documents imports with no optional peer installed", typeof documents.parseDocument === "function"]);
checks.push(["work ./document-extraction subpath exports the extractor and ingest adapter", typeof extraction.createDocumentExtractor === "function" && typeof extraction.createDocumentIngest === "function"]);
checks.push(["optional anydoc peer is not installed by default", existsSync(join(consumer, "node_modules", "@firecrawl")) === false]);

let missingPeer = null;
try {
  await extraction.createDocumentExtractor();
} catch (error) {
  missingPeer = error;
}
checks.push(["building the extractor without the peer fails closed as missingPeer", missingPeer?.reason === "missingPeer"]);
checks.push(["the failure carries no document content", Boolean(missingPeer) && !String(missingPeer.message).includes("Hello Prism")]);

const ingest = extraction.createDocumentIngest({ extract: async () => ({ markdown: "SMOKE-MARKDOWN", format: "odt", ocrUsed: false }) });
const wiki = await import("@arnilo/prism-memory/wiki");
const workspace = await mkdtemp(join(tmpdir(), "prism-work-smoke-"));
const staged = await wiki.ingestWikiSource(
  { bytes: odt, filename: "hello.odt", title: "Hello" },
  { workspaceRoot: workspace, extractDocument: ingest.extractDocument },
);
checks.push(["wiki ingest routes through the injected extractDocument hook", staged.extract === "SMOKE-MARKDOWN"]);
const parsed = await ingest.parser.parse({ uri: "hello.odt", data: odt, mediaType: "application/vnd.oasis.opendocument.text" });
checks.push(["rag parser returns the markdown plus untrusted metadata", parsed.text === "SMOKE-MARKDOWN" && parsed.metadata.untrusted === true && parsed.metadata.inert === true && parsed.metadata.injectionCapable === true]);
checks.push(["rag metadata never carries the markdown body", JSON.stringify(parsed.metadata).includes("SMOKE-MARKDOWN") === false]);
checks.push(["ingest stats stay content-free", JSON.stringify(ingest.stats()).includes("SMOKE-MARKDOWN") === false]);

const helper = join(consumer, "node_modules", "@arnilo/prism-work", "docling", "ocr.py");
checks.push(["work tarball ships docling/ocr.py", existsSync(helper) && statSync(helper).size > 1000]);

const manifests = [];
function collect(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collect(full);
    else if (entry.name === "package.json") manifests.push(full);
  }
}
collect(join(consumer, "node_modules", "@arnilo"));
checks.push(["every installed @arnilo package contributes a manifest", manifests.length >= 4]);
const retiredDriver = ["better", "sqlite3"].join("-");
let nodeEngines = 0;
let retiredRefs = 0;
for (const file of manifests) {
  const text = readFileSync(file, "utf8");
  if (/"engines"\\s*:\\s*\\{[^}]*"node"/.test(text)) nodeEngines += 1;
  if (text.includes(retiredDriver)) retiredRefs += 1;
}
checks.push(["no shipped manifest claims support for the retired Node runtime", nodeEngines === 0]);
checks.push(["no shipped manifest references the retired sqlite driver", retiredRefs === 0]);
const work = JSON.parse(readFileSync(join(consumer, "node_modules", "@arnilo/prism-work", "package.json"), "utf8"));
checks.push(["work declares anydoc as an optional peer, never a dependency", work.peerDependencies?.["@firecrawl/anydoc"] === ${JSON.stringify(anydocPin)} && work.peerDependenciesMeta?.["@firecrawl/anydoc"]?.optional === true && work.dependencies?.["@firecrawl/anydoc"] === undefined]);
checks.push(["work engines stay Bun-only", typeof work.engines?.bun === "string" && work.engines?.node === undefined]);

console.log("import ms: ./documents " + documentsMs.toFixed(1) + ", ./document-extraction " + extractionMs.toFixed(1));
for (const [name, ok] of checks) console.log(\`\${ok ? "PASS" : "FAIL"} \${name}\`);
if (checks.some(([, ok]) => !ok)) process.exit(1);
`;
}

// Opt-in route: with the pinned peer installed the extractor converts locally — no Python, no
// hosted OCR, no model download.
function anydocSmokeSource({ odt, anydocPin }) {
  return `import { readFileSync } from "node:fs";

const odt = readFileSync(${JSON.stringify(odt)});
const checks = [];
const { createDocumentExtractor } = await import("@arnilo/prism-work/document-extraction");
const extractor = await createDocumentExtractor();
const result = await extractor.extract({ bytes: odt, filename: "hello.odt" });
checks.push(["opt-in peer converts an odt locally", result.markdown.includes("Hello Prism ODT") && result.format === "odt"]);
checks.push(["conversion does not claim OCR", result.ocrUsed === false]);
console.log("opt-in peer: @firecrawl/anydoc@" + ${JSON.stringify(anydocPin)});
for (const [name, ok] of checks) console.log(\`\${ok ? "PASS" : "FAIL"} \${name}\`);
if (checks.some(([, ok]) => !ok)) process.exit(1);
`;
}
