// Shape freeze for the compat gate (plan 215 Task 28). Stdlib-only.
//
// The gate records, per entry point and exported name, the full normalized declaration read from the
// emitted `.d.ts` tree: interface, class and enum bodies (members sorted, comments stripped, whitespace
// collapsed), type alias right-hand sides, every function overload, and const types. A re-exported name
// resolves to its declaration through the package's own declaration graph; a name re-exported from
// another package records the `from` specifier. Keys are `<entry> <name>` (`. AgentConfig`,
// `./net pinnedFetch`), so a move between the root and a subpath is a removal plus an addition.
//
// TypeScript 7 (the repo's compiler) ships no JavaScript AST API, so this is a small scanner over the
// regular text tsc emits: strings, template literals, comments and bracket depth, nothing more.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Kernel types only the kernel produces and hosts only consume (events, UI requests, finish reasons):
 * a new union member is additive for them. Anything a host constructs and passes in is not listed, since
 * a widened input union can break exhaustive host code that builds it. Keyed by bare name, any entry.
 */
export const PRODUCER_ONLY_TYPES = new Set(["AgentEventPayload", "AgentEvent", "AgentEventType", "AgentFinishReason", "HostUiRequest", "SessionEntryKind"]);

const OPEN = new Set(["(", "[", "{", "<"]);
const CLOSE = new Set([")", "]", "}", ">"]);

/** Index just past the string or template literal that starts at `start`. */
function skipString(text, start) {
  const quote = text[start];
  let index = start + 1;
  while (index < text.length) {
    const char = text[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === quote) return index + 1;
    if (quote === "`" && char === "$" && text[index + 1] === "{") {
      let depth = 1;
      index += 2;
      while (index < text.length && depth > 0) {
        const inner = text[index];
        if (inner === '"' || inner === "'" || inner === "`") {
          index = skipString(text, index);
          continue;
        }
        if (inner === "{") depth++;
        else if (inner === "}") depth--;
        index++;
      }
      continue;
    }
    index++;
  }
  return index;
}

const isQuote = (char) => char === '"' || char === "'" || char === "`";

/** Comments removed, strings kept verbatim. */
export function stripComments(text) {
  let out = "";
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (isQuote(char)) {
      const end = skipString(text, index);
      out += text.slice(index, end);
      index = end;
    } else if (char === "/" && text[index + 1] === "/") {
      while (index < text.length && text[index] !== "\n") index++;
    } else if (char === "/" && text[index + 1] === "*") {
      const end = text.indexOf("*/", index + 2);
      index = end === -1 ? text.length : end + 2;
      out += " ";
    } else {
      out += char;
      index++;
    }
  }
  return out;
}

/** Whitespace collapsed outside strings, with no space just inside `()` and `[]`. */
function collapseCode(text) {
  let out = "";
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (isQuote(char)) {
      const end = skipString(text, index);
      out += text.slice(index, end);
      index = end;
    } else if (/\s/.test(char)) {
      while (index < text.length && /\s/.test(text[index])) index++;
      const next = text[index];
      const prev = out[out.length - 1];
      if (out && next !== undefined && prev !== "(" && prev !== "[" && next !== ")" && next !== "]") out += " ";
    } else {
      out += char;
      index++;
    }
  }
  return out.trim();
}

/**
 * Split at `separator` where no bracket is open, outside strings. `<`/`>` count as brackets (a `.d.ts`
 * has no comparisons); the `>` of `=>` does not.
 */
export function splitTopLevel(text, separator) {
  const parts = [];
  let depth = 0;
  let start = 0;
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (isQuote(char)) {
      index = skipString(text, index);
      continue;
    }
    if (OPEN.has(char)) depth++;
    else if (CLOSE.has(char) && !(char === ">" && text[index - 1] === "=")) depth--;
    else if (char === separator && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
    index++;
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

const BLOCK_HEAD =
  /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:const\s+)?(?:interface|class|enum|namespace|module|global)\b/;

/** Top-level statements of a comment-free declaration file. */
export function splitStatements(text) {
  const statements = [];
  let depth = 0;
  let start = 0;
  let index = 0;
  const push = (end) => {
    const statement = text.slice(start, end).trim();
    if (statement) statements.push(statement);
    start = end + 1;
  };
  while (index < text.length) {
    const char = text[index];
    if (isQuote(char)) {
      index = skipString(text, index);
      continue;
    }
    if (OPEN.has(char)) depth++;
    else if (CLOSE.has(char) && !(char === ">" && text[index - 1] === "=")) {
      depth--;
      if (char === "}" && depth === 0 && BLOCK_HEAD.test(text.slice(start, index).trim())) push(index + 1);
    } else if (char === ";" && depth === 0) push(index);
    index++;
  }
  push(text.length);
  return statements;
}

/** Index of the first `char` outside brackets and strings (an `=` of `=>` does not count), or -1. */
function topLevelIndex(text, target) {
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (isQuote(char)) {
      index = skipString(text, index) - 1;
      continue;
    }
    if (char === target && depth === 0 && !(char === "=" && text[index + 1] === ">")) return index;
    if (OPEN.has(char)) depth++;
    else if (CLOSE.has(char) && !(char === ">" && text[index - 1] === "=")) depth--;
  }
  return -1;
}

/** Index of the `{` that opens a class/interface/enum/namespace body (outside generics and parameters). */
function bodyStart(text) {
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (isQuote(char)) {
      index = skipString(text, index) - 1;
      continue;
    }
    if (char === "{" && depth === 0) return index;
    if (OPEN.has(char)) depth++;
    else if (CLOSE.has(char) && !(char === ">" && text[index - 1] === "=")) depth--;
  }
  return -1;
}

/** `{ header, members }` of a body declaration, or undefined. */
export function splitBody(item) {
  const open = bodyStart(item);
  if (open === -1 || !item.endsWith("}")) return undefined;
  const header = item.slice(0, open).trim();
  const body = item.slice(open + 1, -1);
  const enumLike = /^(?:const\s+)?enum\b/.test(header);
  const members = splitTopLevel(body, enumLike ? "," : ";");
  return { header, members };
}

const DECL_RE =
  /^(export\s+)?(default\s+)?(?:declare\s+)?((?:(?:abstract|async)\s+)*)(const\s+enum|function|class|interface|type|enum|const|let|var|namespace|module)\s+([A-Za-z0-9_$]+)/;

/**
 * One declaration statement, normalized: `export`, `default` and `declare` dropped, comments gone,
 * whitespace collapsed, and the members of an interface, class or enum body sorted.
 */
export function normalizeDeclaration(statement) {
  const flat = collapseCode(stripComments(statement)).replace(/;$/, "").trim();
  const text = flat.replace(/^(?:export\s+)?(?:default\s+)?(?:declare\s+)?/, "");
  const kind = text.match(
    /^(?:(?:abstract|async)\s+)*(const\s+enum|function|class|interface|type|enum|const|let|var|namespace|module)\b/,
  )?.[1];
  if (kind && ["class", "interface", "enum", "const enum"].includes(kind)) {
    const parts = splitBody(text);
    if (parts) {
      const members = parts.members.map((member) => member.replace(/[;,]$/, "").trim()).sort();
      if (!members.length) return `${parts.header} {}`;
      return /enum$/.test(kind) ? `${parts.header} { ${members.join(", ")} }` : `${parts.header} { ${members.join("; ")}; }`;
    }
  }
  return text;
}

const VALUE_KINDS = /^(?:(?:abstract|async)\s+)*(?:function|class|const|let|var|enum|const\s+enum|namespace|module)\b/;

function parseNameList(list) {
  return splitTopLevel(list, ",").map((part) => {
    const typeOnly = /^type\s/.test(part);
    const pieces = part.replace(/^type\s+/, "").split(/\s+as\s+/);
    return { original: pieces[0].trim(), exported: (pieces[1] ?? pieces[0]).trim(), typeOnly };
  });
}

/** Imports, exports and declarations of one `.d.ts` file. */
export function parseModule(text) {
  const decls = new Map(); // local name -> [normalized item]
  const localExports = []; // { exported, local, typeOnly }
  const reexports = []; // { exported, original, specifier, typeOnly }
  const stars = []; // specifier
  const starNamespaces = []; // { exported, specifier }
  const imports = new Map(); // local -> { specifier, original }  (original "*" = namespace import)
  for (const raw of splitStatements(stripComments(text))) {
    const statement = collapseCode(raw);
    let match;
    if ((match = statement.match(/^import\s+(type\s+)?(.*?)\s+from\s+["']([^"']+)["']$/))) {
      const clause = match[2];
      const specifier = match[3];
      const ns = clause.match(/\*\s+as\s+([A-Za-z0-9_$]+)/);
      if (ns) imports.set(ns[1], { specifier, original: "*" });
      const named = clause.match(/\{([^}]*)\}/);
      if (named) for (const { original, exported } of parseNameList(named[1])) imports.set(exported, { specifier, original });
      const def = clause.match(/^([A-Za-z0-9_$]+)\s*(?:,|$)/);
      if (def) imports.set(def[1], { specifier, original: "default" });
      continue;
    }
    if ((match = statement.match(/^export\s+(type\s+)?\{([^}]*)\}\s*from\s+["']([^"']+)["']$/))) {
      for (const entry of parseNameList(match[2]))
        reexports.push({ ...entry, typeOnly: entry.typeOnly || Boolean(match[1]), specifier: match[3] });
      continue;
    }
    if ((match = statement.match(/^export\s+(type\s+)?\{([^}]*)\}$/))) {
      for (const entry of parseNameList(match[2]))
        localExports.push({ exported: entry.exported, local: entry.original, typeOnly: entry.typeOnly || Boolean(match[1]) });
      continue;
    }
    if ((match = statement.match(/^export\s+(?:type\s+)?\*\s+as\s+([A-Za-z0-9_$]+)\s+from\s+["']([^"']+)["']$/))) {
      starNamespaces.push({ exported: match[1], specifier: match[2] });
      continue;
    }
    if ((match = statement.match(/^export\s+(?:type\s+)?\*\s+from\s+["']([^"']+)["']$/))) {
      stars.push(match[1]);
      continue;
    }
    if ((match = statement.match(/^export\s+default\s+([A-Za-z0-9_$]+)$/))) {
      localExports.push({ exported: "default", local: match[1], typeOnly: false });
      continue;
    }
    if (/^(?:declare\s+)?(?:global\b|module\s+["'])/.test(statement) || /^export\s*=/.test(statement) || statement === "export {}")
      continue;
    if ((match = statement.match(DECL_RE))) {
      const [, exported, isDefault, , , name] = match;
      const item = normalizeDeclaration(statement);
      if (!decls.has(name)) decls.set(name, []);
      decls.get(name).push(item);
      if (exported) localExports.push({ exported: isDefault ? "default" : name, local: name, typeOnly: false });
      continue;
    }
    if (/^export\s+default\b/.test(statement)) {
      decls.set("default", [statement.replace(/^export\s+default\s+/, "default ")]);
      localExports.push({ exported: "default", local: "default", typeOnly: false });
    }
  }
  return { decls, localExports, reexports, stars, starNamespaces, imports };
}

/** Resolve "./x.js" / "./x" / "./x.ts" relative to a .d.ts file. */
export function resolveDeclarationFile(fromFile, specifier) {
  const base = join(dirname(fromFile), specifier).replace(/\.(?:js|ts|mjs|mts)$/, "");
  for (const candidate of [`${base}.d.ts`, `${base}.d.mts`, join(base, "index.d.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * `Map<exportedName, string[]>` for one declaration file: every exported name with its sorted list of
 * normalized items. `read` is injectable for tests.
 */
export function resolveModuleExports(entryFile, read = (file) => readFileSync(file, "utf8")) {
  const cache = new Map();
  const active = new Set();
  function exportsOf(file) {
    if (cache.has(file)) return cache.get(file);
    if (active.has(file)) return new Map();
    active.add(file);
    const parsed = parseModule(read(file));
    const result = new Map();
    const set = (name, items, typeOnly) => {
      const list = [...new Set(items)].sort();
      if (typeOnly && list.some((item) => VALUE_KINDS.test(item))) list.push("[type-only export]");
      result.set(name, list);
    };
    const follow = (specifier, original, typeOnly) => {
      if (!specifier.startsWith(".")) return [`reexport ${original} from "${specifier}"`];
      const target = resolveDeclarationFile(file, specifier);
      if (!target) return [`unresolved ${original} from "${specifier}"`];
      if (original === "*") return [namespaceItem(exportsOf(target))];
      const found = exportsOf(target).get(original);
      if (!found) return [`unresolved ${original} from "${specifier}"`];
      return typeOnly ? found.filter((item) => item !== "[type-only export]") : found;
    };
    for (const specifier of parsed.stars) {
      if (!specifier.startsWith(".")) {
        result.set(`* from "${specifier}"`, [`export * from "${specifier}"`]);
        continue;
      }
      const target = resolveDeclarationFile(file, specifier);
      if (!target) continue;
      for (const [name, items] of exportsOf(target)) if (name !== "default" && !result.has(name)) result.set(name, items);
    }
    for (const { exported, specifier } of parsed.starNamespaces) set(exported, follow(specifier, "*", false), false);
    for (const { exported, original, specifier, typeOnly } of parsed.reexports)
      set(exported, follow(specifier, original, typeOnly), typeOnly);
    for (const { exported, local, typeOnly } of parsed.localExports) {
      const declared = parsed.decls.get(local);
      if (declared) set(exported, declared, typeOnly);
      else if (parsed.imports.has(local)) {
        const binding = parsed.imports.get(local);
        set(exported, follow(binding.specifier, binding.original, typeOnly), typeOnly);
      } else set(exported, [`unresolved ${local}`], typeOnly);
    }
    active.delete(file);
    cache.set(file, result);
    return result;
  }
  return exportsOf(entryFile);
}

function namespaceItem(exports) {
  const names = [...exports.keys()].sort();
  return `namespace { ${names.join("; ")}; }`;
}

/** Declaration file for one `exports` target, or undefined for a non-code target (JSON schema, …). */
export function entryDeclarationFile(declRoot, target) {
  if (typeof target !== "string") return undefined;
  const rel = target.replace(/^\.\//, "");
  if (/\.d\.ts$/.test(rel)) return join(declRoot, rel);
  if (/\.(?:ts|mts|js|mjs)$/.test(rel)) return join(declRoot, rel.replace(/\.(?:ts|mts|js|mjs)$/, ".d.ts"));
  return undefined;
}

function exportTarget(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return value.types ?? value.import ?? value.default;
  return undefined;
}

/**
 * The frozen surface of one package: `Map<"<entry> <name>", normalizedText>` over every code entry of
 * `manifest.exports` (or `types`/`main` when there is no `exports`). `declRoot` mirrors the package root.
 * Returns `{ surface, missing }`; `missing` lists entries whose declaration file was not emitted.
 */
export function extractPackageSurface(declRoot, manifest) {
  const entries = [];
  const exp = manifest.exports;
  if (typeof exp === "string") entries.push([".", exp]);
  else if (exp && typeof exp === "object") for (const [key, value] of Object.entries(exp)) entries.push([key, exportTarget(value)]);
  else if (manifest.types ?? manifest.main) entries.push([".", manifest.types ?? manifest.main]);
  const surface = new Map();
  const missing = [];
  for (const [entry, target] of entries) {
    if (entry.includes("*")) continue;
    const file = entryDeclarationFile(declRoot, target);
    if (!file) continue;
    if (!existsSync(file)) {
      missing.push(`${entry} (${target})`);
      continue;
    }
    for (const [name, items] of resolveModuleExports(file)) surface.set(`${entry} ${name}`, items.join("; "));
  }
  return { surface, missing };
}

/** `name` for the root entry, `./net#name` for a subpath. */
export function displayKey(key) {
  const space = key.indexOf(" ");
  if (space === -1) return key;
  const entry = key.slice(0, space);
  const name = key.slice(space + 1);
  return entry === "." ? name : `${entry}#${name}`;
}

function bareName(key) {
  const space = key.indexOf(" ");
  return space === -1 ? key : key.slice(space + 1);
}

const OPTIONAL_MEMBER =
  /^(?:(?:readonly|static|public|protected|private|abstract|declare|get|set)\s+)*(?:[A-Za-z0-9_$#]+|"[^"]*"|'[^']*'|\[[^\]]*\])\?\s*[:(<]/;

function declHead(item) {
  return item.match(/^((?:(?:abstract|async)\s+)*(?:const\s+enum|class|interface|type|enum|namespace|module)\s+[A-Za-z0-9_$]+)/)?.[1];
}

/** Is `next` an additive successor of `prev` (same declaration, by the rules in docs/release.md)? */
function compatibleSuccessor(prev, next, name, producerOnly) {
  const head = declHead(prev);
  if (!head || declHead(next) !== head) return false;
  if (/^(?:(?:abstract)\s+)*(?:class|interface)\s/.test(head)) {
    const a = splitBody(prev);
    const b = splitBody(next);
    if (!a || !b || a.header !== b.header) return false;
    const before = new Set(a.members.map((member) => member.replace(/;$/, "")));
    const after = new Set(b.members.map((member) => member.replace(/;$/, "")));
    for (const member of before) if (!after.has(member)) return false;
    for (const member of after) if (!before.has(member) && !OPTIONAL_MEMBER.test(member)) return false;
    return true;
  }
  if (/^type\s/.test(head) && producerOnly.has(name)) {
    const split = (item) => {
      const eq = topLevelIndex(item, "=");
      return { lhs: item.slice(0, eq).trim(), union: new Set(splitTopLevel(item.slice(eq + 1).replace(/^\s*\|/, ""), "|")) };
    };
    const a = split(prev);
    const b = split(next);
    if (a.lhs !== b.lhs) return false;
    for (const member of a.union) if (!b.union.has(member)) return false;
    return true;
  }
  return false;
}

/** `"compatible"` or `"breaking"` for one changed name. */
export function classifyChange(key, baselineText, currentText, producerOnly = PRODUCER_ONLY_TYPES) {
  const name = bareName(key);
  const before = splitTopLevel(baselineText, ";");
  const after = splitTopLevel(currentText, ";");
  const unmatchedAfter = after.filter((item) => !before.includes(item));
  for (const item of before) {
    if (after.includes(item)) continue;
    const index = unmatchedAfter.findIndex((candidate) => compatibleSuccessor(item, candidate, name, producerOnly));
    if (index === -1) return "breaking";
    unmatchedAfter.splice(index, 1);
  }
  // A new overload is additive; any other new item (a value next to a type, a type-only marker) is not.
  return unmatchedAfter.every((item) => /^(?:async\s+)?function\s/.test(item)) ? "compatible" : "breaking";
}

/** Normalized text spread over lines: one per item, one per body member. */
function expandLines(text) {
  const lines = [];
  for (const item of splitTopLevel(text, ";")) {
    const parts = /^(?:(?:abstract|async)\s+)*(?:const\s+enum|class|interface|enum)\s/.test(item) ? splitBody(item) : undefined;
    if (parts) {
      lines.push(`${parts.header} {`);
      for (const member of parts.members) lines.push(`  ${member};`);
      lines.push("}");
    } else lines.push(item);
  }
  return lines;
}

/** Unified-style diff (changed lines with one line of context) of two normalized declarations. */
export function shapeDiff(baselineText, currentText) {
  const a = expandLines(baselineText);
  const b = expandLines(currentText);
  const table = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      ops.push(`  ${a[i]}`);
      i++;
      j++;
    } else if (j < b.length && (i === a.length || table[i][j + 1] > table[i + 1][j])) ops.push(`+ ${b[j++]}`);
    else ops.push(`- ${a[i++]}`);
  }
  const keep = ops.map(
    (op, index) =>
      op[0] !== " " ||
      ops[index - 1]?.[0] === "-" ||
      ops[index - 1]?.[0] === "+" ||
      ops[index + 1]?.[0] === "-" ||
      ops[index + 1]?.[0] === "+",
  );
  const out = [];
  ops.forEach((op, index) => {
    if (keep[index]) out.push(op);
    else if (out[out.length - 1] !== "  …") out.push("  …");
  });
  return out.join("\n");
}
