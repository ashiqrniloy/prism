// Plan 152 follow-up: the shared provider-package surface (`src/provider-kit/provider-package.ts`)
// that every `@arnilo/prism-provider-<vendor>` package builds on. These checks pin the pieces the
// 21 vendor packages rely on: ref-only schema properties, the two credential sources, the kernel
// envelope, and the factory/config split.
import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  baseUrlProperty,
  defineProviderPackage,
  modelEntrySchema,
  modelsProperty,
  optionalRefSource,
  providerPackageInstance,
  refSource,
  secretRefProperty,
} from "../provider-kit/index.js";
import { CredentialUnavailableError } from "../index.js";
import { KERNEL_VERSION } from "../version.js";

const secret = (value: string) => ({ type: "api_key" as const, value });

describe("provider-package helpers", () => {
  it("provider_package_schema_properties_are_ref_only", () => {
    assert.deepEqual(secretRefProperty("env:ACME_KEY"), {
      type: "string",
      "x-prism-secret": true,
      default: "env:ACME_KEY",
      description: "An `env:` or `keyring:` ref the credentials slot resolves. A literal key is rejected.",
    });
    // An optional credential (Ollama) carries no default at all.
    assert.deepEqual(secretRefProperty(undefined, "Optional ref"), {
      type: "string",
      "x-prism-secret": true,
      description: "Optional ref",
    });
    assert.deepEqual(baseUrlProperty("Official base."), { type: "string", description: "Official base." });
    assert.deepEqual(baseUrlProperty(), { type: "string" });
    const models = modelsProperty("Static catalog.");
    assert.equal(models.items, modelEntrySchema, "the catalog property reuses the shared entry schema");
    assert.equal(models.description, "Static catalog.");
    assert.deepEqual(modelEntrySchema.required, ["provider", "model"]);
    assert.equal(modelEntrySchema.additionalProperties, false);
  });

  it("provider_package_ref_sources_fail_closed_without_a_value", async () => {
    const missing = refSource(async () => undefined, "env:ACME_KEY");
    await assert.rejects(missing, (error: unknown) => {
      assert.ok(error instanceof CredentialUnavailableError);
      assert.equal(error.code, "credential_unavailable");
      assert.match(error.message, /env:ACME_KEY/);
      return true;
    });
    // An empty secret is as unavailable as an absent one.
    await assert.rejects(
      refSource(async () => secret(""), "keyring:acme"),
      CredentialUnavailableError,
    );
    assert.equal(await refSource(async () => secret("live-key"), "env:ACME_KEY")(), "live-key");

    const optional = optionalRefSource(async () => undefined, "env:ACME_KEY");
    assert.equal(await optional(), undefined);
    assert.equal(await optionalRefSource(async () => secret(""), "env:ACME_KEY")(), undefined);
    assert.equal(await optionalRefSource(async () => secret("live-key"), "env:ACME_KEY")(), "live-key");
  });

  it("define_provider_package_sets_the_kernel_envelope", async () => {
    let setups = 0;
    const definition = defineProviderPackage<{ apiKey?: string }>({
      name: "@arnilo/prism-provider-acme",
      description: "Acme provider package for Prism.",
      config: {
        type: "object",
        properties: { apiKey: secretRefProperty("env:ACME_KEY") },
        additionalProperties: false,
      },
      setup(prism) {
        setups += 1;
        assert.equal(prism.config.apiKey, "env:ACME_KEY");
      },
    });
    assert.equal(definition.name, "@arnilo/prism-provider-acme");
    assert.equal(definition.description, "Acme provider package for Prism.");
    assert.equal(definition.version, KERNEL_VERSION);
    assert.deepEqual(definition.requires, { prism: `^${KERNEL_VERSION}` });
    assert.deepEqual(definition.capabilities, ["credentials"], "a provider package resolves credentials by default");
    assert.equal(definition.config?.properties?.apiKey?.default, "env:ACME_KEY");
    assert.equal(typeof definition, "function");
    const instance = definition({ apiKey: "env:ACME_KEY" });
    assert.equal(instance.definition, definition);
    assert.equal(setups, 0, "defineProviderPackage never runs setup; the loader does");

    const bare = defineProviderPackage({
      name: "@arnilo/prism-provider-acme-bridge",
      description: "Bridge with no credential of its own.",
      capabilities: [],
      config: { type: "object", properties: {}, additionalProperties: false },
      setup() {},
    });
    assert.deepEqual(bare.capabilities, [], "a package that resolves no credentials declares none");
  });

  it("provider_package_instance_splits_factory_options_from_config", () => {
    const base = defineProviderPackage<{ apiKey?: string }>({
      name: "@arnilo/prism-provider-acme",
      description: "Acme provider package for Prism.",
      config: { type: "object", properties: { apiKey: secretRefProperty("env:ACME_KEY") }, additionalProperties: false },
      setup() {},
    });
    const factoryCalls: { id?: string; fetch?: typeof fetch }[] = [];
    const definitionFor = (options: { id?: string; fetch?: typeof fetch }) => {
      factoryCalls.push(options);
      return base;
    };
    const fakeFetch = (() => Promise.reject(new Error("never called"))) as unknown as typeof fetch;

    const withFactory = providerPackageInstance(base, definitionFor, ["id", "fetch"], {
      apiKey: "env:ACME_KEY",
      id: "acme-eu",
      fetch: fakeFetch,
    });
    assert.deepEqual(factoryCalls, [{ id: "acme-eu", fetch: fakeFetch }]);
    assert.deepEqual(withFactory.config, { apiKey: "env:ACME_KEY" }, "factory options never leak into config");

    // No factory option set: the base definition is reused, and an explicitly undefined factory
    // option counts as unset (the hand-written split behaved the same way).
    factoryCalls.length = 0;
    const plain = providerPackageInstance(base, definitionFor, ["id", "fetch"], { apiKey: "env:ACME_KEY", id: undefined });
    assert.deepEqual(factoryCalls, []);
    assert.equal(plain.definition, base);
    assert.deepEqual(plain.config, { apiKey: "env:ACME_KEY" });
  });
});
