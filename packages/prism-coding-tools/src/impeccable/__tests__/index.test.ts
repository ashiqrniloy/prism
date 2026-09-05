import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("impeccable package scaffold", () => {
  it("impeccable_package_metadata_is_minimal", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    assert.equal(pkg.name, "@arnilo/prism-coding-tools");
    assert.deepEqual(pkg.exports["./impeccable"], { types: "./dist/impeccable/index.d.ts", default: "./dist/impeccable/index.js" });
    assert.equal(pkg.sideEffects, false);
    assert.equal(pkg.peerDependencies["@arnilo/prism"], "^0.5.0");
    assert.equal(pkg.scripts.postinstall, undefined);
  });
});
