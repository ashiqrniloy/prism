import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("@arnilo/prism-providers/neuralwatt package manifest", () => {
  it("workspace_package_exports_provider_package_factory", () => {
    const source = readFileSync("src/neuralwatt/index.ts", "utf8");
    assert.match(source, /export function createNeuralWattProviderPackage/);
    assert.match(source, /defineProviderPackage/);
  });

  it("provider_package_has_no_runtime_dependencies_and_peers_prism", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    assert.deepEqual(pkg.dependencies ?? {}, {}, "package must have zero runtime deps");
    // peer follows the package's Decision B window (^0.3.1 since the plan 039 cut).
    assert.equal(pkg.peerDependencies["@arnilo/prism"], "^0.5.0");
    assert.equal(pkg.scripts.postinstall, undefined);
  });

  it("prism_providers_family_ships_neuralwatt", () => {
    const providersPkg = JSON.parse(readFileSync("package.json", "utf8"));
    assert.ok(providersPkg.exports["./neuralwatt"], "prism-providers family must export ./neuralwatt");
    const providersReadme = readFileSync("README.md", "utf8");
    assert.match(providersReadme, /@arnilo\/prism-providers\/neuralwatt/);
  });

  it("prism_all_bundle_pulls_neuralwatt_transitively", () => {
    // Plan 054 Task 8: prism-all is retired. NeuralWatt ships as a provider-family
    // subpath; the family README is the remaining membership proof.
    const providersReadme = readFileSync("README.md", "utf8");
    assert.match(providersReadme, /neuralwatt/);
  });
});
