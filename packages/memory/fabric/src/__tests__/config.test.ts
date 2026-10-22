import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { validateJsonSchema } from "@arnilo/prism";
import {
  MemoryValidationError,
  createHashEmbedder,
} from "@arnilo/prism-memory-core";

import {
  createMemory,
  memoryFabricConfigSchema,
  projectResourceId,
  resolveMemoryFabricConfig,
  resolveProjectIdentity,
} from "../index.js";
import { createMemoryFabric } from "../create.js";
import { createScopedMemoryPolicy } from "../scoped/policy.js";

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop() as string, { recursive: true, force: true });
});

describe("fabric scopes config (plan 188.2 Task 2)", () => {
  it("old_scope_key_fails_config_validation", () => {
    const result = validateJsonSchema(memoryFabricConfigSchema, { scope: { tenantId: "t" } });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.rule === "unknown_key" && error.message.includes("scope")));
  });

  it("scope_priors_are_bounded", () => {
    assert.deepEqual(resolveMemoryFabricConfig({}).scopes.priors, { path: 0.15, project: 0.1, team: 0.075, agent: 0.05, user: 0 });
    assert.equal(resolveMemoryFabricConfig({ scopes: { priors: { user: 0.5 } } }).scopes.priors.user, 0.5);
    assert.throws(() => resolveMemoryFabricConfig({ scopes: { priors: { user: 0.6 } } }), MemoryValidationError);
    assert.throws(() => resolveMemoryFabricConfig({ scopes: { priors: { path: -0.1 } } }), MemoryValidationError);
    assert.equal(validateJsonSchema(memoryFabricConfigSchema, { scopes: { priors: { agent: 1 } } }).ok, false);
  });

  it("all_scopes_off_fails_config_validation", () => {
    assert.throws(
      () => resolveMemoryFabricConfig({ scopes: { user: false, agent: false, project: false } }),
      (error: unknown) => error instanceof MemoryValidationError && /at least one/.test(error.message),
    );
  });

  it("invalid_project_id_disables_project_scope_with_status_note", () => {
    const config = resolveMemoryFabricConfig({ scopes: { project: { id: "Not A Project Id" } } });
    assert.ok(!config.scopes.active.some((scope) => scope.level === "project"));
    assert.equal(config.scopes.project, undefined);
    assert.match(config.scopeWarning ?? "", /not <slug>--<id8>.*project scope disabled/);
    assert.deepEqual(
      config.scopes.active.map((scope) => scope.level),
      ["agent", "user"],
    );
  });

  it("unresolvable_project_root_disables_project_scope_with_status_note", () => {
    const config = resolveMemoryFabricConfig({ scopes: { project: { root: join(tmpdir(), "prism-scope-missing-root") } } });
    assert.ok(!config.scopes.active.some((scope) => scope.level === "project"));
    assert.match(config.scopeWarning ?? "", /not a directory.*project scope disabled/);
  });

  it("scopes_resolve_narrowest_first_with_a_project_id_override", () => {
    const config = resolveMemoryFabricConfig({ scopes: { tenantId: "acme", project: { id: "demo--0123abcd" } } });
    assert.equal(config.scopes.tenantId, "acme");
    assert.deepEqual(config.scopes.active, [
      { level: "project", resourceId: "projects/demo--0123abcd" },
      { level: "agent", resourceId: "agent" },
      { level: "user", resourceId: "user" },
    ]);
    assert.deepEqual(config.scopes.project, {
      resourceId: "projects/demo--0123abcd",
      source: "path",
      roots: [],
      root: process.cwd(),
    });
  });

  it("project_scope_defaults_to_the_cwd_identity", () => {
    const identity = resolveProjectIdentity(process.cwd());
    const config = resolveMemoryFabricConfig({});
    assert.equal(config.scopes.project?.resourceId, projectResourceId(identity));
    assert.equal(config.scopes.active[0]?.level, "project");
  });

  it("scoped_policy_binds_to_project_scope", async () => {
    const ledgerRoot = await mkdtemp(join(tmpdir(), "fabric-scope-policy-"));
    dirs.push(ledgerRoot);
    const memory = createMemory({
      tenantId: "t",
      resourceId: "projects/demo--0123abcd",
      threadId: "default",
      embedder: createHashEmbedder({ dimensions: 8 }),
    });
    const fabric = createMemoryFabric({ memory, consolidate: false });
    const policy = createScopedMemoryPolicy({ memory, fabric, scopeRoot: ledgerRoot });
    assert.equal(policy.scopeRoot, ledgerRoot);
    await policy.rememberFact("the deploy gate runs on fridays");
    const working = await memory.getWorking();
    assert.match(JSON.stringify(working), /deploy gate runs on fridays/);
    assert.equal(memory.scope.resourceId, "projects/demo--0123abcd");
  });
});
