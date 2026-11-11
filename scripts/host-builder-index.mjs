// Plan 215 Task 14: generates the reference indexes that ship inside `@arnilo/prism-hosts/host-builder`.
//
//   bun scripts/host-builder-index.mjs            regenerate packages/hosts/host-builder/data
//   bun scripts/host-builder-index.mjs --check    fail if the committed data is stale (writes nothing)
//   --root <dir>   repository root (default: this checkout)
//   --out <dir>    output directory (default: <root>/packages/hosts/host-builder/data)
//
// Outputs (deterministic, sorted, no timestamps):
//   data/api.json       per live publishable package and `exports` subpath: every reachable name with kind,
//                       signature, summary, the docs that mention it and the examples that import it
//   data/errors.json    per error code: owner, declaration, class, meaning, sample message, docs
//   data/examples.json  per example in the execution gate: path, title, imports, credential needs
//   data/examples/**    the example sources, verbatim
//
// The export model is the release gate's (`scripts/release-gates.mjs`): the same declaration emit and
// `parseDeclarationFile`, so names and signatures move together with the compat baselines. This script never
// reads `scripts/compat-baseline/` (it holds baselines of retired packages) and never calls the gate.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { redactSecrets } from "../src/redaction.ts";
import { activeBundles } from "./bundles.mjs";
import { loadRelease } from "./release.mjs";
import { declarationDir, extractEntrySurface } from "./release-gates.mjs";

const SCHEMA_VERSION = 1;
const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_RELATIVE = "packages/hosts/host-builder/data";
const KERNEL = "@arnilo/prism";

/** Pages the kernel tarball ships that an agent must not read as current: 0.12 and older contracts. */
const EXCLUDED_DOCS = [/^api-page-template\.md$/, /^release-.*-evidence\.md$/, /^migrate-to-0\.(5|6|7|8|9|11)\.md$/, /^migration\.md$/];
/** Example directories that are fixtures or workspaces, not examples (Task 13 (g)). */
const EXCLUDED_EXAMPLE_DIRS = new Set(["fixtures", "example-workspace", "instruction-injection-workspace"]);
const MAX_DOCS_PER_NAME = 6;
const MAX_EXAMPLES_PER_NAME = 5;
const SAMPLE_MESSAGE_CAP = 160;
/** Member lists keep a type's shape (field names, optionality, types) so an agent need not guess `args` vs `arguments`. */
const MAX_MEMBERS_PER_TYPE = 60;
const MEMBER_CAP = 180;

// Key-shaped, not key-named: the examples hold readable demo sentinels such as `sk-live-never-persist-this`
// on purpose, which a real provider key (a long unbroken random run) never resembles.
export const SECRET_SHAPES = [
  /\bsk-[A-Za-z0-9]{32,}/,
  /\bsk-(?:ant|proj|or-v1)-[A-Za-z0-9_-]{32,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /\bBearer [A-Za-z0-9._~+/-]{24,}/,
];

export class HostBuilderIndexError extends Error {
  constructor(message) {
    super(message);
    this.name = "HostBuilderIndexError";
  }
}

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function walk(dir, accept, skipDir = () => false) {
  const out = [];
  if (!existsSync(dir)) return out;
  (function visit(current) {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => compare(a.name, b.name))) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || skipDir(full)) continue;
        visit(full);
      } else if (accept(entry.name, full)) out.push(full);
    }
  })(dir);
  return out;
}

const posix = (path) => path.split("\\").join("/");

/** JSON with the outer `compactAt` levels broken across lines and everything deeper on one line. */
function pretty(value, compactAt, level = 0) {
  if (level >= compactAt || value === null || typeof value !== "object") return JSON.stringify(value);
  const pad = "  ".repeat(level + 1);
  const end = "  ".repeat(level);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[\n${value.map((item) => pad + pretty(item, compactAt, level + 1)).join(",\n")}\n${end}]`;
  }
  const keys = Object.keys(value).filter((key) => value[key] !== undefined);
  if (keys.length === 0) return "{}";
  return `{\n${keys.map((key) => `${pad}${JSON.stringify(key)}: ${pretty(value[key], compactAt, level + 1)}`).join(",\n")}\n${end}}`;
}

function withHash(header, body, compactAt) {
  const bodyText = pretty(body, compactAt);
  const contentHash = createHash("sha256").update(bodyText).digest("hex");
  return `${pretty({ ...header, contentHash, ...body }, compactAt)}\n`;
}

// ---------------------------------------------------------------------------------------------------------
// Docs: which markdown pages mention which identifier in backticks.

function inlineIdentifiers(markdown) {
  const withoutFences = markdown.replace(/^( {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1\2[ \t]*$/gm, "");
  const found = new Set();
  for (const span of withoutFences.matchAll(/`([^`\n]+)`/g)) {
    for (const ident of span[1].matchAll(/[A-Za-z_$][\w$]*/g)) found.add(ident[0]);
  }
  return found;
}

function collectDocs(root, packages) {
  const docs = [];
  const docsDir = join(root, "docs");
  if (existsSync(docsDir)) {
    for (const entry of readdirSync(docsDir, { withFileTypes: true }).sort((a, b) => compare(a.name, b.name))) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      if (EXCLUDED_DOCS.some((pattern) => pattern.test(entry.name))) continue;
      docs.push({ owner: KERNEL, path: `node_modules/${KERNEL}/docs/${entry.name}`, file: join(docsDir, entry.name) });
    }
  }
  for (const pkg of packages) {
    const readme = join(root, pkg.path, "README.md");
    if (existsSync(readme)) docs.push({ owner: pkg.manifest.name, path: `node_modules/${pkg.manifest.name}/README.md`, file: readme });
  }
  return docs.map((doc) => {
    const text = readFileSync(doc.file, "utf8");
    return { ...doc, text, identifiers: inlineIdentifiers(text) };
  });
}

function docsMentioning(docs, name, ownerName) {
  const hits = [];
  for (const doc of docs) {
    if (!doc.identifiers.has(name)) continue;
    // Own README first, then the kernel's pages, then the other packages' READMEs.
    const rank = doc.owner === ownerName && doc.path.endsWith("README.md") ? 0 : doc.path.includes("/docs/") ? 1 : 2;
    hits.push({ rank, path: doc.path });
  }
  hits.sort((a, b) => a.rank - b.rank || compare(a.path, b.path));
  return hits.slice(0, MAX_DOCS_PER_NAME).map((hit) => hit.path);
}

// ---------------------------------------------------------------------------------------------------------
// Examples.

function scanSecrets(rootForNeedles, label, text) {
  for (const shape of SECRET_SHAPES) {
    if (shape.test(text)) throw new HostBuilderIndexError(`secret_shaped_literal: ${label} matches ${shape}`);
  }
  const needles = secretNeedles(rootForNeedles);
  if (needles.length && redactSecrets(text, needles) !== text) {
    throw new HostBuilderIndexError(`secret_shaped_literal: ${label} contains a value from the environment or live.env`);
  }
}

let needleCache;
function secretNeedles(root) {
  if (needleCache?.root === root) return needleCache.values;
  const values = new Set();
  for (const [key, value] of Object.entries(process.env)) {
    if (/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key) && typeof value === "string" && value.length >= 12) values.add(value);
  }
  const liveEnv = join(root, "scripts", "live.env");
  if (existsSync(liveEnv)) {
    for (const line of readFileSync(liveEnv, "utf8").split("\n")) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      const value = match?.[2]?.replace(/^["']|["']$/g, "");
      if (value && value.length >= 12 && /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(match[1])) values.add(value);
    }
  }
  needleCache = { root, values: [...values] };
  return needleCache.values;
}

function loadExamplesManifest(root) {
  const file = join(root, "scripts", "examples-manifest.json");
  if (!existsSync(file)) return { skips: {}, env: {} };
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  return { skips: parsed.skips ?? {}, env: parsed.env ?? {} };
}

function exampleTitle(text, path) {
  const block = text.match(/^\s*(?:#![^\n]*\n)?\s*\/\*\*([\s\S]*?)\*\//);
  if (block) {
    const line = block[1]
      .split("\n")
      .map((raw) => raw.replace(/^\s*\*\s?/, "").trim())
      .find(Boolean);
    if (line) return line.replace(/\s+/g, " ").slice(0, 200);
  }
  const lineComment = text.match(/^(?:#![^\n]*\n)?\s*\/\/\s*(.+)$/m);
  if (lineComment) return lineComment[1].trim().slice(0, 200);
  return path.replace(/^examples\//, "").replace(/\.[^.]+$/, "");
}

/** Imports as `{ specifier, names }`; a namespace or default import records `*` or `default`. */
function parseImports(text) {
  const imports = [];
  const re = /import\s+(?:type\s+)?([\s\S]*?)\s*from\s*["']([^"']+)["']/g;
  for (const match of text.matchAll(re)) {
    const clause = match[1];
    const names = [];
    const braces = clause.match(/\{([^}]*)\}/)?.[1];
    if (braces) {
      for (const part of braces.split(",")) {
        const name = part
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)[0]
          .trim();
        if (name) names.push(name);
      }
    }
    if (/\*\s+as\s+/.test(clause)) names.push("*");
    const head = clause
      .replace(/\{[^}]*\}/, "")
      .replace(/\*\s+as\s+\w+/, "")
      .replace(/,/g, "")
      .trim();
    if (head) names.push("default");
    imports.push({ specifier: match[2], names });
  }
  return imports;
}

function collectExamples(root) {
  const examplesDir = join(root, "examples");
  const manifest = loadExamplesManifest(root);
  const files = walk(
    examplesDir,
    // `tsconfig.json` stays out: the packaging guard denies a tsconfig in any tarball, and an example's
    // compiler settings are the repository's, not something an installed copy needs.
    // Markdown stays out too: an example README links into the repository's docs, and a shipped page with a
    // dangling relative link fails the docs link check.
    (name) => /\.(ts|mjs|json)$/.test(name) && name !== "tsconfig.json",
    (dir) => (dir === examplesDir ? false : EXCLUDED_EXAMPLE_DIRS.has(relative(examplesDir, dir).split("/")[0])),
  );
  const sources = [];
  const rows = [];
  const support = [];
  for (const file of files) {
    const path = posix(relative(root, file));
    const text = readFileSync(file, "utf8");
    const name = posix(relative(examplesDir, file));
    const skip = manifest.skips[name];
    // A known-broken example is not an example an agent should copy; it is left out of the data entirely.
    if (skip?.startsWith("known-broken")) continue;
    scanSecrets(root, path, text);
    sources.push({ path, text });
    if (!/^[^/]+\.ts$/.test(name)) {
      support.push(path);
      continue;
    }
    const imports = parseImports(text);
    const requiresEnv = [...new Set([...text.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)].map((m) => m[1]))].sort();
    rows.push({
      path,
      title: exampleTitle(text, path),
      gate: skip ? `skip:${skip}` : "executed",
      imports: [...new Set(imports.map((entry) => entry.specifier).filter((spec) => spec.startsWith("@arnilo/")))].sort(),
      requiresEnv,
      needsCredentials: skip === "env-gated" || requiresEnv.some((env) => /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/.test(env)),
      importedNames: imports,
    });
  }
  return { rows, support: support.sort(), sources };
}

// ---------------------------------------------------------------------------------------------------------
// API.

function exportTarget(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return exportTarget(value.default ?? value.import ?? value.types);
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------
// Members of interfaces and classes.
//
// The release gate's signature stops at the opening brace, which is right for compat baselines and useless for a
// builder: `export interface ToolCallHookPayload` does not say the field is `args`. The members come from the same
// emitted declarations, comments stripped, one string per member.

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** The text between the braces that start at `open`, or undefined when they never balance. */
function braceBody(text, open) {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, index);
    }
  }
  return undefined;
}

/** Splits a body at top-level `;` (and a top-level newline after `}`), ignoring `;` inside (), [], {}, <>. */
function splitMembers(body) {
  const members = [];
  let depth = 0;
  let angle = 0;
  let current = "";
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === "{" || char === "(" || char === "[") depth += 1;
    else if (char === "}" || char === ")" || char === "]") depth -= 1;
    else if (char === "<") angle += 1;
    else if (char === ">" && body[index - 1] !== "=") angle = Math.max(0, angle - 1);
    if (char === ";" && depth === 0 && angle === 0) {
      members.push(current);
      current = "";
    } else current += char;
  }
  members.push(current);
  return members;
}

function memberLines(body) {
  const lines = [];
  for (const raw of splitMembers(body)) {
    const member = raw.replace(/\s+/g, " ").trim();
    if (member === "" || /^(?:private|protected)\b/.test(member) || member.startsWith("#")) continue;
    lines.push(member.length > MEMBER_CAP ? `${member.slice(0, MEMBER_CAP)} …` : member);
  }
  return lines;
}

/** name -> member lines, for every exported interface and class declared in the package's emitted declarations. */
function collectMembers(distDir) {
  const found = new Map();
  for (const file of walk(distDir, (name) => name.endsWith(".d.ts"))) {
    const text = stripComments(readFileSync(file, "utf8"));
    for (const match of text.matchAll(/^export (?:declare )?(?:abstract )?(?:interface|class) ([A-Za-z_$][\w$]*)\b[^{;]*\{/gm)) {
      const name = match[1];
      if (found.has(name)) continue;
      const body = braceBody(text, match.index + match[0].length - 1);
      if (body === undefined) continue;
      const lines = memberLines(body);
      if (lines.length > 0) found.set(name, lines);
    }
  }
  return found;
}

function buildApi(root, packages, docs, examples) {
  // specifier -> name -> examples that import it
  const importers = new Map();
  for (const example of examples.rows) {
    for (const { specifier, names } of example.importedNames) {
      if (!specifier.startsWith("@arnilo/")) continue;
      const byName = importers.get(specifier) ?? new Map();
      for (const name of names) {
        const list = byName.get(name) ?? [];
        list.push(example.path);
        byName.set(name, list);
      }
      importers.set(specifier, byName);
    }
  }
  const out = [];
  for (const pkg of packages) {
    const emitted = declarationDir(root, pkg);
    try {
      if (emitted.error) throw new HostBuilderIndexError(emitted.error);
      if (!emitted.distDir) continue;
      const entries = [];
      const memberIndex = collectMembers(emitted.distDir);
      for (const [subpath, value] of Object.entries(pkg.manifest.exports ?? {})) {
        const target = exportTarget(value);
        if (!target?.endsWith(".ts")) continue;
        const declaration = join(emitted.distDir, target.replace(/\.ts$/, ".d.ts"));
        if (!existsSync(declaration))
          throw new HostBuilderIndexError(`api: ${pkg.manifest.name} ${subpath} has no declaration at ${relative(root, declaration)}`);
        const specifier = subpath === "." ? pkg.manifest.name : `${pkg.manifest.name}${subpath.slice(1)}`;
        const byName = importers.get(specifier);
        const exports = [];
        for (const [name, info] of extractEntrySurface(declaration)) {
          const importedBy = [...new Set([...(byName?.get(name) ?? [])])].sort().slice(0, MAX_EXAMPLES_PER_NAME);
          const mentions = docsMentioning(docs, name, pkg.manifest.name);
          const members = info.kind === "interface" || info.kind === "class" ? memberIndex.get(name) : undefined;
          exports.push({
            name,
            kind: info.kind,
            signature: info.signature,
            ...(members ? { members: members.slice(0, MAX_MEMBERS_PER_TYPE) } : {}),
            ...(info.summary ? { summary: info.summary } : {}),
            ...(mentions.length ? { docs: mentions } : {}),
            ...(importedBy.length ? { examples: importedBy } : {}),
          });
        }
        entries.push({ subpath, specifier, exports });
      }
      out.push({
        name: pkg.manifest.name,
        version: pkg.manifest.version,
        path: pkg.path,
        experimental: Boolean(pkg.experimental),
        entries,
      });
    } finally {
      emitted.cleanup?.();
    }
  }
  return out.sort((a, b) => compare(a.name, b.name));
}

// ---------------------------------------------------------------------------------------------------------
// Errors.

function cleanComment(raw) {
  const text = raw
    .replace(/^\s*\/\*\*?/, "")
    .replace(/\*\/\s*$/, "")
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*\*\s?/, "")
        .replace(/^\s*\/\/\s?/, "")
        .trim(),
    )
    .filter(Boolean)
    .join(" ")
    .replace(/\{@(?:link|linkcode|linkplain)\s+([^}|\s]+)[^}]*\}/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return text || undefined;
}

/** `type FooErrorCode = | "a" | "b"` blocks: member, line (1-based), and the comment attached to it. */
function unionMembers(text) {
  const lines = text.split("\n");
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i].match(/^\s*(?:export\s+)?type\s+([A-Za-z0-9_$]*Code[A-Za-z0-9_$]*)\s*=\s*(.*)$/);
    if (!header) continue;
    const typeName = header[1];
    let pending = [];
    let inBlockComment = false;
    let cursor = i;
    let rest = header[2];
    for (;;) {
      const trimmed = rest.trim();
      if (inBlockComment) {
        pending.push(rest);
        if (trimmed.includes("*/")) inBlockComment = false;
      } else if (trimmed.startsWith("/*")) {
        pending = [rest];
        if (!trimmed.includes("*/")) inBlockComment = true;
      } else if (trimmed.startsWith("//")) {
        pending.push(rest);
      } else if (trimmed) {
        const trailing = trimmed.match(/\/\/\s*(.+)$/)?.[1];
        const literals = [...trimmed.replace(/\/\/.*$/, "").matchAll(/["']([A-Za-z0-9_]+)["']/g)].map((m) => m[1]);
        for (const member of literals) {
          result.push({
            typeName,
            member,
            line: cursor + 1,
            meaning: cleanComment(pending.join("\n")) ?? (trailing ? cleanComment(trailing) : undefined),
          });
        }
        if (literals.length) pending = [];
        if (trimmed.endsWith(";")) break;
        if (!literals.length && !/^\|?\s*[A-Za-z_$][\w$.]*\s*\|?$/.test(trimmed.replace(/\/\/.*$/, "").trim())) break;
      }
      cursor += 1;
      if (cursor >= lines.length || cursor - i > 400) break;
      rest = lines[cursor];
      if (
        !inBlockComment &&
        !rest.trim().startsWith("|") &&
        !rest.trim().startsWith("/") &&
        !rest.trim().startsWith("*") &&
        !rest.trim().startsWith('"') &&
        !rest.trim().startsWith("'") &&
        rest.trim() !== ""
      )
        break;
    }
  }
  return result;
}

function ownerOf(root, packages, file) {
  const rel = posix(relative(root, file));
  for (const pkg of packages) {
    if (pkg.path !== "." && rel.startsWith(`${pkg.path}/`)) return pkg.manifest.name;
  }
  return KERNEL;
}

function sourceFiles(root, packages) {
  const dirs = [join(root, "src")];
  const bundles = activeBundles(root);
  for (const pkg of packages) {
    if (pkg.path === ".") continue;
    const bundle = bundles.find((bundle) => bundle.dir === pkg.path);
    const folders = bundle ? [...new Set(bundle.subpaths.map((row) => row.dir))] : ["."];
    for (const folder of folders) dirs.push(join(root, pkg.path, folder, "src"));
  }
  const files = [];
  for (const dir of dirs) {
    files.push(
      ...walk(
        dir,
        (name) => /\.(ts|mts)$/.test(name) && !name.endsWith(".d.ts") && !/\.test\./.test(name),
        (path) => path.split("/").includes("__tests__"),
      ),
    );
  }
  return files;
}

const QUOTED = String.raw`("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\x60(?:[^\x60\\]|\\.)*\x60)`;

/** The message literal next to a code, when the code is passed straight to an error constructor. */
function literalAfter(window, code, ref = String.raw`["'\x60]${code}["'\x60]`) {
  const throwSite = new RegExp(String.raw`(?:new\s+([A-Za-z0-9_$.]+)|(super))\s*\(\s*${ref}\s*,\s*` + QUOTED);
  const direct = window.match(throwSite);
  if (direct) return { errorClass: direct[1], message: direct[3].slice(1, -1) };
  const errorClass = window.match(/new\s+([A-Za-z0-9_$.]+)\s*\(/)?.[1];
  const property = window.match(new RegExp(String.raw`message:\s*` + QUOTED));
  if (property) return { errorClass, message: property[1].slice(1, -1) };
  for (const literal of window.matchAll(new RegExp(QUOTED, "g"))) {
    const inner = literal[1].slice(1, -1);
    if (inner !== code && !inner.startsWith("ERR_PRISM_") && inner.length >= 12 && /\s/.test(inner)) return { errorClass, message: inner };
  }
  return { errorClass, message: undefined };
}

/** The class a line sits in, and that class's doc comment, found by walking up to the nearest `class X`. */
function enclosingClass(lines, index) {
  for (let i = index; i >= 0 && index - i < 120; i--) {
    const match = lines[i].match(/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/);
    if (match) return { name: match[1], doc: cleanComment(precedingComment(lines, i) ?? "") };
  }
  return undefined;
}

function sampleOf(message) {
  if (!message) return undefined;
  const flat = message
    .replace(/\\n/g, " ")
    .replace(/\\(["'`])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!flat) return undefined;
  return flat.length > SAMPLE_MESSAGE_CAP ? `${flat.slice(0, SAMPLE_MESSAGE_CAP - 3)}...` : flat;
}

function buildErrors(root, packages, docs) {
  const codes = new Map(); // code -> record
  const files = sourceFiles(root, packages);
  const record = (code, namespace) => {
    let entry = codes.get(code);
    if (!entry) {
      entry = { code, namespace, declared: undefined, first: undefined, aliases: [], classDoc: undefined };
      codes.set(code, entry);
    }
    return entry;
  };
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const rel = posix(relative(root, file));
    const owner = ownerOf(root, packages, file);
    const lines = text.split("\n");
    for (const member of unionMembers(text)) {
      const isErr = member.member.startsWith("ERR_PRISM_");
      if (!isErr && !/ErrorCode/.test(member.typeName)) continue;
      const entry = record(member.member, isErr ? "ERR_PRISM" : "short");
      entry.declared ??= { package: owner, file: rel, line: member.line, type: member.typeName, meaning: member.meaning };
    }
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const hit of line.matchAll(/["'`](ERR_PRISM_[A-Z0-9_]+)["'`]/g)) {
        const code = hit[1];
        const entry = record(code, "ERR_PRISM");
        const constant = line.match(/(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*=\s*["'`]ERR_PRISM_/);
        if (constant && !entry.declared) {
          entry.declared = {
            package: owner,
            file: rel,
            line: i + 1,
            type: `const ${constant[1]}`,
            meaning: cleanComment(precedingComment(lines, i) ?? ""),
          };
        }
        const window = lines.slice(Math.max(0, i - 1), i + 4).join(" ");
        const found = literalAfter(window, code);
        const inClass = /readonly\s+code\s*=|\bsuper\s*\(/.test(window) ? enclosingClass(lines, i) : undefined;
        if (!entry.first) {
          entry.first = {
            package: owner,
            file: rel,
            line: i + 1,
            errorClass: found.errorClass ?? inClass?.name,
            sampleMessage: sampleOf(found.message),
          };
        } else if (!entry.first.sampleMessage && found.message) {
          entry.first.sampleMessage = sampleOf(found.message);
          entry.first.errorClass ??= found.errorClass;
        }
        entry.first.errorClass ??= found.errorClass ?? inClass?.name;
        if (inClass?.doc) entry.classDoc ??= inClass.doc;
        // A code held in a constant or a map entry reaches its throw site by name; remember the name.
        const mapEntry = line.match(/^\s*([A-Za-z0-9_$]+)\s*:\s*["'`]ERR_PRISM_/);
        if (constant) entry.aliases.push({ owner, ref: String.raw`\b${constant[1]}\b` });
        else if (mapEntry) {
          for (let up = i - 1; up >= 0 && i - up < 40; up--) {
            const holder = lines[up].match(/(?:const|let)\s+([A-Za-z0-9_$]+)\s*(?::[^=]+)?=\s*\{/);
            if (holder) {
              entry.aliases.push({ owner, ref: String.raw`\b${holder[1]}\.${mapEntry[1]}\b` });
              break;
            }
          }
        }
      }
      const skill = line.match(/export const (SKILL_UNAVAILABLE_ERROR_CODE)\s*=\s*["']([a-z_]+)["']/);
      if (skill) {
        const entry = record(skill[2], "short");
        entry.declared ??= {
          package: owner,
          file: rel,
          line: i + 1,
          type: `const ${skill[1]}`,
          meaning: cleanComment(precedingComment(lines, i) ?? ""),
        };
      }
    }
  }
  // Second pass: throw sites that pass the code by its constant or map name.
  const byOwner = new Map();
  for (const file of files) {
    const owner = ownerOf(root, packages, file);
    const list = byOwner.get(owner) ?? [];
    list.push(readFileSync(file, "utf8").split("\n"));
    byOwner.set(owner, list);
  }
  for (const entry of codes.values()) {
    if (!entry.aliases.length || entry.first?.sampleMessage) continue;
    search: for (const { owner, ref } of entry.aliases) {
      for (const lines of byOwner.get(owner) ?? []) {
        for (let i = 0; i < lines.length; i++) {
          if (!new RegExp(ref).test(lines[i])) continue;
          const found = literalAfter(lines.slice(i, i + 4).join(" "), entry.code, ref);
          if (!found.message) continue;
          entry.first ??= { package: owner, file: "", line: 0 };
          entry.first.sampleMessage = sampleOf(found.message);
          entry.first.errorClass ??= found.errorClass;
          break search;
        }
      }
    }
  }
  const rows = [];
  for (const entry of [...codes.values()].sort((a, b) => compare(a.code, b.code))) {
    const where = entry.declared ?? entry.first;
    if (!where) continue;
    const mentions = docs
      .filter((doc) => (entry.namespace === "ERR_PRISM" ? doc.text.includes(entry.code) : doc.identifiers.has(entry.code)))
      .map((doc) => doc.path)
      .sort()
      .slice(0, MAX_DOCS_PER_NAME);
    rows.push({
      code: entry.code,
      namespace: entry.namespace,
      package: where.package,
      file: where.file,
      line: where.line,
      ...(entry.declared?.type ? { type: entry.declared.type } : {}),
      errorClass: entry.first?.errorClass ?? null,
      meaning: entry.declared?.meaning ?? entry.classDoc ?? null,
      sampleMessage: entry.first?.sampleMessage ?? null,
      docs: mentions,
    });
  }
  return rows;
}

function precedingComment(lines, index) {
  let i = index - 1;
  const collected = [];
  while (i >= 0 && /^\s*(\/\*\*|\*|\/\/)/.test(lines[i])) {
    collected.unshift(lines[i]);
    if (/^\s*\/\*\*/.test(lines[i])) break;
    i -= 1;
  }
  if (i >= 0 && /\*\/\s*$/.test(lines[i]) && !collected.length) {
    // single-line `/** text */`
    return lines[i];
  }
  return collected.length ? collected.join("\n") : undefined;
}

// ---------------------------------------------------------------------------------------------------------

/**
 * Builds every output file as `Map<path relative to out, text>` without writing anything.
 * `root` may be a fixture repository (the freshness tests build one).
 */
export function buildIndexes({ root = DEFAULT_ROOT } = {}) {
  needleCache = undefined;
  const release = loadRelease(root);
  const packages = release.packages.filter((pkg) => !pkg.manifest.private);
  const kernel = packages.find((pkg) => pkg.path === ".");
  if (!kernel) throw new HostBuilderIndexError("kernel package not found at the repository root");
  const prismVersion = kernel.manifest.version;
  const header = { schemaVersion: SCHEMA_VERSION, prismVersion };

  const docs = collectDocs(root, packages);
  const examples = collectExamples(root);
  const api = buildApi(root, packages, docs, examples);
  const errors = buildErrors(root, packages, docs);

  const files = new Map();
  files.set("api.json", withHash(header, { packages: api }, 6));
  files.set("errors.json", withHash(header, { codes: errors }, 2));
  files.set(
    "examples.json",
    withHash(
      header,
      {
        examples: examples.rows.map(({ importedNames: _ignored, ...row }) => row),
        support: examples.support,
      },
      2,
    ),
  );
  // The sources land at data/examples/<path relative to examples/>, so `examples/x.ts` is `data/examples/x.ts`.
  for (const source of examples.sources) files.set(source.path, source.text);
  const undocumented = errors.filter((row) => row.meaning === null && row.sampleMessage === null).length;
  return {
    files,
    report: {
      prismVersion,
      packages: api.length,
      errors: errors.length,
      errorsWithoutMeaningOrSample: undocumented,
      examples: examples.rows.length,
    },
  };
}

function listExisting(out) {
  return walk(out, () => true).map((file) => posix(relative(out, file)));
}

export function writeIndexes({ root = DEFAULT_ROOT, out = join(root, OUT_RELATIVE) } = {}) {
  const { files, report } = buildIndexes({ root });
  rmSync(out, { recursive: true, force: true });
  for (const [path, text] of files) {
    const target = join(out, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
  return { ...report, files: files.size };
}

/** Stale paths: content differs, missing, or an unexpected extra file under `out`. */
export function checkIndexes({ root = DEFAULT_ROOT, out = join(root, OUT_RELATIVE) } = {}) {
  const { files, report } = buildIndexes({ root });
  const expected = files;
  const stale = [];
  for (const [path, text] of expected) {
    const target = join(out, path);
    if (!existsSync(target)) stale.push(`missing ${path}`);
    else if (readFileSync(target, "utf8") !== text) stale.push(`differs ${path}`);
  }
  if (existsSync(out)) for (const path of listExisting(out)) if (!expected.has(path)) stale.push(`extra ${path}`);
  return { stale, report };
}

function parseArgs(argv) {
  const options = { check: false, root: DEFAULT_ROOT, out: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--check") options.check = true;
    else if (arg === "--root") options.root = resolve(argv[++i] ?? "");
    else if (arg === "--out") options.out = resolve(argv[++i] ?? "");
    else throw new HostBuilderIndexError(`unknown argument ${arg}`);
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const out = options.out ?? join(options.root, OUT_RELATIVE);
    if (options.check) {
      const { stale, report } = checkIndexes({ root: options.root, out });
      if (stale.length) {
        console.error(
          `host-builder-index: ${stale.length} stale file(s); run bun scripts/host-builder-index.mjs\n${stale.slice(0, 20).join("\n")}`,
        );
        process.exitCode = 1;
      } else {
        console.log(`host-builder-index: fresh (${JSON.stringify(report)})`);
      }
    } else {
      console.log(`host-builder-index: wrote ${JSON.stringify(writeIndexes({ root: options.root, out }))}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
