#!/usr/bin/env bun
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { activeBundles, validateBundles } from "./bundles.mjs";
import { lockWorkspace, readBunLock } from "./bun-lock.mjs";
import { runGates } from "./release-gates.mjs";

// Release artifacts are Bun's (plan 164 Task 8.4): `bun pm pack` writes the release tarballs and
// the GitHub build attestation covers exactly those bytes. Publishing is npm's (plan 215 Task 38):
// `npm publish <tarball> --provenance` is the only path that speaks OIDC trusted publishing, so CI
// holds no npm token; `bun publish` carries no OIDC support.

const INTERNAL_SCOPE = "@arnilo/";
const DEPENDENCY_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies"];
const INDEPENDENT_PACKAGES_FILE = "independent-packages.json";

export function loadRelease(root = process.cwd()) {
  validateBundles(root);
  const paths = ["."];
  const bundled = new Set(activeBundles(root).map((bundle) => bundle.dir));
  const packagesDir = join(root, "packages");
  if (existsSync(packagesDir)) {
    const children = (dir) =>
      readdirSync(dir, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name))
        .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, "package.json")));
    for (const entry of readdirSync(packagesDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      const dir = join(packagesDir, entry.name);
      if (existsSync(join(dir, "package.json"))) {
        paths.push(`packages/${entry.name}`);
        // A family directory may also nest packages (`packages/extensions/compaction`).
        if (!bundled.has(`packages/${entry.name}`)) {
          for (const child of children(dir)) paths.push(`packages/${entry.name}/${child.name}`);
        }
        continue;
      }
      for (const child of children(dir)) paths.push(`packages/${entry.name}/${child.name}`);
    }
  }
  // Packages that own their version line (plan 140) come from release tooling data, never from a
  // manifest field: a manifest is published bytes, and touching one after its version shipped makes
  // the next `--resume` see a different package than the registry has.
  //
  // `experimental` (plan 215 Task 2) names the packages on the prerelease line: they are independent-line
  // too, but publish under the `experimental` dist-tag and never under `latest`.
  const independentFile = join(root, "scripts", INDEPENDENT_PACKAGES_FILE);
  const independentData = existsSync(independentFile) ? JSON.parse(readFileSync(independentFile, "utf8")) : {};
  const experimentalNames = new Set(independentData.experimental ?? []);
  const independentNames = new Set([...(independentData.packages ?? []), ...experimentalNames]);
  const packages = paths.map((path) => {
    const manifest = JSON.parse(readFileSync(join(root, path, "package.json"), "utf8"));
    return {
      path,
      manifest,
      independent: independentNames.has(manifest.name),
      experimental: experimentalNames.has(manifest.name),
    };
  });
  const byName = new Map(packages.map((pkg) => [pkg.manifest.name, pkg]));
  for (const name of experimentalNames) if (!byName.has(name)) throw new Error(`unknown experimental package ${name}`);
  const release = { root, packages, byName };
  release.validate = (version) => validateRelease(release, version);
  release.validateIndependent = (opts) => validateReleaseIndependent(release, opts);
  return release;
}

/**
 * bun.lock version drift for every release package. The root entry has no
 * `version` (measured in phase 113 Task 1); a future Bun that writes one must
 * still match. Workspace entries must carry their manifest version. One helper
 * for both validators, so a lockfile shape change is fixed once.
 */
function lockVersionErrors(release, lock, versionFor, { includeIndependent = false } = {}) {
  const errors = [];
  // An independent package's lockfile entry follows its own manifest version, never the cut's, so a
  // lockstep cut skips it. The independent validator checks it against that manifest version.
  for (const pkg of release.packages.filter((candidate) => includeIndependent || !candidate.independent)) {
    const entry = lockWorkspace(lock, pkg.path);
    const expected = versionFor(pkg);
    if (!entry) errors.push(`bun.lock missing ${pkg.path}`);
    else if (entry.version !== undefined && entry.version !== expected)
      errors.push(`bun.lock ${pkg.path} version is ${entry.version}, expected ${expected}`);
    else if (pkg.path !== "." && entry.version === undefined) errors.push(`bun.lock ${pkg.path} has no version`);
  }
  return errors;
}

export function validateRelease(release, version) {
  const errors = [];
  for (const pkg of release.packages) {
    // Independent-line packages are released by their own tag, not by this cut.
    if (pkg.independent) continue;
    if (pkg.manifest.private) errors.push(`${pkg.manifest.name} is private`);
    if (pkg.manifest.version !== version) errors.push(`${pkg.manifest.name} version is ${pkg.manifest.version}, expected ${version}`);
    if (pkg.manifest.publishConfig?.access !== "public") errors.push(`${pkg.manifest.name} must set publishConfig.access to public`);
    for (const field of DEPENDENCY_FIELDS) {
      for (const [name, range] of Object.entries(pkg.manifest[field] ?? {})) {
        // The kernel peer is the API-level window, not a cut pin: every package admits the whole
        // 0.x line (`>=0.13.0 <1.0.0`), so a kernel minor never needs a package rewrite. A floor at
        // or below this cut is valid (docs/compatibility.md).
        if (field === "peerDependencies" && name === "@arnilo/prism") {
          const wide = /^>=(\d+\.\d+\.\d+) <1\.0\.0$/.exec(range);
          if (wide && cmpSemver(version, wide[1]) >= 0) continue;
        }
        // Lockstep cuts pin every first-party range at the cut version — exact
        // (`<version>`) or caret (`^<version>`). A range that merely *satisfies*
        // it (one minor behind at the cut) means two installs of one release line
        // can resolve different first-party minors, so the gate fails closed instead.
        const target = release.byName.get(name);
        // A range into an independent line is pinned by that line, not by this cut.
        if (target && !target.independent && range !== version && range !== `^${version}`)
          errors.push(`${pkg.manifest.name} ${field}.${name} is ${range}, expected ${version}`);
      }
    }
  }

  const lock = readBunLock(release.root);
  errors.push(...lockVersionErrors(release, lock, () => version));
  errors.push(...releaseLineErrors(release));
  if (errors.length) throw new Error(errors.join("\n"));
  // The publish set of a lockstep cut: independent-line packages ship from their own tag.
  return topologicalOrder(release).filter((pkg) => !pkg.independent);
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

  const priority = new Map(activeBundles(release.root).map((bundle) => [bundle.name, bundle.publishOrder ?? 0]));
  priority.set(release.packages.find((pkg) => pkg.path === ".")?.manifest.name, 0);
  const order = [];
  while (remaining.size) {
    const ready = [...remaining]
      .filter(([, dependencies]) => dependencies.size === 0)
      .map(([name]) => name)
      .sort((a, b) => (priority.get(a) ?? 0) - (priority.get(b) ?? 0) || a.localeCompare(b));
    if (!ready.length) throw new Error(`internal dependency cycle: ${[...remaining.keys()].sort().join(", ")}`);
    const name = ready[0];
    order.push(release.byName.get(name));
    remaining.delete(name);
    for (const dependencies of remaining.values()) dependencies.delete(name);
  }
  return order;
}

/** `src/version.ts` carries the kernel version for `requires.prism`; keep it in step with the root manifest. */
function syncKernelVersion(root, version) {
  const file = join(root, "src", "version.ts");
  if (!existsSync(file)) return;
  const text = readFileSync(file, "utf8");
  const next = text.replace(/(export const KERNEL_VERSION = ")[^"]*(";)/, `$1${version}$2`);
  if (next !== text) writeFileSync(file, next);
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
    if (pkg.manifest.name === "@arnilo/prism") syncKernelVersion(release.root, to);
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
  const result = spawnSync("bun", ["install", "--lockfile-only"], {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) throw new Error("bun install --lockfile-only failed after version bump");
}

// --- independent versioning (dual-mode; default after the 0.3.0 cut) ---

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

export function parseSemver(version) {
  const m = SEMVER_RE.exec(String(version));
  return m ? { major: +m[1], minor: +m[2], patch: +m[3], prerelease: m[4] === undefined ? [] : m[4].split(".") } : undefined;
}

const NUMERIC_IDENTIFIER = /^\d+$/;

/** semver 2.0.0 §11 precedence: a prerelease sorts below its release; identifiers compare numerically or lexically. */
export function cmpSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  const core = pa.major - pb.major || pa.minor - pb.minor || pa.patch - pb.patch;
  if (core) return core;
  if (!pa.prerelease.length || !pb.prerelease.length) return pb.prerelease.length - pa.prerelease.length;
  for (let i = 0; i < Math.max(pa.prerelease.length, pb.prerelease.length); i++) {
    const x = pa.prerelease[i];
    const y = pb.prerelease[i];
    if (x === undefined) return -1; // a shorter identifier list sorts first
    if (y === undefined) return 1;
    const xn = NUMERIC_IDENTIFIER.test(x);
    const yn = NUMERIC_IDENTIFIER.test(y);
    if (xn && yn) {
      if (+x !== +y) return +x - +y;
    } else if (xn !== yn) {
      return xn ? -1 : 1; // numeric identifiers sort below alphanumeric ones
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Internal range satisfaction for @arnilo/* pins. Supports exact, caret, and
 * tilde with npm's 0.x bounds. A prerelease target (the experimental line) satisfies only an
 * exact range: npm never matches a prerelease against a caret or tilde of the release, so a loose
 * pin fails closed here instead of at install time.
 */
export function satisfiesInternalRange(range, version) {
  const r = String(range).trim();
  const min = r.replace(/^[~^]/, "");
  const base = parseSemver(min);
  const target = parseSemver(version);
  if (!base || !target) return false;
  if (target.prerelease.length) return r === version;
  if (cmpSemver(version, min) < 0) return false;
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
  if (type === "prerelease") {
    if (!v.prerelease.length) throw new Error(`prerelease bump needs a prerelease version, got ${version}`);
    const ids = [...v.prerelease];
    const last = ids.length - 1;
    if (NUMERIC_IDENTIFIER.test(ids[last])) ids[last] = String(Number(ids[last]) + 1);
    else ids.push("0");
    return `${v.major}.${v.minor}.${v.patch}-${ids.join(".")}`;
  }
  throw new Error(`unknown bump type: ${type}; use patch|minor|major|prerelease`);
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
        // The kernel peer is the API-level window, not a cut pin: a floor at or below the kernel is fine.
        if (field === "peerDependencies" && name === "@arnilo/prism") {
          const wide = /^>=(\d+\.\d+\.\d+) <1\.0\.0$/.exec(range);
          if (wide && cmpSemver(target.manifest.version, wide[1]) >= 0) continue;
        }
        if (!satisfiesInternalRange(range, target.manifest.version)) {
          errors.push(`${pkg.manifest.name} ${field}.${name} range ${range} does not satisfy ${name}@${target.manifest.version}`);
        }
      }
    }
  }
  const lock = readBunLock(release.root);
  errors.push(...lockVersionErrors(release, lock, (pkg) => pkg.manifest.version, { includeIndependent: true }));
  errors.push(...releaseLineErrors(release));
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
  // An experimental package stays a prerelease; a stable one never becomes one.
  if (pkg.experimental && type !== "prerelease") throw new Error(`${name} is experimental: bump it with prerelease, not ${type}`);
  const to = incrementVersion(from, type);
  pkg.manifest.version = to;
  writeFileSync(join(release.root, pkg.path, "package.json"), `${JSON.stringify(pkg.manifest, null, 2)}\n`);
  if (name === "@arnilo/prism") syncKernelVersion(release.root, to);
  // Experimental packages pin each other exactly (a caret never matches a prerelease), so a bump moves
  // every exact pin that named the old version. Dev `file:` links and loose ranges are left alone.
  const repinned = [];
  if (pkg.experimental) {
    for (const dependent of release.packages) {
      let dirty = false;
      for (const field of DEPENDENCY_FIELDS) {
        if (dependent.manifest[field]?.[name] === from) {
          dependent.manifest[field][name] = to;
          dirty = true;
        }
      }
      if (!dirty) continue;
      writeFileSync(join(release.root, dependent.path, "package.json"), `${JSON.stringify(dependent.manifest, null, 2)}\n`);
      repinned.push(dependent.manifest.name);
    }
  }
  return { name, from, to, repinned };
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
      Object.fromEntries(
        Object.entries(manifest[field] ?? {})
          .filter(([name]) => name.startsWith(INTERNAL_SCOPE))
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
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

/**
 * The dist-tag a package publishes under, derived from the release line and never from the caller:
 * an experimental package is `experimental`, everything else `latest`. A version that disagrees with
 * its line fails closed, so a prerelease cannot reach `latest` and a stable cut cannot reach `experimental`.
 */
export function releaseTag(pkg, version) {
  const prerelease = parseSemver(version)?.prerelease.length > 0;
  const name = pkg.manifest.name;
  if (pkg.experimental) {
    if (!prerelease)
      throw new Error(`experimental_version_mismatch: ${name}@${version} is on the experimental line but has no prerelease identifier`);
    return "experimental";
  }
  if (prerelease)
    throw new Error(`stable_version_prerelease: ${name}@${version} has a prerelease identifier but is not in the experimental list`);
  return "latest";
}

/** Line errors for every package's manifest version, so `check` and the validators fail before a publish. */
function releaseLineErrors(release) {
  const errors = [];
  for (const pkg of release.packages) {
    try {
      releaseTag(pkg, pkg.manifest.version);
    } catch (error) {
      errors.push(error.message);
    }
  }
  return errors;
}

// npm reads a bare `dir/file.tgz` as a GitHub shorthand (`github:dir/file.tgz`) and refuses it
// (EALLOWGIT). Only an explicit `./`, `../` or `/` prefix makes the argument a local file, so the
// relative artifact path gets `./` (v0.13.0 run 43070804747 failed on this before any upload).
export function npmFileArg(path) {
  return path.startsWith("/") || path.startsWith("./") || path.startsWith("../") ? path : `./${path}`;
}

export function publishArgs(pkg, version, { dryRun = false, registry, provenance = false, artifactsDir = "release-artifacts" } = {}) {
  const args = [
    "publish",
    npmFileArg(join(artifactsDir, tarballName(pkg.manifest.name, version))),
    "--access",
    "public",
    "--tag",
    releaseTag(pkg, version),
  ];
  // npm's OIDC trusted publishing: the sigstore statement needs the workflow's `id-token: write`
  // and a GitHub-hosted runner, so it is passed in CI only (a local bootstrap publish has no OIDC).
  if (provenance && !dryRun) args.push("--provenance");
  if (registry) args.push("--registry", registry);
  if (dryRun) args.push("--dry-run");
  return args;
}

/** `bun pm pack` tarball name: `@arnilo/prism@0.13.0` -> `arnilo-prism-0.13.0.tgz`. */
export function tarballName(name, version) {
  return `${name.replace(/^@/, "").replace("/", "-")}-${version}.tgz`;
}

/** Pack every release package once, so the attested tarballs are the published bytes. */
export function packRelease(release, destination = "release-artifacts") {
  const dir = resolve(release.root, destination);
  mkdirSync(dir, { recursive: true });
  for (const pkg of release.packages) {
    const cwd = pkg.path === "." ? release.root : join(release.root, pkg.path);
    const result = spawnSync("bun", ["pm", "pack", "--destination", dir], { cwd, encoding: "utf8", stdio: "inherit" });
    if (result.status !== 0) throw new Error(`bun pm pack failed for ${pkg.manifest.name}`);
  }
  return dir;
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
  artifactsDir = "release-artifacts",
  fetcher = fetch,
  reportPath,
  publisher,
}) {
  const validated = independent ? validateReleaseIndependent(release, independentOptions) : validateRelease(release, version);
  const order = independent
    ? validated.filter((pkg) => changedPackages(release, independentOptions).some((changed) => changed.path === pkg.path))
    : validated;
  // Fail on a mislabeled line before any registry call, in `check` mode too.
  for (const pkg of order) releaseTag(pkg, independent ? pkg.manifest.version : version);
  const report = {
    version: independent ? "independent" : version,
    independent,
    dryRun,
    order: order.map((pkg) => pkg.manifest.name),
    packages: [],
  };
  // release-host registry toolchain: `bun publish` has no OIDC support (plan 215 Task 38), so the
  // pipeline publishes the packed, attested tarballs with npm, which exchanges the workflow's OIDC
  // token for a short-lived credential.
  const provenance = process.env.GITHUB_ACTIONS === "true";
  const publish =
    publisher ??
    ((pkg) => {
      const pubVersion = independent ? pkg.manifest.version : version;
      const result = spawnSync("npm", publishArgs(pkg, pubVersion, { dryRun, registry, provenance, artifactsDir }), {
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
  if (!existsSync(path)) throw new Error(`release evidence missing at ${path}; run bun run release:evidence`);
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
    else if (arg === "--destination") options.destination = argv[++i];
    else if (["--version", "--root", "--registry", "--report"].includes(arg))
      options[arg.slice(2).replace("report", "reportPath")] = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!["check", "publish", "gate", "bump", "changed", "pack"].includes(options.mode))
    throw new Error(
      "usage: release.mjs <check|publish|gate|bump|changed|pack> [--lockstep --version <version>|--independent] [--resume] [--dry-run]",
    );
  if (options.mode === "pack") return options;
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
      throw new Error(
        "bump requires either --from <v> --to <v> (lockstep) or --package <name> --type <patch|minor|major|prerelease> (single)",
      );
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
  if (options.mode === "pack") {
    const dir = packRelease(release, options.destination ?? "release-artifacts");
    console.log(`packed ${release.packages.length} packages into ${dir}`);
    return;
  }
  if (options.mode === "changed") {
    const list = changedPackages(release, { baseline: options.baseline });
    for (const pkg of list) console.log(pkg.manifest.name);
    return;
  }
  if (options.mode === "bump") {
    if (options.package) {
      if (!options.type) throw new Error("bump --package requires --type <patch|minor|major|prerelease>");
      const result = bumpPackage(release, options.package, options.type);
      regenerateLockfile(root);
      console.log(`bumped ${result.name}: ${result.from} -> ${result.to}`);
      if (result.repinned.length) console.log(`repinned ${result.repinned.join(", ")}`);
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
    // The gate packs with `bun pm pack` and lists tarballs with tar; fail closed on any other runtime.
    if (typeof Bun === "undefined") {
      console.error("release gate runs on Bun only: bun scripts/release.mjs gate");
      process.exit(1);
    }
    checkReleaseEvidence({ root }); // fail fast on blocked/unexplained surfaces before the long gates
    const report = runGates({
      release,
      version: options.version,
      independent: options.independent,
      allowBreak: options.allowBreak,
      updateBaseline: options.updateBaseline,
      skipTarball: options.skipTarball,
      packageName: options.package,
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
