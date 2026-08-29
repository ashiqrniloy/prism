import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("ponytail package scaffold", () => {
  it("ponytail_package_metadata_is_minimal", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    assert.equal(pkg.name, "@arnilo/prism-ponytail");
    assert.deepEqual(pkg.exports["."], { types: "./dist/index.d.ts", default: "./dist/index.js" });
    assert.equal(pkg.sideEffects, false);
    // ponytail: peer follows the package's Decision B window (^0.3.1 since the plan 039 cut).
    assert.ok(["^0.3.0", "^0.3.1"].includes(pkg.peerDependencies["@arnilo/prism"]));
    assert.equal(pkg.peerDependencies["@dietrichgebert/ponytail"], "^4.9.0");
    assert.equal(pkg.peerDependenciesMeta["@dietrichgebert/ponytail"].optional, true);
    assert.equal(pkg.scripts.postinstall, undefined);
  });
});
