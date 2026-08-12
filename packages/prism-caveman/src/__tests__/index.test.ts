import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("caveman package scaffold", () => {
  it("caveman_package_metadata_is_minimal", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    assert.equal(pkg.name, "@arnilo/prism-caveman");
    assert.deepEqual(pkg.exports["."], { types: "./dist/index.d.ts", default: "./dist/index.js" });
    assert.equal(pkg.sideEffects, false);
    assert.equal(pkg.peerDependencies["@arnilo/prism"], "0.1.7");
    assert.equal(pkg.scripts.postinstall, undefined);
  });
});
