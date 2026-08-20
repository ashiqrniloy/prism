import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AntigravityWorkspaceConfigError,
  DOCUMENTED_ANTIGRAVITY_MUTATOR_TOOLS,
  DOCUMENTED_ANTIGRAVITY_ORCHESTRATION_TOOLS,
  DOCUMENTED_ANTIGRAVITY_READONLY_TOOLS,
  resolveToolPolicy,
  validateBuiltinToolName,
} from "../index.js";

test("validateBuiltinToolName: validates documented built-in tools and rejects unknown names", () => {
  assert.equal(validateBuiltinToolName("run_command"), "run_command");
  assert.equal(validateBuiltinToolName("view_file"), "view_file");
  assert.equal(validateBuiltinToolName("invoke_subagent"), "invoke_subagent");

  // Invalid names
  assert.throws(() => validateBuiltinToolName(""), AntigravityWorkspaceConfigError);
  assert.throws(() => validateBuiltinToolName("   "), AntigravityWorkspaceConfigError);
  assert.throws(() => validateBuiltinToolName("unknown_custom_tool"), {
    name: "AntigravityWorkspaceConfigError",
    message: /Unknown or unsupported Antigravity built-in tool/,
  });
});

test("resolveToolPolicy: default prism-mutators denies mutators and allows read-only/orchestration", () => {
  const resolved = resolveToolPolicy();

  assert.equal(resolved.kind, "prism-mutators");
  assert.equal(resolved.preferPrismMutators, true);

  // All mutators must be denied
  for (const mutator of DOCUMENTED_ANTIGRAVITY_MUTATOR_TOOLS) {
    assert.ok(resolved.deniedBuiltins.includes(mutator), `Expected mutator ${mutator} to be denied`);
    assert.ok(resolved.permissions.deny.includes(`builtin(${mutator})`));
  }

  // Read-only and orchestration tools must be allowed
  for (const readOnly of DOCUMENTED_ANTIGRAVITY_READONLY_TOOLS) {
    assert.ok(resolved.allowedBuiltins.includes(readOnly), `Expected ${readOnly} to be allowed`);
    assert.ok(resolved.permissions.allow.includes(`builtin(${readOnly})`));
  }

  for (const orch of DOCUMENTED_ANTIGRAVITY_ORCHESTRATION_TOOLS) {
    assert.ok(resolved.allowedBuiltins.includes(orch), `Expected ${orch} to be allowed`);
    assert.ok(resolved.permissions.allow.includes(`builtin(${orch})`));
  }

  // MCP wildcard allow rule
  assert.ok(resolved.permissions.allow.includes("mcp(prism/*)"));
});

test("resolveToolPolicy: prism-only denies all mutators and read-only tools", () => {
  const resolved = resolveToolPolicy({
    policy: "prism-only",
    serverName: "prism-server",
    allowedMcpTools: ["read_file", "edit_file"],
  });

  assert.equal(resolved.kind, "prism-only");
  assert.equal(resolved.preferPrismMutators, true);

  // Denies all mutators
  for (const mutator of DOCUMENTED_ANTIGRAVITY_MUTATOR_TOOLS) {
    assert.ok(resolved.deniedBuiltins.includes(mutator));
    assert.ok(resolved.permissions.deny.includes(`builtin(${mutator})`));
  }

  // Denies all read-only tools
  for (const readOnly of DOCUMENTED_ANTIGRAVITY_READONLY_TOOLS) {
    assert.ok(resolved.deniedBuiltins.includes(readOnly));
    assert.ok(resolved.permissions.deny.includes(`builtin(${readOnly})`));
  }

  // Scoped MCP permissions
  assert.ok(resolved.permissions.allow.includes("mcp(prism-server/read_file)"));
  assert.ok(resolved.permissions.allow.includes("mcp(prism-server/edit_file)"));
});

test("resolveToolPolicy: custom policy allows and denies explicit subsets", () => {
  const resolved = resolveToolPolicy({
    policy: {
      allowBuiltins: ["view_file", "find_by_name"],
      denyBuiltins: ["run_command", "write_to_file"],
    },
  });

  assert.equal(resolved.kind, "custom");
  assert.deepEqual(resolved.allowedBuiltins, ["view_file", "find_by_name"]);
  assert.deepEqual(resolved.deniedBuiltins, ["run_command", "write_to_file"]);
  assert.equal(resolved.preferPrismMutators, true);

  assert.deepEqual(resolved.permissions.deny, ["builtin(run_command)", "builtin(write_to_file)"]);
  assert.ok(resolved.permissions.allow.includes("builtin(view_file)"));
  assert.ok(resolved.permissions.allow.includes("builtin(find_by_name)"));
});

test("resolveToolPolicy: rejects conflicting allow and deny in custom policy", () => {
  assert.throws(
    () =>
      resolveToolPolicy({
        policy: {
          allowBuiltins: ["run_command"],
          denyBuiltins: ["run_command"],
        },
      }),
    {
      name: "AntigravityWorkspaceConfigError",
      message: /cannot be both allowed and denied/,
    },
  );
});

test("resolveToolPolicy: rejects unknown built-in in custom policy", () => {
  assert.throws(
    () =>
      resolveToolPolicy({
        policy: {
          allowBuiltins: ["unknown_tool_xyz"],
        },
      }),
    AntigravityWorkspaceConfigError,
  );
});
