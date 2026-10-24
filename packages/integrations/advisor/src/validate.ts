import {
  type JsonValue,
  type Message,
  type PackageAPI,
  type RunEndDecision,
  type RunEndPayload,
  selectTranscript,
  type SessionContext,
} from "@arnilo/prism";
import { generateText, messageText, type AdvisorRuntime } from "./consult.js";
import { resolveContext, type AdvisorConfig, type AdvisorValidateConfig } from "./config.js";
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

type ValidationResult =
  | { readonly verdict: "complete" }
  | { readonly verdict: "incomplete"; readonly missing: readonly string[] }
  | { readonly verdict: "error"; readonly reasonCode: string };

const CODE = {
  model: "model_error",
  child: "child_failed",
  unavailable: "validator_engine_unavailable",
  garbage: "unparseable_verdict",
  childGarbage: "child_unparseable_verdict",
  missingTask: "task_unavailable",
} as const;

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
  return messages.map((message) => messageText(message)).filter((text) => text.length > 0).join("\n\n").trim();
}

/** The task the run was given: pinned so a short slice can never cut it away. */
function inferTask(history: readonly Message[]): readonly Message[] {
  const first = history.find((message) => message.role === "user");
  return first === undefined ? [] : [first];
}

function criteriaBlock(criteria: string | undefined): string {
  return criteria === undefined || criteria.trim().length === 0 ? "ACCEPTANCE CRITERIA\n(none stated; judge against the task)" : `ACCEPTANCE CRITERIA\n${criteria}`;
}

/** One validator review, model engine: a single call, no tools. */
async function validateWithModel(
  runtime: AdvisorRuntime,
  input: { readonly task: string; readonly criteria: string | undefined; readonly finalAnswer: string; readonly transcript: string; readonly signal?: AbortSignal },
): Promise<ValidationResult> {
  const prompt = [
    "You are a completion validator for another AI agent. Decide whether its final answer completes the task it was given.",
    "Judge only what the conversation and the stated evidence show; do not ask for style changes.",
    `TASK\n${input.task}`,
    criteriaBlock(input.criteria),
    `FINAL ANSWER\n${input.finalAnswer || "(the run produced no answer)"}`,
    `CONVERSATION\n${input.transcript || "(none)"}`,
    COMPLETE_JSON_INSTRUCTION,
  ].join("\n\n");
  let text: string;
  try {
    text = (await generateText(runtime.client, prompt, { maxChars: runtime.adviceMaxChars, ...(input.signal === undefined ? {} : { signal: input.signal }) })).text;
  } catch {
    return { verdict: "error", reasonCode: CODE.model };
  }
  const parsed = parseCompletionVerdict(text);
  return parsed ?? { verdict: "error", reasonCode: CODE.garbage };
}

/** One validator review, child engine: the configured hidden delegate child checks the evidence with its own tools. */
async function validateWithChild(
  prism: PackageAPI<AdvisorConfig>,
  config: AdvisorValidateConfig,
  input: { readonly task: string; readonly criteria: string | undefined; readonly finalAnswer: string; readonly session: SessionContext | undefined; readonly signal?: AbortSignal },
): Promise<ValidationResult> {
  const service = prism.services.consume<ValidatorDelegateService>(DELEGATE_SERVICE);
  if (service === undefined || config.engine === "model" || config.engine === undefined) return { verdict: "error", reasonCode: CODE.unavailable };
  if (input.session === undefined) return { verdict: "error", reasonCode: CODE.unavailable };
  const brief = [
    "Validate whether the work below completes the task. You may check the evidence with your tools (read files, run the tests) instead of trusting the report; do that before you answer.",
    `TASK\n${input.task}`,
    criteriaBlock(input.criteria),
    `FINAL ANSWER\n${input.finalAnswer || "(the run produced no answer)"}`,
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
): void {
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
    const slice = selectTranscript(payload.history, { lastTurns: context.lastTurns, maxChars: context.maxChars, pinned: taskMessages });
    const transcript = [
      ...slice.summaries.map((summary) => `Summary of earlier conversation:\n${summary}`),
      ...slice.messages.map((message) => `${message.role}: ${messageText(message)}`),
    ].join("\n\n");
    const answer = finalAnswer(payload.history);
    const result =
      engine === "child"
        ? await validateWithChild(prism, config, { task, criteria: config.criteria, finalAnswer: answer, session: hook.session, ...(hook.signal === undefined ? {} : { signal: hook.signal }) })
        : await validateWithModel(runtime, { task, criteria: config.criteria, finalAnswer: answer, transcript, ...(hook.signal === undefined ? {} : { signal: hook.signal }) });

    if (result.verdict === "complete") {
      tasks.forget(payload.runId);
      hook.emit("validator.verdict", eventData({ round, verdict: "verified", engine, task: labelled }));
      return undefined;
    }
    if (result.verdict === "incomplete") {
      const missing = missingSummary(result.missing);
      if (round >= maxRounds) {
        tasks.forget(payload.runId);
        hook.emit("validator.verdict", eventData({ round, verdict: "unverified", engine, task: labelled, missing: missing as unknown as JsonValue }));
        return undefined;
      }
      hook.emit("validator.verdict", eventData({ round, verdict: "incomplete", engine, task: labelled, missing: missing as unknown as JsonValue }));
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
  });
}
