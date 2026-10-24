/**
 * `@arnilo/prism-delegate` — sub-agents as a tool.
 *
 * The `delegate` tool runs a named child as its own agent over a chosen subset of the parent's packages.
 * Child activity is reported as `delegate.step` package events. A child never sees `delegate` itself.
 *
 * ```ts
 * import delegate from "@arnilo/prism-delegate";
 * packages: [mockProvider(), tools(), delegate({ children: { reviewer: { inherit: ["@arnilo/prism-tools-coding"], instructions: "Review the diff." } } })];
 * ```
 */

import manifest from "../package.json" with { type: "json" };
import { definePackage } from "@arnilo/prism";
import { resolveAgentChildren } from "./agent-files.js";
import { type DelegateConfig, delegateConfigSchema } from "./config.js";
import { createDelegateRuntime, DELEGATE_PACKAGE, DelegateError } from "./runtime.js";
import { createDelegateService, DELEGATE_SERVICE, type DelegateService } from "./service.js";
import { createDelegateTools } from "./tools.js";

export { type DelegateChildConfig, type DelegateChildLimits, type DelegateConfig, type DelegateReport, delegateConfigSchema } from "./config.js";
export { DEFAULT_CHILD_LIMITS, DEFAULT_RESULT_MAX_CHARS, HARD_CHILD_LIMITS, HARD_MAX_RESULT_MAX_CHARS, HARD_RETAINED_RESULT_CHARS, resolveChildLimits, resolveResultMaxChars } from "./limits.js";
export { type DelegateContextConfig } from "./config.js";
export { type ContextUsed, DEFAULT_CONTEXT_MAX_CHARS, HARD_CONTEXT_MAX_CHARS, HARD_CONTEXT_LAST_TURNS, resolveChildContext, SUMMARY_INSTRUCTION } from "./context.js";
export { DELEGATE_SERVICE, createDelegateService, type DelegateService } from "./service.js";
export { AGENT_TOOL_NAMES, type AgentFileNote, resolveAgentChildren } from "./agent-files.js";
export { type DelegationMerge, type IsolationWorkspace, type IsolatedWorktree, mergeMessage } from "./isolation.js";
export { DEFAULT_CHILD_INSTRUCTIONS, DelegateError, type DelegationOutcome, type DelegationStatus } from "./runtime.js";
export { type DelegateStepInput, DelegateStepError, type DelegateStepPhase, delegateStepData } from "./step.js";

const definition = definePackage<DelegateConfig>({
  name: DELEGATE_PACKAGE,
  version: manifest.version,
  description: "Sub-agents as a tool: a delegate tool whose child agent inherits a chosen subset of the parent packages.",
  requires: { api: 1 },
  capabilities: ["models", "background", "host-ui", "session-state"],
  config: delegateConfigSchema,
  setup(prism) {
    const config = prism.config;
    if (config.agentsRoot !== undefined && config.defaultInherit === undefined) {
      throw new DelegateError("defaultInherit is required when agentsRoot is set: an agent file cannot choose which packages its child inherits");
    }
    if (config.defaultInherit?.includes(DELEGATE_PACKAGE) === true) {
      throw new DelegateError(`defaultInherit cannot include ${DELEGATE_PACKAGE}: a child never sees the delegate tool`);
    }
    const { children, notes } = resolveAgentChildren(config);
    for (const note of notes) prism.status.note(note.level, note.text);
    for (const [name, child] of Object.entries(children)) {
      if (child.inherit.includes(DELEGATE_PACKAGE)) {
        throw new DelegateError(`Child ${name} cannot inherit ${DELEGATE_PACKAGE}: a child never sees the delegate tool`);
      }
    }
    if (Object.keys(children).length === 0) {
      prism.status.note("warn", "No delegate children are configured, so the delegate tool is not registered.");
      return;
    }
    const runtime = createDelegateRuntime(prism, children);
    // The service is always provided: a hidden child is reachable only through it.
    prism.services.provide<DelegateService>(DELEGATE_SERVICE, createDelegateService(runtime));
    prism.onDispose(() => runtime.abortAll());
    if (runtime.childNames.length === 0) {
      prism.status.note("info", "Every delegate child is hidden, so no delegate tools are registered; the delegate service still starts them.");
      return;
    }
    for (const tool of createDelegateTools(runtime)) prism.tools.register(tool);
  },
});

export default definition;
