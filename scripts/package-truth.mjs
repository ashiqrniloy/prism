// Plan 024 Task 2: manifest-derived package truth — the single source for the
// package/version/profile counts and tables in docs. Dependency-free
// (node:fs/node:path/stdlib JSON). Reproducible: same manifests → byte-identical
// JSON, modulo `generatedAt`. Exits non-zero on a malformed manifest or a
// workspace glob that matches no directory.
//
//   node scripts/package-truth.mjs [--out scripts/package-truth.json] [--root <dir>]
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

try {
  const root = flag("--root") ?? DEFAULT_ROOT;
  const out = flag("--out") ?? join(DEFAULT_ROOT, "scripts", "package-truth.json");
  writeFileSync(out, `${JSON.stringify(computePackageTruth(root), null, 2)}\n`);
  process.stderr.write(`package-truth: wrote ${out}
`);
} catch (error) {
  process.stderr.write(`package-truth: ${error.message}
`);
  process.exitCode = 1;
}
