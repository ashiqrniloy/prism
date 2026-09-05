/**
 * Dead-export verification (plan 058 Task 1).
 * Cross-checks every candidate in scripts/unused-report.json deadExports against
 * (a) repo usage (all .ts/.mts/.cts incl. tests, examples, scripts),
 * (b) scripts/compat-baseline/<pkg>.txt,
 * (c) docs / code examples / templates,
 * (d) external heuristics are recorded manually in the evidence doc (npm
 *     download counts + GitHub code search; not fetchable reliably in-script).
 * Emits a markdown evidence table; `--check` validates the committed evidence
 * doc: every candidate classified, and no `remove` verdict on an export that is
 * present in the compat baseline (zero false removes).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = join(root, "scripts", "unused-report.json");
if (!existsSync(reportPath)) {
  // unused-report.json is gitignored; generate it on demand so CI (where the
  // alphabetical file order runs this verifier before sweep-unused.test.mjs)
  // has the same artifact a developer machine has.
  const { spawnSync } = await import("node:child_process");
  const gen = spawnSync(process.execPath, [join(root, "scripts", "sweep-unused.mjs"), "--json"], { encoding: "utf8" });
  if (gen.status !== 0) throw new Error(`sweep-unused --json failed: ${gen.stderr}`);
}
const report = JSON.parse(readFileSync(reportPath, "utf8"));

const candidates = [...report.deadExports.matchAll(/^(?<name>[A-Za-z_$][\w$]*) \(defined in (?<file>[^)]+)\)$/gm)].map((m) => ({
  name: m.groups.name,
  file: m.groups.file,
}));
// Post-cut state (plan 058 task 3): deadExports can legitimately reach 0; all
// modes then pass vacuously (evidence doc retained as the historical record).

// --- corpus: every repo source/doc file the evidence looks at -----------------
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  "release-artifacts",
  "security-artifacts",
  "graft",
  "plans",
  "coverage",
  ".agents",
]);
function walk(dir, exts, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) walk(full, exts, out);
    } else if (exts.some((e) => full.endsWith(e))) out.push(full);
  }
  return out;
}
const codeFiles = [
  ...walk(join(root, "src"), [".ts", ".mts", ".cts"]),
  ...walk(join(root, "packages"), [".ts", ".mts", ".cts"]),
  ...walk(join(root, "examples"), [".ts", ".mts", ".cts"]),
  ...walk(join(root, "scripts"), [".ts", ".mjs"]),
  ...walk(join(root, "templates"), [".ts", ".mts", ".cts"]),
];
const codeText = new Map(codeFiles.map((f) => [f, readFileSync(f, "utf8")]));
const docFiles = [
  ...walk(join(root, "docs"), [".md"]),
  join(root, "README.md"),
  join(root, "CHANGELOG.md"),
  join(root, "prism-documents.md"),
].filter((f) => existsSync(f));
const docText = docFiles.map((f) => [relative(root, f), readFileSync(f, "utf8")]);

// --- package name per candidate + compat baseline -----------------------------
const pkgName = new Map();
for (const p of readdirSync(join(root, "packages"))) {
  const j = join(root, "packages", p, "package.json");
  if (existsSync(j)) pkgName.set(join("packages", p), JSON.parse(readFileSync(j, "utf8")).name);
}
pkgName.set("src", "@arnilo/prism");
const pkgOf = (file) => {
  if (file.startsWith("packages/")) return pkgName.get(file.split("/").slice(0, 2).join("/"));
  return pkgName.get(file.split("/")[0]);
};
const baselineCache = new Map();
function baselineHits(pkg, name) {
  if (!baselineCache.has(pkg)) {
    const f = join(root, "scripts", "compat-baseline", `${pkg.replace("@arnilo/", "arnilo__").replace(/\//g, "__")}.txt`);
    const rows = new Set();
    if (existsSync(f)) {
      for (const line of readFileSync(f, "utf8").split("\n")) {
        const i = line.indexOf("\t");
        if (i > 0) rows.add(line.slice(0, i));
      }
    }
    baselineCache.set(pkg, rows);
  }
  return baselineCache.get(pkg).has(name);
}

// --- entry points per package (package.json exports -> src paths) -------------
const entryPoints = new Map(); // pkg -> entry src files
for (const dir of [...pkgName.keys()]) {
  const pkgRoot = dir === "src" ? root : join(root, dir);
  const manifest = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));
  const distToSrc = (p) => p.replace(/^\.?\/?dist\//, "src/").replace(/\.js$/, ".ts");
  const entries = new Set();
  const exportsField = manifest.exports || { ".": manifest.main };
  for (const value of typeof exportsField === "string" ? [exportsField] : Object.values(exportsField)) {
    const target = typeof value === "string" ? value : value?.default || value?.types;
    if (target?.includes("dist/")) {
      const src = join(pkgRoot, distToSrc(target));
      if (existsSync(src)) entries.add(src);
    }
  }
  entryPoints.set(pkgName.get(dir), [...entries]);
}

// --- public reachability: is the SYMBOL re-exported to a package entry point? -
// BFS from entry files over relative re-export edges, carrying the symbol name:
// `export * from` passes any symbol through; `export { a as b } from` passes it
// only when the name (or an alias of it) appears in the braces.
function publiclyReachable(entryFiles, symbol, defFile) {
  const seen = new Set();
  const queue = [...entryFiles];
  const bare = new RegExp(`(?:^|[,{\\s])${symbol}(?:\\s+as\\s+[\\w$]+)?(?=[,}\\s])`);
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (file === defFile) return true;
    const src = codeText.get(file);
    if (!src) continue;
    for (const m of src.matchAll(/export\s+(?:type\s+)?(\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*["'](\.[^"']+)["']/g)) {
      const clause = m[1];
      if (!clause.startsWith("*") && !bare.test(clause)) continue;
      const target = resolve(dirname(file), m[2]).replace(/\.js$/, ".ts");
      if (codeText.has(target)) queue.push(target);
    }
  }
  return false;
}

// --- per-candidate evidence ---------------------------------------------------
const rows = candidates.map((c) => {
  const defPath = join(root, c.file);
  const word = new RegExp(`\\b${c.name}\\b`);
  const repoUses = [];
  for (const [file, src] of codeText) {
    if (file === defPath) continue;
    if (word.test(src)) repoUses.push(relative(root, file));
  }
  const pkg = pkgOf(c.file);
  const compat = baselineHits(pkg, c.name);
  const docs = docText.filter(([, src]) => word.test(src)).map(([f]) => f);
  const barrel = publiclyReachable(entryPoints.get(pkg) || [], c.name, defPath);
  return { name: c.name, pkg, file: c.file, repoUses, compat, docs, barrel };
});

// --- output -------------------------------------------------------------------
function parseVerdicts(text) {
  const verdicts = new Map();
  for (const line of text.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 9 || cells[1] === "export" || cells[1].startsWith("-")) continue;
    if (/^(keep|deprecate|remove)$/.test(cells[7])) verdicts.set(cells[1].replace(/`/g, ""), cells[7]);
  }
  return verdicts;
}

if (process.argv.includes("--check")) {
  // validates docs/_evidence/dead-export-verification-*.md against candidates
  const dir = join(root, "docs", "_evidence");
  const docFile = readdirSync(dir).find((f) => f.startsWith("dead-export-verification-") && f.endsWith(".md"));
  if (!docFile) {
    console.error("no docs/_evidence/dead-export-verification-*.md found");
    process.exit(1);
  }
  const text = readFileSync(join(dir, docFile), "utf8");
  const verdicts = parseVerdicts(text);
  const missing = candidates.filter((c) => !verdicts.has(c.name));
  if (missing.length) {
    console.error(`FAIL: ${missing.length} candidates unclassified: ${missing.map((c) => c.name).join(", ")}`);
    process.exit(1);
  }
  const falseRemoves = candidates.filter((c) => verdicts.get(c.name) === "remove" && baselineHits(pkgOf(c.file), c.name));
  if (falseRemoves.length) {
    console.error(`FAIL: remove verdict on compat-baseline exports (false removes): ${falseRemoves.map((c) => c.name).join(", ")}`);
    process.exit(1);
  }
  console.log(`OK: ${candidates.length} candidates classified, 0 remove verdicts on compat-baseline exports (${docFile})`);
  process.exit(0);
}

if (process.argv.includes("--deprecations")) {
  // plan 058 task 2 gate: every deprecate/remove-classified export carries a
  // type-level @deprecated JSDoc at its definition and a CHANGELOG entry in the
  // Deprecated section (string-presence check, per the plan's docs test).
  const dir = join(root, "docs", "_evidence");
  const docFile = readdirSync(dir).find((f) => f.startsWith("dead-export-verification-") && f.endsWith(".md"));
  const verdicts = parseVerdicts(readFileSync(join(dir, docFile), "utf8"));
  const targets = candidates.filter((c) => verdicts.get(c.name) === "deprecate" || verdicts.get(c.name) === "remove");
  const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  const section = changelog.split(/^### Deprecated$/m)[1]?.split(/^### /m)[0] || "";
  const declRe = (n) => new RegExp(`^export (declare )?(async )?(const|function|class|type|interface) ${n}\\b`);
  const failures = [];
  for (const c of targets) {
    const lines = readFileSync(join(root, c.file), "utf8").split("\n");
    const i = lines.findIndex((l) => declRe(c.name).test(l));
    if (
      i < 0 ||
      !lines
        .slice(Math.max(0, i - 4), i)
        .join("\n")
        .includes("@deprecated")
    )
      failures.push(`${c.name}: no @deprecated JSDoc at ${c.file}`);
    if (!new RegExp(`\\b${c.name}\\b`).test(section)) failures.push(`${c.name}: missing from CHANGELOG Deprecated section`);
  }
  if (failures.length) {
    console.error(`FAIL: ${failures.length}/${targets.length} deprecation annotations incomplete:\n${failures.join("\n")}`);
    process.exit(1);
  }
  console.log(`OK: ${targets.length} deprecate/remove exports carry @deprecated JSDoc + CHANGELOG Deprecated entries`);
  process.exit(0);
}

const fmt = (list, cap = 4) =>
  list.length ? list.slice(0, cap).join(", ") + (list.length > cap ? ` (+${list.length - cap} more)` : "") : "—";
for (const r of rows) {
  console.log(
    `| \`${r.name}\` | ${r.pkg} | ${r.repoUses.length ? `yes (${r.repoUses.length})` : "no"} | ${r.compat ? "yes" : "no"} | ${r.docs.length ? "yes" : "no"} | ${r.barrel ? "entry" : "dist-only"} | ${r.repoUses.length ? fmt(r.repoUses) : ""} |`,
  );
}
console.error(
  `# ${rows.length} rows; entry-reachable: ${rows.filter((r) => r.barrel).length}; compat hits: ${rows.filter((r) => r.compat).length}; docs hits: ${rows.filter((r) => r.docs.length).length}; repo-use hits: ${rows.filter((r) => r.repoUses.length).length}`,
);
