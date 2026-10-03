import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { type JsonSchema, PackageLoadError } from "../index.js";
import { resolvePackageConfig } from "../packages/config.js";
import { validateJsonSchema } from "../packages/schema.js";

const label = (value: unknown) => (typeof value === "object" && value !== null ? "object" : String(value));
const ok = (schema: JsonSchema, value: unknown) => assert.equal(validateJsonSchema(schema, value).ok, true, label(value));
const bad = (schema: JsonSchema, value: unknown, rule?: string) => {
  const result = validateJsonSchema(schema, value);
  assert.equal(result.ok, false, label(value));
  if (rule) assert.equal(result.errors[0]?.rule, rule, label(value));
};
const loadError = (fn: () => unknown, code: string) => {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof PackageLoadError, String(error));
    assert.equal(error.code, code, error.message);
    return error;
  }
  assert.fail(`expected PackageLoadError ${code}`);
};

describe("package config schema", () => {
  it("schema_subset_validates_types_enums_ranges", () => {
    for (const [type, good, wrong] of [
      ["string", "a", 1],
      ["number", 1.5, "1"],
      ["integer", 2, 2.5],
      ["boolean", false, 0],
      ["null", null, 0],
      ["object", {}, []],
      ["array", [], {}],
    ] as const) {
      ok({ type }, good);
      bad({ type }, wrong, "type");
    }
    ok({ enum: ["a", 1, null] }, null);
    ok({ enum: [{ x: 1 }], additionalProperties: true }, { x: 1 });
    bad({ enum: ["a", "b"] }, "c", "enum");
    ok({ const: [1, 2] }, [1, 2]);
    bad({ const: [1, 2] }, [1, 3], "const");
    ok({ type: "number", minimum: 1, maximum: 3 }, 3);
    bad({ type: "number", minimum: 1 }, 0, "range");
    bad({ type: "number", maximum: 3 }, 4, "range");
    ok({ type: "string", minLength: 2, maxLength: 3 }, "ab");
    bad({ type: "string", minLength: 2 }, "a", "length");
    bad({ type: "string", maxLength: 2 }, "abc", "length");
    ok({ type: "string", pattern: "^[a-z]+$" }, "abc");
    bad({ type: "string", pattern: "^[a-z]+$" }, "ABC", "pattern");
    ok({ type: "array", items: { type: "integer" }, minItems: 1, maxItems: 2 }, [1, 2]);
    bad({ type: "array", items: { type: "integer" } }, [1, "x"], "type");
    bad({ type: "array", minItems: 1 }, [], "length");
    bad({ type: "array", maxItems: 1 }, [1, 2], "length");
    const object: JsonSchema = { type: "object", properties: { a: { type: "string" } }, required: ["a"] };
    ok(object, { a: "x" });
    bad(object, {}, "required");
    bad(object, { a: "x", b: 1 }, "unknown_key");
    ok({ ...object, additionalProperties: true }, { a: "x", b: 1 });
    ok({ ...object, additionalProperties: { type: "number" } }, { a: "x", b: 1 });
    bad({ ...object, additionalProperties: { type: "number" } }, { a: "x", b: "no" }, "type");
    // Keywords apply to their own type only; annotations are accepted.
    ok({ minimum: 5, title: "t", description: "d" }, "text");
    // oneOf needs exactly one match; anyOf at least one.
    const either: JsonSchema = { oneOf: [{ type: "string" }, { type: "number", minimum: 0 }] };
    ok(either, "x");
    ok(either, 1);
    bad(either, true, "shape");
    bad({ oneOf: [{ type: "number" }, { type: "integer" }] }, 1, "shape");
    ok({ anyOf: [{ type: "number" }, { type: "integer" }] }, 1);
    bad({ anyOf: [{ type: "string" }, { type: "null" }] }, 1, "shape");
  });

  it("applies defaults, including nested ones, without mutating the schema", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        backend: { type: "string", default: "brave" },
        limits: { type: "object", properties: { retries: { type: "integer", default: 2 }, name: { type: "string" } } },
        extra: { type: "object", properties: { x: { type: "string" } } },
      },
    };
    const result = validateJsonSchema(schema, {});
    assert.deepEqual(result.value, { backend: "brave", limits: { retries: 2 } });
    const again = validateJsonSchema(schema, { limits: { name: "n" } });
    assert.deepEqual(again.value, { backend: "brave", limits: { retries: 2, name: "n" } });
    assert.deepEqual(validateJsonSchema(schema, {}).value, { backend: "brave", limits: { retries: 2 } });
  });

  it("unsupported_schema_keyword_fails_closed", () => {
    const cases: readonly unknown[] = [
      { $ref: "#/$defs/x" },
      { patternProperties: { "^a": { type: "string" } } },
      { allOf: [{ type: "string" }] },
      { not: { type: "string" } },
      { format: "uri" },
      { uniqueItems: true },
      { type: ["string", "null"] },
      { items: [{ type: "string" }] },
      { "x-custom": true },
      { properties: { a: { exclusiveMinimum: 1 } } },
      { oneOf: [{ $defs: {} }] },
      { type: "nope" },
      { minLength: -1 },
      { pattern: "(" },
      { "x-prism-secret": true, type: "number" },
      { default: 5, type: "string" },
      { properties: { __proto__x: {}, ["__proto__"]: {} } },
    ];
    for (const schema of cases) {
      loadError(() => validateJsonSchema(schema as JsonSchema, {}), "config_schema_unsupported");
    }
    // The error names the path and keyword, not config values.
    const error = loadError(
      () => validateJsonSchema({ properties: { a: { format: "uri" } } } as unknown as JsonSchema, { a: "secret-x" }),
      "config_schema_unsupported",
    );
    assert.match(error.message, /properties\/a.*"format"/);
    assert.equal(error.message.includes("secret-x"), false);
  });

  it("function_valued_config_is_rejected", () => {
    const schema: JsonSchema = { type: "object", additionalProperties: true };
    for (const value of [
      { fetch: () => 1 },
      { nested: { list: [() => 1] } },
      { date: new Date() },
      { n: Number.NaN },
      { n: 1n },
      { s: Symbol("x") },
    ]) {
      bad(schema, value, "not_json");
    }
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    bad(schema, cyclic, "not_json");
    bad(schema, JSON.parse('{"__proto__": {"polluted": true}}'), "not_json");
    // An undefined property is absent, as with JSON.stringify.
    assert.deepEqual(validateJsonSchema(schema, { a: undefined, b: 1 }).value, { b: 1 });
    const error = loadError(() => resolvePackageConfig({ name: "p", config: schema }, { host: { fetch: () => 1 } }), "config_invalid");
    assert.match(error.message, /\/fetch/);
    assert.equal(error.path, "/fetch");
  });

  it("pattern_is_length_bounded", () => {
    loadError(() => validateJsonSchema({ type: "string", pattern: "a".repeat(257) }, "a"), "config_schema_unsupported");
    const schema: JsonSchema = { type: "string", pattern: "^(a+)+$" };
    const started = performance.now();
    const result = validateJsonSchema(schema, "a".repeat(5000));
    assert.equal(result.ok, false);
    assert.equal(result.errors[0]?.rule, "pattern");
    assert.match(result.errors[0]?.message ?? "", /too long/);
    assert.ok(performance.now() - started < 1000, "an over-long input is refused without running the pattern");
  });
});

describe("package config resolution", () => {
  const definition = {
    name: "@acme/web",
    config: {
      type: "object",
      properties: {
        backend: { type: "string", enum: ["brave", "exa"], default: "brave" },
        region: { type: "string", default: "us" },
        retries: { type: "integer", default: 1 },
        limits: { type: "object", default: { a: 1, b: 2 }, additionalProperties: { type: "integer" } },
        tags: { type: "array", items: { type: "string" }, default: ["d"] },
        apiKey: { type: "string", "x-prism-secret": true },
      },
      required: ["apiKey"],
    } satisfies JsonSchema,
  };

  it("config_merges_defaults_manifest_host_in_order", () => {
    const resolved = resolvePackageConfig(definition, {
      manifest: { backend: "exa", region: "eu", limits: { b: 5 }, tags: ["m"], apiKey: "env:MANIFEST_KEY" },
      host: { region: "ap", limits: { c: 7 }, tags: ["h1", "h2"], apiKey: "env:HOST_KEY" },
    });
    assert.deepEqual(resolved.config, {
      backend: "exa",
      region: "ap",
      retries: 1,
      limits: { a: 1, b: 5, c: 7 },
      tags: ["h1", "h2"],
      apiKey: "env:HOST_KEY",
    });
    assert.deepEqual(resolved.sources, {
      backend: "manifest",
      region: "host",
      retries: "default",
      limits: "host",
      tags: "host",
      apiKey: "host",
    });
    // Only key names and sources are recorded.
    assert.equal(JSON.stringify(resolved.sources).includes("HOST_KEY"), false);
    // Defaults alone, and the inputs are never mutated.
    const host = { apiKey: "env:K" };
    const defaults = resolvePackageConfig(definition, { host });
    assert.equal(defaults.sources.backend, "default");
    assert.deepEqual(host, { apiKey: "env:K" });
    assert.notEqual(defaults.config.tags, resolvePackageConfig(definition, { host }).config.tags);
  });

  it("unknown_config_key_fails_closed", () => {
    const error = loadError(() => resolvePackageConfig(definition, { host: { apiKey: "env:K", bakend: "x" } }), "config_unknown_key");
    assert.equal(error.package, "@acme/web");
    assert.equal(error.path, "/");
    assert.match(error.message, /unknown key "bakend"/);
    // A package without a schema accepts no config at all.
    assert.deepEqual(resolvePackageConfig({ name: "p" }).config, {});
    loadError(() => resolvePackageConfig({ name: "p" }, { host: { anything: 1 } }), "config_unknown_key");
    loadError(() => resolvePackageConfig({ name: "p" }, { manifest: { anything: 1 } }), "config_unknown_key");
    // Violations and missing required keys are config_invalid.
    loadError(() => resolvePackageConfig(definition, { host: { apiKey: "env:K", backend: "bing" } }), "config_invalid");
    loadError(() => resolvePackageConfig(definition, { host: { apiKey: "env:K", retries: 1.5 } }), "config_invalid");
    const missing = loadError(() => resolvePackageConfig(definition, {}), "config_invalid");
    assert.equal(missing.path, "/apiKey");
    loadError(() => resolvePackageConfig(definition, { host: [] }), "config_invalid");
    loadError(() => resolvePackageConfig({ name: "p", config: { type: "string" } }), "config_schema_unsupported");
  });

  it("literal_secret_rejected_and_never_echoed", () => {
    const literal = "sk-live-abcdef0123456789";
    for (const layer of ["host", "manifest"] as const) {
      const error = loadError(() => resolvePackageConfig(definition, { [layer]: { apiKey: literal } }), "secret_literal");
      assert.equal(error.path, "/apiKey");
      assert.equal(error.message.includes(literal), false);
      assert.equal(JSON.stringify(error).includes(literal), false);
      assert.equal(error.stack?.includes(literal) ?? false, false);
      assert.equal(error.cause, undefined);
      assert.equal(
        Object.values(error).some((value) => String(value).includes(literal)),
        false,
      );
    }
    // A literal in a non-secret field is not a ref violation, and is also never echoed on failure.
    const error = loadError(() => resolvePackageConfig(definition, { host: { apiKey: "env:K", backend: literal } }), "config_invalid");
    assert.equal(error.message.includes(literal), false);
    // A literal secret default is a schema error, caught at compile time.
    loadError(
      () => validateJsonSchema({ type: "object", properties: { k: { type: "string", "x-prism-secret": true, default: literal } } }, {}),
      "config_schema_unsupported",
    );
  });

  it("secret_refs_accept_env_and_keyring_only", () => {
    for (const ref of ["env:OPENAI_API_KEY", "keyring:prod/openai", "env:a.b-c_d", "keyring:x"]) {
      assert.equal(resolvePackageConfig(definition, { host: { apiKey: ref } }).config.apiKey, ref);
    }
    for (const ref of [
      "file:/etc/key",
      "sk-ant-1234",
      "env:",
      "keyring:",
      "env:has space",
      "ENV:X",
      "env:X\nY",
      "http://x",
      "",
      "env:$(id)",
    ]) {
      loadError(() => resolvePackageConfig(definition, { host: { apiKey: ref } }), "secret_literal");
    }
    // A non-string in a secret field is a type error, and a ref inside an array of secrets is checked too.
    loadError(() => resolvePackageConfig(definition, { host: { apiKey: 5 } }), "config_invalid");
    const list: JsonSchema = { type: "object", properties: { keys: { type: "array", items: { type: "string", "x-prism-secret": true } } } };
    assert.equal(validateJsonSchema(list, { keys: ["env:A", "keyring:b"] }).ok, true);
    loadError(() => resolvePackageConfig({ name: "p", config: list }, { host: { keys: ["env:A", "plain"] } }), "secret_literal");
  });
});
