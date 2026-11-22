/**
 * `@arnilo/prism-extensions/delegate` — sub-agents as a tool.
 *
 * The `delegate` tool runs a named child as a session of the parent's own agent, linked to the parent session and
 * limited to the tools of the packages it inherits. Child activity is reported as `delegate.step` package events, and
 * under `report: "stream"` as bounded `delegate.activity` events. A child sees `delegate` only below `maxDepth`.
 *
 * ```ts
 * import delegate from "@arnilo/prism-extensions/delegate";
 * packages: [mockProvider(), tools(), delegate({ children: { reviewer: { inherit: ["@arnilo/prism-tools/coding"], instructions: "Review the diff." } } })];
 * ```
 */

import { fileURLToPath } from "node:url";
import { definePackage } from "@arnilo/prism";
import manifest from "../../package.json" with { type: "json" };
import { resolveAgentChildren } from "./agent-files.js";
import { DEFAULT_MAX_CONCURRENT, type DelegateConfig, delegateConfigSchema } from "./config.js";
import { assertChildWithinCeilings, resolveDelegateCeilings } from "./limits.js";
import { createDelegateRuntime, DELEGATE_PACKAGE, DelegateError, MAX_ANNOUNCED_DELEGATIONS } from "./runtime.js";
import { createDelegateService, DELEGATE_SERVICE, type DelegateService } from "./service.js";
import { createDelegateTools } from "./tools.js";

export { AGENT_TOOL_NAMES, type AgentFileNote, resolveAgentChildren } from "./agent-files.js";
export {
  createActivityReporter,
  DEFAULT_ACTIVITY_FLUSH_MS,
  type DelegateActivityInput,
  type DelegateActivityKind,
  delegateActivityData,
  MAX_DELEGATE_ACTIVITY_TEXT_BYTES,
} from "./activity.js";
export {
  DEFAULT_MAX_DEPTH,
  DEFAULT_QUEUE_TIMEOUT_MS,
  HARD_MAX_DEPTH,
  type DelegateCeilings,
  type DelegateChildConfig,
  type DelegateChildLimits,
  type DelegateConfig,
  type DelegateContextConfig,
  type DelegateReport,
  delegateConfigSchema,
} from "./config.js";
export {
  type ContextUsed,
  DEFAULT_CONTEXT_MAX_CHARS,
  resolveChildContext,
  SUMMARY_INSTRUCTION,
} from "./context.js";
export { type DelegationMerge, type IsolatedWorktree, type IsolationWorkspace, mergeMessage } from "./isolation.js";
export {
  assertChildWithinCeilings,
  DEFAULT_CHILD_CEILINGS,
  DEFAULT_CHILD_LIMITS,
  DEFAULT_MAX_RESULT_MAX_CHARS,
  DEFAULT_RESULT_MAX_CHARS,
  DEFAULT_RETAINED_RESULT_CHARS,
  type DelegateCeilingAxis,
  DelegateCeilingError,
  type ResolvedDelegateCeilings,
  resolveChildLimits,
  resolveDelegateCeilings,
  resolveResultMaxChars,
} from "./limits.js";
export { createSlotQueue, type SlotQueue } from "./queue.js";
export {
  DEFAULT_CHILD_INSTRUCTIONS,
  DELEGATE_TOOL_NAMES,
  DelegateError,
  type DelegationOutcome,
  type DelegationStatus,
  MAX_ANNOUNCED_DELEGATIONS,
} from "./runtime.js";
export { createDelegateService, DELEGATE_SERVICE, type DelegateService } from "./service.js";
export {
  DelegateStepError,
  type DelegateStepInput,
  type DelegateStepPhase,
  delegateStepData,
  MAX_DELEGATE_STEP_APPROVALS,
} from "./step.js";

const definition = definePackage<DelegateConfig>({
  name: DELEGATE_PACKAGE,
  version: manifest.version,
  description: "Sub-agents as a tool: a delegate tool whose child is a linked session limited to the tools of chosen packages.",
  requires: { api: 2 },
  capabilities: ["models", "background", "session-state", "sessions"],
  config: delegateConfigSchema,
  setup(prism) {
    // Registered first: `requiresTools` hides the skill whenever no `delegate` tool is registered (no visible child).
    prism.skills.addDir(fileURLToPath(new URL("../skills", import.meta.url)));
    const config = prism.config;
    if ((config as { ownership?: unknown }).ownership !== undefined) {
      throw new DelegateError(
        "ownership is retired: a child is a session linked to the parent session and inherits its ownership scope; remove the key",
      );
    }
    if (config.agentsRoot !== undefined && config.defaultInherit === undefined) {
      throw new DelegateError(
        "defaultInherit is required when agentsRoot is set: an agent file cannot choose which packages its child inherits",
      );
    }
    if (config.defaultInherit?.includes(DELEGATE_PACKAGE) === true) {
      throw new DelegateError(`defaultInherit cannot include ${DELEGATE_PACKAGE}: a child never sees the delegate tool`);
    }
    const { children, notes } = resolveAgentChildren(config);
    for (const note of notes) prism.status.note(note.level, note.text);
    const ceilings = resolveDelegateCeilings(config.ceilings);
    for (const [name, child] of Object.entries(children)) {
      if (child.inherit.includes(DELEGATE_PACKAGE)) {
        throw new DelegateError(`Child ${name} cannot inherit ${DELEGATE_PACKAGE}: a child never sees the delegate tool`);
      }
      assertChildWithinCeilings(name, child, ceilings);
    }
    if (Object.keys(children).length === 0) {
      prism.status.note("warn", "No delegate children are configured, so the delegate tool is not registered.");
      return;
    }
    const runtime = createDelegateRuntime(prism, children, ceilings);
    // The service is always provided: a hidden child is reachable only through it.
    prism.services.provide<DelegateService>(DELEGATE_SERVICE, createDelegateService(runtime));
    prism.onDispose(() => runtime.abortAll());
    if (runtime.childNames.length === 0) {
      prism.status.note(
        "info",
        "Every delegate child is hidden, so no delegate tools are registered; the delegate service still starts them.",
      );
      return;
    }
    const maxDepth = runtime.maxDepth;
    if (maxDepth > 1 && (config.maxConcurrent ?? DEFAULT_MAX_CONCURRENT) < maxDepth) {
      prism.status.note(
        "warn",
        `maxConcurrent is below maxDepth: a sync child that delegates waits for a slot its own ancestors hold, and times out after queueTimeoutMs.`,
      );
    }
    // A session at `maxDepth` or deeper neither sees nor can call the tools (the runtime also refuses, fail closed).
    const when = (session: { readonly depth?: number }) => (session.depth ?? 0) < maxDepth;
    for (const tool of createDelegateTools(runtime)) prism.tools.register(tool, { when });
    if (config.announceAsync !== false) {
      prism.hooks.on(
        "run.end",
        (payload, context) => {
          if (context.signal?.aborted) return undefined;
          const pending = runtime.takeUnannounced(payload.sessionId);
          if (pending.length === 0) return undefined;
          const shown = pending.slice(0, MAX_ANNOUNCED_DELEGATIONS);
          const lines = shown.map((entry) => `- ${entry.id} (child ${entry.child}, ${entry.settled ? "finished, unread" : "running"})`);
          if (pending.length > shown.length) lines.push(`- …and ${pending.length - shown.length} more`);
          return {
            continue: {
              reason: "Async delegations of this conversation have not been read.",
              steer: `Async delegations not read yet:\n${lines.join("\n")}\nCall delegate_wait for each answer you still need, or delegate_cancel for one you do not.`,
            },
          };
        },
        { id: "announce-async" },
      );
    }
  },
});

export default definition;
