/**
 * `@arnilo/prism-agent-sdk` — assembly-only agent SDK.
 *
 * Assembles a configurable agentic runtime (tool planes, skills, instructions,
 * MCP bridges, hooks, session stores) over the Prism harness with every plane
 * optional and replaceable.
 */

export type {
  AgentSdkJsonConfig,
  JsonHooksConfig,
  JsonInstructionsConfig,
  JsonMcpConfig,
  JsonPlanesConfig,
  JsonSkillsConfig,
  JsonToolsConfig,
} from "./config.js";
export {
  parseAgentSdkConfig,
  resolveJsonConfig,
} from "./config.js";
export type {
  AgentSdkConfig,
  AgentSdkDefinition,
  AgentSdkMcpPlane,
} from "./define-agent.js";
export { defineAgent } from "./define-agent.js";
export { AgentSdkConfigError, McpConnectError } from "./errors.js";
export type {
  AssembledHooksPlane,
  HooksPlaneConfig,
} from "./planes/hooks.js";
export { assembleHooksPlane } from "./planes/hooks.js";
export type {
  AssembledInstructionsPlane,
  InstructionsPlaneConfig,
} from "./planes/instructions.js";
export { assembleInstructionsPlane } from "./planes/instructions.js";
export type {
  AssembledMcpPlane,
  McpCustomTransportServerSpec,
  McpHttpServerSpec,
  McpPlaneConfig,
  McpServerSpec,
  McpServerStatus,
  McpStdioServerSpec,
} from "./planes/mcp.js";
export {
  applyMcpApprovalPolicy,
  assembleMcpPlane,
  assertServerAllowed,
  buildConnectOptions,
  DEFAULT_MCP_CONNECT_TIMEOUT_MS,
  parseAllowDestination,
  redactMcpError,
} from "./planes/mcp.js";
export type {
  AssembledSkillsPlane,
  SkillsPlaneConfig,
} from "./planes/skills.js";
export { assembleSkillsPlane } from "./planes/skills.js";
export type { CodingPresetOptions } from "./presets.js";
export {
  barePreset,
  codingPreset,
  mergeAgentConfig,
} from "./presets.js";
export type {
  ResolveToolPlaneOptions,
  ToolPlaneValue,
} from "./tool-plane.js";
export { resolveToolPlane } from "./tool-plane.js";
