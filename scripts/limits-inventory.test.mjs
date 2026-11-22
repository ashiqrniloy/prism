// scripts/limits-inventory.test.mjs
// Plan 239 Task 3: the limit inventory gate and the freshness of docs/limits.md. Runs in `bun run test`.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { check, DOCS_FILE, ROOT, readInventory, renderDocs, scan, seed } from "./limits-inventory.mjs";

const inventory = readInventory();
const started = performance.now();
const scanned = scan();
const scanMs = performance.now() - started;

const clone = () => structuredClone(inventory);
/** The tree's scan plus fixture files scanned on their own. */
function withFixture(files) {
  const extra = scan({ files: new Map(Object.entries(files)), tree: false });
  return {
    entries: [...scanned.entries.filter((entry) => !(entry.file in files)), ...extra.entries],
    fallbacks: [...scanned.fallbacks, ...extra.fallbacks],
    texts: scanned.texts,
  };
}

describe("limit inventory", () => {
  test("inventory_matches_the_tree", () => {
    // Plan 239 Task 6: the gate is strict, so a `pending` row is an error.
    const errors = check({ inventory, scanned, strict: true });
    expect(errors, `fix the inventory (bun scripts/limits-inventory.mjs --update, then review):\n${errors.join("\n")}`).toEqual([]);
    expect(scanMs).toBeLessThan(2_000);
  });

  test("every_limit_constant_is_inventoried", () => {
    const errors = check({
      inventory,
      scanned: withFixture({ "src/limits-fixture.ts": "export const MAX_FOO = 1;\nconst BAR_TIMEOUT_MS = 5;\nconst NOT_ONE = 2;\n" }),
    });
    expect(errors).toContain(
      "unlisted: src/limits-fixture.ts MAX_FOO (run bun scripts/limits-inventory.mjs --update, then review its class)",
    );
    expect(errors.some((error) => error.includes("BAR_TIMEOUT_MS"))).toBe(true);
    expect(errors.some((error) => error.includes("NOT_ONE"))).toBe(false);
  });

  test("a_removed_constant_fails_until_dropped", () => {
    const row = inventory.entries.find((entry) => entry.name === "DEFAULT_CHILD_CEILINGS");
    const errors = check({ inventory, scanned: withFixture({ [row.file]: "export const OTHER = 1;\n" }) });
    expect(errors.some((error) => error.startsWith(`removed: ${row.file}#DEFAULT_CHILD_CEILINGS`))).toBe(true);
  });

  test("policy_or_ceiling_needs_a_config_path", () => {
    const next = clone();
    const policy = next.entries.find((entry) => entry.class === "policy" && entry.config);
    const ceiling = next.entries.find((entry) => entry.class === "ceiling" && entry.config);
    const format = next.entries.find((entry) => entry.class === "format");
    delete policy.config;
    delete ceiling.config;
    delete format.reason;
    const errors = check({ inventory: next, scanned });
    expect(errors).toContain(`policy entry needs a config path or pending: ${policy.file}#${policy.name}`);
    expect(errors).toContain(`ceiling entry needs a config path or pending: ${ceiling.file}#${ceiling.name}`);
    expect(errors).toContain(`format entry needs a reason: ${format.file}#${format.name}`);
  });

  test("pending_names_a_fixing_task_and_strict_mode_rejects_it", () => {
    const next = clone();
    const row = next.entries.find((entry) => entry.class === "policy" && entry.config);
    delete row.config;
    row.pending = "later";
    expect(check({ inventory: next, scanned, strict: false })).toContain(`bad pending: ${row.file}#${row.name} "later"`);
    row.pending = "plan 239 Task 6";
    expect(check({ inventory: next, scanned, strict: false })).toEqual([]);
    // Strict is the default: a seeded review marker fails until the row gets a config path or a format reason.
    expect(check({ inventory: next, scanned })).toEqual([`pending is not allowed: ${row.file}#${row.name}`]);
  });

  test("no_pending_limit_remains", () => {
    expect(inventory.entries.filter((entry) => entry.pending !== undefined).map((entry) => `${entry.file}#${entry.name}`)).toEqual([]);
  });

  test("a_stale_default_fails", () => {
    const next = clone();
    const row = next.entries.find((entry) => entry.name === "DEFAULT_MAX_CONTINUATIONS");
    row.default = 99;
    expect(check({ inventory: next, scanned })).toContain(`stale default: ${row.file}#${row.name} lists 99, source has 3`);
  });

  test("a_literal_limit_fallback_fails", () => {
    const errors = check({
      inventory,
      scanned: withFixture({
        "packages/tools/web/src/fallback-fixture.ts":
          "const a = options.maxBytes ?? 4096;\nconst b = event.attempt ?? 2;\nconst c = usage.inputTokens ?? 0;\n",
      }),
    });
    expect(errors).toEqual([
      "literal limit fallback: packages/tools/web/src/fallback-fixture.ts:1 `maxBytes ?? 4096` (move the number into a named constant)",
    ]);
  });

  test("seed_classifies_by_role", () => {
    const ceiling = seed({ name: "HARD_MAX_FOO_BYTES", file: "packages/extensions/x/src/a.ts", init: " 1024" });
    expect(ceiling).toEqual({
      name: "HARD_MAX_FOO_BYTES",
      file: "packages/extensions/x/src/a.ts",
      class: "ceiling",
      pending: "plan 239 Task 5",
    });
    const policy = seed({ name: "DEFAULT_MAX_FOO", file: "src/foo.ts", init: " 8" }, "const v = options.maxFoo ?? DEFAULT_MAX_FOO;");
    expect(policy).toEqual({
      name: "DEFAULT_MAX_FOO",
      file: "src/foo.ts",
      class: "policy",
      pending: "plan 239 Task 4",
      hint: "options.maxFoo",
    });
    expect(seed({ name: "DEFAULT_TOOL_NAME", file: "src/foo.ts", init: ' "prompt"' }).reason).toBe("not a limit");
    expect(seed({ name: "MAX_KEY_LENGTH", file: "src/foo.ts", init: " 128" }).class).toBe("format");
  });

  test("limits_page_is_fresh", () => {
    const page = readFileSync(join(ROOT, DOCS_FILE), "utf8");
    expect(page === renderDocs(inventory), "docs/limits.md is stale; run bun scripts/limits-inventory.mjs --emit-docs").toBe(true);
    expect(page).toContain("| core | `HARD_RUN_LIMITS` | ceiling |");
    // Plan 239 Tasks 4–6: every ceiling names its host path; no row reads "not configurable yet".
    expect(page).toMatch(/`HARD_RUN_LIMITS` \| ceiling \| [^|]+\| `AgentConfig\.ceilings\.maxRequestBytes [^|]+\(host only\)/);
    expect(page).toMatch(
      /`DEFAULT_CHILD_CEILINGS` \| ceiling \| [^|]+\| `packageConfig\["@arnilo\/prism-extensions\/delegate"\]\.ceilings[^|]+\(host only\)/,
    );
    expect(page).toMatch(
      /`DEFAULT_MAX_SOURCE_FILES` \| ceiling \| [^|]+\| `packageConfig\["@arnilo\/prism-knowledge\/rag"\]\.sources\[\]\.maxFiles` \(host only\)/,
    );
    expect(page).not.toContain("not configurable yet");
  });
});
