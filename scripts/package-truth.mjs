// Plan 024 Task 2: manifest-derived package truth — the single source for the
// package/version/profile counts and tables in docs. Dependency-free
// (node:fs/node:path/stdlib JSON). Reproducible: same manifests → byte-identical
// JSON, modulo `generatedAt`. Exits non-zero on a malformed manifest or a
// workspace glob that matches no directory.
//
//   node scripts/package-truth.mjs [--out scripts/package-truth.json] [--root <dir>]
//   node scripts/package-truth.mjs --emit-docs   (also regenerate the docs tables)
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// `prism-*` family packages. Taxonomy constant: these names have no
// name-pattern separation from capability packages (e.g. prism-mcp), so the set
// is explicit here; the docs tests assert it against the generated artifact.
// Plan 054 Task 8: npm profile manifests are deleted; families only.
export const PRISM_FAMILY = ["@arnilo/prism-coding-tools", "@arnilo/prism-core", "@arnilo/prism-providers"];

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
    dirs.push(...current);
  }
  return [...new Set(dirs)];
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

export function computePackageTruth(rootDir = DEFAULT_ROOT) {
  const root = readManifest(join(rootDir, "package.json"));
  if (!Array.isArray(root.workspaces)) {
    throw new Error(`root manifest missing workspaces array: ${join(rootDir, "package.json")}`);
  }
  const pkgs = expandWorkspaceDirs(rootDir, root.workspaces).map((dir) => ({
    dir,
    ...readManifest(join(dir, "package.json")),
  }));
  const byName = new Map(pkgs.map((p) => [p.name, p]));
  const names = pkgs.map((p) => p.name).sort();

  const providerManifests = names.filter((n) => n.startsWith("@arnilo/prism-provider-"));
  // Plan 054 Task 6: provider adapters may live as subpaths of the family
  // package instead of standalone manifests; the taxonomy counts both.
  const providerSubpaths = Object.keys(byName.get("@arnilo/prism-providers")?.exports ?? {})
    .filter((k) => k !== ".")
    .map((k) => `@arnilo/prism-providers${k.slice(1)}`)
    .sort();
  const providers = [...providerManifests, ...providerSubpaths].sort();
  const family = names.filter((n) => PRISM_FAMILY.includes(n));
  const capability = names.filter((n) => !providerManifests.includes(n) && !family.includes(n));
  const codeWithPeer = names.filter((n) => byName.get(n).peerDependencies?.["@arnilo/prism"] !== undefined);
  const pureManifest = names.filter((n) => !codeWithPeer.includes(n));

  const providersDeps = Object.keys(byName.get("@arnilo/prism-providers")?.dependencies ?? {}).sort();
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
    umbrella: {
      "prism-providers": {
        deps: providersDeps,
        subpaths: providerSubpaths,
        omitsProviders: providerManifests.filter((n) => !providersDeps.includes(n)),
      },
    },
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
  "@arnilo/prism-coding-tools":
    "family — /agent, /security, /document-reader, /openapi, /computer-use-linux, /dev, /caveman, /ponytail, /impeccable subpaths",
  "@arnilo/prism-core": "family — /runtime, /sessions, /governance, /credentials, /enterprise, /work, /validation subpaths",
  "@arnilo/prism-providers": "family — all provider adapters as `/<adapter>` subpaths",
  "@arnilo/prism-acp-agent": "capability — ACP adapter",
  "@arnilo/prism-ag-ui": "capability — AG-UI/A2A/A2UI adapter",
  "@arnilo/prism-mcp": "capability — MCP client/server/OAuth interop",
  "@arnilo/prism-memory": "capability — memory plus /rag, /compaction/*, /graft, /wiki subpaths",
  "@arnilo/prism-office": "capability — /documents, /sheets, /diagrams subpaths",
  "@arnilo/prism-web-tools": "capability — Brave/Exa/Firecrawl plus peer-gated /browser and /obscura subpaths",
};

const blockBegin = (type) => `<!-- generated:package-truth:${type} begin -->`;
const blockEnd = (type) => `<!-- generated:package-truth:${type} end -->`;

// The canonical inventory table: root + every workspace manifest, with version
// and editorial notes. Reused byte-identical across README, docs/index.md, and
// docs/release-and-install.md (regenerate all with --emit-docs).
export function renderInventoryBlock(truth) {
  const rows = [
    ["@arnilo/prism", truth.root.version, "core"],
    ...truth.family.map((n) => [n, truth.versions[n], "family"]),
    ...truth.capability.map((n) => [n, truth.versions[n], "capability"]),
  ];
  return [
    blockBegin("inventory"),
    `**${truth.counts.publishable} publishable manifests** — root \`@arnilo/prism\` plus ${truth.counts.workspace} workspace packages (${truth.counts.prismFamily} \`prism-*\` family packages, ${truth.counts.capability} capability packages). Generated by \`node scripts/package-truth.mjs --emit-docs\` — do not hand-edit.`,
    "",
    "| package | version | notes |",
    "| --- | --- | --- |",
    ...rows.map(([name, version, kind]) => `| \`${name}\` | ${version} | ${PACKAGE_NOTES[name] ?? kind} |`),
    blockEnd("inventory"),
  ].join("\n");
}

// The provider-adapter table: every first-party adapter as a subpath of the
// providers family. Reused byte-identical on docs/release-and-install.md and
// docs/provider-packages.md.
export function renderProvidersBlock(truth) {
  const version = truth.versions["@arnilo/prism-providers"] ?? "?";
  return [
    blockBegin("providers"),
    `**${truth.counts.provider} provider adapters** — first-party adapters ship as \`@arnilo/prism-providers/<adapter>\` subpaths in one tarball (importing one never evaluates another):`,
    "",
    "| adapter package | version |",
    "| --- | --- |",
    ...truth.providers.map((p) => `| \`${p}\` | ${version} |`),
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
  "docs/release-and-install.md": ["inventory", "providers"],
  "docs/provider-packages.md": ["providers"],
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const root = flag("--root") ?? DEFAULT_ROOT;
    const out = flag("--out") ?? join(DEFAULT_ROOT, "scripts", "package-truth.json");
    const truth = computePackageTruth(root);
    writeFileSync(out, `${JSON.stringify(truth, null, 2)}\n`);
    if (process.argv.includes("--emit-docs")) {
      const renderers = { inventory: renderInventoryBlock, providers: renderProvidersBlock };
      for (const [file, types] of Object.entries(DOC_BLOCK_TARGETS)) {
        const path = join(root, file);
        let text = readFileSync(path, "utf8");
        for (const type of types) text = applyGeneratedBlock(text, type, renderers[type](truth));
        writeFileSync(path, text);
        process.stderr.write(`package-truth: regenerated ${file}\n`);
      }
    }
    process.stderr.write(`package-truth: wrote ${out}\n`);
  } catch (error) {
    process.stderr.write(`package-truth: ${error.message}\n`);
    process.exitCode = 1;
  }
}
