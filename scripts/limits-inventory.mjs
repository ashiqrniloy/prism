#!/usr/bin/env bun
// Plan 239 Task 3: the limit inventory, its gate, and the generated `docs/limits.md`.
//
// `scripts/limits-inventory.json` lists every limit constant in `src/` and `packages/` (tests and
// generated `**/data/**` excluded). A limit constant is a `const` whose name starts with `DEFAULT_`,
// `HARD_`, `MAX_` or `MIN_`, or ends in a limit suffix (`_LIMIT(S)`, `_CAP`, `_BYTES`, `_CHARS`,
// `_MS`, `_PAGES`, `_DEPTH`, `_SIZE`). Each entry has a class:
//   - policy   bounds the work an agent does; the host configures it (`config`);
//   - ceiling  protects the process; only the host raises it (`config`);
//   - format   a wire or storage invariant, or not a limit at all (`reason`).
// `default` is the constant's initializer, read from source, so the gate fails when the two drift.
// `--update` seeds a new constant with `pending: "plan 239 Task N"`, a review marker: since plan 239
// Task 6 the gate is strict, so a pending row fails until a reviewer gives it a `config` path or makes it
// `format` with a `reason`.
//
//   bun scripts/limits-inventory.mjs               check (strict); exit 1 on any finding
//   bun scripts/limits-inventory.mjs --update      add new constants (seed class), drop removed ones,
//                                                  refresh `default`; hand-set fields are kept
//   bun scripts/limits-inventory.mjs --emit-docs   write docs/limits.md
//
// The check also fails on a literal numeric fallback on a limit-named field (`options.maxBytes ?? 4096`):
// a limit lives in a named constant, so the inventory sees it.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ROOT = join(import.meta.dirname, "..");
export const INVENTORY_FILE = "scripts/limits-inventory.json";
export const DOCS_FILE = "docs/limits.md";
export const CLASSES = ["policy", "ceiling", "format"];
export const PENDING = /^plan 239 Task [456]$/;

const SCAN_ROOTS = ["src", "packages"];
const EXCLUDE = /(^|\/)(__tests__|node_modules|dist|data)\/|\.test\.[cm]?[jt]sx?$|\.d\.ts$/;
const SOURCE = /\.(?:[cm]?[jt]s|tsx)$/;
const LIMIT_NAME = /^(?:DEFAULT|HARD|MAX|MIN)_|_(?:LIMITS?|CAP|BYTES|CHARS|MS|PAGES|DEPTH|SIZE)$/;
const DECLARATION = /^[ \t]*(?:export[ \t]+)?const[ \t]+([A-Z][A-Z0-9_]*)\b[ \t]*(?=[:=])/gm;

// `?? <number>` on a limit-named field. `attempt` counters are not limits.
const FALLBACK = /([A-Za-z_$][\w$]*)\s*\?\?\s*(\d[\d_]*(?:\.\d+)?)/g;
const FALLBACK_FIELD = /max|limit|cap|bytes|chars|timeout|size|depth|pages|concurren|rounds|retr|tokens|breakpoint|sources|pool/i;

export const BUNDLES = [
  { dir: "src", name: "@arnilo/prism", title: "Kernel — `@arnilo/prism`", task: 4 },
  { dir: "packages/extensions", name: "@arnilo/prism-extensions", task: 5 },
  { dir: "packages/tools", name: "@arnilo/prism-tools", task: 5 },
  { dir: "packages/hosts", name: "@arnilo/prism-hosts", task: 5 },
  { dir: "packages/providers", name: "@arnilo/prism-ai", task: 6 },
  { dir: "packages/memory", name: "@arnilo/prism-memory-system", task: 6 },
  { dir: "packages/knowledge", name: "@arnilo/prism-knowledge", task: 6 },
];

export function bundleOf(file) {
  return BUNDLES.find((bundle) => file === bundle.dir || file.startsWith(`${bundle.dir}/`));
}

/** The package (bundle subpath) a file belongs to, or the kernel area for `src/`. */
export function packageOf(file) {
  const parts = file.split("/");
  if (parts[0] === "src") return parts.length > 2 ? parts[1] : "core";
  return parts[2];
}

function listSources(root) {
  const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", ...SCAN_ROOTS], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return [...new Set(out.split("\n"))].filter((file) => file && SOURCE.test(file) && !EXCLUDE.test(file) && existsSync(join(root, file)));
}

/** The index just past the declaration's `=`, skipping a type annotation (which may span lines). */
function assignmentEnd(text, start) {
  let depth = 0;
  for (let i = start; i < text.length && i - start < 4000; i++) {
    const ch = text[i];
    if (ch === "<" || ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ">" && text[i - 1] !== "=") depth--;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (depth === 0 && ch === "=" && text[i + 1] !== ">" && text[i + 1] !== "=") return i + 1;
    else if (depth === 0 && ch === ";") return -1;
  }
  return -1;
}

/** The initializer text after `=` up to the end of the statement (balanced brackets). */
function initializerAt(text, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < text.length && i - start < 4000; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (depth === 0 && (ch === ";" || ch === "\n")) {
      // A line break inside an unfinished binary expression continues the statement.
      if (ch === "\n" && /^\s*$|[=*+\-/?:|&,(]\s*$/.test(text.slice(start, i))) continue;
      return text.slice(start, i);
    }
  }
  return text.slice(start, start + 4000);
}

const NUMERIC = /^[\d_.\s*+\-/()]+$/;

function stripInit(init) {
  return init
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+as\s+const\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function evaluateNumber(expression) {
  if (!NUMERIC.test(expression) || !/\d/.test(expression)) return undefined;
  try {
    const value = Function(`"use strict"; return (${expression.replaceAll("_", "")});`)();
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The `default` the inventory records: a number for a numeric literal, else the compact source text. */
export function defaultOf(init) {
  const text = stripInit(init);
  const number = evaluateNumber(text);
  if (number !== undefined) return number;
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

/** Whether an initializer can hold a numeric limit (a number, a numeric object, or a reference). */
function holdsNumber(init) {
  const text = stripInit(init);
  if (evaluateNumber(text) !== undefined) return true;
  if (/^(?:Object\.freeze\()?\{/.test(text))
    return !/=>|\bfunction\b/.test(text) && (/:\s*-?[\d(]/.test(text) || /:\s*[A-Z][A-Z0-9_]+/.test(text));
  return /^(?:Math\.\w+\()?[A-Z][A-Z0-9_]*(?:\.[a-zA-Z]\w*)?(?:\s*[*+\-/]\s*[\w.]+)*\)?$/.test(text);
}

/**
 * Every limit constant in the tree. `files` (path → text) replaces or adds file contents (test fixtures);
 * `tree: false` scans only `files`.
 */
export function scan({ root = ROOT, files, tree = true } = {}) {
  const sources = new Map();
  if (tree) for (const file of listSources(root)) sources.set(file, null);
  if (files) for (const [file, text] of files) sources.set(file, text);
  const entries = [];
  const fallbacks = [];
  const texts = new Map();
  for (const [file, given] of sources) {
    if (!SOURCE.test(file) || EXCLUDE.test(file) || !bundleOf(file)) continue;
    const text = given ?? readFileSync(join(root, file), "utf8");
    texts.set(file, text);
    const seen = new Set();
    for (const match of text.matchAll(DECLARATION)) {
      const name = match[1];
      if (!LIMIT_NAME.test(name) || seen.has(name)) continue;
      seen.add(name);
      const at = assignmentEnd(text, match.index + match[0].length);
      if (at < 0) continue;
      const init = initializerAt(text, at);
      entries.push({ name, file, init });
    }
    if (file.startsWith("src/testing/")) continue;
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index++) {
      for (const match of lines[index].matchAll(FALLBACK)) {
        const value = Number(match[2].replaceAll("_", ""));
        if (value < 2 || /attempt/i.test(match[1]) || !FALLBACK_FIELD.test(match[1])) continue;
        fallbacks.push({ file, line: index + 1, text: match[0] });
      }
    }
  }
  entries.sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name));
  return { entries, fallbacks, texts };
}

// ---------------------------------------------------------------------------------------------
// Seed knowledge for `--update`: used only for a constant the inventory does not list yet. The
// JSON is the reviewed source afterwards.

const NOT_A_LIMIT = new Set([
  "DEFAULT_SECRET_REF_DESCRIPTION",
  "DEFAULT_SYSTEMONE_PATH",
  "DEFAULT_LOAD_SKILL_TOOL_NAME",
  "DEFAULT_ENV_ALLOWLIST",
  "DEFAULT_COMPACTION_TRIGGER",
  "DEFAULT_CHAT_CACHE_BREAKPOINTS",
  "DEFAULT_OWNED_COMPAT_KEYS",
]);

// Constants whose prefix misstates their role (plan 239 Task 1(a), (g)).
const SEED_CLASS = {
  "src/provider-kit/transport.ts#DEFAULT_MAX_EVENT_BYTES": "ceiling",
  "src/provider-kit/transport.ts#DEFAULT_MAX_BUFFER_BYTES": "ceiling",
  "src/provider-kit/transport.ts#DEFAULT_MAX_RESPONSE_BODY_BYTES": "ceiling",
  "src/contracts-run-state.ts#DEFAULT_MAX_PENDING_STEERS": "ceiling",
  "src/contracts-run-state.ts#DEFAULT_MAX_PENDING_STEER_BYTES": "ceiling",
  "src/contracts-run-state.ts#DEFAULT_MAX_STICKY_DECISIONS": "ceiling",
  "src/contracts-run-state.ts#DEFAULT_MAX_PENDING_DECISIONS": "ceiling",
  "src/structured-output.ts#MAX_STRUCTURED_OUTPUT_REPAIRS": "policy",
};

// Host paths confirmed in plan 239 Task 1.
const SEED_CONFIG = {
  "src/run-limits.ts#DEFAULT_RUN_LIMITS": "AgentConfig.limits.<axis> (RunOptions.limits narrows)",
  "src/run-limits.ts#DEFAULT_MAX_CONTINUATIONS": "AgentConfig.limits.maxContinuations",
  "src/run-limits.ts#DEFAULT_BACKGROUND_SETTLE_MS": "AgentConfig.limits.backgroundSettleMs",
  "src/tools.ts#DEFAULT_TOOL_CONCURRENCY": "AgentConfig.tools.concurrency (RunOptions.tools.concurrency narrows)",
  "src/models/retry.ts#DEFAULT_RETRY_MAX_ATTEMPTS": "AgentConfig.retry.maxAttempts",
  "src/models/retry.ts#DEFAULT_RETRY_BASE_DELAY_MS": "AgentConfig.retry.baseDelayMs",
  "src/models/retry.ts#DEFAULT_RETRY_MAX_DELAY_MS": "AgentConfig.retry.maxDelayMs",
  "src/contracts-core/agent.ts#DEFAULT_SNAPSHOT_CACHE_TTL_MS": "SessionOptions.snapshotCacheTtlMs",
  "src/agent-session/event-subscriber.ts#DEFAULT_MAX_QUEUED_EVENTS": "SubscribeOptions.maxQueuedEvents",
  "src/agent-run-state.ts#DEFAULT_MAX_AGENT_RUN_STATE_BYTES": "DurableRunStateOptions.maxStateBytes",
  "packages/extensions/delegate/src/limits.ts#DEFAULT_CHILD_LIMITS":
    'packageConfig["@arnilo/prism-extensions/delegate"].children.<name>.limits',
  "packages/extensions/delegate/src/limits.ts#DEFAULT_RESULT_MAX_CHARS":
    'packageConfig["@arnilo/prism-extensions/delegate"].children.<name>.resultMaxChars',
};

const WORKFLOW_LIMITS_FILE = "packages/extensions/workflows/src/limits.ts";
const EVENT_SOURCE_FILE = "src/testing/memory-event-source.ts";

function camel(name) {
  return name.toLowerCase().replace(/_([a-z0-9])/g, (_, ch) => ch.toUpperCase());
}

/** A hint at the option that reads the constant (`options.maxBytes ?? DEFAULT_MAX_BYTES`), for Tasks 4–6. */
export function hintFor(name, text) {
  const fallback = new RegExp(`([A-Za-z_$][\\w$]*)\\??\\.([A-Za-z_$][\\w$]*)\\s*\\?\\?\\s*${name}\\b`).exec(text);
  if (fallback) return `${fallback[1]}.${fallback[2]}`;
  const bounded = new RegExp(`\\(\\s*([A-Za-z_$][\\w$]*)\\??\\.([A-Za-z_$][\\w$]*)\\s*,[^)]*\\b${name}\\b`).exec(text);
  if (bounded) return `${bounded[1]}.${bounded[2]}`;
  return undefined;
}

function formatReason(name, file, value) {
  if (file.startsWith("src/testing/")) return "test fixture";
  if (/^(?:IV|AUTH_TAG|SALT|DEK|TOKEN|THINKING_KEY)_BYTES$/.test(name)) return "cryptographic size";
  if (/_PER_MS$|SCHEDULING_MS$/.test(name)) return "measured calibration constant";
  if (/WEIGHTS$|PRIORS$|(?:^|_)DECAY$/.test(name)) return "scoring weight, not a limit";
  if ((/THRESHOLD$/.test(name) && value !== undefined && value < 1) || /^SINGLE_PASS_/.test(name))
    return "algorithm parameter, not a limit";
  if (/OVERHEAD_BYTES$/.test(name)) return "size-estimate constant";
  if (/^DEFAULT_|^HARD_|_HARD_/.test(name)) return undefined;
  if (/^[A-Z]+_CHUNK_BYTES$/.test(name)) return "I/O chunk size";
  if (/NAME(?:_CHARS|_BYTES|_LENGTH)?$|NAMES?_CHARS$|IDENTIFIER_BYTES$|REFERENCE_BYTES$/.test(name)) return "identifier length";
  if (/ERRORS?(?:_CHARS|_BYTES)?$/.test(name)) return "diagnostic message bound";
  if (
    /LENGTH|(?:^|_)DEPTH$|PROPERTIES|SCHEMA|VERSION|LEVELS|CHOICE_OPTIONS|SYSTEMONE_(?!BASE|MAX_DELAY)|KEY_BYTES|SNIFF|META_SCAN|_SEGMENT_CAP$/.test(
      name,
    )
  ) {
    return "wire or storage format invariant";
  }
  return undefined;
}

/** The seed entry for a constant the inventory does not list. */
export function seed({ name, file, init }, text = "") {
  const key = `${file}#${name}`;
  const entry = { name, file };
  const hint = hintFor(name, text);
  if (NOT_A_LIMIT.has(name) || !holdsNumber(init)) {
    return { ...entry, class: "format", reason: "not a limit" };
  }
  if (file === EVENT_SOURCE_FILE && hint) {
    return { ...entry, class: "ceiling", config: `createMemoryAgentEventSource({ ${hint.replace(/^\w+\./, "")} })` };
  }
  const value = defaultOf(init);
  const reason = formatReason(name, file, typeof value === "number" ? value : undefined);
  if (reason) return { ...entry, class: "format", reason };
  let cls = SEED_CLASS[key];
  if (!cls) {
    if (/^DEFAULT_/.test(name)) cls = "policy";
    else if (/(?:^|_)HARD(?:_|$)|_CAP$|^MAX_|^MIN_|_MAX_|_LIMITS$|_BYTES$/.test(name)) cls = "ceiling";
    else cls = "policy";
  }
  let config = SEED_CONFIG[key];
  if (!config && file === WORKFLOW_LIMITS_FILE && /^DEFAULT_MAX_/.test(name)) {
    config = `WorkflowDefinition.limits.${camel(name.slice("DEFAULT_".length))}`;
  }
  const out = { ...entry, class: cls };
  if (config) out.config = config;
  else {
    out.pending = `plan 239 Task ${bundleOf(file).task}`;
    if (hint) out.hint = hint;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------

export function readInventory(root = ROOT) {
  return JSON.parse(readFileSync(join(root, INVENTORY_FILE), "utf8"));
}

const keyOf = (entry) => `${entry.file}#${entry.name}`;

/** Every finding the gate reports. `strict` (the default since plan 239 Task 6) makes `pending` an error. */
export function check({ inventory = readInventory(), scanned = scan(), strict = true } = {}) {
  const errors = [];
  const listed = new Map(inventory.entries.map((entry) => [keyOf(entry), entry]));
  const found = new Map(scanned.entries.map((entry) => [keyOf(entry), entry]));
  for (const [key, entry] of found) {
    const row = listed.get(key);
    if (!row) {
      errors.push(`unlisted: ${entry.file} ${entry.name} (run bun scripts/limits-inventory.mjs --update, then review its class)`);
      continue;
    }
    const expected = defaultOf(entry.init);
    if (row.default !== expected)
      errors.push(`stale default: ${key} lists ${JSON.stringify(row.default)}, source has ${JSON.stringify(expected)}`);
  }
  for (const [key, row] of listed) {
    if (!found.has(key)) errors.push(`removed: ${key} no longer exists (run --update)`);
    if (!CLASSES.includes(row.class)) errors.push(`bad class: ${key} ${JSON.stringify(row.class)}`);
    if (row.class === "format") {
      if (typeof row.reason !== "string" || !row.reason) errors.push(`format entry needs a reason: ${key}`);
      if (row.config || row.pending) errors.push(`format entry carries config or pending: ${key}`);
      continue;
    }
    const hasConfig = typeof row.config === "string" && row.config.length > 0;
    const hasPending = typeof row.pending === "string" && PENDING.test(row.pending);
    if (row.pending !== undefined && !PENDING.test(row.pending)) errors.push(`bad pending: ${key} ${JSON.stringify(row.pending)}`);
    if (hasConfig && row.pending !== undefined) errors.push(`${row.class} entry has both config and pending: ${key}`);
    if (!hasConfig && !hasPending) errors.push(`${row.class} entry needs a config path or pending: ${key}`);
    if (strict && row.pending !== undefined) errors.push(`pending is not allowed: ${key}`);
  }
  for (const hit of scanned.fallbacks) {
    errors.push(`literal limit fallback: ${hit.file}:${hit.line} \`${hit.text}\` (move the number into a named constant)`);
  }
  return errors;
}

/** Rewrite the inventory: keep listed entries, add seeds for new constants, drop removed ones. */
export function update({ inventory, scanned = scan() } = {}) {
  const listed = new Map((inventory?.entries ?? []).map((entry) => [keyOf(entry), entry]));
  const entries = scanned.entries.map((entry) => {
    const row = listed.get(keyOf(entry)) ?? seed(entry, scanned.texts.get(entry.file));
    const { name, file, class: cls, ...rest } = row;
    delete rest.default;
    return { name, file, class: cls, default: defaultOf(entry.init), ...rest };
  });
  return {
    $comment:
      "Plan 239 Task 3: every limit constant in src/ and packages/. Generated rows are reviewed by hand; bun scripts/limits-inventory.mjs --update adds new constants and refreshes defaults. See scripts/limits-inventory.mjs.",
    entries,
  };
}

// ---------------------------------------------------------------------------------------------
// docs/limits.md

const MIB = 1024 * 1024;

function humanDefault(name, value) {
  if (typeof value !== "number") return `\`${value.replaceAll("|", "\\|")}\``;
  const plain = value.toLocaleString("en-US");
  if (/BYTES/.test(name) && value >= 1024) {
    if (value % MIB === 0) return `${plain} (${value / MIB} MiB)`;
    if (value % 1024 === 0) return `${plain} (${value / 1024} KiB)`;
  }
  if (/_MS$/.test(name) && value >= 1000) {
    if (value % 3_600_000 === 0) return `${plain} (${value / 3_600_000} h)`;
    if (value % 60_000 === 0) return `${plain} (${value / 60_000} min)`;
    if (value % 1000 === 0) return `${plain} (${value / 1000} s)`;
  }
  return plain;
}

function whereToSet(row) {
  if (row.class === "format") return `fixed: ${row.reason}`;
  const place = row.config ? `\`${row.config.replaceAll("|", "\\|")}\`` : "not configurable yet";
  return row.class === "ceiling" ? `${place} (host only)` : place;
}

export function renderDocs(inventory = readInventory()) {
  const rows = inventory.entries;
  const count = (cls) => rows.filter((row) => row.class === cls).length;
  const lines = [
    "# Limits",
    "",
    "Every limit Prism applies, its default, and where a host sets it. Generated by `bun scripts/limits-inventory.mjs --emit-docs` from `scripts/limits-inventory.json` — do not hand-edit.",
    "",
    "## Limit classes",
    "",
    "- **policy** bounds the work an agent does: turns, tool calls, tokens, time, page sizes, timeouts. The host configures it, Prism ships the default, and `null` disables it where the axis allows (see [agent.md](agent.md)).",
    "- **ceiling** protects the process: wire and storage bytes, queue depths, durable state. Only the host raises or lowers a ceiling, at `createAgent`, in package config, or on a factory the host constructs. A run, a package, a tool argument, or the model never raises one, and a value above a ceiling fails closed.",
    "- **format** is a structural invariant of a wire or storage format, such as an identifier length or schema depth, or a constant whose name looks like a limit but is not one. It stays fixed; the reason is listed.",
    "",
    `The inventory holds ${rows.length} constants: ${count("policy")} policy, ${count("ceiling")} ceiling, ${count("format")} format. "Not configurable yet" marks a policy or ceiling that has no host setting today; the constant's default applies.`,
    "",
    "A new limit constant in `src/` or `packages/` fails the inventory gate (`scripts/limits-inventory.test.mjs`) until it is listed with its class, as does a numeric fallback written inline (`options.maxBytes ?? 4096`).",
    "",
  ];
  for (const bundle of BUNDLES) {
    const inBundle = rows.filter((row) => bundleOf(row.file) === bundle);
    if (inBundle.length === 0) continue;
    const limits = inBundle.filter((row) => row.class !== "format");
    const formats = inBundle.filter((row) => row.class === "format");
    const order = (a, b) =>
      packageOf(a.file).localeCompare(packageOf(b.file)) || a.name.localeCompare(b.name) || a.file.localeCompare(b.file);
    lines.push(`## ${bundle.title ?? `\`${bundle.name}\``}`, "");
    lines.push(`${limits.length} policy and ceiling limits, ${formats.length} fixed.`, "");
    lines.push("| Package | Limit | Class | Default | Where to set it | Source |", "| --- | --- | --- | --- | --- | --- |");
    for (const row of limits.sort(order)) {
      lines.push(
        `| ${packageOf(row.file)} | \`${row.name}\` | ${row.class} | ${humanDefault(row.name, row.default)} | ${whereToSet(row)} | \`${row.file}\` |`,
      );
    }
    if (formats.length > 0) {
      lines.push("", "<details>", `<summary>Fixed constants (${formats.length})</summary>`, "");
      lines.push("| Package | Constant | Default | Why fixed | Source |", "| --- | --- | --- | --- | --- |");
      for (const row of formats.sort(order)) {
        lines.push(
          `| ${packageOf(row.file)} | \`${row.name}\` | ${humanDefault(row.name, row.default)} | ${row.reason} | \`${row.file}\` |`,
        );
      }
      lines.push("", "</details>");
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const started = performance.now();
  if (args.includes("--update")) {
    const current = existsSync(join(ROOT, INVENTORY_FILE)) ? readInventory() : undefined;
    const next = update({ inventory: current });
    writeFileSync(join(ROOT, INVENTORY_FILE), `${JSON.stringify(next, null, 2)}\n`);
    console.log(`${INVENTORY_FILE}: ${next.entries.length} entries`);
  }
  if (args.includes("--emit-docs")) {
    writeFileSync(join(ROOT, DOCS_FILE), renderDocs());
    console.log(`${DOCS_FILE} written`);
  }
  const errors = check();
  for (const error of errors) console.error(error);
  console.log(`limits inventory: ${errors.length} finding(s) in ${Math.round(performance.now() - started)} ms`);
  if (errors.length > 0) process.exit(1);
}
