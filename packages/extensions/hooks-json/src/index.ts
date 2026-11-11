/**
 * `@arnilo/prism-extensions/hooks-json` — compile a Claude/Codex `hooks.json` onto Prism hooks.
 *
 * ```ts
 * import hooksJson from "@arnilo/prism-extensions/hooks-json";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model,
 *   packages: [hooksJson],
 *   packageConfig: { "@arnilo/prism-extensions/hooks-json": JSON.parse(await Bun.file("hooks.json").text()) },
 * });
 * ```
 */

import { definePackage, type JsonSchema, type PackageInstance } from "@arnilo/prism";
import manifest from "../../package.json" with { type: "json" };

import { compileHooks, type HooksJsonConfig, type HooksJsonOptions } from "./compile.js";

export {
  type ContextQueue,
  createContextQueue,
  defaultHookOutputDir,
  estimateContextTokens,
} from "./async-queue.js";
export { type HooksJsonConfig, type HooksJsonOptions, type HooksWarning, hookCommandHash } from "./compile.js";
export {
  type CommandHandlerOptions,
  DEFAULT_HANDLER_TIMEOUT_SECONDS,
  type HookHandlerInput,
  type HookOutcome,
  hookStdinPayload,
  parseHookDecision,
  runCommandHandler,
  tokenizeCommand,
} from "./handlers/command.js";
export {
  type McpHandlerOptions,
  type McpToolClient,
  runMcpToolHandler,
  substituteTemplates,
  templateScope,
} from "./handlers/mcp.js";
export { compileMatcher } from "./matchers.js";
export {
  type CommandHookHandler,
  DEFAULT_ADDITIONAL_CONTEXT_LIMIT,
  HOOK_EVENT_NAMES,
  type HookDefinition,
  type HookEventName,
  type HookHandler,
  type HooksConfig,
  HooksConfigError,
  type McpToolHookHandler,
} from "./schema.js";

const commandHandler: JsonSchema = {
  type: "object",
  properties: {
    type: { const: "command" },
    command: { type: "string", minLength: 1, maxLength: 4096 },
    args: { type: "array", items: { type: "string" } },
    timeout: { type: "number", minimum: 0.001 },
    async: { type: "boolean" },
    asyncRewake: { type: "boolean" },
    statusMessage: { type: "string" },
    additionalContextLimit: { type: "integer", minimum: 0 },
  },
  required: ["type", "command"],
  additionalProperties: false,
};

const mcpHandler: JsonSchema = {
  type: "object",
  properties: {
    type: { const: "mcp_tool" },
    server: { type: "string", minLength: 1 },
    tool: { type: "string", minLength: 1 },
    input: { type: "object", additionalProperties: true },
    timeout: { type: "number", minimum: 0.001 },
    async: { type: "boolean" },
    additionalContextLimit: { type: "integer", minimum: 0 },
  },
  required: ["type", "server", "tool"],
  additionalProperties: false,
};

const handler: JsonSchema = { additionalProperties: true, oneOf: [commandHandler, mcpHandler] };

const definitionEntry: JsonSchema = {
  additionalProperties: true,
  oneOf: [
    {
      type: "object",
      properties: {
        matcher: { type: "string", maxLength: 256 },
        hooks: { type: "array", minItems: 1, items: handler },
      },
      required: ["hooks"],
      additionalProperties: false,
    },
    handler,
  ],
};

const eventProps = {
  SessionStart: { type: "array", items: definitionEntry },
  UserPromptSubmit: { type: "array", items: definitionEntry },
  PreToolUse: { type: "array", items: definitionEntry },
  PostToolUse: { type: "array", items: definitionEntry },
  Stop: { type: "array", items: definitionEntry },
} satisfies JsonSchema["properties"];

const events: JsonSchema = { type: "object", properties: eventProps, additionalProperties: false };

const shared: JsonSchema["properties"] = {
  additionalContextLimit: { type: "integer", minimum: 0, default: 2500 },
  allowCommands: {
    additionalProperties: true,
    oneOf: [{ const: "all" }, { type: "object", additionalProperties: { type: "string", pattern: "^[a-z0-9]+-[a-f0-9]+$" } }],
    default: {},
  },
  env: { type: "object", additionalProperties: { type: "string", "x-prism-secret": true }, default: {} },
  description: { type: "string" },
};

const hooksConfigSchema: JsonSchema = {
  type: "object",
  properties: { hooks: events, ...eventProps, ...shared },
  additionalProperties: false,
};

function definitionFor(options: HooksJsonOptions) {
  return definePackage<HooksJsonConfig>({
    name: "@arnilo/prism-extensions/hooks-json",
    version: manifest.version,
    description: "Claude/Codex hooks.json compiled onto Prism hooks.",
    requires: { api: 1 },
    capabilities: ["credentials"],
    config: hooksConfigSchema,
    setup: (prism) => compileHooks(prism, options),
  });
}

const definition = definitionFor({});

/** Default package. Pass config through `packageConfig` or `hooksJson({ config })`. */
export default definition;

/** Instance with factory-only options (`mcpClient`, `cwd`, `onWarning`). Config stays JSON. */
export function hooksJson(options: HooksJsonOptions & { readonly config?: HooksJsonConfig } = {}): PackageInstance {
  const { config, ...rest } = options;
  return (Object.keys(rest).length === 0 ? definition : definitionFor(rest))(config);
}
