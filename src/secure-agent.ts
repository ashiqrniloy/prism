import { validateRunStateOptions } from "./agent-run-state.js";
import { createAgent } from "./agents.js";
import { askEveryTool } from "./hooks/index.js";
import type { Agent, AgentConfig, SecureAgentOptions } from "./contracts.js";
import {
  assertHostCompositionReadiness,
  HostCompositionError,
  type HostCompositionGovernance,
  type HostCompositionOptions,
  type HostCompositionProfile,
  type HostCompositionReport,
  type HostCompositionToolReport,
  inspectHostComposition,
} from "./host-composition.js";
import { assertIdentityActive, assertIdentityMatchesOwnership } from "./identity.js";
import { resolveRunLimits } from "./run-limits.js";
import { createToolParameterValidator } from "./tools.js";

export {
  assertHostCompositionReadiness,
  HostCompositionError,
  type HostCompositionGovernance,
  type HostCompositionOptions,
  type HostCompositionProfile,
  type HostCompositionReport,
  type HostCompositionToolReport,
  inspectHostComposition,
};

/** Build an opt-in agent whose security-critical defaults cannot be replaced per run. */
export async function createSecureAgent(options: SecureAgentOptions): Promise<Agent> {
  if (!options.id.trim()) throw new TypeError("Secure agent requires a non-empty id");
  if (!options.definitionRevision.trim()) throw new TypeError("Secure agent requires a non-empty definitionRevision");
  if (!options.redactor || typeof options.redactor.redact !== "function") throw new TypeError("Secure agent requires a redactor");
  if (!options.trust || typeof options.trust.check !== "function") throw new TypeError("Secure agent requires a trust policy");
  if (!options.toolArgumentValidator || typeof options.toolArgumentValidator.validate !== "function")
    throw new TypeError("Secure agent requires a tool argument validator");
  if (!options.limits || Object.keys(options.limits).length === 0) throw new TypeError("Secure agent requires explicit limits");
  if (!options.ownership || !Object.values(options.ownership).some((value) => typeof value === "string" && value.trim()))
    throw new TypeError("Secure agent requires non-empty ownership");
  for (const tool of options.tools) {
    if (!tool.name.trim()) throw new TypeError("Secure agent tool names must be non-empty");
    if (!tool.parameters || Object.keys(tool.parameters).length === 0)
      throw new TypeError(`Secure agent tool ${tool.name} requires a non-empty parameters schema`);
  }
  resolveRunLimits(options.limits);
  if (options.identity) {
    assertIdentityActive(options.identity);
    assertIdentityMatchesOwnership(options.identity, options.ownership);
  }
  if (options.composition) {
    assertHostCompositionReadiness({ ...options.composition, agent: options, identity: options.identity });
  }
  const runState = Object.freeze({ ...options.runState, definitionRevision: options.definitionRevision });
  validateRunStateOptions(runState);
  const hostHooks = options.hooks;
  const config: AgentConfig = Object.freeze({
    ...withoutSecureFields(options),
    // `interruptBeforeTool` retired: a secure agent asks before every tool through a host hook.
    hooks: (hooks: import("./hooks/index.js").HookRegistrar) => {
      hostHooks?.(hooks);
      askEveryTool()(hooks);
    },
    id: options.id,
    tools: { add: options.tools },
    validator: createToolParameterValidator(options.toolArgumentValidator, { missingSchema: "reject" }),
    redactor: options.redactor,
    trust: options.trust,
    ownership: Object.freeze({ ...options.ownership }),
    ...(options.identity ? { principal: options.identity.principal } : {}),
    limits: Object.freeze({ ...options.limits }),
    runState,
    secure: true,
  });
  return await createAgent(config);
}

function withoutSecureFields(
  options: SecureAgentOptions,
): Omit<AgentConfig, "tools" | "validator" | "redactor" | "trust" | "ownership" | "principal" | "limits" | "runState" | "secure"> {
  const {
    tools: _tools,
    toolArgumentValidator: _validator,
    redactor: _redactor,
    trust: _trust,
    ownership: _ownership,
    identity: _identity,
    limits: _limits,
    definitionRevision: _revision,
    runState: _runState,
    composition: _composition,
    ...config
  } = options;
  return config;
}
