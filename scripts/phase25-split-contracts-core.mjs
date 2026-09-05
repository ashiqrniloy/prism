// Task 1 helper: split src/contracts-core.ts into cohesive family modules behind a barrel.
// Stdlib-only. Extracts declaration ranges verbatim, fixes inline import() paths for the
// deeper location, auto-generates type-only imports (cross-family + external), writes the barrel.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = "src/contracts-core.ts";
const lines = readFileSync(SRC, "utf8").split("\n");

const families = [
  { name: "content", start: 30, end: 168, exclude: new Set([46]) },
  { name: "run-limits", start: 169, end: 259 },
  { name: "provider", start: 260, end: 363 },
  { name: "agent", start: 364, end: 632 },
  { name: "extensions", start: 633, end: 810 },
  { name: "session", start: 811, end: 1085 },
  { name: "persistence", start: 1086, end: 1482 },
  { name: "compaction", start: 1483, end: 1561 },
  { name: "resources", start: 1562, end: 1616 },
  { name: "loop", start: 1617, end: 1719 },
];

// External type imports (from the original header). name -> module.
const externalMap = Object.assign(Object.create(null), {
  AgentEvent: "contracts-protocol",
  AgentEventRecord: "contracts-protocol",
  AgentEventType: "contracts-protocol",
  InputAssemblyLayout: "contracts-protocol",
  ProviderTurnResult: "contracts-protocol",
  RealtimeEvent: "contracts-protocol",
  RunLedger: "contracts-protocol",
  RunStatus: "contracts-protocol",
  ToolCallRecord: "contracts-protocol",
  ToolCallStatus: "contracts-protocol",
  ToolEffectStore: "contracts-protocol",
  ToolResult: "contracts-protocol",
  UsageRecord: "contracts-protocol",
  UsageScope: "contracts-protocol",
  AgentEventSource: "contracts-protocol",
  ProviderEvent: "contracts-protocol",
  RunRecord: "contracts-protocol",
  ToolDefinition: "contracts-protocol",
  ToolRegistry: "contracts-protocol",
  AgentRunStateOptions: "contracts-run-state",
  AgentSession: "contracts-run-state",
  AudioContent: "content",
  DocumentContent: "content",
  FileContent: "content",
  ContributionRegistries: "contributions",
  AgentInput: "input",
  ManifestContributionDeclaration: "manifests",
  Middleware: "middleware",
  MiddlewareHookName: "middleware",
  MiddlewareRegistry: "middleware",
  SecretRedactor: "redaction",
  PermissionPolicy: "security",
  TrustPolicy: "security",
  ToolValidator: "tools",
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
  "Int8Array",
  "ArrayBuffer",
  "Buffer",
  "ReadableStream",
  "WritableStream",
  "TransformStream",
  "AbortSignal",
  "AbortController",
  "RegExp",
  "Math",
  "Number",
  "Boolean",
  "String",
  "Object",
  "BigInt",
  "Float32Array",
  "Float64Array",
  "Uint16Array",
  "Uint32Array",
  "DataView",
  "TextEncoder",
  "TextDecoder",
  "URL",
  "URLSearchParams",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "queueMicrotask",
  "atob",
  "btoa",
  "console",
  "process",
  "crypto",
  "fetch",
  "Request",
  "Response",
  "Headers",
  "FormData",
  "Blob",
  "File",
  "true",
  "false",
  "constructor",
  "toString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "T",
  "U",
  "V",
  "K",
  "S",
  "R",
  "P",
  "E",
  "X",
  "Y",
  "Z",
  "Self",
  "C",
  "Ctx",
  "Opts",
  "Args",
  "Result",
  "Value",
  "Item",
  "Key",
  "Acc",
  "Out",
  "In",
  "A",
  "B",
  "D",
  "F",
  "G",
  "H",
  "I",
  "J",
  "L",
  "M",
  "N",
  "O",
  "Q",
  "W",
  "NodeJS",
  "Self",
]);

const declRe =
  /^export (?:declare )?(?:abstract |async |readonly )*(?:function|class|const|let|var|enum|interface|type|namespace|module)\s+([A-Za-z0-9_]+)/;
const identRe = /\b([A-Za-z_$][A-Za-z0-9_$]*)\b/g;

const familyDeclared = new Map();
const nameToFamily = new Map();
for (const f of families) {
  const declared = new Set();
  for (let i = f.start; i <= f.end; i++) {
    if (f.exclude?.has(i)) continue;
    const m = lines[i - 1].match(declRe);
    if (m) {
      declared.add(m[1]);
      nameToFamily.set(m[1], f.name);
    }
  }
  familyDeclared.set(f.name, declared);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync("src/contracts-core", { recursive: true });

  for (const f of families) {
    const declLines = [];
    for (let i = f.start; i <= f.end; i++) {
      if (f.exclude?.has(i)) continue;
      declLines.push(lines[i - 1]);
    }
    // Fix inline import("./X.js") paths for the deeper location (the .d.ts resolves these to
    // bare type names, so the surface signature is unchanged; only the source path moves).
    const body = `${declLines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/import\("\.\//g, 'import("../')
      .trimEnd()}\n`;

    const used = new Set();
    let m2;
    identRe.lastIndex = 0;
    while ((m2 = identRe.exec(body)) !== null) used.add(m2[1]);
    const local = familyDeclared.get(f.name);
    const extByMod = new Map();
    const coreByFam = new Map();
    for (const name of [...used].sort()) {
      if (skip.has(name) || local.has(name)) continue;
      if (Object.hasOwn(externalMap, name)) {
        const mod = externalMap[name];
        if (!extByMod.has(mod)) extByMod.set(mod, new Set());
        extByMod.get(mod).add(name);
      } else if (nameToFamily.has(name) && nameToFamily.get(name) !== f.name) {
        const fam = nameToFamily.get(name);
        if (!coreByFam.has(fam)) coreByFam.set(fam, new Set());
        coreByFam.get(fam).add(name);
      }
    }
    const importLines = [];
    for (const [mod, names] of extByMod) importLines.push(`import type { ${[...names].join(", ")} } from "../${mod}.js";`);
    for (const [fam, names] of coreByFam) importLines.push(`import type { ${[...names].join(", ")} } from "./${fam}.js";`);
    const header = `/** Contracts-core ${f.name} family (0.2.5 plan 025 Task 1 split).\n * Moved verbatim from contracts-core.ts; public surface unchanged behind the barrel. */\n`;
    writeFileSync(`src/contracts-core/${f.name}.ts`, header + (importLines.length ? `${importLines.join("\n")}\n\n` : "") + body);
  }

  const barrel =
    `/** Contracts-core barrel (0.2.5 plan 025 Task 1 god-module split): re-exports the
 * public contracts surface from cohesive family modules so the import surface
 * of \`./contracts-core.js\` is unchanged (0.1.4 barrel precedent). */
export type { AudioContent, DocumentContent, FileContent } from "./content.js";
` +
    families.map((f) => `export * from "./contracts-core/${f.name}.js";`).join("\n") +
    "\n";
  writeFileSync(SRC, barrel);
  console.log("split contracts-core.ts into", families.length, "family files + barrel");
}
