// Task 1 helper: split packages/coding-agent/src/repository.ts into cohesive family modules behind a barrel.
// Adds `export` to internal declarations that are referenced cross-family (required for cross-file imports).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = "packages/coding-agent/src/repository.ts";
const lines = readFileSync(SRC, "utf8").split("\n");

const families = [
  { name: "types", ranges: [[44, 217]] },
  { name: "path", ranges: [[218, 305]] },
  { name: "walk", ranges: [[336, 449]] },
  { name: "list", ranges: [[450, 565]] },
  {
    name: "search",
    ranges: [
      [306, 335],
      [566, 826],
    ],
  },
  { name: "glob", ranges: [[827, 963]] },
  { name: "operations", ranges: [[964, 974]] },
];

const externalMap = Object.assign(Object.create(null), {
  Dir: ["node:fs", "type"],
  Dirent: ["node:fs", "type"],
  lstat: ["node:fs/promises", "val"],
  open: ["node:fs/promises", "val"],
  opendir: ["node:fs/promises", "val"],
  realpath: ["node:fs/promises", "val"],
  isAbsolute: ["node:path", "val"],
  join: ["node:path", "val"],
  relative: ["node:path", "val"],
  resolve: ["node:path", "val"],
  sep: ["node:path", "val"],
  DEFAULT_BINARY_SNIFF_BYTES: ["./limits.js", "val"],
  DEFAULT_MAX_REPO_CONCURRENCY: ["./limits.js", "val"],
  DEFAULT_MAX_REPO_DEPTH: ["./limits.js", "val"],
  DEFAULT_MAX_REPO_ENTRIES: ["./limits.js", "val"],
  DEFAULT_MAX_REPO_FILES: ["./limits.js", "val"],
  DEFAULT_MAX_REPO_RESULTS: ["./limits.js", "val"],
  DEFAULT_MAX_SEARCH_CONTEXT_LINES: ["./limits.js", "val"],
  DEFAULT_MAX_SEARCH_FILE_BYTES: ["./limits.js", "val"],
  DEFAULT_MAX_SEARCH_LINE_BYTES: ["./limits.js", "val"],
  DEFAULT_MAX_SEARCH_MATCHES: ["./limits.js", "val"],
  DEFAULT_MAX_SEARCH_PATTERN_BYTES: ["./limits.js", "val"],
  DEFAULT_MAX_SEARCH_SCAN_BYTES: ["./limits.js", "val"],
  DEFAULT_MAX_SEARCH_TIME_MS: ["./limits.js", "val"],
  HARD_MAX_REPO_CONCURRENCY: ["./limits.js", "val"],
  HARD_MAX_REPO_DEPTH: ["./limits.js", "val"],
  HARD_MAX_REPO_ENTRIES: ["./limits.js", "val"],
  HARD_MAX_REPO_FILES: ["./limits.js", "val"],
  HARD_MAX_REPO_RESULTS: ["./limits.js", "val"],
  HARD_MAX_SEARCH_CONTEXT_LINES: ["./limits.js", "val"],
  HARD_MAX_SEARCH_FILE_BYTES: ["./limits.js", "val"],
  HARD_MAX_SEARCH_LINE_BYTES: ["./limits.js", "val"],
  HARD_MAX_SEARCH_MATCHES: ["./limits.js", "val"],
  HARD_MAX_SEARCH_PATTERN_BYTES: ["./limits.js", "val"],
  HARD_MAX_SEARCH_SCAN_BYTES: ["./limits.js", "val"],
  HARD_MAX_SEARCH_TIME_MS: ["./limits.js", "val"],
  validateCodingLimit: ["./limits.js", "val"],
  validateCodingLimitAllowZero: ["./limits.js", "val"],
  expandGlobBraces: ["./glob-match.js", "val"],
  matchGlobPattern: ["./glob-match.js", "val"],
  validateGlobPattern: ["./glob-match.js", "val"],
  resolveToCwd: ["./path-utils.js", "val"],
});

const skip = new Set([
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
  "value",
  "done",
  "name",
]);

const declRe = /^(export\s+)?(async\s+)?(function\*?|class|const|let|var|enum|interface|type|namespace|module)\s+([A-Za-z0-9_]+)/;
const identRe = /\b([A-Za-z_$][A-Za-z0-9_$]*)\b/g;

const nameInfo = new Map();
for (const f of families)
  for (const [s, e] of f.ranges)
    for (let i = s; i <= e; i++) {
      const m = lines[i - 1].match(declRe);
      if (m) nameInfo.set(m[4], { family: f.name, kind: /interface|type|enum|namespace|module/.test(m[3]) ? "type" : "val" });
    }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync("packages/coding-agent/src/repository", { recursive: true });

  // Phase A: per family, compute body + used + collect cross-family-imported names (needsExport).
  const perFamily = [];
  const needsExport = new Set();
  for (const f of families) {
    const declLines = [];
    for (const [s, e] of f.ranges) for (let i = s; i <= e; i++) declLines.push(lines[i - 1]);
    const body = `${declLines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/import\("\.\//g, 'import("../')
      .trimEnd()}\n`;
    const used = new Set();
    let m2;
    identRe.lastIndex = 0;
    while ((m2 = identRe.exec(body)) !== null) used.add(m2[1]);
    const local = new Set([...nameInfo.entries()].filter(([, info]) => info.family === f.name).map(([n]) => n));
    for (const name of used) {
      if (skip.has(name) || local.has(name)) continue;
      if (nameInfo.has(name) && nameInfo.get(name).family !== f.name) needsExport.add(name);
    }
    perFamily.push({ f, body, used, local });
  }

  // Phase B: write each family file with imports + export-prefix on needsExport declarations.
  for (const { f, body, used, local } of perFamily) {
    const extByMod = new Map(),
      coreByFam = new Map();
    const bump = (map, key, kind, name) => {
      if (!map.has(key)) map.set(key, { type: new Set(), val: new Set() });
      map.get(key)[kind].add(name);
    };
    for (const name of [...used].sort()) {
      if (skip.has(name) || local.has(name)) continue;
      if (Object.hasOwn(externalMap, name)) {
        const [mod, kind] = externalMap[name];
        bump(extByMod, mod, kind, name);
      } else if (nameInfo.has(name) && nameInfo.get(name).family !== f.name) {
        bump(coreByFam, nameInfo.get(name).family, nameInfo.get(name).kind, name);
      }
    }
    const importLines = [];
    for (const [mod, { type, val }] of extByMod) {
      const spec = mod.startsWith(".") ? mod.replace(/^\.\//, "../") : mod;
      if (type.size) importLines.push(`import type { ${[...type].join(", ")} } from "${spec}";`);
      if (val.size) importLines.push(`import { ${[...val].join(", ")} } from "${spec}";`);
    }
    for (const [fam, { type, val }] of coreByFam) {
      if (type.size) importLines.push(`import type { ${[...type].join(", ")} } from "./${fam}.js";`);
      if (val.size) importLines.push(`import { ${[...val].join(", ")} } from "./${fam}.js";`);
    }
    // Add `export` to declarations referenced cross-family that aren't already exported.
    const outBody = body
      .split("\n")
      .map((line) => {
        const m = line.match(declRe);
        if (m && !m[1] && needsExport.has(m[4])) return `export ${line}`;
        return line;
      })
      .join("\n");
    const header = `/** Repository ${f.name} family (0.2.5 plan 025 Task 1 split).\n * Moved verbatim from repository.ts; public surface unchanged behind the barrel. */\n`;
    writeFileSync(
      `packages/coding-agent/src/repository/${f.name}.ts`,
      header + (importLines.length ? `${importLines.join("\n")}\n\n` : "") + outBody,
    );
  }

  const barrel =
    `/** Repository barrel (0.2.5 plan 025 Task 1 god-module split): re-exports the public
 * repository surface from cohesive family modules so the import surface of
 * \`./repository.js\` is unchanged (0.1.4 barrel precedent). */
` +
    families.map((f) => `export * from "./repository/${f.name}.js";`).join("\n") +
    "\n";
  writeFileSync(SRC, barrel);
  console.log("split repository.ts into", families.length, "family files + barrel; needsExport:", [...needsExport].join(", "));
}
