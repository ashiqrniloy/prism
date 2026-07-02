import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("@arnilo/prism-provider-neuralwatt package manifest", () => {
  it("workspace_package_exports_provider_package_factory", () => {
    const source = readFileSync("src/index.ts", "utf8");
    assert.match(source, /export function createNeuralWattProviderPackage/);
    assert.match(source, /defineProviderPackage/);
  });

  it("provider_package_has_no_runtime_dependencies_and_peers_prism", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    assert.deepEqual(pkg.dependencies ?? {}, {}, "package must have zero runtime deps");
    assert.equal(pkg.peerDependencies["@arnilo/prism"], "0.0.1");
    assert.equal(pkg.scripts.postinstall, undefined);
  });

  it("prism_providers_bundle_includes_neuralwatt", () => {
    const providersPkg = JSON.parse(readFileSync("../prism-providers/package.json", "utf8"));
    assert.equal(
      providersPkg.dependencies["@arnilo/prism-provider-neuralwatt"],
      "0.0.1",
      "prism-providers must depend on @arnilo/prism-provider-neuralwatt@0.0.1",
    );
    const providersReadme = readFileSync("../prism-providers/README.md", "utf8");
    assert.match(providersReadme, /@arnilo\/prism-provider-neuralwatt/);
  });

  it("prism_all_bundle_pulls_neuralwatt_transitively", () => {
    const allPkg = JSON.parse(readFileSync("../prism-all/package.json", "utf8"));
    // prism-all depends on prism-providers (the aggregator), which transitively
    // pulls NeuralWatt — match the established wiring pattern.
    assert.equal(allPkg.dependencies["@arnilo/prism-providers"], "0.0.1");
    const allReadme = readFileSync("../prism-all/README.md", "utf8");
    assert.match(allReadme, /neuralwatt/);
  });
});
