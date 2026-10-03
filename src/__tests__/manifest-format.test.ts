import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertJsonSchemaSupported, validateJsonSchema, type JsonSchema } from "../packages/schema.js";
import { ManifestError, MANIFEST_V1_SCHEMA, mergeManifestScopes, parseManifest } from "../manifest/index.js";

const HASH = (c: string) => `sha512-${c.repeat(86)}==`;
const user = { scope: "user", path: "/home/u/.prism/packages.json" } as const;
const project = { scope: "project", path: "/repo/.prism/packages.json" } as const;

const entry = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  version: "^1.0.0",
  integrity: HASH("A"),
  capabilities: [],
  ...extra,
});

const FIXTURES: readonly unknown[] = [
  { version: 1, packages: [] },
  {
    version: 1,
    packages: [entry("@arnilo/prism-approval", { config: { mode: "ask" } }), entry("plain-pkg", { enabled: false, optional: true })],
  },
  { version: 1, packages: [entry("@a/store", { capabilities: ["slot:store", "host-ui"] })], slots: { store: "@a/store" } },
];

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof ManifestError, String(error));
    return error.code;
  }
  assert.fail("expected a ManifestError");
}

function errorOf(run: () => unknown): ManifestError {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof ManifestError);
    return error;
  }
  return assert.fail("expected a ManifestError");
}

describe("manifest format v1", () => {
  it("manifest_v1_fixture_validates_through_schema_file_and_kernel_validator", () => {
    // The published file is what `scripts/emit-manifest-schema.mjs` writes at build; run it into a temp dir.
    const out = join(mkdtempSync(join(tmpdir(), "prism-manifest-schema-")), "packages.v1.schema.json");
    const emit = spawnSync("bun", ["scripts/emit-manifest-schema.mjs", out]);
    assert.equal(emit.status, 0, emit.stderr.toString());
    const { $schema, ...fileSchema } = JSON.parse(readFileSync(out, "utf8")) as JsonSchema & { $schema: string };
    assert.equal(typeof $schema, "string");
    assert.deepEqual(fileSchema, JSON.parse(JSON.stringify(MANIFEST_V1_SCHEMA)), "schema file must equal the kernel schema");
    assertJsonSchemaSupported(fileSchema);
    for (const fixture of FIXTURES) {
      assert.equal(validateJsonSchema(fileSchema, fixture).ok, true);
      assert.equal(validateJsonSchema(MANIFEST_V1_SCHEMA, fixture).ok, true);
      assert.deepEqual(parseManifest(fixture, user), fixture);
    }
    const bad = { version: 1, packages: [{ name: "Bad Name" }] };
    assert.equal(validateJsonSchema(fileSchema, bad).ok, false);
    assert.equal(validateJsonSchema(MANIFEST_V1_SCHEMA, bad).ok, false);
  });

  it("unknown_field_fails_closed_naming_scope_and_path", () => {
    const top = errorOf(() => parseManifest({ version: 1, packages: [], extra: 1 }, user));
    assert.equal(top.code, "manifest_unknown_field");
    assert.match(top.message, /user/);
    assert.match(top.message, /\.prism\/packages\.json/);
    assert.match(top.message, /extra/);
    const nested = errorOf(() => parseManifest({ version: 1, packages: [entry("a", { surprise: true })] }, project));
    assert.equal(nested.code, "manifest_unknown_field");
    assert.equal(nested.scope, "project");
    assert.match(nested.message, /\/packages\/0 unknown key "surprise"/);
  });

  it("unsupported_version_fails_closed", () => {
    for (const version of [2, "1", undefined])
      assert.equal(
        codeOf(() => parseManifest({ version, packages: [] }, user)),
        "manifest_version",
      );
    assert.equal(
      codeOf(() => parseManifest([], user)),
      "manifest_invalid",
    );
  });

  it("duplicate_name_in_one_scope_fails_closed", () => {
    assert.equal(
      codeOf(() => parseManifest({ version: 1, packages: [entry("a"), entry("a")] }, user)),
      "manifest_duplicate",
    );
  });

  it("malformed_name_range_integrity_or_partial_entry_fails_closed", () => {
    const invalid = (packages: unknown[], opts: { scope: "user" | "project"; path: string } = user) =>
      codeOf(() => parseManifest({ version: 1, packages }, opts));
    assert.equal(invalid([entry("Bad Name")]), "manifest_invalid");
    assert.equal(invalid([entry("a", { version: "not a range" })]), "manifest_invalid");
    assert.equal(invalid([entry("a", { integrity: "sha512-short" })]), "manifest_invalid");
    assert.equal(invalid([entry("a", { capabilities: ["root"] })]), "manifest_invalid");
    assert.equal(invalid([{ name: "a", version: "^1.0.0" }], project), "manifest_invalid");
    assert.equal(invalid([{ name: "a", enabled: false }], user), "manifest_invalid");
    assert.equal(invalid([entry("a", { config: "text" })]), "manifest_invalid");
    // A project override without the install trio is legal.
    assert.doesNotThrow(() => parseManifest({ version: 1, packages: [{ name: "a", enabled: false }] }, project));
  });

  it("project_entry_overrides_user_version_config_and_enabled", () => {
    const merged = mergeManifestScopes({
      user: parseManifest(
        { version: 1, packages: [entry("a", { config: { root: ".", nested: { keep: 1, over: 1 } }, optional: true })] },
        user,
      ),
      project: parseManifest(
        {
          version: 1,
          packages: [
            { name: "a", enabled: false, config: { nested: { over: 2 } } },
            entry("b", { version: "^2.0.0", integrity: HASH("B") }),
          ],
        },
        project,
      ),
    });
    const a = merged.packages[0]!;
    assert.deepEqual(a.config, { root: ".", nested: { keep: 1, over: 2 } });
    assert.equal(a.enabled, false);
    assert.equal(a.optional, true);
    assert.equal(a.scope, "user");
    assert.equal(a.integrity, HASH("A"));

    const bumped = mergeManifestScopes({
      user: parseManifest({ version: 1, packages: [entry("a")] }, user),
      project: parseManifest({ version: 1, packages: [entry("a", { version: "^3.0.0", integrity: HASH("C") })] }, project),
    }).packages[0]!;
    assert.equal(bumped.version, "^3.0.0");
    assert.equal(bumped.integrity, HASH("C"));
    assert.equal(bumped.scope, "project");
  });

  it("merge_keeps_user_order_then_project_only_entries", () => {
    const merged = mergeManifestScopes({
      user: parseManifest({ version: 1, packages: [entry("u1"), entry("u2")] }, user),
      project: parseManifest({ version: 1, packages: [entry("p1"), { name: "u1", optional: true }, entry("p2")] }, project),
    });
    assert.deepEqual(
      merged.packages.map((p) => p.name),
      ["u1", "u2", "p1", "p2"],
    );
    assert.equal(merged.packages[2]!.scope, "project");
  });

  it("project_override_of_unlisted_package_fails_closed", () => {
    const project1 = parseManifest({ version: 1, packages: [{ name: "ghost", enabled: false }] }, project);
    assert.equal(
      codeOf(() => mergeManifestScopes({ project: project1, projectPath: project.path })),
      "manifest_invalid",
    );
  });

  it("project_slots_override_user_slots_per_slot", () => {
    const merged = mergeManifestScopes({
      user: parseManifest({ version: 1, packages: [entry("s1"), entry("s2")], slots: { store: "s1", loop: "s1" } }, user),
      project: parseManifest({ version: 1, packages: [], slots: { store: "s2" } }, project),
    });
    assert.deepEqual(merged.slots, { store: "s2", loop: "s1" });
  });

  it("slot_owner_must_be_a_listed_enabled_entry", () => {
    const slots = { store: "ghost" };
    assert.equal(
      codeOf(() => parseManifest({ version: 1, packages: [entry("a")], slots }, user)),
      "manifest_slot_owner",
    );
    assert.equal(
      codeOf(() => parseManifest({ version: 1, packages: [entry("ghost", { enabled: false })], slots }, user)),
      "manifest_slot_owner",
    );
    assert.equal(
      codeOf(() => parseManifest({ version: 1, packages: [], slots: { nope: "a" } }, user)),
      "manifest_unknown_field",
    );
    // A project slot may name a user package; disabling that package in project scope breaks the assignment.
    const userSide = parseManifest({ version: 1, packages: [entry("s1")] }, user);
    const ok = parseManifest({ version: 1, packages: [], slots: { store: "s1" } }, project);
    assert.doesNotThrow(() => mergeManifestScopes({ user: userSide, project: ok }));
    const disabled = parseManifest({ version: 1, packages: [{ name: "s1", enabled: false }], slots: { store: "s1" } }, project);
    assert.equal(
      codeOf(() => mergeManifestScopes({ user: userSide, project: disabled })),
      "manifest_slot_owner",
    );
  });

  it("manifest_error_never_contains_config_values", () => {
    const literal = "sk-live-SECRET-1234567890";
    const cases: Array<() => unknown> = [
      () => parseManifest({ version: 1, packages: [entry("Bad Name", { config: { apiKey: literal } })] }, user),
      () => parseManifest({ version: 1, packages: [entry("a", { config: { apiKey: literal }, bogus: literal })] }, user),
      () =>
        parseManifest(
          { version: 1, packages: [entry("a", { config: { apiKey: literal } }), entry("a", { config: { apiKey: literal } })] },
          user,
        ),
      () => parseManifest({ version: 1, packages: [entry("a", { version: literal, config: { apiKey: literal } })] }, user),
      () => parseManifest({ version: literal, packages: [] }, user),
      () => parseManifest({ version: 1, packages: [entry("a", { config: literal })] }, user),
    ];
    for (const run of cases) {
      const error = errorOf(run);
      assert.equal(error.message.includes(literal), false, error.message);
      assert.equal(JSON.stringify(error).includes(literal), false);
    }
  });
});
