#!/usr/bin/env node
import { spawnSync } from "node:child_process";
// Post-publish verification: install the release packages into a fresh consumer project
// and exercise one real behavior per headline surface.
//
//   bun scripts/post-publish-smoke.mjs                    # from the registry (after publish)
//   bun scripts/post-publish-smoke.mjs --local            # from local tarballs (pre-publish parity)
//   bun scripts/post-publish-smoke.mjs --version 0.11.0   # pin the version
//
// Registry mode is the post-publish gate: it proves the published artifacts (not the working
// tree) resolve memory-system, knowledge, the hooks adapter, and work/document-extraction
// subpath with and without its optional `@firecrawl/anydoc` peer. `--local` runs the same checks
// against `bun pm pack` output, so a broken `files` entry or subpath export fails before the tag
// is pushed. Network-free after install; exit code 1 on any failed check.
//
// Plan 125 Task 2: tarballs come from `bun pm pack` (plan 164 Task 8.4) and the registry specs are
// the npm names; the consumer installs and runs on Bun.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPackedConsumer } from "./fixtures/packed-consumer.mjs";
import { loadRelease } from "./release.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const local = argv.includes("--local");
const versionIndex = argv.indexOf("--version");
const version = versionIndex === -1 ? null : argv[versionIndex + 1];
if (versionIndex !== -1 && !version) throw new Error("--version requires a value");

const PACKAGES = [
  "@arnilo/prism",
  "@arnilo/prism-memory-system",
  "@arnilo/prism-knowledge",
  "@arnilo/prism-extensions",
  "@arnilo/prism-tools",
];
const resolvedVersion = version ?? JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const anydocPin = JSON.parse(readFileSync(join(root, "packages/tools/package.json"), "utf8")).peerDependencies["@firecrawl/anydoc"];
const odtFixture = join(root, "packages/tools/work/src/document-extraction/__tests__/fixtures/hello.odt");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: options.quiet ? "pipe" : "inherit", timeout: 60_000, ...options });
  if (result.status !== 0) {
    if (options.quiet && result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
  return result.stdout ?? "";
}

const officePeers = JSON.parse(readFileSync(join(root, "packages/tools/package.json"), "utf8")).peerDependencies;
const workdir = mkdtempSync(join(tmpdir(), "prism-post-publish-smoke-"));
let consumer;
process.on("exit", () => rmSync(workdir, { recursive: true, force: true }));

let specs;
if (local) {
  const release = loadRelease(root);
  const fixture = createPackedConsumer(PACKAGES.map((name) => ({ name, dir: release.byName.get(name).path })));
  if (fixture.installStatus !== 0) {
    fixture.cleanup();
    throw new Error(fixture.installOut);
  }
  // Reuse the closure-pinned consumer so unpublished peers never resolve from the registry.
  consumer = fixture.consumer;
  process.on("exit", fixture.cleanup);
  specs = [];
} else {
  consumer = join(workdir, "consumer");
  mkdirSync(consumer);
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "prism-post-publish-smoke", private: true, type: "module" }));
  const byName = loadRelease(root).byName;
  specs = PACKAGES.map((pkg) => `${pkg}@${byName.get(pkg).experimental ? "experimental" : resolvedVersion}`);
}
console.log(`post-publish smoke: ${local ? "local tarballs" : "registry"} — ${specs.join(" ")}`);

if (!local) run("bun", ["install", ...specs, "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: consumer });
writeFileSync(join(consumer, "smoke.mjs"), smokeSource());
run("bun", ["smoke.mjs"], { cwd: consumer });

// Direct Office library imports need their declared peers; anydoc remains absent for the first leg.
run(
  "bun",
  [
    "add",
    ...Object.entries(officePeers)
      .filter(([name]) => name.startsWith("@office-open/") || name === "ajv" || name === "fast-xml-parser")
      .map(([name, range]) => `${name}@${range}`),
    "--ignore-scripts",
    "--prefer-offline",
  ],
  { cwd: consumer },
);
// Work family: direct library imports, then the opt-in anydoc route.
writeFileSync(join(consumer, "smoke-work.mjs"), workSmokeSource({ consumer, odt: odtFixture, anydocPin }));
run("bun", ["smoke-work.mjs"], { cwd: consumer });
run("bun", ["add", `@firecrawl/anydoc@${anydocPin}`, "--ignore-scripts", "--prefer-offline", "--no-audit", "--no-fund"], { cwd: consumer });
writeFileSync(join(consumer, "smoke-anydoc.mjs"), anydocSmokeSource({ odt: odtFixture, anydocPin }));
run("bun", ["smoke-anydoc.mjs"], { cwd: consumer });

console.log(`post-publish smoke: PASS (${local ? "local tarballs" : `registry @${resolvedVersion}`})`);

// The consumer-side checks: one import per headline surface plus one real behavior each.
function smokeSource() {
  return `import { createAgent, definePackage, providerTextDelta, providerDone } from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { createMemory, createLongTermMemory } from "@arnilo/prism-memory-system";
import hooksJson, { hookCommandHash } from "@arnilo/prism-extensions/hooks-json";

const checks = [];
checks.push(["root: createAgent + definePackage", [createAgent, definePackage].every((f) => typeof f === "function")]);
checks.push(["memory-system: createMemory + createLongTermMemory", [createMemory, createLongTermMemory].every((f) => typeof f === "function")]);
checks.push(["hooks-json default export", typeof hooksJson === "function" && hooksJson.name === "@arnilo/prism-extensions/hooks-json"]);
checks.push(["hooks-json hash helper", typeof hookCommandHash === "function"]);

const provider = { id: "mock", async *generate() { yield providerTextDelta("ok"); yield providerDone(); } };
const agent = await createAgent({
  model: { provider: "mock", model: "smoke" },
  packages: [providerPackage("smoke-provider", [provider])],
  hooks: (hooks) => hooks.on("run.end", () => undefined, { id: "smoke" }),
});
const session = (await agent.session({ id: "post-publish-smoke", create: true }));
const result = await session.run("hi");
checks.push(["run with a stop hook settles", result?.status === "completed" && result.text === "ok"]);
checks.push(["Session.close() present", typeof session.close === "function"]);
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
const documents = await import("@arnilo/prism-tools/work/documents");
const documentsMs = performance.now() - documentsStart;
const extractionStart = performance.now();
const extraction = await import("@arnilo/prism-tools/work/document-extraction");
const extractionMs = performance.now() - extractionStart;
checks.push(["work ./documents imports with its declared Office peers installed", typeof documents.parseDocument === "function"]);
checks.push(["work ./document-extraction exports the extractor and ingest adapter without anydoc", typeof extraction.createDocumentExtractor === "function" && typeof extraction.createDocumentIngest === "function"]);
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
const wiki = await import("@arnilo/prism-knowledge/wiki");
checks.push([
  "the wiki package exports the wiki factory, its definition, the ingest, search and read tool names, and no retired CLI",
  typeof wiki.wiki === "function" &&
    wiki.default === wiki.definition &&
    wiki.WIKI_INGEST_TOOL_NAME === "wiki_ingest" &&
    wiki.WIKI_SEARCH_TOOL === "wiki.search" &&
    wiki.WIKI_READ_TOOL === "wiki.read" &&
    wiki.runCli === undefined,
]);
const parsed = await ingest.parser.parse({ uri: "hello.odt", data: odt, mediaType: "application/vnd.oasis.opendocument.text" });
checks.push(["rag parser returns the markdown plus untrusted metadata", parsed.text === "SMOKE-MARKDOWN" && parsed.metadata.untrusted === true && parsed.metadata.inert === true && parsed.metadata.injectionCapable === true]);
checks.push(["rag metadata never carries the markdown body", JSON.stringify(parsed.metadata).includes("SMOKE-MARKDOWN") === false]);
checks.push(["ingest stats stay content-free", JSON.stringify(ingest.stats()).includes("SMOKE-MARKDOWN") === false]);

const helper = join(consumer, "node_modules", "@arnilo/prism-tools", "work", "docling", "ocr.py");
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
const work = JSON.parse(readFileSync(join(consumer, "node_modules", "@arnilo/prism-tools", "package.json"), "utf8"));
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
const { createDocumentExtractor } = await import("@arnilo/prism-tools/work/document-extraction");
const extractor = await createDocumentExtractor();
const result = await extractor.extract({ bytes: odt, filename: "hello.odt" });
checks.push(["opt-in peer converts an odt locally", result.markdown.includes("Hello Prism ODT") && result.format === "odt"]);
checks.push(["conversion does not claim OCR", result.ocrUsed === false]);
console.log("opt-in peer: @firecrawl/anydoc@" + ${JSON.stringify(anydocPin)});
for (const [name, ok] of checks) console.log(\`\${ok ? "PASS" : "FAIL"} \${name}\`);
if (checks.some(([, ok]) => !ok)) process.exit(1);
`;
}
