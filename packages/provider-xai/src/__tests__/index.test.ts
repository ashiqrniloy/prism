import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("@arnilo/prism-provider-xai skeleton", () => {
  it("workspace_packages_export_provider_package_factories", () => {
    const source = readFileSync("src/index.ts", "utf8");
    assert.match(source, /export function createXaiProviderPackage/);
    assert.match(source, /defineProviderPackage/);
    assert.match(source, /createXaiOAuthProvider/);
  });

  it("provider_packages_do_not_add_runtime_dependencies", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    assert.deepEqual(pkg.dependencies ?? {}, {});
    // ponytail: peer follows the package's Decision B window (^0.3.1 since the plan 039 cut).
    assert.ok(["^0.3.0", "^0.3.1"].includes(pkg.peerDependencies["@arnilo/prism"]));
    assert.equal(pkg.scripts.postinstall, undefined);
  });
});
