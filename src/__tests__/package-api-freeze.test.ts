import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "bun:test";
import type { AgentConfig, PackageAPI, PackageLoadErrorCode } from "../index.js";
import { CAPABILITIES, type Capability } from "../packages/capabilities.js";

/**
 * Phase 3 freeze (plan 147 Task 6). The package surface Phase 3 builds on is pinned as data.
 * A rename, addition, or removal fails here. The failure names docs/next/packages.md so the
 * contract and the prose move together.
 */

const DOC = "docs/next/packages.md";

const FROZEN_PACKAGE_API: readonly (keyof PackageAPI)[] = [
  "name",
  "config",
  "hooks",
  "slots",
  "tools",
  "skills",
  "providers",
  "commands",
  "models",
  "credentials",
  "state",
  "services",
  "host",
  "events",
  "status",
  "log",
  "onDispose",
];

const FROZEN_CAPABILITIES: readonly Capability[] = [
  "models",
  "host-ui",
  "session-state",
  "background",
  "credentials",
  "slot:loop",
  "slot:compaction",
  "slot:store",
  "slot:credentials",
];

const FROZEN_AGENT_CONFIG_PACKAGE_FIELDS: readonly (keyof AgentConfig)[] = ["packages", "packageConfig", "disable"];

const FROZEN_LOAD_ERROR_CODES: readonly PackageLoadErrorCode[] = [
  "config_unknown_key",
  "config_invalid",
  "secret_literal",
  "config_schema_unsupported",
  "definition_invalid",
  "kernel_range",
  "missing_package",
  "missing_service",
  "service_conflict",
  "dependency_cycle",
  "duplicate_package",
  "capability_missing",
  "setup_failed",
  "tool_conflict",
  "skill_conflict",
  "provider_conflict",
  "command_conflict",
  "unknown_command",
  "command_args_invalid",
  "unknown_disable_id",
  "state_not_json",
  "state_too_large",
  "state_not_ready",
];

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type _codes = Equal<PackageLoadErrorCode, (typeof FROZEN_LOAD_ERROR_CODES)[number]>;
type _capabilities = Equal<Capability, (typeof FROZEN_CAPABILITIES)[number]>;
const _frozen: [_codes, _capabilities] = [true, true];

const RETIRED_ROOT_EXPORTS = [
  "createExtensionKernel",
  "activateKernel",
  "forwardAgentEvents",
  "createExtensionEventBus",
  "createContributionRegistries",
  "createContributionRegistry",
  "registerDiscoveredContributions",
  "definePrismManifest",
  "parsePrismManifest",
  "defineProviderPackage",
  "loadManifestResource",
  "authMethodKey",
  "systemPromptContributionKey",
];

describe("package API freeze", () => {
  it("package_api_is_frozen_for_phase_3", () => {
    const doc = readFileSync(DOC, "utf8");
    const probe: Record<keyof PackageAPI, true> = {
      name: true,
      config: true,
      hooks: true,
      slots: true,
      tools: true,
      skills: true,
      providers: true,
      commands: true,
      models: true,
      credentials: true,
      state: true,
      services: true,
      host: true,
      events: true,
      status: true,
      log: true,
      onDispose: true,
    };
    assert.deepEqual(Object.keys(probe).sort(), [...FROZEN_PACKAGE_API].sort(), `PackageAPI members drifted. Update ${DOC}.`);
    for (const name of FROZEN_PACKAGE_API) assert.ok(doc.includes(`\`${name}\``), `${DOC} missing PackageAPI member ${name}`);
    void _frozen;
  });

  it("package_load_error_codes_are_frozen", () => {
    const doc = readFileSync(DOC, "utf8");
    assert.deepEqual([...CAPABILITIES].sort(), [...FROZEN_CAPABILITIES].sort(), `Capability union drifted. Update ${DOC}.`);
    for (const code of FROZEN_LOAD_ERROR_CODES) assert.ok(doc.includes(`\`${code}\``), `${DOC} missing PackageLoadError code ${code}`);
    for (const field of FROZEN_AGENT_CONFIG_PACKAGE_FIELDS) {
      assert.ok(doc.includes(`\`${field}\``), `${DOC} missing AgentConfig package field ${field}`);
    }
  });

  it("root_barrel_exports_no_extension_names", () => {
    const barrel = readFileSync("src/index.ts", "utf8");
    for (const name of RETIRED_ROOT_EXPORTS) {
      assert.equal(barrel.includes(name), false, `src/index.ts re-exported ${name}. The extension surface stays deleted. See ${DOC}.`);
    }
  });
});
