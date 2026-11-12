/**
 * `@arnilo/prism-extensions/advisor` — a second model's opinion, and completion validation.
 *
 * One `advise` tool (one model call per use), optional `beforeTools`/`beforeFinish` review consults, and an
 * opt-in `validate` stage that fails closed: a run is verified only by a parsed `complete` verdict.
 * The advisor is advisory. It never gates safety (that is `@arnilo/prism-extensions/approval` and policy packages) and
 * never blocks a run when it fails.
 *
 * ```ts
 * import advisor from "@arnilo/prism-extensions/advisor";
 * packages: [mockProvider(), advisor({ model: "hyper/<strong-model>", triggers: { beforeFinish: true } })];
 * ```
 */

import manifest from "../../package.json" with { type: "json" };
import { definePackage, type ModelClient, type ModelRef, type PackageInstance } from "@arnilo/prism";
import {
  advisorConfigSchema,
  DEFAULT_ADVISOR_INSTRUCTIONS,
  resolveContext,
  resolveLimits,
  type AdvisorConfig,
  type AdvisorValidateConfig,
} from "./config.js";
import { createConsultLedger, type AdvisorRuntime } from "./consult.js";
import type { ValidationEvidence } from "./evidence.js";
import { createTaskStore } from "./task-capture.js";
import { createAdviseTool } from "./tool.js";
import { registerBeforeFinish, registerBeforeTools } from "./triggers.js";
import { type CompletionValidation, registerValidation, type ValidationEvidenceSource, validateCompletion } from "./validate.js";

export {
  type AdvisorConfig,
  type AdvisorContextConfig,
  type AdvisorValidateConfig,
  advisorConfigSchema,
  DEFAULT_ADVISOR_INSTRUCTIONS,
  DEFAULT_ADVICE_MAX_CHARS,
  DEFAULT_CONTEXT_LAST_TURNS,
  DEFAULT_CONTEXT_MAX_CHARS,
  DEFAULT_MAX_CONSULTS_PER_RUN,
  DEFAULT_MAX_ROUNDS,
  HARD_ADVICE_MAX_CHARS,
  HARD_CONTEXT_LAST_TURNS,
  HARD_CONTEXT_MAX_CHARS,
  HARD_MAX_CONSULTS_PER_RUN,
  HARD_MAX_ROUNDS,
  resolveContext,
  resolveLimits,
} from "./config.js";
export {
  DEFAULT_EVIDENCE_MAX_CHARS,
  HARD_EVIDENCE_MAX_CHARS,
  MAX_EVIDENCE_BLOCKS,
  MAX_TASK_CHARS,
  type ValidationEvidence,
} from "./evidence.js";
export { ADVISE_DESCRIPTION, ADVISE_TOOL } from "./tool.js";
export {
  type CompletionValidation,
  type ValidateCompletionInput,
  type ValidationErrorCode,
  type ValidationEvidenceSource,
  type ValidatorDelegateService,
  type ValidatorVerdict,
  validateCompletion,
} from "./validate.js";
export {
  type AdviceVerdict,
  type CompletionVerdict,
  MAX_MISSING_CHARS,
  MAX_MISSING_ITEMS,
  parseAdviceVerdict,
  parseCompletionVerdict,
} from "./verdict.js";

/** Name of the service the advisor provides. */
export const ADVISOR_SERVICE = "advisor";

/** The `advisor` service: standalone validation with the advisor's model, or another one the agent resolves. */
export interface AdvisorService {
  /** `validateCompletion` with `model` resolved through the agent; default the advisor's own model. */
  validateCompletion(input: {
    readonly model?: ModelRef;
    readonly task: string;
    readonly criteria?: string;
    readonly evidence?: readonly ValidationEvidence[];
    readonly evidenceMaxChars?: number;
    readonly signal?: AbortSignal;
  }): Promise<CompletionValidation>;
}

/** Setup-time refusal: a config combination that would silently disable one of the two run-end reviews. */
export class AdvisorConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdvisorConfigError";
  }
}

const PACKAGE_NAME = "@arnilo/prism-extensions/advisor";

/** Factory-only options: a function cannot travel in JSON package config. */
interface AdvisorFactoryOptions {
  readonly evidence?: ValidationEvidenceSource;
}

const definitionFor = (options: AdvisorFactoryOptions) =>
  definePackage<AdvisorConfig>({
    name: PACKAGE_NAME,
    version: manifest.version,
    description:
      "A second model's advice on the current approach: one advise tool, optional review triggers, and completion validation by a model or a delegate child.",
    requires: { api: 1 },
    capabilities: ["models", "session-state"],
    config: advisorConfigSchema,
    setup(prism) {
      const config = prism.config;
      if (config.model === undefined)
        throw new AdvisorConfigError("model is required: an advisor with no model cannot give a second opinion");
      if (config.validate !== undefined && config.triggers?.beforeFinish === true) {
        throw new AdvisorConfigError(
          "validate and triggers.beforeFinish cannot both be set: both are run.end reviews and the first continue wins, so one of them would be silently inert",
        );
      }
      const context = resolveContext(config.context);
      const limits = resolveLimits(config);
      const validateContext = config.validate?.context === undefined ? undefined : resolveContext(config.validate.context);
      const clamped = [
        ...limits.clamped,
        ...(context.clamped ? [`context (lastTurns → ${context.lastTurns}, maxChars → ${context.maxChars})`] : []),
        ...(validateContext?.clamped === true
          ? [`validate.context (lastTurns → ${validateContext.lastTurns}, maxChars → ${validateContext.maxChars})`]
          : []),
      ];
      if (clamped.length > 0) prism.status.note("info", `Advisor config was clamped to its ceiling: ${clamped.join(", ")}.`);

      let client: ModelClient;
      try {
        client = prism.models.client(config.model);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        prism.status.note(
          "warn",
          `The advisor model "${typeof config.model === "string" ? config.model : `${config.model.provider}/${config.model.model}`}" could not be resolved (${reason}). The advisor registers nothing.`,
        );
        return;
      }

      const runtime: AdvisorRuntime = {
        config,
        client,
        model: client.model,
        instructions: config.instructions ?? DEFAULT_ADVISOR_INSTRUCTIONS,
        context,
        adviceMaxChars: limits.adviceMaxChars,
        maxConsultsPerRun: limits.maxConsultsPerRun,
        ledger: createConsultLedger(prism, limits.maxConsultsPerRun),
      };

      if (config.tool !== false) prism.tools.register(createAdviseTool(prism, runtime));
      const beforeTools = config.triggers?.beforeTools ?? [];
      if (beforeTools.length > 0) registerBeforeTools(prism, runtime, beforeTools);
      if (config.triggers?.beforeFinish === true) registerBeforeFinish(prism, runtime);
      prism.services.provide<AdvisorService>(ADVISOR_SERVICE, {
        validateCompletion: async ({ model, ...input }) => {
          let validator: ModelClient = client;
          if (model !== undefined) {
            try {
              validator = prism.models.client(model);
            } catch {
              return { verdict: "error", reasonCode: "validator_engine_unavailable" };
            }
          }
          return validateCompletion({ ...input, model: validator });
        },
      });
      if (config.validate !== undefined) {
        registerValidation(prism, runtime, config.validate, limits.maxRounds, createTaskStore(prism), options.evidence);
      } else if (options.evidence !== undefined) {
        prism.status.note("warn", "validate.evidence is set but validate is not, so the evidence source is never called.");
      }
    },
  });

const definition = definitionFor({});

export default definition;

/** `validate` config plus the host's evidence source, which is a function and so cannot go through `packageConfig`. */
export type AdvisorPackageOptions = Omit<AdvisorConfig, "validate"> & {
  readonly validate?: AdvisorValidateConfig & { readonly evidence?: ValidationEvidenceSource };
};

/**
 * The advisor as a package instance, with `validate.evidence` allowed. Everything except `evidence` is the
 * JSON config `advisor(config)` takes.
 */
export function advisorPackage(options: AdvisorPackageOptions): PackageInstance {
  const { validate, ...rest } = options;
  if (validate?.evidence === undefined) return definition(options as AdvisorConfig);
  const { evidence, ...validateConfig } = validate;
  if (typeof evidence !== "function") throw new AdvisorConfigError("validate.evidence must be a function");
  return definitionFor({ evidence })({ ...rest, validate: validateConfig });
}
