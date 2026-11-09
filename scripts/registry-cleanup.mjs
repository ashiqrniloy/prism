// scripts/registry-cleanup.mjs
// Plan 215 Task 37: retire the legacy npm names as an owner-confirmed, ordered plan.
//
// The registry is read anonymously and nothing here mutates it. `--inventory` writes every name in
// the scope with its versions, deprecations, dist-tags, maintainers, last-week downloads and
// in-scope dependents; `--plan` prints the exact `npm unpublish` / `npm deprecate` commands the
// owner runs signed in with 2FA. npm's unpublish is irreversible (an unpublished version never
// comes back) and is not an OIDC operation, so this tool never reads a token, never spawns npm and
// never handles an OTP.
//
// The three name sources are: scripts/deprecations-0.13.json (the 0.13 retirement list), the scope
// listing (GET /-/org/<scope>/package, which needs no credential and, unlike search, still lists
// deprecated packages — `/-/v1/search?text=scope:arnilo` returns 0), and the names the 0.13.0 tree
// ships (a shipped name is never deleted; for a reused name only the retired line is).
//
// npm 12 (lib/commands/unpublish.js) accepts a single exact version or the whole package with
// `--force`; "Tags and ranges are not supported", so a reused name's retired line is one command
// per version. Policy (https://docs.npmjs.com/policies/unpublish/): after 72 hours a name can be
// unpublished only with one maintainer, fewer than 300 downloads last week, and no registry
// package depending on it. A name that fails any condition gets `npm deprecate` instead.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertNoSecretLeak, secretValues } from "./cache-parity/run.mjs";
import { DEFAULT_LIST_REL, DEFAULT_REGISTRY, escapedName, versionInRange } from "./registry-deprecate.mjs";

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const NEW_LINE_VERSION = "0.13.0";
/** npm's unpublish policy threshold, in downloads last week. */
export const POLICY_WEEKLY_DOWNLOADS = 300;
export const EVIDENCE_DIR_REL = "docs/_evidence/registry";
export const DEFAULT_DOWNLOADS_BASE = "https://api.npmjs.org";

/** `@arnilo/prism-x` -> `@arnilo`. */
export function scopeOf(name) {
  return name.slice(0, name.indexOf("/"));
}

/** The names the 0.13.0 tree publishes: the root package plus its workspace globs. */
export function shippedNames(rootDir = DEFAULT_ROOT) {
  const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
  const names = new Set([pkg.name]);
  for (const pattern of pkg.workspaces ?? []) {
    let dirs = [rootDir];
    for (const segment of pattern.split("/")) {
      const next = [];
      for (const dir of dirs) {
        if (!existsSync(dir)) continue;
        if (segment !== "*") {
          next.push(join(dir, segment));
          continue;
        }
        for (const entry of readdirSync(dir, { withFileTypes: true })) if (entry.isDirectory()) next.push(join(dir, entry.name));
      }
      dirs = next;
    }
    for (const dir of dirs) {
      const manifest = join(dir, "package.json");
      if (!existsSync(manifest)) continue;
      const workspace = JSON.parse(readFileSync(manifest, "utf8"));
      // A `private: true` workspace (apps/prism-agent) never reaches the registry.
      if (!workspace.private) names.add(workspace.name);
    }
  }
  return names;
}

/**
 * Whether a name is deleted, its retired line is deleted, or it stays. Pure: every input is on
 * `entry`, so the suite calls it with fixtures.
 */
/** The repo's own ledger of retired names: the names retired before 0.13, which no 0.13 list repeats. */
export function ledgerRetiredNames(rootDir = DEFAULT_ROOT) {
  const file = join(rootDir, "scripts/retired-names.json");
  if (!existsSync(file)) throw new Error(`missing ${file}`);
  const names = JSON.parse(readFileSync(file, "utf8")).packages;
  if (!Array.isArray(names) || names.some((name) => typeof name !== "string"))
    throw new Error(`${file}: packages must be an array of names`);
  return new Set(names);
}

export function classifyName(entry, { ledger = new Set() } = {}) {
  const { name, retired, shipped, state, versions = [], deprecatedVersions = [] } = entry;
  if (state !== undefined && state !== "present") return { category: "absent", action: "keep", reason: "not on the registry" };
  if (retired?.reused === true) {
    const old = versions.filter((version) => versionInRange(version, retired.range));
    if (old.length === 0) return { category: "retired", action: "keep", reason: `no published version is inside ${retired.range}` };
    return {
      category: "retired",
      action: "delete-old-line",
      retiredVersions: old,
      reason: `${NEW_LINE_VERSION} reuses the name, so only the ${retired.range} line is retired`,
    };
  }
  if (retired) return { category: "retired", action: "delete-name", reason: `retired ${retired.range}` };
  if (shipped) return { category: "shipped", action: "keep", reason: `${NEW_LINE_VERSION} publishes this name` };
  if (ledger.has(name))
    return {
      category: "retired",
      action: "delete-name",
      reason: "retired before 0.13 (scripts/retired-names.json) and no workspace ships it",
    };
  if (versions.length > 0 && deprecatedVersions.length === versions.length)
    return { category: "unlisted", action: "keep", reason: "every version is deprecated, but no 0.13 list names it (owner decision)" };
  return { category: "unlisted", action: "keep", reason: `no 0.13 list names ${name} (owner decision)` };
}

/** Classify a whole inventory: each entry keeps its raw fields and gains `category`, `action`, `reason`. */
export function classifyEntries(entries, { ledger = new Set() } = {}) {
  return entries.map((entry) => ({ ...entry, ...classifyName(entry, { ledger }) }));
}

/**
 * Every unpublish-policy condition the name fails, as human-readable strings. `deleting` is the set
 * of names this plan removes: a dependent inside that set disappears before this name does.
 */
export function policyRefusals(entry, deleting) {
  const reasons = [];
  if (entry.downloadsLastWeek === null || entry.downloadsLastWeek === undefined) {
    reasons.push("last-week downloads unknown; re-run --inventory");
  } else if (entry.downloadsLastWeek >= POLICY_WEEKLY_DOWNLOADS) {
    reasons.push(`${entry.downloadsLastWeek} downloads last week (policy allows fewer than ${POLICY_WEEKLY_DOWNLOADS})`);
  }
  if ((entry.maintainers ?? []).length > 1) reasons.push(`${entry.maintainers.length} maintainers (policy allows one)`);
  const outside = (entry.dependents ?? []).filter((dependent) => !deleting.has(dependent));
  if (outside.length > 0) {
    const verb = outside.length === 1 ? "is" : "are";
    reasons.push(`${outside.join(", ")} ${verb} published and depend${outside.length === 1 ? "s" : ""} on it`);
  }
  return reasons;
}

/** Dependents first: a name is emitted only after every name in the set that depends on it. */
export function orderDependentsFirst(entries) {
  const names = new Set(entries.map((entry) => entry.name));
  const remaining = new Map();
  for (const entry of entries) {
    remaining.set(entry.name, (entry.dependents ?? []).filter((dependent) => names.has(dependent) && dependent !== entry.name).length);
  }
  const ready = entries
    .map((entry) => entry.name)
    .filter((name) => remaining.get(name) === 0)
    .sort();
  const order = [];
  while (ready.length > 0) {
    const name = ready.shift();
    order.push(name);
    for (const dependency of dependenciesOf(name, entries, names)) {
      const left = remaining.get(dependency) - 1;
      remaining.set(dependency, left);
      if (left === 0) {
        ready.push(dependency);
        ready.sort();
      }
    }
  }
  if (order.length !== names.size) {
    const stuck = [...names].filter((name) => !order.includes(name));
    throw new Error(`cycle in the dependency graph: ${stuck.sort().join(", ")}`);
  }
  return order;
}

function dependenciesOf(name, entries, names) {
  const entry = entries.find((candidate) => candidate.name === name);
  return (entry?.dependsOn ?? []).filter((dependency) => names.has(dependency));
}

/** The `npm deprecate` fallback for a name the registry will not let us unpublish. */
export function deprecateCommand(entry) {
  const message = entry.retired?.message ?? entry.deprecatedMessage;
  if (typeof message !== "string" || message.length === 0) throw new Error(`${entry.name}: no deprecation message to fall back to`);
  const range = entry.retired?.range ?? `<${NEW_LINE_VERSION}`;
  return `npm deprecate '${entry.name}@${range}' '${message.replaceAll("'", "'\\''")}'`;
}

/**
 * The owner checklist for npm trusted publishing (plan 215 Task 38): npm has no API for it, so this
 * prints the settings to copy into each package's page on npmjs.com. A name that was never published
 * has no settings page, so it is marked as needing a manual first publish.
 */
export function renderTrustedPublishers(
  names,
  { owner, repository, workflow = "release.yml", environment = "npm-publish", published = new Set() } = {},
) {
  if (!owner || !repository) throw new Error("owner and repository are required");
  const lines = [
    "# Trusted publishers for the published @arnilo names (plan 215 Task 38).",
    "# npmjs.com -> Packages -> <name> -> Settings -> Trusted publishing -> GitHub Actions:",
    `#   organization/user: ${owner}`,
    `#   repository:        ${repository}`,
    `#   workflow filename: ${workflow}`,
    `#   environment:       ${environment}`,
    `#   allowed actions:   npm publish (and npm dist-tag, which the release tag needs)`,
    '# Then set Publishing access to "Require two-factor authentication and disallow tokens".',
    "# A name that npm has never seen cannot be configured: publish its first version locally with",
    "# 2FA, then add the trusted publisher. Leftovers here are the names still to publish.",
    "",
  ];
  for (const name of [...names].sort())
    lines.push(`- ${name}${published.has(name) ? "" : "  # never published: configure after the first manual publish"}`);
  return `${lines.join("\n")}\n`;
}

/**
 * The ordered plan: deletions (dependents first), refusals with their deprecation fallback, and the
 * names that stay. Pure; `--include-unlisted` is the owner's opt-in for the fully deprecated names
 * that no 0.13 list mentions.
 */
export function buildPlan(evidence, { includeUnlisted = false } = {}) {
  const byName = new Map(evidence.names.map((entry) => [entry.name, entry]));
  const candidates = new Map();
  for (const entry of evidence.names) {
    let action = entry.action;
    const fullyDeprecated = entry.versions.length > 0 && entry.deprecatedVersions.length === entry.versions.length;
    if (includeUnlisted && action === "keep" && fullyDeprecated) {
      // A shipped name keeps its entry: only the retired line goes, exactly as for a reused name.
      if (entry.shipped) {
        const old = entry.versions.filter((version) => versionInRange(version, `<${NEW_LINE_VERSION}`));
        if (old.length > 0)
          candidates.set(entry.name, {
            ...entry,
            action: "delete-old-line",
            retiredVersions: old,
            reason: `every published version is below ${NEW_LINE_VERSION} and deprecated`,
          });
        continue;
      }
      action = "delete-name";
    }
    if (action !== "keep") candidates.set(entry.name, { ...entry, action });
  }

  const deleting = new Set(candidates.keys());
  const refusals = new Map();
  for (let round = 0; round <= candidates.size; round += 1) {
    const found = new Map();
    for (const [name, entry] of candidates) {
      if (!deleting.has(name)) continue;
      const reasons = policyRefusals(entry, deleting);
      if (reasons.length > 0) found.set(name, reasons);
    }
    if (found.size === 0) break;
    for (const [name, reasons] of found) {
      refusals.set(name, reasons);
      deleting.delete(name);
    }
  }

  const ordered = orderDependentsFirst([...deleting].map((name) => candidates.get(name)));
  const steps = ordered.map((name) => {
    const entry = candidates.get(name);
    // When every published version is retired the name loses all of them anyway, which npm treats as
    // deleting the name: one command instead of one per version. A version outside the range (0.13.0
    // after the republish) keeps the per-version form, which is the case that must never hit the name.
    const allRetired = entry.action === "delete-old-line" && entry.retiredVersions.length === entry.versions.length;
    const action = allRetired ? "delete-name" : entry.action;
    const versions = action === "delete-old-line" ? entry.retiredVersions : [];
    return {
      name,
      action,
      reason: allRetired ? `every published version is retired, so the name goes` : entry.reason,
      dependents: entry.dependents ?? [],
      commands:
        action === "delete-name"
          ? [`npm unpublish ${name} --force`]
          : versions.map((version) => `npm unpublish ${name}@${version} --force`),
      versionCount: entry.versions.length,
      versions,
    };
  });
  const refused = [...refusals.entries()].map(([name, reasons]) => {
    const entry = byName.get(name);
    const message = entry?.retired?.message ?? entry?.deprecatedMessage;
    return { name, reasons, command: typeof message === "string" && message.length > 0 ? deprecateCommand(entry) : null };
  });
  const kept = evidence.names
    .filter((entry) => !deleting.has(entry.name) && !refusals.has(entry.name))
    .map((entry) => ({ name: entry.name, category: entry.category, reason: entry.reason }));
  return { steps, refusals: refused, kept, deleting: [...deleting] };
}

/** The plan as a shell script a human reads before running it. */
export function renderPlan(plan, { evidence = null } = {}) {
  const commands = plan.steps.reduce((total, step) => total + step.commands.length, 0);
  const lines = [
    "# Plan 215 Task 37 — retire the legacy @arnilo names.",
    `# generated: ${evidence?.generatedAt ?? "unknown"}  registry: ${evidence?.registry ?? "unknown"}`,
    `# ${plan.steps.length} name(s) and ${commands} command(s); ${plan.refusals.length} refused by policy; ${plan.kept.length} kept.`,
    "# Run top to bottom, signed in with 2FA; npm asks for an OTP per write. Dependents go first.",
    "# An unpublish the registry refuses prints its reason; its deprecate fallback follows the name as a comment.",
    "# Irreversible: an unpublished version never comes back, and a name whose every version goes is",
    "# blocked for 24 hours before it can be published again (0.13.0 needs that gap).",
    "",
  ];
  for (const step of plan.steps) {
    const what =
      step.action === "delete-name"
        ? `delete the name (${step.versionCount} version(s))`
        : `delete ${step.versions.length} retired version(s) of ${step.versionCount}`;
    lines.push(`# ${step.name}: ${what}; ${step.reason}`);
    for (const command of step.commands) lines.push(command);
    lines.push("");
  }
  if (plan.refusals.length > 0) {
    lines.push("# Refused by npm's unpublish policy: deprecate instead.", "");
    for (const refusal of plan.refusals) {
      lines.push(`# ${refusal.name}: ${refusal.reasons.join("; ")}`);
      lines.push(refusal.command ?? "# no deprecation message on this package: deprecate it by hand, or keep it");
    }
    lines.push("");
  }
  lines.push(`# Kept (${plan.kept.length}): ${plan.kept.map((entry) => `${entry.name} (${entry.reason})`).join(", ")}`);
  return `${lines.join("\n")}\n`;
}

/**
 * The registry reader. Every dependency is injectable so the suite runs offline with a stub
 * `fetch`; the CLI builds one from the environment.
 */
export function createRegistryCleanup({
  rootDir = DEFAULT_ROOT,
  registry = process.env.PRISM_CLEANUP_REGISTRY || DEFAULT_REGISTRY,
  downloadsBase = process.env.PRISM_CLEANUP_DOWNLOADS || DEFAULT_DOWNLOADS_BASE,
  fetchImpl = globalThis.fetch,
  listPath = join(rootDir, DEFAULT_LIST_REL),
  retired = null,
  shipped = null,
  out = (line) => console.log(line),
  err = (line) => console.error(line),
} = {}) {
  const base = String(registry).replace(/\/+$/, "");
  const downloads = String(downloadsBase).replace(/\/+$/, "");
  const retiredNames = retired ?? new Map(JSON.parse(readFileSync(listPath, "utf8")).names.map((item) => [item.name, item]));
  const shippedSet = shipped ?? shippedNames(rootDir);

  async function getJson(url, { optional = false } = {}) {
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const res = await fetchImpl(url, { headers: { accept: "application/json" } });
      if (res.ok) return res.json();
      if (res.status === 404) return null;
      // The downloads API rate-limits hard (429 with a Cloudflare page); it is the only soft input.
      if (attempt === 6) {
        if (optional) return null;
        throw new Error(`GET ${url}: ${res.status}`);
      }
      const retryAfter = Number(res.headers?.get?.("retry-after") ?? 0);
      await new Promise((resolve) => setTimeout(resolve, retryAfter > 0 ? retryAfter * 1000 : 1500 * attempt));
    }
    throw new Error(`GET ${url}: no response`);
  }

  async function readScope(scope) {
    const listing = await getJson(`${base}/-/org/${encodeURIComponent(scope.slice(1))}/package`);
    return Object.keys(listing ?? {}).sort();
  }

  async function readName(name) {
    const packument = await getJson(`${base}/${escapedName(name)}`);
    const downloadsPoint = await getJson(`${downloads}/downloads/point/last-week/${escapedName(name)}`, { optional: true });
    // The downloads API rate-limits to roughly one request per second; the scope is read once, by hand.
    await new Promise((resolve) => setTimeout(resolve, 250));
    const versions = packument === null ? [] : Object.keys(packument.versions ?? {}).sort();
    const deprecatedVersions = versions.filter((version) => packument.versions[version].deprecated);
    const latest = packument?.["dist-tags"]?.latest;
    const latestManifest = latest === undefined ? {} : (packument.versions?.[latest] ?? {});
    return {
      name,
      state: packument === null ? "absent" : "present",
      versions,
      deprecatedVersions,
      deprecatedMessage: deprecatedVersions.length === 0 ? null : packument.versions[deprecatedVersions.at(-1)].deprecated,
      distTags: packument?.["dist-tags"] ?? {},
      maintainers: (packument?.maintainers ?? []).map((maintainer) => maintainer.name),
      downloadsLastWeek: typeof downloadsPoint?.downloads === "number" ? downloadsPoint.downloads : null,
      dependsOn: Object.keys(latestManifest.dependencies ?? {}).filter((dependency) => dependency.startsWith(`${scopeOf(name)}/`)),
      dependents: [],
      retired: retiredNames.get(name) ?? null,
      shipped: shippedSet.has(name),
    };
  }

  /** Every name in the scope, each with its classification; no registry state is touched. */
  async function inventory(scope = "@arnilo") {
    const names = await readScope(scope);
    if (names.length === 0) throw new Error(`the scope listing for ${scope} is empty`);
    const entries = [];
    for (const name of names) entries.push(await readName(name));
    const byDependency = new Map(entries.map((entry) => [entry.name, []]));
    for (const entry of entries) {
      for (const dependency of entry.dependsOn) byDependency.get(dependency)?.push(entry.name);
    }
    for (const entry of entries) entry.dependents = (byDependency.get(entry.name) ?? []).sort();
    const classified = classifyEntries(entries, { ledger: ledgerRetiredNames(rootDir) });
    const summary = { names: classified.length };
    for (const action of ["delete-name", "delete-old-line", "keep"])
      summary[action] = classified.filter((entry) => entry.action === action).length;
    return {
      $comment:
        "Plan 215 Task 37 registry inventory. Anonymous registry reads only: the scope listing (GET /-/org/arnilo/package), one packument per name and one downloads point per name. No credential is read and nothing is mutated; the commands the owner runs are printed by `bun scripts/registry-cleanup.mjs --plan`.",
      generatedAt: new Date().toISOString(),
      registry: base,
      downloads: downloads,
      scope,
      newLineVersion: NEW_LINE_VERSION,
      sources: { scopeListing: `/-/org/${scope.slice(1)}/package`, retiredList: DEFAULT_LIST_REL, shipped: "package.json workspaces" },
      summary,
      names: classified,
    };
  }

  function write(evidence, path) {
    assertNoSecretLeak(evidence, secretValues(process.env), `the ${path} evidence`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`);
    return path;
  }

  function evidencePath(date = new Date()) {
    return join(rootDir, EVIDENCE_DIR_REL, `arnilo-scope-${date.toISOString().slice(0, 10)}.json`);
  }

  return { inventory, write, evidencePath, registry: base, listPath, shippedNames: shippedSet, out, err };
}

export async function main(argv = process.argv.slice(2)) {
  const wantsInventory = argv.includes("--inventory");
  const wantsPlan = argv.includes("--plan");
  const wantsPublishers = argv.includes("--trusted-publishers");
  if (!wantsInventory && !wantsPlan && !wantsPublishers) {
    console.error("usage: bun scripts/registry-cleanup.mjs [--inventory | --plan [--include-unlisted] | --trusted-publishers]");
    return 2;
  }
  const cleanup = createRegistryCleanup();
  const evidence = await cleanup.inventory();
  if (wantsInventory) {
    const path = cleanup.write(evidence, cleanup.evidencePath());
    cleanup.err(`inventory written: ${path}`);
    cleanup.out(JSON.stringify(evidence.summary));
    return 0;
  }
  if (wantsPublishers) {
    // Read, never spawn: this tool stays free of child processes (cleanup_plan_never_invokes_npm).
    const configPath = join(DEFAULT_ROOT, ".git", "config");
    const remote =
      /\[remote "origin"\][^[]*?url\s*=\s*(\S+)/.exec(existsSync(configPath) ? readFileSync(configPath, "utf8") : "")?.[1] ?? "";
    const match = /github\.com[:/]([^/]+)\/([^/.]+)/.exec(remote);
    if (!match) {
      cleanup.err(`cannot read owner/repository from remote.origin.url (${remote || "unset"})`);
      return 2;
    }
    const published = new Set(evidence.names.filter((entry) => entry.versions.length > 0).map((entry) => entry.name));
    writeFileSync(
      process.stdout.fd ?? 1,
      renderTrustedPublishers(shippedNames(), { owner: match[1], repository: match[2], published }),
      "utf8",
    );
    cleanup.err(`trusted publishers: ${shippedNames().length} name(s), nothing was executed`);
    return 0;
  }
  const plan = buildPlan(evidence, { includeUnlisted: argv.includes("--include-unlisted") });
  writeFileSync(process.stdout.fd ?? 1, renderPlan(plan, { evidence }), "utf8");
  cleanup.err(
    `plan: ${plan.steps.length} name(s), ${plan.steps.reduce((total, step) => total + step.commands.length, 0)} command(s), ${plan.refusals.length} refused, ${plan.kept.length} kept; nothing was executed`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  main().then((code) => process.exit(code));
}
