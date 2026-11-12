import {
  type JsonValue,
  type Message,
  type ModelClient,
  type PackageAPI,
  type RunEndDecision,
  type RunEndPayload,
  type SessionContext,
  selectTranscript,
} from "@arnilo/prism";
import { type AdvisorConfig, type AdvisorValidateConfig, DEFAULT_ADVICE_MAX_CHARS, resolveContext } from "./config.js";
import { type AdvisorRuntime, generateText, messageText } from "./consult.js";
import { capText, checkEvidence, clampEvidenceMaxChars, MAX_TASK_CHARS, renderEvidence, type ValidationEvidence } from "./evidence.js";
import { registerTaskCapture, type TaskStore } from "./task-capture.js";
import { COMPLETE_JSON_INSTRUCTION, eventData, MAX_MISSING_CHARS, MAX_MISSING_ITEMS, parseCompletionVerdict } from "./verdict.js";

/** The `delegate` service's shape this package needs. Structural, so there is no runtime import of it. */
export interface ValidatorDelegateService {
  start(input: {
    readonly child: string;
    readonly input: string;
    readonly mode: "sync";
    readonly session: SessionContext;
    readonly signal?: AbortSignal;
  }): Promise<{ readonly status: string; readonly text?: string; readonly error?: string }>;
}

/** Service name kept as a literal: importing the delegate package here would be a runtime dependency. */
const DELEGATE_SERVICE = "delegate";

export type ValidatorVerdict = "verified" | "incomplete" | "unverified" | "error";

/** Why a validation produced no verdict. Closed: an `error` never passes a task. */
export type ValidationErrorCode =
  | "model_error"
  | "child_failed"
  | "validator_engine_unavailable"
  | "unparseable_verdict"
  | "child_unparseable_verdict"
  | "task_unavailable"
  | "invalid_input"
  | "evidence_failed";

/** One validation's outcome. Only a parsed `complete` verdict is `complete`. */
export type CompletionValidation =
  | { readonly verdict: "complete" }
  | { readonly verdict: "incomplete"; readonly missing: readonly string[] }
  | { readonly verdict: "error"; readonly reasonCode: ValidationErrorCode };

type ValidationResult = CompletionValidation;

const CODE = {
  model: "model_error",
  child: "child_failed",
  unavailable: "validator_engine_unavailable",
  garbage: "unparseable_verdict",
  childGarbage: "child_unparseable_verdict",
  missingTask: "task_unavailable",
  invalid: "invalid_input",
  evidence: "evidence_failed",
} as const satisfies Record<string, ValidationErrorCode>;

/** Evidence the host assembles for an in-run validation: called on `run.end`, after the worker stopped. */
export type ValidationEvidenceSource = (
  payload: RunEndPayload,
  session: SessionContext | undefined,
) => readonly ValidationEvidence[] | Promise<readonly ValidationEvidence[]>;

/** The validator's final answer: the last assistant text in the run. */
function finalAnswer(history: readonly Message[]): string {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message !== undefined && message.role === "assistant") {
      const text = messageText(message);
      if (text.length > 0) return text;
    }
  }
  return "";
}

function taskText(messages: readonly Message[]): string {
  return messages
    .map((message) => messageText(message))
    .filter((text) => text.length > 0)
    .join("\n\n")
    .trim();
}

/** The task the run was given: pinned so a short slice can never cut it away. */
function inferTask(history: readonly Message[]): readonly Message[] {
  const first = history.find((message) => message.role === "user");
  return first === undefined ? [] : [first];
}

function criteriaBlock(criteria: string | undefined): string {
  return criteria === undefined || criteria.trim().length === 0
    ? "ACCEPTANCE CRITERIA\n(none stated; judge against the task)"
    : `ACCEPTANCE CRITERIA\n${criteria}`;
}

/** What one validation prompt carries. An absent section is absent from the prompt, not shown as empty. */
interface PromptSections {
  readonly task: string;
  readonly criteria: string | undefined;
  /** `undefined` leaves the FINAL ANSWER section out. */
  readonly finalAnswer?: string;
  /** `undefined` leaves the CONVERSATION section out. */
  readonly transcript?: string;
  readonly evidence: readonly string[];
}

/**
 * The model engine's prompt. With the default inputs (answer and transcript, no evidence) it is the 0.13.0
 * prompt byte for byte; without them the intro tells the validator it sees no account from the worker.
 */
export function buildValidationPrompt(sections: PromptSections): string {
  const sawWorker = sections.finalAnswer !== undefined || sections.transcript !== undefined;
  const intro = sawWorker
    ? [
        "You are a completion validator for another AI agent. Decide whether its final answer completes the task it was given.",
        "Judge only what the conversation and the stated evidence show; do not ask for style changes.",
      ]
    : [
        "You are a completion validator for another AI agent's work. Decide whether the work completes the task it was given.",
        "You see no account from the agent, only evidence the host assembled. Judge only what that evidence shows; anything it does not show is not done. Do not ask for style changes.",
      ];
  return [
    ...intro,
    `TASK\n${sections.task}`,
    criteriaBlock(sections.criteria),
    ...(sections.finalAnswer === undefined ? [] : [`FINAL ANSWER\n${sections.finalAnswer || "(the run produced no answer)"}`]),
    ...(sections.transcript === undefined ? [] : [`CONVERSATION\n${sections.transcript || "(none)"}`]),
    ...sections.evidence,
    COMPLETE_JSON_INSTRUCTION,
  ].join("\n\n");
}

/** One model call, no tools, parsed fail closed. */
async function judge(client: ModelClient, prompt: string, maxChars: number, signal: AbortSignal | undefined): Promise<ValidationResult> {
  let text: string;
  try {
    text = (await generateText(client, prompt, { maxChars, ...(signal === undefined ? {} : { signal }) })).text;
  } catch {
    return { verdict: "error", reasonCode: CODE.model };
  }
  const parsed = parseCompletionVerdict(text);
  return parsed ?? { verdict: "error", reasonCode: CODE.garbage };
}

/** One validator review, model engine: a single call, no tools. */
async function validateWithModel(
  runtime: AdvisorRuntime,
  sections: PromptSections,
  signal: AbortSignal | undefined,
): Promise<ValidationResult> {
  return judge(runtime.client, buildValidationPrompt(sections), runtime.adviceMaxChars, signal);
}

/** Input to the standalone validation: host text and host evidence only. Nothing is read from a session. */
export interface ValidateCompletionInput {
  /** The validator's model client. A model other than the worker's is recommended. */
  readonly model: ModelClient;
  readonly task: string;
  readonly criteria?: string;
  /** Host-assembled evidence, at most `MAX_EVIDENCE_BLOCKS` blocks. */
  readonly evidence?: readonly ValidationEvidence[];
  /** Budget for all evidence text. Default 48,000, capped at 120,000. */
  readonly evidenceMaxChars?: number;
  readonly signal?: AbortSignal;
}

/**
 * Independent completion validation for a workflow `gateNode` or any host code: one model call with no tools,
 * no session, no transcript and no final answer. The prompt holds the task, the criteria and the evidence
 * blocks, nothing else. Fails closed: no `complete` without a parsed verdict.
 */
export async function validateCompletion(input: ValidateCompletionInput): Promise<CompletionValidation> {
  let evidence: readonly ValidationEvidence[];
  try {
    if (typeof input.model?.generate !== "function") throw new TypeError("model must be a ModelClient");
    if (typeof input.task !== "string") throw new TypeError("task must be a string");
    if (input.criteria !== undefined && typeof input.criteria !== "string") throw new TypeError("criteria must be a string");
    evidence = checkEvidence(input.evidence);
  } catch {
    return { verdict: "error", reasonCode: CODE.invalid };
  }
  const task = input.task.trim();
  if (task.length === 0) return { verdict: "error", reasonCode: CODE.missingTask };
  const prompt = buildValidationPrompt({
    task: capText(task, MAX_TASK_CHARS, "task"),
    criteria: input.criteria === undefined ? undefined : capText(input.criteria, MAX_TASK_CHARS, "criteria"),
    evidence: renderEvidence(evidence, clampEvidenceMaxChars(input.evidenceMaxChars)),
  });
  const result = await judge(input.model, prompt, DEFAULT_ADVICE_MAX_CHARS, input.signal);
  return result.verdict === "incomplete" ? { verdict: "incomplete", missing: missingSummary(result.missing) } : result;
}

/** One validator review, child engine: the configured hidden delegate child checks the evidence with its own tools. */
async function validateWithChild(
  prism: PackageAPI<AdvisorConfig>,
  config: AdvisorValidateConfig,
  input: {
    readonly task: string;
    readonly criteria: string | undefined;
    /** `undefined` leaves the FINAL ANSWER section out of the brief. */
    readonly finalAnswer: string | undefined;
    readonly evidence: readonly string[];
    readonly session: SessionContext | undefined;
    readonly signal?: AbortSignal;
  },
): Promise<ValidationResult> {
  const service = prism.services.consume<ValidatorDelegateService>(DELEGATE_SERVICE);
  if (service === undefined || config.engine === "model" || config.engine === undefined)
    return { verdict: "error", reasonCode: CODE.unavailable };
  if (input.session === undefined) return { verdict: "error", reasonCode: CODE.unavailable };
  const brief = [
    "Validate whether the work below completes the task. You may check the evidence with your tools (read files, run the tests) instead of trusting the report; do that before you answer.",
    `TASK\n${input.task}`,
    criteriaBlock(input.criteria),
    ...(input.finalAnswer === undefined ? [] : [`FINAL ANSWER\n${input.finalAnswer || "(the run produced no answer)"}`]),
    ...input.evidence,
    COMPLETE_JSON_INSTRUCTION,
  ].join("\n\n");
  let outcome: Awaited<ReturnType<ValidatorDelegateService["start"]>>;
  try {
    outcome = await service.start({
      child: config.engine.child,
      input: brief,
      mode: "sync",
      session: input.session,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
  } catch {
    return { verdict: "error", reasonCode: CODE.unavailable };
  }
  if (outcome.status !== "completed" || typeof outcome.text !== "string") return { verdict: "error", reasonCode: CODE.child };
  const parsed = parseCompletionVerdict(outcome.text);
  return parsed ?? { verdict: "error", reasonCode: CODE.childGarbage };
}

const missingSummary = (missing: readonly string[]): readonly string[] =>
  missing.slice(0, MAX_MISSING_ITEMS).map((item) => item.slice(0, MAX_MISSING_CHARS));

/**
 * `validate` on `run.end`: one review per round, fail closed. No `verified` without a parsed `complete`
 * verdict, and every failure is reported as `error` with a reason code, never as a pass. Rounds are
 * counted by the run's continuations, so `round = continuations + 1` needs no extra state.
 */
export function registerValidation(
  prism: PackageAPI<AdvisorConfig>,
  runtime: AdvisorRuntime,
  config: AdvisorValidateConfig,
  maxRounds: number,
  tasks: TaskStore,
  evidenceSource?: ValidationEvidenceSource,
): void {
  const useTranscript = config.inputs?.transcript !== false;
  const useAnswer = config.inputs?.finalAnswer !== false;
  const evidenceMaxChars = clampEvidenceMaxChars(config.evidenceMaxChars);
  const engine: "model" | "child" = config.engine === undefined || config.engine === "model" ? "model" : "child";
  const onError = config.onError ?? "continue";
  const context = config.context === undefined ? runtime.context : resolveContext(config.context);

  registerTaskCapture(prism, tasks);
  prism.hooks.on("run.end", async (payload: RunEndPayload, hook): Promise<RunEndDecision | undefined> => {
    const round = payload.continuations + 1;
    const captured = tasks.get(payload.runId);
    const labelled = captured === undefined ? "inferred" : "captured";
    const taskMessages = captured?.messages ?? inferTask(payload.history);
    const task = taskText(taskMessages);
    if (task.length === 0) {
      tasks.forget(payload.runId);
      hook.emit("validator.verdict", eventData({ round, verdict: "error", engine, task: labelled, reasonCode: CODE.missingTask }));
      return undefined;
    }
    let evidence: readonly string[] = [];
    if (evidenceSource !== undefined) {
      try {
        evidence = renderEvidence(checkEvidence(await evidenceSource(payload, hook.session)), evidenceMaxChars);
      } catch {
        return settle({ verdict: "error", reasonCode: CODE.evidence });
      }
    }
    let transcript: string | undefined;
    if (useTranscript && engine === "model") {
      const slice = selectTranscript(payload.history, { lastTurns: context.lastTurns, maxChars: context.maxChars, pinned: taskMessages });
      transcript = [
        ...slice.summaries.map((summary) => `Summary of earlier conversation:\n${summary}`),
        ...slice.messages.map((message) => `${message.role}: ${messageText(message)}`),
      ].join("\n\n");
    }
    const answer = useAnswer ? finalAnswer(payload.history) : undefined;
    const signal = hook.signal;
    const result =
      engine === "child"
        ? await validateWithChild(prism, config, {
            task,
            criteria: config.criteria,
            finalAnswer: answer,
            evidence,
            session: hook.session,
            ...(signal === undefined ? {} : { signal }),
          })
        : await validateWithModel(
            runtime,
            {
              task,
              criteria: config.criteria,
              ...(answer === undefined ? {} : { finalAnswer: answer }),
              ...(transcript === undefined ? {} : { transcript }),
              evidence,
            },
            signal,
          );
    return settle(result);

    function settle(result: ValidationResult): RunEndDecision | undefined {
      if (result.verdict === "complete") {
        tasks.forget(payload.runId);
        hook.emit("validator.verdict", eventData({ round, verdict: "verified", engine, task: labelled }));
        return undefined;
      }
      if (result.verdict === "incomplete") {
        const missing = missingSummary(result.missing);
        if (round >= maxRounds) {
          tasks.forget(payload.runId);
          hook.emit(
            "validator.verdict",
            eventData({ round, verdict: "unverified", engine, task: labelled, missing: missing as unknown as JsonValue }),
          );
          return undefined;
        }
        hook.emit(
          "validator.verdict",
          eventData({ round, verdict: "incomplete", engine, task: labelled, missing: missing as unknown as JsonValue }),
        );
        const list = missing.length === 0 ? "the task is not finished" : missing.map((item) => `- ${item}`).join("\n");
        return { continue: { reason: "Validator: task incomplete", steer: `Missing:\n${list}\nFinish these, then state the evidence.` } };
      }
      const roundsLeft = round < maxRounds;
      if (onError === "continue" && roundsLeft) {
        hook.emit("validator.verdict", eventData({ round, verdict: "error", engine, task: labelled, reasonCode: result.reasonCode }));
        return {
          continue: {
            reason: "Validator: validation could not run",
            steer: `Validation could not run (${result.reasonCode}). Check your work explicitly and state the evidence.`,
          },
        };
      }
      tasks.forget(payload.runId);
      hook.emit("validator.verdict", eventData({ round, verdict: "error", engine, task: labelled, reasonCode: result.reasonCode }));
      return undefined;
    }
  });
}
