import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("@arnilo/prism-providers/deepseek skeleton", () => {
  it("workspace_packages_export_provider_package_factories", () => {
    const source = readFileSync("src/deepseek/index.ts", "utf8");
    assert.match(source, /export function createDeepSeekProviderPackage/);
    assert.match(source, /defineProviderPackage/);
  });

  it("provider_packages_do_not_add_runtime_dependencies", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    assert.deepEqual(pkg.dependencies ?? {}, {});
    // ponytail: peer follows the package's own version (Decision B lockstep).
    assert.equal(pkg.peerDependencies["@arnilo/prism"], `^${pkg.version}`);
    assert.equal(pkg.scripts.postinstall, undefined);
  });
});
