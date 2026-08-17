import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("ponytail package scaffold", () => {
  it("ponytail_package_metadata_is_minimal", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    assert.equal(pkg.name, "@arnilo/prism-ponytail");
    assert.deepEqual(pkg.exports["."], { types: "./dist/index.d.ts", default: "./dist/index.js" });
    assert.equal(pkg.sideEffects, false);
    assert.equal(pkg.peerDependencies["@arnilo/prism"], "0.2.7");
    assert.equal(pkg.peerDependencies["@dietrichgebert/ponytail"], "^4.8.4");
    assert.equal(pkg.peerDependenciesMeta["@dietrichgebert/ponytail"].optional, true);
    assert.equal(pkg.scripts.postinstall, undefined);
  });
});
