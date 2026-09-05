import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("ponytail package scaffold", () => {
  it("ponytail_package_metadata_is_minimal", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    assert.equal(pkg.name, "@arnilo/prism-coding-tools");
    assert.deepEqual(pkg.exports["./ponytail"], { types: "./dist/ponytail/index.d.ts", default: "./dist/ponytail/index.js" });
    assert.equal(pkg.sideEffects, false);
    assert.equal(pkg.peerDependencies["@arnilo/prism"], "^0.5.0");
    assert.equal(pkg.peerDependencies["@dietrichgebert/ponytail"], "^4.9.0");
    assert.equal(pkg.peerDependenciesMeta["@dietrichgebert/ponytail"].optional, true);
    assert.equal(pkg.scripts.postinstall, undefined);
  });
});
