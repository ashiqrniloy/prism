/**
 * Zero-dependency dead-export candidate scan (plan 015 Task 3).
 * Parses `export`ed symbol names from core src and workspace package src
 * TypeScript sources, counts word-boundary references across all repo *.ts
 * sources, and reports
 * symbols with <=1 reference (definition-only) as dead-export candidates.
 * Report-only: public-but-unused exports are removed in the 0.1.5 breaking
 * cut, never here.
 *
 * # ponytail: naive regex scan — false positives on re-exports, dynamic
 * imports, and string-built references; upgrade to knip if the report noise
 * exceeds triage value.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
// optional CLI arg: scan a different root (used by sweep-unused.test.mjs fixtures)
const scanRoot = process.argv[2] ? resolve(process.argv[2]) : root;

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // missing dir (e.g. fixture without packages/)
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts") && !full.includes("__tests__") && !full.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

const sources = [...walk(join(scanRoot, "src")), ...walk(join(scanRoot, "packages"))];
const text = new Map(sources.map((f) => [f, readFileSync(f, "utf8")]));
const exportedSources = new Map(sources.map((f) => [f, readFileSync(f, "utf8")]));

// Usage-evidence corpus (plan 058 task 1/task 3): tests, examples, scripts, and
// templates also prove a symbol is alive. The old __tests__ exclusion made
// test-only exports read as dead — the dominant false-positive class. Exported
// names are still parsed from non-test sources only.
function walkEvidence(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkEvidence(full, out);
    else if (/.\.(ts|mts|cts|mjs)$/.test(full) && !full.endsWith(".d.ts")) out.push(full);
  }
  return out;
}
for (const dir of ["src", "packages", "examples", "scripts", "templates"]) {
  for (const f of walkEvidence(join(scanRoot, dir))) {
    if (!text.has(f)) text.set(f, readFileSync(f, "utf8"));
  }
}

// exported symbol names: `export function foo`, `export const foo`, `export class Foo`,
// `export interface Foo`, `export type Foo`, `export { foo }`, `export { foo as bar }`
const exported = new Map(); // name -> defining file
for (const [file, src] of exportedSources) {
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class|interface|type)\s+([A-Za-z_$][\w$]*)/g)) {
    if (!exported.has(m[1])) exported.set(m[1], file);
  }
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const name of m[1].split(",")) {
      const sym = name
        .trim()
        .split(/\s+as\s+/)[0]
        .trim();
      if (/^[A-Za-z_$][\w$]*$/.test(sym) && !exported.has(sym)) exported.set(sym, file);
    }
  }
}

const candidates = [];
for (const [name, defFile] of exported) {
  let refs = 0;
  for (const src of text.values()) {
    for (const _m of src.matchAll(new RegExp(`\\b${name}\\b`, "g"))) {
      refs += 1;
      if (refs > 1) break;
    }
    if (refs > 1) break;
  }
  if (refs <= 1) candidates.push({ name, defFile: relative(root, defFile) });
}

candidates.sort((a, b) => a.defFile.localeCompare(b.defFile) || a.name.localeCompare(b.name));
// Plan 058 task 1: the committed evidence doc is the classification authority.
// Zero-ref exports classified `keep` (security guards, canonical defaults) are
// suppressed from the candidate list so deadExports reflects actionable surface.
const keep = new Set();
const evidenceDir = join(root, "docs", "_evidence");
try {
  const evidenceFile = readdirSync(evidenceDir).find((f) => f.startsWith("dead-export-verification-") && f.endsWith(".md"));
  if (evidenceFile) {
    for (const line of readFileSync(join(evidenceDir, evidenceFile), "utf8").split("\n")) {
      if (!line.startsWith("|")) continue;
      const cells = line.split("|").map((c) => c.trim());
      if (cells.length > 7 && cells[7] === "keep") keep.add(cells[1].replace(/`/g, ""));
    }
  }
} catch {}
const suppressed = candidates.filter((c) => keep.has(c.name));
const actionable = candidates.filter((c) => !keep.has(c.name));
const lines = actionable.map((c) => `${c.name} (defined in ${c.defFile})`);
const footer = suppressed.length
  ? `\n${suppressed.length} zero-ref export${suppressed.length === 1 ? "" : "s"} suppressed (keep-classified security/canonical surface — see the evidence doc): ${suppressed.map((c) => c.name).join(", ")}\n`
  : "";
process.stdout.write(
  `${lines.length} dead-export candidate${lines.length === 1 ? "" : "s"} (definition-only reference count):\n${lines.join("\n")}\n${footer}`,
);
