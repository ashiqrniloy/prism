/**
 * `@arnilo/prism-hooks` — run a Claude/Codex-compatible `hooks.json` against Prism.
 *
 * ```ts
 * import { parseHooksConfig, createHooksExtension, hookCommandHash } from "@arnilo/prism-hooks";
 * import { activateKernel, createAgent, createExtensionKernel } from "@arnilo/prism";
 *
 * const hooks = createHooksExtension(parseHooksConfig(await readFile("hooks.json", "utf8")), {
 *   trusted: { "node audit-tool.js": hookCommandHash({ type: "command", command: "node audit-tool.js" }) },
 * });
 * const kernel = createExtensionKernel();
 * await kernel.load([hooks]);
 * const activated = activateKernel(kernel);
 * const agent = createAgent({
 *   model, provider,
 *   guardrails: hooks.guardrails,
 *   instructionInjectors: activated.instructionInjectors,
 *   stopHooks: activated.stopHooks,
 *   middleware: activated.middleware,
 * });
 * ```
 */

export {
  type ContextQueue,
  createContextQueue,
  defaultHookOutputDir,
  estimateContextTokens,
} from "./async-queue.js";
export { createHooksExtension, type HooksExtension, type HooksExtensionOptions, type HooksWarning, hookCommandHash } from "./compile.js";
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
  parseHooksConfig,
} from "./schema.js";
