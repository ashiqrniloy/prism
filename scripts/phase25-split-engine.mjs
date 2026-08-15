// Task 1 reusable god-module split engine (0.2.5 plan 025). Stdlib-only.
// Splits a module into cohesive family files behind a barrel, preserving the public
// surface (value decls by local-decl text; types via the barrel chain). Auto-derives
// the external import map from the source header (named + default + JSON attributes),
// adds `export` to internal declarations referenced cross-family, and emits type/val
// imports per family.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const DEFAULT_SKIP = new Set([
  "string",
  "number",
  "boolean",
  "null",
  "undefined",
  "unknown",
  "any",
  "void",
  "object",
  "never",
  "symbol",
  "bigint",
  "readonly",
  "const",
  "let",
  "var",
  "function",
  "class",
  "interface",
  "type",
  "enum",
  "namespace",
  "module",
  "extends",
  "implements",
  "return",
  "if",
  "else",
  "for",
  "while",
  "switch",
  "case",
  "break",
  "continue",
  "new",
  "this",
  "super",
  "import",
  "export",
  "from",
  "as",
  "in",
  "of",
  "keyof",
  "infer",
  "is",
  "satisfies",
  "typeof",
  "instanceof",
  "delete",
  "void",
  "yield",
  "await",
  "async",
  "static",
  "get",
  "set",
  "public",
  "private",
  "protected",
  "abstract",
  "override",
  "declare",
  "global",
  "require",
  "Promise",
  "Record",
  "Readonly",
  "Array",
  "Map",
  "Set",
  "Date",
  "Error",
  "JSON",
  "Symbol",
  "Uint8Array",
  "Buffer",
  "ReadableStream",
  "WritableStream",
  "AbortSignal",
  "AbortController",
  "RegExp",
  "Math",
  "Number",
  "Boolean",
  "String",
  "Object",
  "BigInt",
  "TextEncoder",
  "TextDecoder",
  "URL",
  "URLSearchParams",
  "setTimeout",
  "clearTimeout",
  "console",
  "process",
  "crypto",
  "fetch",
  "Request",
  "Response",
  "Headers",
  "true",
  "false",
  "constructor",
  "toString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "__proto__",
  "NodeJS",
]);

const DECL_RE = /^(export\s+)?(async\s+)?(function\*?|class|const|let|var|enum|interface|type|namespace|module)\s+([A-Za-z0-9_]+)/;
const IDENT_RE = /\b([A-Za-z_$][A-Za-z0-9_$]*)\b/g;

// Parse a module's top-of-file `import` statements.
// Returns { map: name -> [module, "type"|"val", isDefault], attrByMod: module -> "with {...}" string }
function deriveExternalMap(text) {
  const map = Object.create(null);
  const attrByMod = Object.create(null);
  const re = /^import\s+(type\s+)?([\s\S]+?)\s+from\s+["']([^"']+)["'](\s+with\s+\{[^}]*\})?\s*;?\s*$/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    const isType = !!m[1];
    const spec = m[2];
    const mod = m[3];
    if (m[4]) attrByMod[mod] = m[4].trim();
    const brace = spec.match(/\{([^}]*)\}/);
    const defPart = brace ? spec.slice(0, spec.indexOf("{")).replace(/,\s*$/, "").trim() : spec.trim();
    if (defPart) {
      if (defPart.startsWith("* as ")) {
        const ns = defPart.slice(5).trim();
        if (ns) map[ns] = [mod, isType ? "type" : "val", false];
      } else {
        map[defPart] = [mod, isType ? "type" : "val", true]; // default import
      }
    }
    if (brace) {
      for (let part of brace[1].split(",")) {
        part = part.trim();
        if (!part) continue;
        const t = part.match(/^type\s+([A-Za-z0-9_$]+)$/);
        if (t) {
          map[t[1]] = [mod, "type", false];
          continue;
        }
        const name = part.match(/^([A-Za-z0-9_$]+)(?:\s+as\s+([A-Za-z0-9_$]+))?$/);
        if (name) map[name[2] ?? name[1]] = [mod, isType ? "type" : "val", false];
      }
    }
  }
  return { map, attrByMod };
}

// Relative module spec, adjusted one level deeper (family files live in <dir>/).
function deepen(spec) {
  return spec.startsWith(".") ? `../${spec.replace(/^\.\//, "")}` : spec;
}

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

export function splitModule({ src, families, extraSkip = [] }) {
  const text = readFileSync(src, "utf8");
  const lines = text.split("\n");
  const { map: externalMap, attrByMod } = deriveExternalMap(text);
  const dir = src.replace(/\.ts$/, "");
  const dirBasename = basename(dir);
  const skip = new Set([...DEFAULT_SKIP, ...extraSkip]);

  const nameInfo = new Map();
  for (const f of families)
    for (const [s, e] of f.ranges)
      for (let i = s; i <= e; i++) {
        const m = lines[i - 1].match(DECL_RE);
        if (m) nameInfo.set(m[4], { family: f.name, kind: /interface|type|enum|namespace|module/.test(m[3]) ? "type" : "val" });
      }

  mkdirSync(dir, { recursive: true });

  // Phase A: per family body + used names; collect cross-family-imported names (needsExport).
  const perFamily = [];
  const needsExport = new Set();
  for (const f of families) {
    const dl = [];
    for (const [s, e] of f.ranges) for (let i = s; i <= e; i++) dl.push(lines[i - 1]);
    const body = `${dl
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/import\("\.\//g, 'import("../')
      .trimEnd()}\n`;
    const scanBody = stripComments(body);
    const used = new Set();
    let m;
    IDENT_RE.lastIndex = 0;
    while ((m = IDENT_RE.exec(scanBody)) !== null) used.add(m[1]);
    const local = new Set([...nameInfo.entries()].filter(([, i]) => i.family === f.name).map(([n]) => n));
    for (const name of used) {
      if (skip.has(name) || local.has(name)) continue;
      if (nameInfo.has(name) && nameInfo.get(name).family !== f.name) needsExport.add(name);
    }
    perFamily.push({ f, body, used, local });
  }

  // Phase B: write each family file with imports + export-prefix on needsExport declarations.
  for (const { f, body, used, local } of perFamily) {
    // Per module: { type:Set, val:Set, defaults:Set } for external; { type, val } for cross-family.
    const extByMod = new Map();
    const coreByFam = new Map();
    const bumpExt = (mod, kind, name, isDefault) => {
      if (!extByMod.has(mod)) extByMod.set(mod, { type: new Set(), val: new Set(), defaults: new Set() });
      if (isDefault) extByMod.get(mod).defaults.add(name);
      else extByMod.get(mod)[kind].add(name);
    };
    const bumpCore = (fam, kind, name) => {
      if (!coreByFam.has(fam)) coreByFam.set(fam, { type: new Set(), val: new Set() });
      coreByFam.get(fam)[kind].add(name);
    };
    for (const name of [...used].sort()) {
      if (skip.has(name) || local.has(name)) continue;
      if (Object.hasOwn(externalMap, name)) {
        const [mod, kind, isDefault] = externalMap[name];
        bumpExt(mod, kind, name, isDefault);
      } else if (nameInfo.has(name) && nameInfo.get(name).family !== f.name) {
        bumpCore(nameInfo.get(name).family, nameInfo.get(name).kind, name);
      }
    }
    const importLines = [];
    for (const [mod, { type, val, defaults }] of extByMod) {
      const spec = deepen(mod);
      const attr = Object.hasOwn(attrByMod, mod) ? ` ${attrByMod[mod]}` : "";
      for (const d of defaults) importLines.push(`import ${d} from "${spec}"${attr};`);
      if (type.size) importLines.push(`import type { ${[...type].join(", ")} } from "${spec}"${attr};`);
      if (val.size) importLines.push(`import { ${[...val].join(", ")} } from "${spec}"${attr};`);
    }
    for (const [fam, { type, val }] of coreByFam) {
      if (type.size) importLines.push(`import type { ${[...type].join(", ")} } from "./${fam}.js";`);
      if (val.size) importLines.push(`import { ${[...val].join(", ")} } from "./${fam}.js";`);
    }
    const outBody = body
      .split("\n")
      .map((line) => {
        const m = line.match(DECL_RE);
        if (m && !m[1] && needsExport.has(m[4])) return `export ${line}`;
        return line;
      })
      .join("\n");
    const header = `/** ${f.name} (0.2.5 plan 025 Task 1 split). Moved verbatim from ${basename(src)}; public surface unchanged behind the barrel. */\n`;
    writeFileSync(`${dir}/${f.name}.ts`, header + (importLines.length ? `${importLines.join("\n")}\n\n` : "") + outBody);
  }

  const barrel =
    `/** ${basename(src)} barrel (0.2.5 plan 025 Task 1 god-module split): re-exports the\n * public surface from cohesive family modules (0.1.4 barrel precedent). */\n` +
    families.map((f) => `export * from "./${dirBasename}/${f.name}.js";`).join("\n") +
    "\n";
  writeFileSync(src, barrel);
  console.log(`split ${src} -> ${families.length} families; needsExport: ${[...needsExport].join(", ") || "(none)"}`);
}
