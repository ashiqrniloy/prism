// Plan 024 Task 2: manifest-derived package truth — the single source for the
// package/version/profile counts and tables in docs. Dependency-free
// (node:fs/node:path/stdlib JSON). Reproducible: same manifests → byte-identical
// JSON, modulo `generatedAt`. Exits non-zero on a malformed manifest or a
// workspace glob that matches no directory.
//
//   bun scripts/package-truth.mjs [--out scripts/package-truth.json] [--root <dir>]
//   bun scripts/package-truth.mjs --emit-docs   (also regenerate docs tables and package evidence)
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPackageMap, generateMarkdown } from "./phase54-package-map.mjs";

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// `prism-*` family packages. Taxonomy constant: these names have no
// name-pattern separation from capability packages (e.g. prism-mcp), so the set
// is explicit here; the docs tests assert it against the generated artifact.
// Plan 054 Task 8: npm profile manifests are deleted; families only.
export const PRISM_FAMILY = ["@arnilo/prism-channels"];

export function expandWorkspaceDirs(root, globs) {
  const dirs = [];
  for (const glob of globs) {
    let current = [root];
    for (const segment of glob.split("/")) {
      if (segment.includes("*")) {
        const pattern = new RegExp(`^${segment.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", "[^/]*")}$`);
        current = current.flatMap((base) => {
          let entries;
          try {
            entries = readdirSync(base, { withFileTypes: true });
          } catch {
            return [];
          }
          return entries.filter((e) => e.isDirectory() && pattern.test(e.name)).map((e) => join(base, e.name));
        });
      } else {
        current = current
          .map((base) => join(base, segment))
          .filter((p) => {
            try {
              return statSync(p).isDirectory();
            } catch {
              return false;
            }
          });
      }
    }
    if (current.length === 0) {
      throw new Error(`workspace glob matches no directory: ${glob}`);
    }
    // Bun ignores a glob hit with no manifest (packages/memory/src is residue). Match that.
    dirs.push(...current.filter((dir) => existsSync(join(dir, "package.json"))));
  }
  return [...new Set(dirs)];
}

/** Published workspace dirs. Private apps stay in the glob so typecheck and run-all-tests see them. */
export function publishableWorkspaceDirs(root, globs) {
  return expandWorkspaceDirs(root, globs).filter((dir) => readManifest(join(dir, "package.json")).private !== true);
}

export function readManifest(file) {
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(`cannot read manifest ${file}: ${error.message}`);
  }
  let pkg;
  try {
    pkg = JSON.parse(raw);
  } catch {
    throw new Error(`malformed manifest: ${file}`);
  }
  if (typeof pkg.name !== "string" || typeof pkg.version !== "string") {
    throw new Error(`manifest missing name/version: ${file}`);
  }
  return pkg;
}

// Plan 070 Task 15: the LIVE workspace shape — every `packages/*` directory that
// has a manifest, plus the provider/prism/capability partition the freeze suites
// assert their frozen counts against. One readdir, no manifest reads.
//
// The historical counts themselves are deliberately NOT derived here: the
// `hasCodingTools ? -46 : …` deltas in the phase13-21 freeze suites are
// frozen-lineage release evidence (Task 1), so they stay put. Historical name
// exclusions (computer-use-linux, prism-wiki, obscura, …) are gone too — those
// directories no longer exist, and the manifest check already excludes any
// non-package directory.
//
//   const { names, providerDirs, prismDirs, capabilityDirs } = workspaceShape();
//
export function workspaceShape(rootDir = DEFAULT_ROOT) {
  const packagesDir = join(rootDir, "packages");
  const dirs = readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(packagesDir, entry.name, "package.json")))
    .map((entry) => join(packagesDir, entry.name))
    .sort();
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || existsSync(join(packagesDir, entry.name, "package.json"))) continue;
    const group = join(packagesDir, entry.name);
    for (const child of readdirSync(group, { withFileTypes: true })) {
      if (child.isDirectory() && existsSync(join(group, child.name, "package.json"))) dirs.push(join(group, child.name));
    }
  }
  // Private manifests are not package truth (plan 172 Task 3). The app lives under apps/, not here.
  const published = dirs.filter((dir) => readManifest(join(dir, "package.json")).private !== true);
  published.sort();
  const names = published.map((dir) => basename(dir));
  const providerDirs = names.filter((name) => name.startsWith("provider-"));
  const prismDirs = names.filter((name) => name.startsWith("prism-"));
  const capabilityDirs = names.filter((name) => !name.startsWith("provider-") && !name.startsWith("prism-"));
  return { dirs: published, names, providerDirs, prismDirs, capabilityDirs };
}

// Plan 120 Task 8. Presence of a public workspace package (directory + package.json).
// Counts a future public package. Private manifests are excluded. Cached per root for the process.
const packageCountCache = new Map();
export function workspacePackageCounts(rootDir = DEFAULT_ROOT) {
  const cached = packageCountCache.get(rootDir);
  if (cached) return cached;
  const counts = new Set(workspaceShape(rootDir).names);
  packageCountCache.set(rootDir, counts);
  return counts;
}

// Plan 071 Task 1 (plan 070 FA 10): the one source for the release version. The
// root manifest is what `release.mjs bump` rewrites first, so tests and scripts
// read it instead of hardcoding the cut version (`scripts/version-literal-gate.test.mjs`
// then fails any stale literal that a hand sweep would miss).
//
//   const version = currentVersion();
export function currentVersion(rootDir = DEFAULT_ROOT) {
  return readManifest(join(rootDir, "package.json")).version;
}

export function computePackageTruth(rootDir = DEFAULT_ROOT) {
  const root = readManifest(join(rootDir, "package.json"));
  if (!Array.isArray(root.workspaces)) {
    throw new Error(`root manifest missing workspaces array: ${join(rootDir, "package.json")}`);
  }
  const pkgs = publishableWorkspaceDirs(rootDir, root.workspaces).map((dir) => ({
    dir,
    ...readManifest(join(dir, "package.json")),
  }));
  const byName = new Map(pkgs.map((p) => [p.name, p]));
  const names = pkgs.map((p) => p.name).sort();

  const providerManifests = names.filter((n) => n.startsWith("@arnilo/prism-provider-"));
  // Plan 152 Task 8: the provider-family workspace is deleted, so every
  // first-party adapter is a standalone manifest and no adapter is a subpath.
  const providers = [...providerManifests].sort();
  const family = names.filter((n) => PRISM_FAMILY.includes(n));
  const capability = names.filter((n) => !providerManifests.includes(n) && !family.includes(n));
  const codeWithPeer = names.filter((n) => byName.get(n).peerDependencies?.["@arnilo/prism"] !== undefined);
  const pureManifest = names.filter((n) => !codeWithPeer.includes(n));

  const internalRanges = [];
  for (const pkg of pkgs) {
    for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      for (const [name, range] of Object.entries(pkg[field] ?? {})) {
        if (byName.has(name)) internalRanges.push(range);
      }
    }
  }
  const independent = internalRanges.some((range) => /^[~^]/.test(range));

  return {
    generatedAt: new Date().toISOString(),
    root: { name: root.name, version: root.version },
    versions: Object.fromEntries([[root.name, root.version], ...pkgs.map((p) => [p.name, p.version])]),
    counts: {
      publishable: pkgs.length + 1,
      workspace: pkgs.length,
      provider: providers.length,
      prismFamily: family.length,
      capability: capability.length,
      codeWithPeer: codeWithPeer.length,
      pureManifest: pureManifest.length,
    },
    providers,
    family,
    capability,
    umbrella: {},
    profiles: {},
    peerPolicy: {
      decision: independent ? "B" : "A",
      spec: independent ? `^${root.version}` : root.version,
      atomicUpgrade: !independent,
    },
  };
}

const flag = (name) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
};

// Plan 057 Task 4: generated docs tables. Editorial notes keyed by package name
// are the single notes authority (one place, not per-page ad hoc lists); a
// package without a note renders with its kind label.
export const PACKAGE_NOTES = {
  "@arnilo/prism": "core — runtime, CLI/RPC, templates, docs",
  "@arnilo/prism-channels":
    "family — transport-neutral messaging runtime, durable journal, pairing and one-use approvals; official /telegram (private DMs, opt-in granted groups/topics) and experimental pinned signal-cli /signal",
  "@arnilo/prism-ag-ui": "capability — AG-UI/A2A/A2UI adapter",
  "@arnilo/prism-credentials-keyring":
    "capability — credentials slot: OS keyring and encrypted-file backends, `keyring:` ref resolution, and secret/OAuth persistence",
  "@arnilo/prism-hooks-json":
    "capability — Claude/Codex hooks.json compiled onto session.opened, context.build, run.input, tool.call, tool.result, and run.end",
  "@arnilo/prism-mcp":
    "capability — MCP client package: connects allowed servers, bridges their tools, and exposes mcp:status/reconnect/close",
  "@arnilo/prism-mcp-server":
    "library — host library serving Prism tools, resources, and prompts over MCP (stdio and Streamable HTTP transports)",
  "@arnilo/prism-headless": "library — host library routing HostUi requests through ordered routes with a value-free answer log",
  "@arnilo/prism-host-builder":
    "library — host library shipping version-exact API, error-code and example indexes, a skill, an MCP server and an installer for coding agents that build Prism hosts",
  "@arnilo/prism-remote":
    "library — host library serving a Prism agent to remote clients and connecting to remote agents over prism.remote/1",
  "@arnilo/prism-tools-coding":
    "capability — coding file/search/shell tools as a package: a small tool set with declared effects, in-tool path containment, and an optional shell",
  "@arnilo/prism-approval": "capability — approval modes deny/ask/edits/auto over tool effects and roots, as one tool.call gate",
  "@arnilo/prism-guardrail-packs":
    "capability — built-in guardrail packs (coding-standard, destructive-commands, validation-respect, secrets-hygiene) as restrictive-only tool.call/tool.result rules with package session state",
  "@arnilo/prism-governance":
    "capability — deny-by-default policy engine (inline rules or OPA) plus approvals and an audit ledger, as one tool.call/run.input/model.request gate with a governance.policy/governance.audit service",
  "@arnilo/prism-model-router":
    "capability — policy around hook routing turns across candidates with budget, circuit, and rate-limit controls",
  "@arnilo/prism-observability":
    "capability — OpenTelemetry spans and metrics over the agent event catalog as observe handlers; exports nothing itself",
  "@arnilo/prism-workflows":
    "library — typed graph workflows (DAG and cyclic) that orchestrate any set of agents from outside their sessions: checkpoints, suspend/resume, replay, graph export, and the `checkpoints`/`leases` service contracts",
  "@arnilo/prism-driver-process": "capability — generic external-agent process driver with a host-written adapter",
  "@arnilo/prism-delegate":
    "capability — a delegate tool whose child agent inherits a chosen subset of the parent packages, reporting delegate.step package events",
  "@arnilo/prism-advisor":
    "capability — a second model's advice as one advise tool and opt-in review consults, plus completion validation by a model or a hidden delegate child",
  "@arnilo/prism-context-files":
    "capability — AGENTS.md / SYSTEM.md layers as one context.build handler, trust-gated and cached per session",
  "@arnilo/prism-context-engineering":
    "capability — the input budget, tool-result folding, tool search, and the attention compiler as one fixed-order context.build handler",
  "@arnilo/prism-memory-core":
    "library — shared memory contracts, vector stores, lineage, propagation, and scoring; no slot and no capability",
  "@arnilo/prism-rag": "capability — indexed retrieval with a rag_search tool, an opt-in context block, and the embeddings service",
  "@arnilo/prism-memory-fabric":
    "capability — T1 of the three-tier memory, the store of record: working, semantic, and scoped notes with the memory.* tools, a context block, and per-session state",
  "@arnilo/prism-wiki":
    "capability — knowledge outside memory, opt-in and unmeasured: concepts and sources in its own store, consolidated from cited evidence; reads memory read-only",
  "@arnilo/prism-memory-observational":
    "capability — T0 of the three-tier memory: observes the session, keeps a source-backed ledger, and compacts from it",
  "@arnilo/prism-tools-work":
    "capability — /connectors, /documents, /sheets, /diagrams, /document-extraction, /document-reader, /sandbox, /skills, /tools subpaths",
  "@arnilo/prism-tools-browser":
    "capability — six exclusive Playwright browser tools with declared effects, fail-closed egress policy, and artifact quarantine",
  "@arnilo/prism-tools-web":
    "capability — keyless native fetch plus Brave/Exa/SearXNG/Tavily/Kagi search, Firecrawl fetch/extract, and host-installed Obscura, with a host domain policy, an optional per-session cache, and a web.fetch service",
  "@arnilo/prism-tools-research": "capability — research skills, a per-session source ledger, cite, and a bounded run.end citation check",
  "@arnilo/prism-tools-openapi":
    "capability — compile allow-listed OpenAPI 3.1 operations into bounded tools with pinned origins, per-method effects, and ref-only header credentials",
  "@arnilo/prism-tools-computer-use":
    "capability — the host-owned computer-use-linux MCP binary as tools with declared external effects, in-tool device admission, and a bundled skill",
};

const blockBegin = (type) => `<!-- generated:package-truth:${type} begin -->`;
const blockEnd = (type) => `<!-- generated:package-truth:${type} end -->`;

// The canonical inventory table: root + every workspace manifest, with version
// and editorial notes. Reused byte-identical across README, docs/index.md, and
// docs/release.md (regenerate all with --emit-docs).
export function renderInventoryBlock(truth) {
  const rows = [
    ["@arnilo/prism", truth.root.version, "core"],
    ...truth.family.map((n) => [n, truth.versions[n], "family"]),
    ...truth.capability.map((n) => [n, truth.versions[n], "capability"]),
  ];
  return [
    blockBegin("inventory"),
    `**${truth.counts.publishable} publishable manifests** — root \`@arnilo/prism\` plus ${truth.counts.workspace} workspace packages (${truth.counts.prismFamily} \`prism-*\` family packages, ${truth.counts.capability} capability packages). Generated by \`bun scripts/package-truth.mjs --emit-docs\` — do not hand-edit.`,
    "",
    "| package | version | notes |",
    "| --- | --- | --- |",
    ...rows.map(([name, version, kind]) => `| \`${name}\` | ${version} | ${PACKAGE_NOTES[name] ?? kind} |`),
    blockEnd("inventory"),
  ].join("\n");
}

// The provider-adapter table: every first-party adapter as its own package.
// Rendered on docs/release.md.
export function renderProvidersBlock(truth) {
  return [
    blockBegin("providers"),
    // Plan 152 Task 8: the family workspace is deleted, so every adapter is standalone.
    `**${truth.counts.provider} provider adapters** — first-party adapters ship as standalone \`@arnilo/prism-provider-*\` packages (importing one never evaluates another):`,
    "",
    "| adapter package | version |",
    "| --- | --- |",
    ...truth.providers.map((p) => `| \`${p}\` | ${truth.versions[p] ?? "?"} |`),
    blockEnd("providers"),
  ].join("\n");
}

// Replace the marked region of one block type in a page. Pure (string → string)
// so tests can exercise regeneration without touching the repo.
export function applyGeneratedBlock(text, type, content) {
  const begin = blockBegin(type);
  const end = blockEnd(type);
  const start = text.indexOf(begin);
  if (start === -1) throw new Error(`missing \`${begin}\` marker`);
  const finish = text.indexOf(end, start);
  if (finish === -1) throw new Error(`missing \`${end}\` marker`);
  let tail = text.slice(finish + end.length);
  if (tail.startsWith("\n")) tail = tail.slice(1);
  return `${text.slice(0, start)}${content}\n${tail}`;
}

// Page → block types. Every target must carry the markers (applyGeneratedBlock
// fails loud when a marker is missing).
export const DOC_BLOCK_TARGETS = {
  "README.md": ["inventory"],
  "docs/index.md": ["inventory"],
  "docs/release.md": ["inventory", "providers"],
};

export function renderGeneratedDocs(root, truth) {
  const renderers = { inventory: renderInventoryBlock, providers: renderProvidersBlock };
  const rendered = {};
  for (const [file, types] of Object.entries(DOC_BLOCK_TARGETS)) {
    let text = readFileSync(join(root, file), "utf8");
    for (const type of types) text = applyGeneratedBlock(text, type, renderers[type](truth));
    rendered[file] = text;
  }
  rendered["docs/_evidence/phase54-package-map.md"] = generateMarkdown(buildPackageMap(root));
  return rendered;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const root = flag("--root") ?? DEFAULT_ROOT;
    const out = flag("--out") ?? join(DEFAULT_ROOT, "scripts", "package-truth.json");
    const truth = computePackageTruth(root);
    writeFileSync(out, `${JSON.stringify(truth, null, 2)}\n`);
    if (process.argv.includes("--emit-docs")) {
      for (const [file, text] of Object.entries(renderGeneratedDocs(root, truth))) {
        writeFileSync(join(root, file), text);
        process.stderr.write(`package-truth: regenerated ${file}\n`);
      }
    }
    process.stderr.write(`package-truth: wrote ${out}\n`);
  } catch (error) {
    process.stderr.write(`package-truth: ${error.message}\n`);
    process.exitCode = 1;
  }
}
