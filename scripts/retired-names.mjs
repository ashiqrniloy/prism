#!/usr/bin/env bun
// Plan 215 Task 35: the standing retired-name sweep (was plan 187 Task 1).
//
// `scripts/retired-names.json` lists every name the 0.13.0 train retired. The generated half comes
// from the compat-baseline diff against a release tag (default `v0.12.1`):
//   - `packages`   the `@arnilo/*` names with a v0.12.1 baseline, a registry-deprecation entry or a
//                  stale baseline file, and no live workspace;
//   - `exports`    every export name in a v0.12.1 baseline that no live baseline exports;
//   - `errorCodes` every `ERR_*` code in the tag's `src/` + `packages/` source that live source no
//                  longer contains;
//   - `cliFlags`   every flag literal in the tag's `src/cli*.ts` that the live `prism` bin no longer
//                  parses.
// The hand-curated half (`vocabulary`, `allow`) is kept across regenerations. Retired tool names stay in
// `scripts/retired-tool-names.json` (plan 215 Task 7), which the sweep reads too.
//
//   bun scripts/retired-names.mjs --generate [--from v0.12.1]   rewrite the generated half
//   bun scripts/retired-names.mjs                                run the sweep, exit 1 on any hit
//
// The sweep is a Bun/Node walk over `git ls-files` (no `rg` dependency). Each matcher is chosen so
// that a hit means a reader is told to use something that is gone:
//   - a retired package specifier anywhere;
//   - a retired export imported from an `@arnilo/*` specifier (code or Markdown code blocks);
//   - a retired export, error code or tool name in Markdown backticks;
//   - a retired error code anywhere;
//   - a retired tool name as a quoted string in source;
//   - a retired flag on a `prism` command line.
//   - in Markdown and `examples/`, a name imported from a live `@arnilo/*` specifier that the
//     specifier does not export (`bun run typecheck` covers the rest of the tree).
// A Markdown backtick hit is skipped when `vocabulary` lists the name (a field such as `agentId`), and a
// Markdown hit inside a section or on a line that says the name is gone is not a hit (`removalSections`,
// `REMOVAL_SENTENCE`).
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { activeBundles } from "./bundles.mjs";
import { loadRelease } from "./release.mjs";
import { BASELINE_DIR, baselineName } from "./release-gates.mjs";

export const ROOT = join(import.meta.dirname, "..");
export const LIST_FILE = "scripts/retired-names.json";
export const TOOL_LIST_FILE = "scripts/retired-tool-names.json";
export const DEFAULT_FROM = "v0.12.1";

export const SCAN_ROOTS = ["src", "packages", "apps", "scripts", "examples", "docs", "README.md", "PRODUCT.md"];

// Paths the sweep never reads: build output, plans, release history, migration guides (they name the
// removed APIs by design), the lists themselves, the compat baselines, the frozen `phase<N>` release
// evidence (immutable, audited standalone; `scripts/run-all-tests.mjs`), and tests (a test names a
// retired symbol to pin its absence; `bun run typecheck` catches a live import of one).
export const EXCLUDE = [
  /^scripts\/bundles\.json$/,
  /(^|\/)dist\//,
  /(^|\/)node_modules\//,
  /^plans\//,
  /^docs\/history\//,
  /^docs\/_evidence\//,
  /(^|\/)CHANGELOG\.md$/,
  /^docs\/migrate-to-[^/]+\.md$/,
  /^docs\/migration\.md$/,
  /^scripts\/compat-baseline\//,
  /^scripts\/retired-names\.(json|mjs|test\.mjs)$/,
  /^scripts\/retired-tool-names\.json$/,
  /^scripts\/deprecations-0\.13\.json$/,
  /^scripts\/phase\d+-/,
  /(^|\/)__tests__\//,
  /\.test\.[cm]?[jt]sx?$/,
  /\.(png|jpe?g|gif|webp|ico|pdf|docx|xlsx|pptx|zip|gz|tgz|wasm|woff2?|ttf|sqlite|db)$/i,
];

const SOURCE_EXT = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
const MD_EXT = /\.mdx?$/;
const CLI_DOC_EXT = /\.(mdx?|sh|ya?ml|txt)$/;
// Flags the bin answers without a literal in `src/cli*.ts`, and generic ones that are not retirements.
const CLI_FLAG_KEEP = new Set(["--help", "-h", "--version", "-v"]);

function git(args, root = ROOT) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 });
}

const nameOfKey = (key) => key.split(" ").pop();

function baselineNames(text) {
  const names = new Set();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const tab = line.indexOf("\t");
    names.add(nameOfKey(tab === -1 ? line : line.slice(0, tab)));
  }
  return names;
}

function livePackages(root) {
  return loadRelease(root).packages.map((pkg) => pkg.manifest);
}

/** The export names every live publishable package exports today, from its compat baseline. */
export function liveExportNames(root = ROOT) {
  const names = new Set();
  for (const manifest of livePackages(root)) {
    if (manifest.private) continue;
    const file = join(root, BASELINE_DIR, baselineName(manifest.name));
    if (!existsSync(file)) continue;
    for (const name of baselineNames(readFileSync(file, "utf8"))) names.add(name);
  }
  return names;
}

/** Export names in the tag's baselines, mapped to the packages that exported them. */
export function tagExportNames(from, root = ROOT) {
  const byName = new Map();
  const files = git(["ls-tree", "--name-only", from, `${BASELINE_DIR}/`], root)
    .split("\n")
    .filter(Boolean);
  for (const file of files) {
    const pkg = `@arnilo/${file.split("/").pop().slice("arnilo__".length, -".txt".length)}`;
    for (const name of baselineNames(git(["show", `${from}:${file}`], root))) {
      if (!byName.has(name)) byName.set(name, new Set());
      byName.get(name).add(pkg);
    }
  }
  return byName;
}

function liveSourceFiles(root) {
  return git(["ls-files", "-co", "--exclude-standard", "--", "src", "packages", "apps"], root)
    .split("\n")
    .filter((file) => file && SOURCE_EXT.test(file) && !EXCLUDE.some((re) => re.test(file)) && existsSync(join(root, file)));
}

function codesIn(text) {
  return text.match(/\bERR_[A-Z0-9_]+\b/g) ?? [];
}

function flagsIn(text) {
  return (text.match(/["'](--?[a-z][a-z0-9-]*)["']/g) ?? []).map((quoted) => quoted.slice(1, -1));
}

/** The generated half of the list: a pure function of the tag and the live tree. */
export function generate({ from = DEFAULT_FROM, root = ROOT } = {}) {
  const manifests = livePackages(root);
  const live = new Set(manifests.map((manifest) => manifest.name));
  const candidates = new Set();
  for (const file of git(["ls-tree", "--name-only", from, `${BASELINE_DIR}/`], root)
    .split("\n")
    .filter(Boolean)) {
    candidates.add(`@arnilo/${file.split("/").pop().slice("arnilo__".length, -".txt".length)}`);
  }
  for (const file of readdirSync(join(root, BASELINE_DIR)).filter((name) => name.endsWith(".txt"))) {
    candidates.add(`@arnilo/${file.slice("arnilo__".length, -".txt".length)}`);
  }
  for (const entry of JSON.parse(readFileSync(join(root, "scripts/deprecations-0.13.json"), "utf8")).names) {
    candidates.add(entry.name);
  }
  const successors = {};
  for (const bundle of activeBundles(root)) {
    for (const row of bundle.subpaths) {
      if (row.formerName === bundle.name) continue;
      candidates.add(row.formerName);
      if (!(row.formerName in successors) || row.kind === "package") {
        successors[row.formerName] = bundle.name + (row.path === "." ? "" : row.path.slice(1));
      }
    }
  }
  const packages = [...candidates].filter((name) => !live.has(name)).sort();

  // Subpaths a package still published at 0.13.0 no longer exports (`@arnilo/prism/node/settings`).
  // A retired package's subpaths are covered by its package name.
  const liveSubpaths = new Map(manifests.map((manifest) => [manifest.name, new Set(Object.keys(manifest.exports ?? {}))]));
  const subpaths = [];
  const tagManifests = git(["ls-tree", "-r", "--name-only", from], root)
    .split("\n")
    .filter(
      (file) => /^(package\.json|packages\/.+\/package\.json)$/.test(file) && !/(node_modules|fixtures|templates|__tests__)\//.test(file),
    );
  for (const file of tagManifests) {
    const manifest = JSON.parse(git(["show", `${from}:${file}`], root));
    if (manifest.private || !liveSubpaths.has(manifest.name)) continue;
    for (const key of Object.keys(manifest.exports ?? {})) {
      if (key === "." || key === "./package.json" || liveSubpaths.get(manifest.name).has(key)) continue;
      subpaths.push(`${manifest.name}${key.slice(1)}`);
    }
  }
  subpaths.sort();

  const liveNames = liveExportNames(root);
  const exports = [...tagExportNames(from, root)]
    .filter(([name]) => !liveNames.has(name))
    .map(([name, pkgs]) => ({ name, from: [...pkgs].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const tagCodes = new Set(
    codesIn(git(["grep", "-h", "-o", "-E", "ERR_[A-Z0-9_]+", from, "--", "src", "packages", ":!**/__tests__/**", ":!**/*.test.*"], root)),
  );
  const liveCodes = new Set();
  for (const file of liveSourceFiles(root)) for (const code of codesIn(readFileSync(join(root, file), "utf8"))) liveCodes.add(code);
  // A code ending in `_` is a prefix literal (`ERR_PRISM_DECISION_`), not a code.
  const errorCodes = [...tagCodes].filter((code) => !code.endsWith("_") && !liveCodes.has(code)).sort();

  const tagCli = git(["ls-tree", "--name-only", from, "src/"], root)
    .split("\n")
    .filter((file) => /^src\/cli[^/]*\.ts$/.test(file));
  const tagFlags = new Set(tagCli.flatMap((file) => flagsIn(git(["show", `${from}:${file}`], root))));
  const liveFlags = new Set(
    readdirSync(join(root, "src"))
      .filter((file) => /^cli[^/]*\.ts$/.test(file))
      .flatMap((file) => flagsIn(readFileSync(join(root, "src", file), "utf8"))),
  );
  const cliFlags = [...tagFlags].filter((flag) => !liveFlags.has(flag) && !CLI_FLAG_KEEP.has(flag)).sort();

  return { generatedFrom: from, packages, successors, subpaths, exports, errorCodes, cliFlags };
}

export function readList(root = ROOT) {
  return JSON.parse(readFileSync(join(root, LIST_FILE), "utf8"));
}

export function writeList(generated, root = ROOT) {
  const previous = existsSync(join(root, LIST_FILE)) ? readList(root) : {};
  const list = {
    $comment:
      "Plan 215 Task 35. Names the 0.13.0 train retired. `generatedFrom`, `packages`, `exports`, `errorCodes` and `cliFlags` are generated by `bun scripts/retired-names.mjs --generate` from the compat-baseline diff against that tag; do not edit them by hand. `vocabulary` (retired export names that stay ordinary words, such as a field name) and `allow` (path prefixes with the names they may keep, and why) are hand-curated and survive regeneration. Retired tool names live in scripts/retired-tool-names.json. `scripts/retired-names.test.mjs` fails on any hit in the live tree.",
    ...generated,
    vocabulary: previous.vocabulary ?? [],
    allow: previous.allow ?? [],
  };
  writeFileSync(join(root, LIST_FILE), `${JSON.stringify(list, null, 2)}\n`);
  return list;
}

// A Markdown sentence that states a removal may name what was removed. A sentence ends at `. `, a blank
// line, a list item, or a table row, so a wrapped sentence counts as one.
const SENTENCE_BREAK = /\.\s|\n\s*\n|\n\s*[-*|]\s|\n\s*\d+\.\s|\|/g;

function sentenceAt(text, index) {
  let start = 0;
  let end = text.length;
  for (const m of text.matchAll(SENTENCE_BREAK)) {
    if (m.index + m[0].length <= index) start = m.index + m[0].length;
    else if (m.index >= index) {
      end = m.index;
      break;
    }
  }
  return text.slice(start, end);
}

// "the 0.12 `x`", "in 0.11": a sentence about an earlier line, not a unit (`0.1 ms`).
const REMOVAL_SENTENCE =
  /\b(?:removed|deleted|retired|is gone|are gone|were gone|no longer|replac(?:ed|es)|superseded|successor|renamed|moved (?:to|out|into))\b|\b(?:the|in|from|of|before|until)\s+0\.(?:\d|1[0-2])(?:\.\d+)?(?:'s)?(?!\.?\d|\s*(?:ms|s|%|KiB|MiB|MB|GB|x|×)\b)/i;

/** Live `@arnilo/*` specifier → the names it exports, from the compat baselines. */
export function liveSurfaces(root = ROOT) {
  const surfaces = new Map();
  for (const manifest of livePackages(root)) {
    if (manifest.private) continue;
    const file = join(root, BASELINE_DIR, baselineName(manifest.name));
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const tab = line.indexOf("\t");
      if (tab === -1) continue;
      const parts = line.slice(0, tab).split(" ");
      const subpath = parts.length > 1 ? parts[0] : ".";
      const specifier = subpath === "." ? manifest.name : `${manifest.name}${subpath.slice(1)}`;
      if (!surfaces.has(specifier)) surfaces.set(specifier, new Set());
      surfaces.get(specifier).add(parts.at(-1));
    }
  }
  return surfaces;
}

function scanFiles(root) {
  const out = git(["ls-files", "-co", "--exclude-standard", "--", ...SCAN_ROOTS], root);
  return [...new Set(out.split("\n"))].filter((file) => file && !EXCLUDE.some((re) => re.test(file)) && existsSync(join(root, file)));
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

// A Markdown section that says names are gone may name them: a heading of "Removed …", "Retired …",
// "Migration …"/"Migrating …"/"Upgrading …", or one naming a 0.x line ("Changes from 0.12"). The section
// runs to the next heading of the same or a higher level.
const REMOVAL_HEADING = /^(#{1,6})\s+(?:(?:Removed|Retired|Migrat(?:e|ion|ing)|Upgrad(?:e|ing))\b|.*\b0\.(?:[0-9]|1[0-2])\b)/i;

export function removalSections(text) {
  const ranges = [];
  const headings = [...text.matchAll(/^(#{1,6})\s.*$/gm)];
  headings.forEach((heading, i) => {
    const match = heading[0].match(REMOVAL_HEADING);
    if (!match) return;
    const level = match[1].length;
    const next = headings.slice(i + 1).find((later) => later[1].length <= level);
    ranges.push([heading.index, next ? next.index : text.length]);
  });
  return ranges;
}

/**
 * Run the sweep. Returns `{ hits, files, ms }`; each hit is `{ file, line, kind, name }`. `files` (a map of
 * repo path → text) replaces the tree walk, for tests.
 */
export function sweep({ root = ROOT, list = readList(root), files: given } = {}) {
  const started = performance.now();
  const tools = new Set(JSON.parse(readFileSync(join(root, TOOL_LIST_FILE), "utf8")).tools.map((tool) => tool.name));
  const exportsSet = new Set(list.exports.map((entry) => entry.name));
  const vocabulary = new Set(list.vocabulary.map((entry) => entry.name));
  const codes = new Set(list.errorCodes);
  const flags = new Set(list.cliFlags);
  const allow = list.allow.map((entry) => ({ ...entry, names: entry.names ? new Set(entry.names) : undefined }));
  const allowed = (file, name) => allow.some((entry) => file.startsWith(entry.path) && (!entry.names || entry.names.has(name)));

  const packageRe = list.packages.length
    ? new RegExp(`@arnilo/(?:${list.packages.map((name) => escape(name.slice("@arnilo/".length))).join("|")})(?![A-Za-z0-9_-])`, "g")
    : undefined;
  const subpathRe = list.subpaths?.length
    ? new RegExp(`(?:${list.subpaths.map(escape).join("|")})(?![A-Za-z0-9_/-]|\\.[A-Za-z0-9])`, "g")
    : undefined;
  const importRe = /\b(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["'](@arnilo\/[^"']+)["']/g;
  const backtickRe = /`([A-Za-z_$][A-Za-z0-9_$]*)(?:\([^`)]*\))?`/g;
  // String quotes only: a backticked tool name in a source comment is prose about its removal.
  const quotedRe = /["']([a-z][a-z0-9_]*)["']/g;
  // Dated history prose in a JSON config (`"$comment"`, `"reason"`) records what a retired name was.
  const jsonHistoryLine = /^\s*"(?:\$comment|reason|note)"\s*:/;
  const cliLineRe = /(?:^|[\s`$(>])(?:npx |bunx )?prism\s+([^\n|;&]*)/g;

  const surfaces = liveSurfaces(root);
  const texts = new Map();
  for (const file of given ? [...given.keys()].filter((path) => !EXCLUDE.some((re) => re.test(path))) : scanFiles(root)) {
    let text;
    try {
      text = given ? given.get(file) : readFileSync(join(root, file), "utf8");
    } catch {
      continue;
    }
    if (text.includes("\u0000")) continue;
    texts.set(file, text);
  }

  const hits = [];
  const seen = new Set();
  let exempt = [];
  const add = (file, index, text, kind, name) => {
    if (allowed(file, name)) return;
    if (exempt.some(([start, end]) => index >= start && index < end)) return;
    if (MD_EXT.test(file) && REMOVAL_SENTENCE.test(sentenceAt(text, index))) return;
    if (file.endsWith(".json")) {
      const start = text.lastIndexOf("\n", index - 1) + 1;
      if (jsonHistoryLine.test(text.slice(start, start + 200))) return;
    }
    const line = lineOf(text, index);
    const key = `${file}:${line}:${kind}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({ file, line, kind, name });
  };

  for (const [file, text] of texts) {
    const md = MD_EXT.test(file);
    exempt = md ? removalSections(text) : [];
    if (packageRe) for (const m of text.matchAll(packageRe)) add(file, m.index, text, "package", m[0]);
    if (subpathRe) for (const m of text.matchAll(subpathRe)) add(file, m.index, text, "subpath", m[0]);
    for (const m of text.matchAll(importRe)) {
      for (const part of m[1].split(",")) {
        const name = part
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)[0]
          .trim();
        if (exportsSet.has(name)) add(file, m.index, text, "export", name);
        else if ((md || file.startsWith("examples/")) && name && surfaces.has(m[2]) && !surfaces.get(m[2]).has(name)) {
          add(file, m.index, text, "import", `${name} from ${m[2]}`);
        }
      }
    }
    if (codes.size) for (const m of text.matchAll(/\bERR_[A-Z0-9_]+\b/g)) if (codes.has(m[0])) add(file, m.index, text, "error", m[0]);
    if (md) {
      for (const m of text.matchAll(backtickRe)) {
        const name = m[1];
        if (tools.has(name)) add(file, m.index, text, "tool", name);
        // An all-lowercase word (`session`, `usage`) is prose; a retired API name has a capital or `_`.
        else if (exportsSet.has(name) && /[A-Z_]/.test(name) && !vocabulary.has(name)) add(file, m.index, text, "export", name);
      }
    } else if (SOURCE_EXT.test(file)) {
      for (const m of text.matchAll(quotedRe)) if (tools.has(m[1])) add(file, m.index, text, "tool", m[1]);
    }
    if (CLI_DOC_EXT.test(file) && flags.size) {
      for (const m of text.matchAll(cliLineRe)) {
        for (const token of m[1].split(/\s+/)) {
          const flag = token.replace(/^["'`]|[=`"',].*$/g, "");
          if (flags.has(flag)) add(file, m.index, text, "cli-flag", flag);
        }
      }
    }
  }
  hits.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { hits, files: texts.size, ms: performance.now() - started };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes("--generate")) {
    const fromIndex = args.indexOf("--from");
    const from = fromIndex === -1 ? DEFAULT_FROM : args[fromIndex + 1].replace(/^.*@/, "");
    const list = writeList(generate({ from }));
    console.log(
      `${LIST_FILE}: ${list.packages.length} packages, ${list.subpaths.length} subpaths, ${list.exports.length} exports, ${list.errorCodes.length} error codes, ${list.cliFlags.length} CLI flags (from ${from})`,
    );
  } else {
    const { hits, files, ms } = sweep();
    for (const hit of hits) console.log(`${hit.file}:${hit.line}\t${hit.kind}\t${hit.name}`);
    console.log(`${hits.length} retired-name hit(s) in ${files} files (${Math.round(ms)} ms)`);
    process.exitCode = hits.length ? 1 : 0;
  }
}
