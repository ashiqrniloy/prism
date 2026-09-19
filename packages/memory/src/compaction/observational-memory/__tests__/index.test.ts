import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  createWorkScopeController,
  foldWorkScopeMap,
  packageName,
  projectWorkMemory,
  WORK_SCOPE_BOUND,
  WORK_SCOPE_CLOSED,
  WORK_SCOPE_ENTERED,
  WORK_SCOPE_LEFT,
  WORK_SCOPE_OPENED,
  WORK_SCOPE_UNBOUND,
  withWorkScope,
} from "../index.js";

describe("observational memory package skeleton", () => {
  it("observational_memory_package_entrypoint_exists", () => {
    assert.equal(packageName, "@arnilo/prism-memory/compaction/observational-memory");
  });

  it("observational_memory_subpath_ships_from_the_memory_family_manifest", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../../../package.json", import.meta.url), "utf8"));
    assert.ok(pkg.exports["./compaction/observational-memory"], "family manifest must expose ./compaction/observational-memory");
    assert.equal(pkg.peerDependencies["@arnilo/prism"], `^${pkg.version}`);
    assert.equal(pkg.scripts.postinstall, undefined);
  });

  it("observational_memory_work_scope_helpers_and_entries_are_public", () => {
    for (const helper of [createWorkScopeController, foldWorkScopeMap, projectWorkMemory, withWorkScope])
      assert.equal(typeof helper, "function");
    assert.deepEqual(
      [WORK_SCOPE_OPENED, WORK_SCOPE_CLOSED, WORK_SCOPE_ENTERED, WORK_SCOPE_LEFT, WORK_SCOPE_BOUND, WORK_SCOPE_UNBOUND],
      ["om.scope.opened", "om.scope.closed", "om.scope.entered", "om.scope.left", "om.scope.bound", "om.scope.unbound"],
    );
  });

  it("observational_memory_docs_cover_the_work_scope_contract", () => {
    const docs = readFileSync(new URL("../../../../../../docs/compaction-observational-memory.md", import.meta.url), "utf8");
    for (const needle of [
      "Work-scope index",
      "projectWorkMemory",
      "withWorkScope",
      "Shared work scopes",
      "onScopeAccess",
      "resource-scoped observational memory",
      "storage safety cap",
    ])
      assert.ok(docs.includes(needle), `docs/compaction-observational-memory.md must mention ${needle}`);
  });
});
