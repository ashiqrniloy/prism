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
import { type DelegateConfig, delegateConfigSchema } from "./config.js";
import { createDelegateRuntime, DELEGATE_PACKAGE, DelegateError } from "./runtime.js";
import { createDelegateTools } from "./tools.js";

export { type DelegateChildConfig, type DelegateChildLimits, type DelegateConfig, type DelegateLifetime, type DelegateReport, delegateConfigSchema } from "./config.js";
export { DEFAULT_CHILD_LIMITS, HARD_CHILD_LIMITS, resolveChildLimits } from "./limits.js";
export { DelegateError, type DelegationOutcome, type DelegationStatus } from "./runtime.js";
export { type DelegateStepInput, DelegateStepError, type DelegateStepPhase, delegateStepData } from "./step.js";

const definition = definePackage<DelegateConfig>({
  name: DELEGATE_PACKAGE,
  version: manifest.version,
  description: "Sub-agents as a tool: a delegate tool whose child agent inherits a chosen subset of the parent packages.",
  requires: { api: 1 },
  capabilities: ["models", "background"],
  config: delegateConfigSchema,
  setup(prism) {
    const children = prism.config.children ?? {};
    for (const [name, child] of Object.entries(children)) {
      if (child.inherit.includes(DELEGATE_PACKAGE)) {
        throw new DelegateError(`Child ${name} cannot inherit ${DELEGATE_PACKAGE}: a child never sees the delegate tool`);
      }
    }
    for (const [name, child] of Object.entries(children)) {
      if (child.budgetShare !== undefined && !(child.budgetShare > 0)) throw new DelegateError(`Child ${name} budgetShare must be greater than 0`);
    }
    if (Object.keys(children).length === 0) {
      prism.status.note("warn", "No delegate children are configured, so the delegate tool is not registered.");
      return;
    }
    const runtime = createDelegateRuntime(prism);
    for (const tool of createDelegateTools(runtime)) prism.tools.register(tool);
    prism.onDispose(() => runtime.abortAll());
  },
});

export default definition;
