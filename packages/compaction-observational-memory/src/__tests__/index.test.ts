import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { packageName } from "../index.js";

describe("observational memory package skeleton", () => {
  it("observational_memory_package_entrypoint_exists", () => {
    assert.equal(packageName, "@arnilo/prism-compaction-observational-memory");
  });

  it("observational_memory_package_metadata_is_minimal", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    assert.deepEqual(pkg.exports["."], { types: "./dist/index.d.ts", default: "./dist/index.js" });
    assert.deepEqual(pkg.files, ["dist", "!dist/__tests__", "!dist/**/*.map", "README.md", "CHANGELOG.md"]);
    assert.deepEqual(pkg.dependencies ?? {}, {});
    assert.deepEqual(pkg.devDependencies ?? {}, { "@arnilo/prism": "file:../.." });
    assert.equal(pkg.peerDependencies["@arnilo/prism"], "0.0.1");
    assert.equal(pkg.scripts.postinstall, undefined);
  });
});
