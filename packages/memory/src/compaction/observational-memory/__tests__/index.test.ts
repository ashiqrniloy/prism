import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { packageName } from "../index.js";

describe("observational memory package skeleton", () => {
  it("observational_memory_package_entrypoint_exists", () => {
    assert.equal(packageName, "@arnilo/prism-memory/compaction/observational-memory");
  });

  it("observational_memory_subpath_ships_from_the_memory_family_manifest", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../../../package.json", import.meta.url), "utf8"));
    assert.ok(pkg.exports["./compaction/observational-memory"], "family manifest must expose ./compaction/observational-memory");
    assert.equal(pkg.peerDependencies["@arnilo/prism"], "^0.5.0");
    assert.equal(pkg.scripts.postinstall, undefined);
  });
});
