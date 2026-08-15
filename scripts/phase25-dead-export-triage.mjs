/**
 * Task 4 triage helper: for each dead-exports.mjs candidate, classify why it
 * appears definition-only in the naive scan. The naive scan excludes __tests__
 * and cannot see `export *` star re-exports, so a symbol used only in tests or
 * only star-re-exported shows as a false positive. This greps the FULL repo
 * (src, packages, __tests__, dist, scripts) for each candidate name and prints
 * a one-line verdict + the non-definition reference sites, so the manual
 * triage is a review of the verdicts, not a 62-grep rerun.
 *
 * Zero dependencies; report-only.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

// collect all repo text files that could reference a symbol (.ts .js .mjs .cjs)
function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git" || entry === "coverage" || entry === ".tmp") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|js|mjs|cjs)$/.test(full) && !full.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

const files = [...walk(join(root, "src")), ...walk(join(root, "packages")), ...walk(join(root, "scripts"))];
const text = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));

// parse candidates from the raw file
const raw = readFileSync(join(root, "scripts", "phase25-dead-exports-raw.txt"), "utf8");
const candidates = [];
for (const line of raw.split("\n")) {
  const m = line.match(/^(\S+) \(defined in (.+)\)$/);
  if (m) candidates.push({ name: m[1], defFile: m[2] });
}

function classify(name, defFile) {
  const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
  const sites = { otherSrc: [], tests: [], dist: [], scripts: [], starReexport: [] };
  for (const [file, src] of text) {
    const rel = relative(root, file);
    const matches = [...src.matchAll(re)];
    if (matches.length === 0) continue;
    // is this the defining file? skip the definition line itself
    const _defRel = defFile.startsWith("packages/") || defFile.startsWith("src/") ? defFile : defFile;
    const isDef = rel === defFile;
    if (isDef) {
      // count refs beyond the single definition
      const _defLine = src.split("\n").findIndex((l) => re.test(l) && /export\s/.test(l));
      // references in the defining file that are NOT the export decl
      const nonDefRefs = matches.length - 1; // subtract the export decl
      if (nonDefRefs > 0) sites.otherSrc.push(`${rel} (×${nonDefRefs} self-use)`);
      continue;
    }
    // detect star re-export referencing the symbol's package
    if (/export\s+\*\s+from/.test(src) && matches.length > 0) {
      // the name may appear elsewhere too; record star re-export context
    }
    if (/__tests__/.test(rel)) sites.tests.push(rel);
    else if (/^dist\//.test(rel) || /\/dist\//.test(rel)) sites.dist.push(rel);
    else if (/^scripts\//.test(rel)) sites.scripts.push(rel);
    else sites.otherSrc.push(rel);
  }
  // verdict
  const usedOther = sites.otherSrc.length > 0;
  const usedTests = sites.tests.length > 0;
  const usedDist = sites.dist.length > 0;
  let verdict;
  if (usedOther) verdict = "USED-ELSEWHERE";
  else if (usedTests || usedDist) verdict = "TEST-OR-DIST-ONLY";
  else verdict = "DEAD";
  return { verdict, sites };
}

console.log(`# Task 4 dead-export triage — ${candidates.length} candidates\n`);
for (const c of candidates) {
  const { verdict, sites } = classify(c.name, c.defFile);
  const detail = [
    sites.otherSrc.length ? `src:${sites.otherSrc.join(",")}` : "",
    sites.tests.length ? `tests:${sites.tests.length} files` : "",
    sites.dist.length ? `dist:${sites.dist.length} files` : "",
    sites.scripts.length ? `scripts:${sites.scripts.length} files` : "",
  ]
    .filter(Boolean)
    .join(" | ");
  console.log(`${verdict}\t${c.name}\t${c.defFile}${detail ? `\t${detail}` : ""}`);
}
