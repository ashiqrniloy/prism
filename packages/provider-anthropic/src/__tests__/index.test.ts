import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("@arnilo/prism-provider-anthropic skeleton", () => {
  it("workspace_packages_export_provider_package_factories", () => {
    const source = readFileSync("src/index.ts", "utf8");
    assert.match(source, /export function createAnthropicProviderPackage/);
    assert.match(source, /createAnthropicMessagesProvider/);
    assert.match(source, /defineProviderPackage/);
  });

  it("provider_packages_do_not_add_runtime_dependencies", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    assert.deepEqual(pkg.dependencies ?? {}, {});
    assert.equal(pkg.peerDependencies["@arnilo/prism"], "0.0.12");
    assert.equal(pkg.scripts.postinstall, undefined);
  });
});
