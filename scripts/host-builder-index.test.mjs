// Plan 215 Task 14: the host-builder indexes are fresh, deterministic, built from live packages only, and
// refuse a secret-shaped example.

import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkHostBuilderBudget, loadBudgets } from "./budget-gates.mjs";
import { buildIndexes, checkIndexes, HostBuilderIndexError, writeIndexes } from "./host-builder-index.mjs";
import { packStats } from "./release-gates.mjs";

const ROOT = join(import.meta.dirname, "..");
const FIXTURE_VERSION = "9.9.9";

/** A one-package repository: a kernel with one export, one doc page, one example. */
function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "prism-host-builder-fixture-"));
  symlinkSync(join(ROOT, "node_modules"), join(root, "node_modules"));
  cpSync(join(ROOT, "tsconfig.packages.json"), join(root, "tsconfig.packages.json"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "@arnilo/prism", version: FIXTURE_VERSION, type: "module", exports: { ".": "./src/index.ts" } }),
  );
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify({ extends: "./tsconfig.packages.json", compilerOptions: { noEmit: true }, include: ["src"] }),
  );
  mkdirSync(join(root, "src"));
  writeFileSync(
    join(root, "src", "index.ts"),
    '/** Adds two numbers. */\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n\nexport class FixtureError extends Error {\n  constructor() {\n    super("fixture failed");\n  }\n}\n\nexport class SecondError extends Error {\n  readonly code = "ERR_PRISM_FIXTURE_SECOND";\n}\n',
  );
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "docs", "index.md"), "# Index\n\nCall `add(1, 2)` and see `ERR_PRISM_FIXTURE_SECOND`.\n");
  mkdirSync(join(root, "examples"));
  writeFileSync(join(root, "examples", "one.ts"), '/**\n * Adds.\n */\nimport { add } from "@arnilo/prism";\n\nconsole.log(add(1, 2));\n');
  return root;
}

describe("host-builder index", () => {
  test("host_builder_index_is_fresh: the committed data matches the tree", () => {
    const { stale } = checkIndexes({ root: ROOT });
    assert.deepEqual(stale, [], `run bun scripts/host-builder-index.mjs\n${stale.join("\n")}`);
  });

  test("host_builder_index_is_fresh: a fixture that adds an export without regenerating fails --check", () => {
    const root = makeFixture();
    try {
      const out = join(root, "data");
      writeIndexes({ root, out });
      assert.deepEqual(checkIndexes({ root, out }).stale, []);
      writeFileSync(join(root, "src", "index.ts"), `${readFileSync(join(root, "src", "index.ts"), "utf8")}\nexport const ADDED = 1;\n`);
      const { stale } = checkIndexes({ root, out });
      assert.ok(stale.includes("differs api.json"), stale.join("\n"));
      // an extra file under data/ is stale too
      writeIndexes({ root, out });
      writeFileSync(join(out, "stray.txt"), "x");
      assert.ok(checkIndexes({ root, out }).stale.includes("extra stray.txt"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("host_builder_index_deterministic: two runs are byte-identical", () => {
    const root = makeFixture();
    try {
      const first = buildIndexes({ root }).files;
      const second = buildIndexes({ root }).files;
      assert.deepEqual([...first.keys()], [...second.keys()]);
      for (const [path, text] of first) assert.equal(second.get(path), text, path);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the fixture index records names, docs, examples, error classes and a content hash", () => {
    const root = makeFixture();
    try {
      const { files } = buildIndexes({ root });
      const api = JSON.parse(files.get("api.json"));
      assert.equal(api.prismVersion, FIXTURE_VERSION);
      assert.match(api.contentHash, /^[0-9a-f]{64}$/);
      const add = api.packages[0].entries[0].exports.find((row) => row.name === "add");
      assert.equal(add.kind, "function");
      assert.equal(add.signature, "export declare function add(a: number, b: number): number");
      assert.equal(add.summary, "Adds two numbers.");
      assert.deepEqual(add.docs, ["node_modules/@arnilo/prism/docs/index.md"]);
      assert.deepEqual(add.examples, ["examples/one.ts"]);
      const errors = JSON.parse(files.get("errors.json")).codes;
      const second = errors.find((row) => row.code === "ERR_PRISM_FIXTURE_SECOND");
      assert.equal(second.errorClass, "SecondError");
      assert.deepEqual(second.docs, ["node_modules/@arnilo/prism/docs/index.md"]);
      const examples = JSON.parse(files.get("examples.json"));
      assert.equal(examples.examples[0].title, "Adds.");
      assert.equal(files.get("examples/one.ts").includes("add(1, 2)"), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("host_builder_index_rejects_secret_in_example: a key-shaped literal fails generation", () => {
    const root = makeFixture();
    try {
      writeFileSync(join(root, "examples", "leak.ts"), `export const key = "sk-${"a1B2c3D4".repeat(5)}";\n`);
      assert.throws(
        () => buildIndexes({ root }),
        (error) => error instanceof HostBuilderIndexError && /secret_shaped_literal: examples\/leak\.ts/.test(error.message),
      );
      // a readable demo sentinel is allowed: it is not key-shaped
      writeFileSync(join(root, "examples", "leak.ts"), 'export const key = "sk-live-never-persist-this";\n');
      assert.doesNotThrow(() => buildIndexes({ root }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the real index is built from live publishable packages and leaves out retired docs", () => {
    const api = JSON.parse(readFileSync(join(ROOT, "packages/hosts/host-builder/data/api.json"), "utf8"));
    const names = api.packages.map((pkg) => pkg.name);
    assert.ok(names.includes("@arnilo/prism"));
    assert.ok(names.includes("@arnilo/prism-host-builder"), "the package indexes itself");
    assert.equal(
      names.some((name) => /prism-(agent-sdk|code|core)$/.test(name)),
      false,
      "no retired package",
    );
    assert.equal(names.includes("@arnilo/prism-agent"), false, "the private reference host is not published");
    const text = JSON.stringify(api);
    assert.doesNotMatch(text, /docs\/history\/|migrate-to-0\.(5|6|7|8|9|11)\.md|docs\/migration\.md/);
    const kernel = api.packages.find((pkg) => pkg.name === "@arnilo/prism");
    assert.ok(kernel.entries.length >= 5, "kernel subpaths are recorded");
    assert.ok(kernel.entries.some((entry) => entry.subpath === "./testing"));
    assert.ok(existsSync(join(ROOT, "packages/hosts/host-builder/data/examples/define-package.ts")));
    assert.equal(existsSync(join(ROOT, "packages/hosts/host-builder/data/examples/fixtures")), false);
  });

  test("the host-builder tarball is inside its budget and the budget rejects growth", () => {
    const budget = loadBudgets().hostBuilder;
    const pack = packStats(ROOT, "packages/hosts/host-builder");
    assert.ok(pack.files.includes("data/api.json"), "the tarball carries the api index");
    assert.ok(pack.files.includes("bin/prism-host-builder.ts"));
    assert.equal(
      pack.files.some((file) => file.includes("__tests__")),
      false,
    );
    for (const check of checkHostBuilderBudget(budget, pack)) assert.ok(check.ok, check.message);
    const grown = checkHostBuilderBudget(budget, {
      packedBytes: Math.ceil(budget.packedBytes.baseline * (1 + budget.packedBytes.tolerance)) + 1,
      unpackedBytes: budget.unpackedBytes.baseline,
    });
    assert.ok(
      grown.some((check) => !check.ok && check.message.startsWith("host-builder packedBytes: measured ")),
      "growth names the metric",
    );
    assert.ok(
      checkHostBuilderBudget({}, pack).every((check) => !check.ok),
      "a missing budget fails closed",
    );
  });
});
