#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runGates } from "./release-gates.mjs";

const INTERNAL_SCOPE = "@arnilo/";
const DEPENDENCY_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies"];

export function loadRelease(root = process.cwd()) {
  const paths = ["."];
  const packagesDir = join(root, "packages");
  if (existsSync(packagesDir)) {
    for (const entry of readdirSync(packagesDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory() && existsSync(join(packagesDir, entry.name, "package.json"))) paths.push(`packages/${entry.name}`);
    }
  }
  const packages = paths.map((path) => ({
    path,
    manifest: JSON.parse(readFileSync(join(root, path, "package.json"), "utf8")),
  }));
  const byName = new Map(packages.map((pkg) => [pkg.manifest.name, pkg]));
  const release = { root, packages, byName };
  release.validate = (version) => validateRelease(release, version);
  release.validateIndependent = (opts) => validateReleaseIndependent(release, opts);
  return release;
}

export function validateRelease(release, version) {
  const errors = [];
  for (const pkg of release.packages) {
    if (pkg.manifest.private) errors.push(`${pkg.manifest.name} is private`);
    if (pkg.manifest.version !== version) errors.push(`${pkg.manifest.name} version is ${pkg.manifest.version}, expected ${version}`);
    if (pkg.manifest.publishConfig?.access !== "public") errors.push(`${pkg.manifest.name} must set publishConfig.access to public`);
    for (const field of DEPENDENCY_FIELDS) {
      for (const [name, range] of Object.entries(pkg.manifest[field] ?? {})) {
        if (release.byName.has(name) && range !== version && !satisfiesInternalRange(range, version))
          errors.push(`${pkg.manifest.name} ${field}.${name} is ${range}, expected ${version}`);
      }
    }
  }

  const lock = JSON.parse(readFileSync(join(release.root, "package-lock.json"), "utf8"));
  for (const pkg of release.packages) {
    const locked = lock.packages?.[pkg.path === "." ? "" : pkg.path];
    if (!locked) errors.push(`package-lock.json missing ${pkg.path}`);
    else if (locked.version !== version) errors.push(`package-lock.json ${pkg.path} version is ${locked.version}, expected ${version}`);
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return topologicalOrder(release);
}

export function topologicalOrder(release) {
  const remaining = new Map();
  for (const pkg of release.packages) {
    const dependencies = new Set();
    for (const field of DEPENDENCY_FIELDS) {
      for (const name of Object.keys(pkg.manifest[field] ?? {})) if (release.byName.has(name)) dependencies.add(name);
    }
    remaining.set(pkg.manifest.name, dependencies);
  }

  const order = [];
  while (remaining.size) {
    const ready = [...remaining]
      .filter(([, dependencies]) => dependencies.size === 0)
      .map(([name]) => name)
      .sort();
    if (!ready.length) throw new Error(`internal dependency cycle: ${[...remaining.keys()].sort().join(", ")}`);
    for (const name of ready) {
      order.push(release.byName.get(name));
      remaining.delete(name);
      for (const dependencies of remaining.values()) dependencies.delete(name);
    }
  }
  return order;
}

export function bumpRelease(release, from, to) {
  const changed = [];
  for (const pkg of release.packages) {
    const manifest = pkg.manifest;
    if (manifest.version !== from) continue; // only touch manifests at the old version
    manifest.version = to;
    for (const field of DEPENDENCY_FIELDS) {
      for (const [name, range] of Object.entries(manifest[field] ?? {})) {
        if (release.byName.has(name) && range === from) manifest[field][name] = to;
      }
    }
    writeFileSync(join(release.root, pkg.path, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    changed.push(pkg.manifest.name);
  }
  return changed;
}

export function rewriteInternalRanges(release, version, style = "caret") {
  if (style !== "caret") throw new Error(`unsupported internal range style: ${style}; use caret`);
  const target = `^${version}`;
  const changed = [];
  for (const pkg of release.packages) {
    let dirty = false;
    for (const field of DEPENDENCY_FIELDS) {
      for (const name of Object.keys(pkg.manifest[field] ?? {})) {
        if (!release.byName.has(name) || pkg.manifest[field][name] === target) continue;
        pkg.manifest[field][name] = target;
        dirty = true;
      }
    }
    if (!dirty) continue;
    writeFileSync(join(release.root, pkg.path, "package.json"), `${JSON.stringify(pkg.manifest, null, 2)}\n`);
    changed.push(pkg.manifest.name);
  }
  return changed;
}

export function regenerateLockfile(root) {
  const result = spawnSync("npm", ["install", "--package-lock-only", "--ignore-scripts"], {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) throw new Error("npm install --package-lock-only failed after version bump");
}

// --- independent versioning (dual-mode; default after the 0.3.0 cut) ---

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

export function parseSemver(version) {
  const m = SEMVER_RE.exec(String(version));
  return m ? { major: +m[1], minor: +m[2], patch: +m[3] } : undefined;
}

function cmpSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  return pa.major - pb.major || pa.minor - pb.minor || pa.patch - pb.patch;
}

/**
 * Internal range satisfaction for @arnilo/* pins. Supports exact, caret, and
 * tilde with npm's 0.x bounds. No prerelease handling — first-party pins are
 * release versions.
 */
export function satisfiesInternalRange(range, version) {
  const r = String(range).trim();
  const min = r.replace(/^[~^]/, "");
  const base = parseSemver(min);
  const target = parseSemver(version);
  if (!base || !target || cmpSemver(version, min) < 0) return false;
  if (r.startsWith("~")) return target.major === base.major && target.minor === base.minor;
  if (r.startsWith("^")) {
    if (base.major > 0) return target.major === base.major;
    if (base.minor > 0) return target.major === 0 && target.minor === base.minor;
    return target.major === 0 && target.minor === 0 && target.patch === base.patch;
  }
  return r === version;
}

export function incrementVersion(version, type) {
  const v = parseSemver(version);
  if (!v) throw new Error(`invalid version: ${version}`);
  if (type === "patch") return `${v.major}.${v.minor}.${v.patch + 1}`;
  if (type === "minor") return `${v.major}.${v.minor + 1}.0`;
  if (type === "major") return `${v.major + 1}.0.0`;
  throw new Error(`unknown bump type: ${type}; use patch|minor|major`);
}

function shellGit(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

export function detectBaselineTag(root, name, currentVersion) {
  if (name) {
    const out = shellGit(root, "tag", "--list", `${name}@*`, "--sort=-v:refname");
    const tags = out
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean);
    for (const tag of tags) {
      const ver = tag.slice(name.length + 1);
      if (!currentVersion || (parseSemver(ver) && cmpSemver(ver, currentVersion) < 0)) {
        return tag;
      }
    }
  }
  const out = shellGit(root, "tag", "--list", "v*", "--sort=-v:refname");
  const tags = out
    .split("\n")
    .map((t) => t.trim())
    .filter(Boolean);
  for (const tag of tags) {
    const ver = tag.replace(/^v/, "");
    if (!currentVersion || (parseSemver(ver) && cmpSemver(ver, currentVersion) < 0)) {
      return tag;
    }
  }
  return tags[0] ?? "HEAD";
}

export function defaultGitDiff(root, baseline, pkgPath) {
  const target = pkgPath === "." ? "." : `./${pkgPath}`;
  const result = spawnSync("git", ["diff", "--quiet", baseline, "--", target], { cwd: root, encoding: "utf8" });
  if (result.error) return true; // git failed (e.g. path new at baseline) -> treat as changed
  return result.status !== 0;
}

export function defaultBaselineVersion(root, baseline, pkgPath) {
  const rel = pkgPath === "." ? "package.json" : `${pkgPath}/package.json`;
  const result = spawnSync("git", ["show", `${baseline}:${rel}`], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) return undefined; // new package at baseline
  try {
    return JSON.parse(result.stdout).version;
  } catch {
    return undefined;
  }
}

export function changedPackages(release, { baseline, gitDiff = defaultGitDiff } = {}) {
  const rootVersion = release.byName.get("@arnilo/prism")?.manifest.version;
  const resolved = baseline ?? detectBaselineTag(release.root, undefined, rootVersion);
  return release.packages.filter((pkg) => gitDiff(release.root, resolved, pkg.path));
}

/**
 * Independent validate: every internal pin satisfies the target's actual
 * version, lockfile per-package versions match manifests, changed packages
 * bumped, unchanged packages not. Git/baseline seams are injectable for tests.
 */
export function validateReleaseIndependent(release, { baseline, gitDiff = defaultGitDiff, baselineVersion = defaultBaselineVersion } = {}) {
  const rootVersion = release.byName.get("@arnilo/prism")?.manifest.version;
  const resolved = baseline ?? detectBaselineTag(release.root, undefined, rootVersion);
  const errors = [];
  for (const pkg of release.packages) {
    for (const field of DEPENDENCY_FIELDS) {
      for (const [name, range] of Object.entries(pkg.manifest[field] ?? {})) {
        const target = release.byName.get(name);
        if (!target) continue;
        if (!satisfiesInternalRange(range, target.manifest.version)) {
          errors.push(`${pkg.manifest.name} ${field}.${name} range ${range} does not satisfy ${name}@${target.manifest.version}`);
        }
      }
    }
  }
  const lock = JSON.parse(readFileSync(join(release.root, "package-lock.json"), "utf8"));
  for (const pkg of release.packages) {
    const locked = lock.packages?.[pkg.path === "." ? "" : pkg.path];
    if (!locked) errors.push(`package-lock.json missing ${pkg.path}`);
    else if (locked.version !== pkg.manifest.version)
      errors.push(`package-lock.json ${pkg.path} version is ${locked.version}, manifest is ${pkg.manifest.version}`);
  }
  for (const pkg of release.packages) {
    const changed = gitDiff(release.root, resolved, pkg.path);
    const base = baselineVersion(release.root, resolved, pkg.path);
    if (changed && base && pkg.manifest.version === base)
      errors.push(`${pkg.manifest.name} changed since ${resolved} but version is still ${base} (bump required)`);
    if (!changed && base && pkg.manifest.version !== base)
      errors.push(`${pkg.manifest.name} unchanged since ${resolved} but version is ${pkg.manifest.version} (was ${base})`);
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return topologicalOrder(release);
}

export function bumpPackage(release, name, type) {
  const pkg = release.byName.get(name);
  if (!pkg) throw new Error(`unknown package: ${name}`);
  const from = pkg.manifest.version;
  const to = incrementVersion(from, type);
  pkg.manifest.version = to;
  writeFileSync(join(release.root, pkg.path, "package.json"), `${JSON.stringify(pkg.manifest, null, 2)}\n`);
  return { name, from, to };
}

export function assertGitState(root, version, { allowDirty = false, allowUntagged = false, independent = false, packages = [], tag } = {}) {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  if (!allowDirty && git("status", "--porcelain")) throw new Error("release requires a clean git tree");
  if (allowUntagged) return;
  const tags = git("tag", "--points-at", "HEAD").split("\n").filter(Boolean);
  if (independent) {
    const packageTag = tag ?? process.env.GITHUB_REF_NAME;
    if (packageTag) {
      const target = packages.find(({ name, version: v }) => `${name}@${v}` === packageTag);
      if (!target) throw new Error(`HEAD must have a current package tag; got ${packageTag}`);
      if (!tags.includes(packageTag)) throw new Error(`HEAD must have tag ${packageTag}`);
      return;
    }
    const tagged = packages.filter(({ name, version: v }) => tags.includes(`${name}@${v}`));
    if (!tagged.length) throw new Error("HEAD must have a current package tag");
  } else {
    if (!tags.includes(`v${version}`)) throw new Error(`HEAD must have tag v${version}`);
  }
}

function releaseFields(manifest) {
  return Object.fromEntries(
    DEPENDENCY_FIELDS.map((field) => [
      field,
      Object.fromEntries(Object.entries(manifest[field] ?? {}).filter(([name]) => name.startsWith(INTERNAL_SCOPE))),
    ]),
  );
}

export function samePublishedManifest(local, published) {
  return (
    published?.name === local.name &&
    published?.version === local.version &&
    JSON.stringify(releaseFields(published)) === JSON.stringify(releaseFields(local))
  );
}

export async function registryManifest(pkg, version, registry = "https://registry.npmjs.org", fetcher = fetch) {
  const response = await fetcher(`${registry.replace(/\/$/, "")}/${encodeURIComponent(pkg)}/${encodeURIComponent(version)}`, {
    headers: { accept: "application/json" },
  });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`registry preflight failed for ${pkg}: HTTP ${response.status}`);
  return response.json();
}

function saveReport(path, report) {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
}

export function publishArgs(pkg, dryRun = false, provenance = process.env.GITHUB_ACTIONS === "true") {
  const args = ["publish", pkg.path === "." ? "." : `./${pkg.path}`, "--access", "public", "--tag", "latest"];
  if (provenance) args.splice(4, 0, "--provenance");
  if (dryRun) args.push("--dry-run");
  return args;
}

export async function runRelease({
  release,
  version,
  independent = false,
  independentOptions,
  mode,
  resume = false,
  dryRun = false,
  registry,
  fetcher = fetch,
  reportPath,
  publisher,
}) {
  const validated = independent ? validateReleaseIndependent(release, independentOptions) : validateRelease(release, version);
  const order = independent
    ? validated.filter((pkg) => changedPackages(release, independentOptions).some((changed) => changed.path === pkg.path))
    : validated;
  const report = {
    version: independent ? "independent" : version,
    independent,
    dryRun,
    order: order.map((pkg) => pkg.manifest.name),
    packages: [],
  };
  const publish =
    publisher ??
    ((pkg) => {
      const result = spawnSync("npm", publishArgs(pkg, dryRun), {
        cwd: release.root,
        encoding: "utf8",
        stdio: "inherit",
        env: process.env,
      });
      if (result.status !== 0) throw new Error(`npm publish failed for ${pkg.manifest.name}`);
    });

  for (const pkg of order) {
    const pubVersion = independent ? pkg.manifest.version : version;
    const published = await registryManifest(pkg.manifest.name, pubVersion, registry, fetcher);
    if (published) {
      if (mode === "publish" && resume && samePublishedManifest(pkg.manifest, published)) {
        report.packages.push({ name: pkg.manifest.name, status: "skipped" });
        saveReport(reportPath, report);
        console.log(`skipped ${pkg.manifest.name}@${pubVersion} (already published)`);
        continue;
      }
      throw new Error(`${pkg.manifest.name}@${pubVersion} already exists on the registry`);
    }
    if (mode === "check") {
      report.packages.push({ name: pkg.manifest.name, status: "available" });
    } else {
      try {
        await publish(pkg);
        report.packages.push({
          name: pkg.manifest.name,
          status: dryRun ? "dry-run" : "published",
        });
      } catch (error) {
        report.packages.push({ name: pkg.manifest.name, status: "failed" });
        saveReport(reportPath, report);
        throw error;
      }
    }
    saveReport(reportPath, report);
  }
  return report;
}

export function checkReleaseEvidence({ manifestPath, root = process.cwd() } = {}) {
  const path = resolve(root, manifestPath ?? "scripts/release-evidence.json");
  if (!existsSync(path)) throw new Error(`release evidence missing at ${path}; run npm run release:evidence`);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`release evidence unreadable: ${error.message}`);
  }
  if (!Array.isArray(manifest.surfaces)) throw new Error("release evidence malformed: surfaces array missing");
  const states = new Set(["pass", "skip", "blocked", "protected"]);
  for (const surface of manifest.surfaces) {
    if (!surface?.name || !states.has(surface.state)) {
      throw new Error(`release evidence malformed: ${surface?.name ?? "(unnamed)"} state ${surface?.state}`);
    }
  }
  const blocked = manifest.surfaces.filter((surface) => surface.state === "blocked");
  if (blocked.length) {
    throw new Error(
      `release evidence blocked — cannot release:\n${blocked
        .map(
          (surface) =>
            `- ${surface.name}: ${surface.reason ?? "no reason"}${surface.requiredEnv ? ` (required env ${surface.requiredEnv})` : ""}`,
        )
        .join("\n")}`,
    );
  }
  const unexplained = manifest.surfaces.filter((surface) => surface.state === "skip" && (!surface.reason || !surface.requiredEnv));
  if (unexplained.length) {
    throw new Error(`unexplained skips in release evidence:\n${unexplained.map((surface) => `- ${surface.name}`).join("\n")}`);
  }
  return manifest;
}

export function parseArgs(argv) {
  const options = { mode: argv[0] };
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--resume") options.resume = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--allow-dirty") options.allowDirty = true;
    else if (arg === "--allow-untagged") options.allowUntagged = true;
    else if (arg === "--allow-break") options.allowBreak = true;
    else if (arg === "--update-baseline") options.updateBaseline = true;
    else if (arg === "--skip-tarball") options.skipTarball = true;
    else if (arg === "--independent") options.independent = true;
    else if (arg === "--lockstep") options.lockstep = true;
    else if (arg === "--ranges") options.ranges = argv[++i];
    else if (arg === "--from") options.from = argv[++i];
    else if (arg === "--to") options.to = argv[++i];
    else if (arg === "--package") options.package = argv[++i];
    else if (arg === "--type") options.type = argv[++i];
    else if (arg === "--baseline") options.baseline = argv[++i];
    else if (["--version", "--root", "--registry", "--report"].includes(arg))
      options[arg.slice(2).replace("report", "reportPath")] = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!["check", "publish", "gate", "bump", "changed"].includes(options.mode))
    throw new Error(
      "usage: release.mjs <check|publish|gate|bump|changed> [--lockstep --version <version>|--independent] [--resume] [--dry-run]",
    );
  if (options.mode === "gate") {
    if (options.lockstep && options.independent) throw new Error("--lockstep and --independent are mutually exclusive");
    if (!options.lockstep) options.independent = true;
    if (options.independent && options.version) throw new Error("--independent and --version are mutually exclusive");
    if (options.lockstep && !options.version) throw new Error("--lockstep requires --version <version>");
    return options;
  }
  if (options.mode === "changed") return options;
  if (options.mode === "bump") {
    const lockstep = options.from && options.to;
    const single = options.package && options.type;
    if (lockstep === single)
      throw new Error("bump requires either --from <v> --to <v> (lockstep) or --package <name> --type <patch|minor|major> (single)");
    if (options.ranges && (!lockstep || options.ranges !== "caret"))
      throw new Error("--ranges supports only caret with lockstep --from/--to");
    return options;
  }
  if (options.lockstep && options.independent) throw new Error("--lockstep and --independent are mutually exclusive");
  if (!options.lockstep && !options.independent) options.independent = true;
  if (options.independent && options.version) throw new Error("--independent and --version are mutually exclusive");
  if (options.lockstep && !options.version) throw new Error("--lockstep requires --version <version>");
  if (options.mode === "publish" && !options.dryRun && (options.allowDirty || options.allowUntagged)) {
    throw new Error("real publication cannot bypass clean tagged git checks");
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = resolve(options.root ?? process.cwd());
  const release = loadRelease(root);
  if (options.mode === "changed") {
    const list = changedPackages(release, { baseline: options.baseline });
    for (const pkg of list) console.log(pkg.manifest.name);
    return;
  }
  if (options.mode === "bump") {
    if (options.package) {
      if (!options.type) throw new Error("bump --package requires --type <patch|minor|major>");
      const result = bumpPackage(release, options.package, options.type);
      regenerateLockfile(root);
      console.log(`bumped ${result.name}: ${result.from} -> ${result.to}`);
      return;
    }
    const changed = bumpRelease(release, options.from, options.to);
    const ranged = options.ranges ? rewriteInternalRanges(release, options.to, options.ranges) : [];
    regenerateLockfile(root);
    console.log(`bumped ${changed.length} manifests from ${options.from} to ${options.to}: ${changed.join(", ")}`);
    if (ranged.length) console.log(`rewrote ${ranged.length} manifests to ${options.ranges} internal ranges: ${ranged.join(", ")}`);
    return;
  }
  if (options.mode === "gate") {
    checkReleaseEvidence({ root }); // fail fast on blocked/unexplained surfaces before the long gates
    const report = runGates({
      release,
      version: options.version,
      independent: options.independent,
      allowBreak: options.allowBreak,
      updateBaseline: options.updateBaseline,
      skipTarball: options.skipTarball,
    });
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  assertGitState(root, options.version, {
    ...options,
    independent: options.independent,
    tag: process.env.GITHUB_REF_NAME,
    packages: release.packages.map((p) => ({ name: p.manifest.name, version: p.manifest.version })),
  });
  const report = await runRelease({
    ...options,
    release,
    independentOptions: { baseline: options.baseline },
    reportPath: options.reportPath ? resolve(root, options.reportPath) : undefined,
  });
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
