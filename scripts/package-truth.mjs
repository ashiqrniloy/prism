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

// The 9 `prism-*` family/profile packages. Taxonomy constant: these names have
// no name-pattern separation from capability packages (e.g. prism-mcp), so the
// set is explicit here; the docs tests assert it against the generated artifact.
export const PRISM_FAMILY = [
  "@arnilo/prism-all",
  "@arnilo/prism-base",
  "@arnilo/prism-caveman",
  "@arnilo/prism-code",
  "@arnilo/prism-compaction",
  "@arnilo/prism-openapi-tools",
  "@arnilo/prism-ponytail",
  "@arnilo/prism-providers",
  "@arnilo/prism-sdk",
];

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

  const providers = names.filter((n) => n.startsWith("@arnilo/prism-provider-"));
  const family = names.filter((n) => PRISM_FAMILY.includes(n));
  const capability = names.filter((n) => !providers.includes(n) && !family.includes(n));
  const codeWithPeer = names.filter((n) => byName.get(n).peerDependencies?.["@arnilo/prism"] !== undefined);
  const pureManifest = names.filter((n) => !codeWithPeer.includes(n));

  // Transitive closure over workspace `dependencies` (peers/devDependencies
  // excluded: peers are consumer-resolved, devDeps are workspace-only).
  const closure = (start) => {
    const seen = new Set();
    const queue = Object.keys(byName.get(start)?.dependencies ?? {});
    for (let i = 0; i < queue.length; i++) {
      const name = queue[i];
      if (!byName.has(name) || seen.has(name)) continue;
      seen.add(name);
      queue.push(...Object.keys(byName.get(name).dependencies ?? {}));
    }
    return [...seen].sort();
  };

  const providersDeps = Object.keys(byName.get("@arnilo/prism-providers")?.dependencies ?? {}).sort();
  const allDeps = Object.keys(byName.get("@arnilo/prism-all")?.dependencies ?? {}).sort();
  const allClosure = closure("@arnilo/prism-all");
  const omits = names.filter((n) => n !== "@arnilo/prism-all" && !allClosure.includes(n));

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
        omitsProviders: providers.filter((n) => !providersDeps.includes(n)),
      },
      "prism-all": { deps: allDeps, closure: allClosure.length, omits },
    },
    profiles: {
      "prism-base": closure("@arnilo/prism-base"),
      "prism-code": closure("@arnilo/prism-code"),
      "prism-sdk": closure("@arnilo/prism-sdk"),
      "prism-providers": closure("@arnilo/prism-providers"),
      "prism-all": allClosure,
    },
    peerPolicy: { decision: "A", spec: root.version, atomicUpgrade: true },
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
