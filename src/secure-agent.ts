import type { Agent, AgentConfig, Guardrails, SecureAgentOptions } from "./contracts.js";
import { createAgent } from "./agents.js";
import { validateRunStateOptions } from "./agent-run-state.js";
import { resolveRunLimits } from "./run-limits.js";
import { createToolParameterValidator, createToolRegistry } from "./tools.js";

/** Build an opt-in agent whose security-critical defaults cannot be replaced per run. */
export function createSecureAgent(options: SecureAgentOptions): Agent {
  if (!options.id.trim()) throw new TypeError("Secure agent requires a non-empty id");
  if (!options.definitionRevision.trim()) throw new TypeError("Secure agent requires a non-empty definitionRevision");
  if (!options.redactor || typeof options.redactor.redact !== "function") throw new TypeError("Secure agent requires a redactor");
  if (!options.permission || typeof options.permission.check !== "function") throw new TypeError("Secure agent requires a permission policy");
  if (!options.trust || typeof options.trust.check !== "function") throw new TypeError("Secure agent requires a trust policy");
  if (!options.toolArgumentValidator || typeof options.toolArgumentValidator.validate !== "function") throw new TypeError("Secure agent requires a tool argument validator");
  if (!options.limits || Object.keys(options.limits).length === 0) throw new TypeError("Secure agent requires explicit limits");
  if (!options.ownership || !Object.values(options.ownership).some((value) => typeof value === "string" && value.trim())) throw new TypeError("Secure agent requires non-empty ownership");
  for (const tool of options.tools) {
    if (!tool.name.trim()) throw new TypeError("Secure agent tool names must be non-empty");
    if (!tool.parameters || Object.keys(tool.parameters).length === 0) throw new TypeError(`Secure agent tool ${tool.name} requires a non-empty parameters schema`);
  }
  resolveRunLimits(options.limits);
  const runState = Object.freeze({ ...options.runState, definitionRevision: options.definitionRevision, interruptBeforeTool: true });
  validateRunStateOptions(runState);
  const config: AgentConfig = Object.freeze({
    ...withoutSecureFields(options),
    id: options.id,
    tools: createToolRegistry(options.tools, { duplicate: "error" }),
    validator: createToolParameterValidator(options.toolArgumentValidator, { missingSchema: "reject" }),
    redactor: options.redactor,
    permission: options.permission,
    trust: options.trust,
    ownership: Object.freeze({ ...options.ownership }),
    limits: Object.freeze({ ...options.limits }),
    guardrails: freezeGuardrails(options.guardrails),
    runState,
    secure: true,
  });
  return createAgent(config);
}

function withoutSecureFields(options: SecureAgentOptions): Omit<AgentConfig, "tools" | "validator" | "redactor" | "permission" | "trust" | "ownership" | "limits" | "guardrails" | "runState" | "secure"> {
  const { tools: _tools, toolArgumentValidator: _validator, redactor: _redactor, permission: _permission, trust: _trust, ownership: _ownership, limits: _limits, guardrails: _guardrails, definitionRevision: _revision, runState: _runState, ...config } = options;
  return config;
}

function freezeGuardrails(guardrails: Guardrails | undefined): Guardrails | undefined {
  if (!guardrails) return undefined;
  return Object.freeze({
    ...guardrails,
    input: Object.freeze([...(guardrails.input ?? [])]),
    output: Object.freeze([...(guardrails.output ?? [])]),
    toolInput: Object.freeze([...(guardrails.toolInput ?? [])]),
    toolOutput: Object.freeze([...(guardrails.toolOutput ?? [])]),
  });
}
