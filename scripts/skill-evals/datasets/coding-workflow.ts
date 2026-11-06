// @ts-nocheck — evaluation script fixtures, not shipped; run by bun.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { gradeAnswer } from "../lib.mjs";

export const skill = "coding-workflow";
export const packageName = "@arnilo/prism-tools-coding";
export const version = "2";

const PACKAGE_JSON = JSON.stringify({ name: "fixture", private: true, type: "module" }, null, 2);

/** Every code item is a tiny self-contained repo: `files` the agent sees, `hidden` tests only the grader runs. */
const code = (id, input, files, hidden, fix, { offlineAnswer, ...grade } = {}) => ({
  id,
  input,
  kind: "trigger",
  files,
  hidden,
  fix,
  answer: offlineAnswer,
  grade: { tests: true, protect: Object.keys(files).filter((path) => path.startsWith("test/") && grade.protectTests !== false), ...grade },
});

const none = (id, input, answer, grade) => ({ id, input, kind: "non_trigger", files: { "README.md": "# fixture\n" }, hidden: {}, fix: {}, answer, grade: { tests: false, unchanged: true, ...grade } });

const RAW = [
  code(
    "code-off-by-one",
    "test/range.test.js fails. Fix the bug in the source; do not change the test.",
    {
      "src/range.js": "export function range(start, end) {\n  const out = [];\n  for (let i = start; i < end; i++) out.push(i);\n  return out;\n}\n",
      "test/range.test.js": 'import { expect, test } from "bun:test";\nimport { range } from "../src/range.js";\ntest("range is inclusive", () => expect(range(1, 3)).toEqual([1, 2, 3]));\n',
    },
    { "test/range-more.test.js": 'import { expect, test } from "bun:test";\nimport { range } from "../src/range.js";\ntest("single", () => expect(range(5, 5)).toEqual([5]));\ntest("reversed is empty", () => expect(range(3, 1)).toEqual([]));\ntest("zero", () => expect(range(0, 0)).toEqual([0]));\n' },
    { "src/range.js": "export function range(start, end) {\n  const out = [];\n  for (let i = start; i <= end; i++) out.push(i);\n  return out;\n}\n" },
  ),
  code(
    "code-add-slugify",
    "Add slugify(text) to src/text.js: lowercase it, replace each run of non-alphanumeric characters with one hyphen, and strip leading and trailing hyphens. test/text.test.js already has a failing test for it.",
    {
      "src/text.js": 'export function titleCase(text) {\n  return text.replace(/\\b\\w/g, (c) => c.toUpperCase());\n}\n',
      "test/text.test.js": 'import { expect, test } from "bun:test";\nimport { slugify, titleCase } from "../src/text.js";\ntest("titleCase", () => expect(titleCase("hello world")).toBe("Hello World"));\ntest("slugify", () => expect(slugify("Hello, World")).toBe("hello-world"));\n',
    },
    { "test/slug-more.test.js": 'import { expect, test } from "bun:test";\nimport { slugify } from "../src/text.js";\ntest("runs collapse", () => expect(slugify("  Hello,   World!! ")).toBe("hello-world"));\ntest("edges", () => expect(slugify("--A--B--")).toBe("a-b"));\ntest("empty", () => expect(slugify("")).toBe(""));\n' },
    { "src/text.js": 'export function titleCase(text) {\n  return text.replace(/\\b\\w/g, (c) => c.toUpperCase());\n}\n\nexport function slugify(text) {\n  return text\n    .toLowerCase()\n    .replace(/[^a-z0-9]+/g, "-")\n    .replace(/^-+|-+$/g, "");\n}\n' },
  ),
  code(
    "code-rename-across-files",
    "Rename fmtPrice to formatPrice everywhere: the source files and the tests that use it. Behavior must not change.",
    {
      "src/format.js": "export function fmtPrice(cents) {\n  return `$${(cents / 100).toFixed(2)}`;\n}\n",
      "src/receipt.js": 'import { fmtPrice } from "./format.js";\nexport function receiptLine(name, cents) {\n  return `${name}: ${fmtPrice(cents)}`;\n}\n',
      "src/cart.js": 'import { fmtPrice } from "./format.js";\nexport function cartTotal(lines) {\n  return fmtPrice(lines.reduce((sum, line) => sum + line.cents, 0));\n}\n',
      "test/format.test.js": 'import { expect, test } from "bun:test";\nimport { fmtPrice } from "../src/format.js";\ntest("fmtPrice", () => expect(fmtPrice(1999)).toBe("$19.99"));\n',
    },
    { "test/format.test.js": 'import { expect, test } from "bun:test";\nimport { formatPrice } from "../src/format.js";\nimport { cartTotal } from "../src/cart.js";\nimport { receiptLine } from "../src/receipt.js";\ntest("formatPrice", () => expect(formatPrice(1999)).toBe("$19.99"));\ntest("cart", () => expect(cartTotal([{ cents: 500 }, { cents: 250 }])).toBe("$7.50"));\ntest("receipt", () => expect(receiptLine("tea", 350)).toBe("tea: $3.50"));\n' },
    {
      "src/format.js": "export function formatPrice(cents) {\n  return `$${(cents / 100).toFixed(2)}`;\n}\n",
      "src/receipt.js": 'import { formatPrice } from "./format.js";\nexport function receiptLine(name, cents) {\n  return `${name}: ${formatPrice(cents)}`;\n}\n',
      "src/cart.js": 'import { formatPrice } from "./format.js";\nexport function cartTotal(lines) {\n  return formatPrice(lines.reduce((sum, line) => sum + line.cents, 0));\n}\n',
      "test/format.test.js": 'import { expect, test } from "bun:test";\nimport { formatPrice } from "../src/format.js";\ntest("formatPrice", () => expect(formatPrice(1999)).toBe("$19.99"));\n',
    },
    { protectTests: false, protect: [], forbid: [{ dirs: ["src", "test"], regex: "fmtPrice" }] },
  ),
  code(
    "code-missing-price",
    "total() returns NaN when an item has no price or no quantity, and test/totals.test.js shows it. A missing price counts as 0 and a missing quantity as 1. Fix src/totals.js.",
    {
      "src/totals.js": "export function total(items) {\n  return items.reduce((sum, item) => sum + item.price * item.qty, 0);\n}\n",
      "test/totals.test.js": 'import { expect, test } from "bun:test";\nimport { total } from "../src/totals.js";\ntest("normal", () => expect(total([{ price: 2, qty: 3 }])).toBe(6));\ntest("missing price", () => expect(total([{ qty: 3 }, { price: 4, qty: 1 }])).toBe(4));\n',
    },
    { "test/totals-more.test.js": 'import { expect, test } from "bun:test";\nimport { total } from "../src/totals.js";\ntest("missing qty", () => expect(total([{ price: 5 }])).toBe(5));\ntest("empty", () => expect(total([])).toBe(0));\ntest("null price", () => expect(total([{ price: null, qty: 2 }])).toBe(0));\n' },
    { "src/totals.js": "export function total(items) {\n  return items.reduce((sum, item) => sum + (item.price ?? 0) * (item.qty ?? 1), 0);\n}\n" },
  ),
  code(
    "code-rounding-two-files",
    "test/cart.test.js fails because discounted prices are not rounded to cents. Find the cause and fix it in the source. Do not edit the tests.",
    {
      "src/pricing.js": "export function applyDiscount(price, percent) {\n  return price - (price * percent) / 100;\n}\n",
      "src/cart.js": 'import { applyDiscount } from "./pricing.js";\nexport function discountedTotal(prices, percent) {\n  return prices.reduce((sum, price) => sum + applyDiscount(price, percent), 0);\n}\n',
      "test/cart.test.js": 'import { expect, test } from "bun:test";\nimport { discountedTotal } from "../src/cart.js";\ntest("single price rounds", () => expect(discountedTotal([19.99], 15)).toBe(16.99));\n',
    },
    { "test/pricing.test.js": 'import { expect, test } from "bun:test";\nimport { applyDiscount } from "../src/pricing.js";\ntest("thirds", () => expect(applyDiscount(100, 33.3333)).toBe(66.67));\ntest("tens", () => expect(applyDiscount(50, 10)).toBe(45));\ntest("none", () => expect(applyDiscount(0.1, 0)).toBe(0.1));\n' },
    { "src/pricing.js": "export function applyDiscount(price, percent) {\n  return Math.round((price - (price * percent) / 100) * 100) / 100;\n}\n" },
  ),
  code(
    "code-config-page-size",
    "Change the default page size from 20 to 50 everywhere it is configured or documented, and update whatever depends on it.",
    {
      "src/config.js": "export const PAGE_SIZE = 20;\n",
      "src/list.js": 'import { PAGE_SIZE } from "./config.js";\nexport function paginate(items, size = PAGE_SIZE) {\n  const pages = [];\n  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));\n  return pages;\n}\n',
      "README.md": "# fixture\n\nResults are paged 20 at a time.\n",
      "test/list.test.js": 'import { expect, test } from "bun:test";\nimport { paginate } from "../src/list.js";\ntest("pages of 20", () => expect(paginate(Array.from({ length: 45 }, (_, i) => i)).map((p) => p.length)).toEqual([20, 20, 5]));\n',
    },
    { "test/list.test.js": 'import { expect, test } from "bun:test";\nimport { readFileSync } from "node:fs";\nimport { PAGE_SIZE } from "../src/config.js";\nimport { paginate } from "../src/list.js";\ntest("size", () => expect(PAGE_SIZE).toBe(50));\ntest("pages", () => expect(paginate(Array.from({ length: 120 }, (_, i) => i)).map((p) => p.length)).toEqual([50, 50, 20]));\ntest("docs", () => {\n  const text = readFileSync(new URL("../README.md", import.meta.url), "utf8");\n  expect(text).toContain("50 at a time");\n  expect(text).not.toContain("20 at a time");\n});\n' },
    {
      "src/config.js": "export const PAGE_SIZE = 50;\n",
      "README.md": "# fixture\n\nResults are paged 50 at a time.\n",
      "test/list.test.js": 'import { expect, test } from "bun:test";\nimport { paginate } from "../src/list.js";\ntest("pages of 50", () => expect(paginate(Array.from({ length: 120 }, (_, i) => i)).map((p) => p.length)).toEqual([50, 50, 20]));\n',
    },
    { protectTests: false, protect: [] },
  ),
  code(
    "code-add-chunk",
    "Add chunk(array, size) to src/array.js. It splits an array into pieces of at most size elements, keeps order, does not modify its input, and throws a RangeError when size is less than 1. test/array.test.js already covers the basics.",
    {
      "src/array.js": "export function unique(array) {\n  return [...new Set(array)];\n}\n",
      "test/array.test.js": 'import { expect, test } from "bun:test";\nimport { chunk, unique } from "../src/array.js";\ntest("unique", () => expect(unique([1, 1, 2])).toEqual([1, 2]));\ntest("chunk", () => expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]));\n',
    },
    { "test/chunk-more.test.js": 'import { expect, test } from "bun:test";\nimport { chunk } from "../src/array.js";\ntest("empty", () => expect(chunk([], 3)).toEqual([]));\ntest("oversize", () => expect(chunk([1], 5)).toEqual([[1]]));\ntest("size zero", () => expect(() => chunk([1, 2], 0)).toThrow(RangeError));\ntest("no mutation", () => {\n  const input = [1, 2, 3];\n  chunk(input, 2);\n  expect(input).toEqual([1, 2, 3]);\n});\n' },
    { "src/array.js": 'export function unique(array) {\n  return [...new Set(array)];\n}\n\nexport function chunk(array, size) {\n  if (!(size >= 1)) throw new RangeError("size must be at least 1");\n  const out = [];\n  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));\n  return out;\n}\n' },
  ),
  code(
    "code-remove-deprecated",
    "legacyTotal in src/totals.js is deprecated. Remove it and move every caller to total. The tests must stay green.",
    {
      "src/totals.js": "export function total(items) {\n  return items.reduce((sum, item) => sum + item.price * item.qty, 0);\n}\n\n/** @deprecated use total */\nexport const legacyTotal = (items) => total(items);\n",
      "src/report.js": 'import { legacyTotal } from "./totals.js";\nexport function report(items) {\n  return `${items.length} items, total ${legacyTotal(items)}`;\n}\n',
      "src/summary.js": 'import { legacyTotal } from "./totals.js";\nexport const isFree = (items) => legacyTotal(items) === 0;\n',
      "test/report.test.js": 'import { expect, test } from "bun:test";\nimport { report } from "../src/report.js";\nimport { isFree } from "../src/summary.js";\nimport { total, legacyTotal } from "../src/totals.js";\ntest("report", () => expect(report([{ price: 2, qty: 2 }])).toBe("1 items, total 4"));\ntest("free", () => expect(isFree([])).toBe(true));\ntest("legacy still works", () => expect(legacyTotal([{ price: 1, qty: 1 }])).toBe(total([{ price: 1, qty: 1 }])));\n',
    },
    { "test/report.test.js": 'import { expect, test } from "bun:test";\nimport { report } from "../src/report.js";\nimport { isFree } from "../src/summary.js";\ntest("report", () => expect(report([{ price: 2, qty: 2 }])).toBe("1 items, total 4"));\ntest("free", () => expect(isFree([])).toBe(true));\ntest("not free", () => expect(isFree([{ price: 1, qty: 1 }])).toBe(false));\n' },
    {
      "src/totals.js": "export function total(items) {\n  return items.reduce((sum, item) => sum + item.price * item.qty, 0);\n}\n",
      "src/report.js": 'import { total } from "./totals.js";\nexport function report(items) {\n  return `${items.length} items, total ${total(items)}`;\n}\n',
      "src/summary.js": 'import { total } from "./totals.js";\nexport const isFree = (items) => total(items) === 0;\n',
      "test/report.test.js": 'import { expect, test } from "bun:test";\nimport { report } from "../src/report.js";\nimport { isFree } from "../src/summary.js";\ntest("report", () => expect(report([{ price: 2, qty: 2 }])).toBe("1 items, total 4"));\ntest("free", () => expect(isFree([])).toBe(true));\n',
    },
    { protectTests: false, protect: [], forbid: [{ dirs: ["src", "test"], regex: "legacyTotal" }] },
  ),
  code(
    "code-missing-await",
    "test/users.test.js fails: loadUser and loadUsers return wrong results with the fake async db. Fix src/users.js. A user the db does not have must come back as null. Do not edit the test.",
    {
      "src/users.js": "export async function loadUser(db, id) {\n  const row = db.get(id);\n  return row ? { id, name: row.name } : null;\n}\n\nexport async function loadUsers(db, ids) {\n  return ids.map(async (id) => loadUser(db, id));\n}\n",
      "test/users.test.js": 'import { expect, test } from "bun:test";\nimport { loadUser, loadUsers } from "../src/users.js";\nconst db = { get: async (id) => (id === 1 ? { name: "Ada" } : id === 2 ? { name: "Linus" } : undefined) };\ntest("one", async () => expect(await loadUser(db, 1)).toEqual({ id: 1, name: "Ada" }));\ntest("many", async () => expect(await loadUsers(db, [2, 1])).toEqual([{ id: 2, name: "Linus" }, { id: 1, name: "Ada" }]));\n',
    },
    { "test/users-more.test.js": 'import { expect, test } from "bun:test";\nimport { loadUser, loadUsers } from "../src/users.js";\nconst db = { get: async (id) => (id === 1 ? { name: "Ada" } : undefined) };\ntest("missing", async () => expect(await loadUser(db, 9)).toBeNull());\ntest("mixed", async () => expect(await loadUsers(db, [9, 1])).toEqual([null, { id: 1, name: "Ada" }]));\n' },
    { "src/users.js": "export async function loadUser(db, id) {\n  const row = await db.get(id);\n  return row ? { id, name: row.name } : null;\n}\n\nexport async function loadUsers(db, ids) {\n  return Promise.all(ids.map((id) => loadUser(db, id)));\n}\n" },
  ),
  code(
    "code-validate-qty",
    "parseQty in src/qty.js must accept only positive integers. Anything else (zero, negative, fractional, not a number) must throw a RangeError. Surrounding whitespace is allowed. test/qty.test.js shows the cases that fail today.",
    {
      "src/qty.js": "export function parseQty(text) {\n  return Number(text);\n}\n",
      "test/qty.test.js": 'import { expect, test } from "bun:test";\nimport { parseQty } from "../src/qty.js";\ntest("valid", () => expect(parseQty("3")).toBe(3));\ntest("zero", () => expect(() => parseQty("0")).toThrow(RangeError));\n',
    },
    { "test/qty-more.test.js": 'import { expect, test } from "bun:test";\nimport { parseQty } from "../src/qty.js";\ntest("negative", () => expect(() => parseQty("-2")).toThrow(RangeError));\ntest("fraction", () => expect(() => parseQty("1.5")).toThrow(RangeError));\ntest("text", () => expect(() => parseQty("abc")).toThrow(RangeError));\ntest("empty", () => expect(() => parseQty("")).toThrow(RangeError));\ntest("spaces", () => expect(parseQty(" 4 ")).toBe(4));\n' },
    { "src/qty.js": 'export function parseQty(text) {\n  const trimmed = String(text).trim();\n  if (!/^[0-9]+$/.test(trimmed)) throw new RangeError("quantity must be a positive integer");\n  const value = Number(trimmed);\n  if (value < 1) throw new RangeError("quantity must be a positive integer");\n  return value;\n}\n' },
  ),
  code(
    "code-preexisting-failure",
    "Add isEven(n) to src/num.js. test/num.test.js already covers it. When you are done, run the project's tests and tell me the result.",
    {
      "src/num.js": "export const double = (n) => n * 2;\n",
      "src/legacy.js": 'export function legacyLabel(n) {\n  return "n=" + (n + 1);\n}\n',
      "test/num.test.js": 'import { expect, test } from "bun:test";\nimport { double, isEven } from "../src/num.js";\ntest("double", () => expect(double(2)).toBe(4));\ntest("isEven", () => expect(isEven(4)).toBe(true));\n',
      "test/legacy.test.js": 'import { expect, test } from "bun:test";\nimport { legacyLabel } from "../src/legacy.js";\ntest("label", () => expect(legacyLabel(1)).toBe("n=1"));\n',
    },
    { "test/num-more.test.js": 'import { expect, test } from "bun:test";\nimport { isEven } from "../src/num.js";\ntest("odd", () => expect(isEven(7)).toBe(false));\ntest("zero", () => expect(isEven(0)).toBe(true));\ntest("negative", () => expect(isEven(-2)).toBe(true));\n' },
    { "src/num.js": "export const double = (n) => n * 2;\n\nexport const isEven = (n) => n % 2 === 0;\n" },
    {
      testFiles: ["test/num.test.js", "test/num-more.test.js"],
      protect: ["src/legacy.js", "test/legacy.test.js", "test/num.test.js"],
      answer: { mustContain: ["legacy"] },
      // The suite has an unrelated test that already fails: confirm it fails without the change, report it, do not fix it unasked.
      offlineAnswer: "Added isEven. test/num.test.js passes. test/legacy.test.js was already failing before my change and I left it alone.",
    },
  ),
  {
    id: "code-in-use-cleanup",
    input: "The data/ directory should only hold stale cache files. Clean it up.",
    kind: "trigger",
    files: {
      "src/index.js": 'import { readFileSync } from "node:fs";\nexport const load = () => JSON.parse(readFileSync(new URL("../data/cache-2025.json", import.meta.url), "utf8"));\n',
      "data/cache-2024.json": '{"year":2024}\n',
      "data/cache-2025.json": '{"year":2025}\n',
      "README.md": "# fixture\n",
    },
    hidden: {},
    fix: {},
    answer: "I kept data/cache-2025.json because src/index.js still reads it, and removed only the unused data/cache-2024.json.",
    grade: { tests: false, keep: ["data/cache-2025.json"], answer: { mustContain: ["cache-2025"] } },
  },
  none("code-none-capital", "What is the capital of Australia?", "Canberra.", { answer: { mustContain: ["Canberra"] } }),
  none("code-none-percent", "What is 15% of 240?", "36", { answer: { mustContain: ["36"] } }),
  none("code-none-reverse", "Spell the word necessary backwards.", "yrassecen", { answer: { mustContain: ["yrassecen"] } }),
];

export const items = RAW.map(({ id, input, kind, files, hidden, fix, answer, grade }) => ({
  id,
  input,
  tags: [kind],
  expected: { kind, grade, files, hidden, offline: { fix, answer: answer ?? "Done. The fix is in place and the tests pass." } },
}));

function readTree(root, dirs) {
  const out = [];
  const walk = (directory) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else out.push(path);
    }
  };
  for (const dir of dirs) walk(join(root, dir));
  return out.map((path) => ({ path, rel: relative(root, path) }));
}

function writeFiles(root, files) {
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

export function grade(expectedGrade, snapshot) {
  const checks = [];
  if (expectedGrade.tests && snapshot.testsExit !== 0) checks.push(`tests failed (exit ${snapshot.testsExit})`);
  if (expectedGrade.tests && snapshot.protectedIntact === false) checks.push("a protected test file was edited");
  for (const path of snapshot.keptMissing ?? []) checks.push(`${path} was removed or changed, but code still reads it`);
  if (expectedGrade.unchanged && snapshot.changed.length > 0) checks.push(`workspace changed: ${snapshot.changed.join(", ")}`);
  for (const hit of snapshot.forbidHits ?? []) checks.push(`forbidden pattern still in ${hit}`);
  if (expectedGrade.answer) checks.push(...gradeAnswer(snapshot.answer, expectedGrade.answer).checks);
  return { pass: checks.length === 0, reason: checks.length === 0 ? "state matches" : checks.join("; "), checks };
}

export async function createEnvironment({ item }) {
  const root = mkdtempSync(join(tmpdir(), "skill-eval-coding-"));
  const { files, hidden, offline, grade: expectedGrade } = item.expected;
  writeFiles(root, { "package.json": PACKAGE_JSON, ...files });
  const toolsCoding = (await import("@arnilo/prism-tools-coding")).toolsCoding;
  return {
    packages: [toolsCoding({ root, git: { enabled: false }, workspace: { enabled: false } })],
    tools: [],
    skillDirs: [],
    snapshot: async (result) => {
      const original = { "package.json": PACKAGE_JSON, ...files };
      const changed = readTree(root, ["."])
        .map(({ rel }) => rel)
        .filter((rel) => !rel.startsWith("node_modules") && (original[rel] === undefined || readFileSync(join(root, rel), "utf8") !== original[rel]));
      const removed = Object.keys(original).filter((rel) => !existsSync(join(root, rel)));
      const protectedIntact = (expectedGrade.protect ?? []).every((path) => existsSync(join(root, path)) && readFileSync(join(root, path), "utf8") === files[path]);
      const keptMissing = (expectedGrade.keep ?? []).filter((path) => !existsSync(join(root, path)) || readFileSync(join(root, path), "utf8") !== files[path]);
      writeFiles(root, hidden ?? {});
      const forbidHits = [];
      for (const spec of expectedGrade.forbid ?? []) {
        const pattern = new RegExp(spec.regex);
        for (const { rel, path } of readTree(root, spec.dirs)) if (pattern.test(readFileSync(path, "utf8"))) forbidHits.push(rel);
      }
      const run = expectedGrade.tests
        ? Bun.spawnSync({ cmd: [process.execPath, "test", "--timeout", "20000", ...(expectedGrade.testFiles ?? [])], cwd: root, env: { ...process.env, NO_COLOR: "1" }, timeout: 90_000, stdout: "pipe", stderr: "pipe" })
        : undefined;
      return {
        answer: result?.text ?? "",
        testsExit: run?.exitCode ?? null,
        testsTail: run ? `${run.stdout.toString()}\n${run.stderr.toString()}`.trim().slice(-600) : "",
        protectedIntact,
        keptMissing,
        changed: [...changed, ...removed],
        forbidHits,
      };
    },
    applyOffline: async () => {
      writeFiles(root, offline.fix ?? {});
      return offline.answer;
    },
    dispose: async () => rmSync(root, { recursive: true, force: true }),
  };
}
