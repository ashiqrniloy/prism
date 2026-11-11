import type { JsonValue, Message, ModelClient, ModelConfig, PackageAPI, ProviderEvent, SessionEntry } from "@arnilo/prism";
import { selectTranscript, type TranscriptSlice } from "@arnilo/prism";
import type { AdvisorConfig, ResolvedContext } from "./config.js";

/** One provider call. The advisor never runs a loop, calls a tool, or writes to the session. */
export async function generateText(
  client: ModelClient,
  prompt: string,
  options: { readonly maxChars: number; readonly signal?: AbortSignal },
): Promise<{ readonly text: string; readonly totalTokens?: number }> {
  const parts: string[] = [];
  let length = 0;
  let totalTokens: number | undefined;
  const request: Parameters<ModelClient["generate"]>[0] = { messages: [{ role: "user", content: [{ type: "text", text: prompt }] }] };
  for await (const event of client.generate(
    options.signal === undefined ? request : { ...request, signal: options.signal },
  ) as AsyncIterable<ProviderEvent>) {
    if (event.type === "error") throw new Error(event.error.message || "the advisor model returned an error");
    if (event.type === "usage" && event.usage.totalTokens !== undefined) totalTokens = event.usage.totalTokens;
    if (event.type === "done" && event.usage?.totalTokens !== undefined) totalTokens = event.usage.totalTokens;
    if (event.type !== "content_delta" || event.content.type !== "text" || typeof event.content.text !== "string") continue;
    // Keep reading past the cap so a `done` usage event is still seen; the text is cut once at the end.
    if (length >= options.maxChars) continue;
    parts.push(event.content.text);
    length += event.content.text.length;
  }
  return { text: parts.join("").slice(0, options.maxChars), ...(totalTokens === undefined ? {} : { totalTokens }) };
}

/** The slice as plain text: summaries first, then messages. Tool activity is already text in a slice. */
export function renderSlice(slice: TranscriptSlice): string {
  const parts: string[] = [];
  for (const summary of slice.summaries) parts.push(`Summary of earlier conversation:\n${summary}`);
  for (const message of [...slice.pinned, ...slice.messages]) {
    const text = messageText(message);
    if (text.length > 0) parts.push(`${message.role}: ${text}`);
  }
  return parts.join("\n\n");
}

/** Portable text of one message: only text blocks survive, because the advisor has no tool protocol. */
export function messageText(message: Message): string {
  return message.content
    .map((block) => (block.type === "text" ? block.text : block.type === "image" ? "[image omitted]" : ""))
    .filter((text) => text.length > 0)
    .join("\n")
    .trim();
}

/** The slice the advisor or validator reads; one function keeps `lastTurns`/`maxChars` in one place. */
export function sliceOf(
  entries: readonly SessionEntry[] | readonly Message[],
  context: ResolvedContext,
  pinned?: readonly Message[],
): TranscriptSlice {
  return selectTranscript(entries, {
    lastTurns: context.lastTurns,
    maxChars: context.maxChars,
    ...(pinned === undefined ? {} : { pinned }),
  });
}

/** Per-run consult budget and the retry guard. One bound covers both maps, so a leaked run id cannot grow. */
export interface ConsultLedger {
  /** Charges one consult for the run, or returns false when the cap is reached. */
  take(runId: string): boolean;
  /** Marks that this tool+args pair was already revised in this run, so a retry is not re-consulted. */
  markRevised(runId: string, key: string): void;
  /** Whether this tool+args pair was already revised in this run. */
  wasRevised(runId: string, key: string): boolean;
}

type LedgerState = Record<string, number>;
type RevisedState = Record<string, string[]>;
const MAX_LEDGER_RUNS = 16;

/** Both maps live in agent state (process memory). A run's entry is dropped when a later run pushes it out. */
export const createConsultLedger = (prism: PackageAPI<AdvisorConfig>, maxConsultsPerRun: number): ConsultLedger => {
  const counts = prism.state.agent<LedgerState>("consults", {});
  const revised = prism.state.agent<RevisedState>("revised", {});
  const trim = <T>(state: T): T => {
    if (typeof state !== "object" || state === null) return state;
    const ids = Object.keys(state);
    if (ids.length <= MAX_LEDGER_RUNS) return state;
    const out = { ...state } as Record<string, unknown>;
    for (const stale of ids.slice(0, ids.length - MAX_LEDGER_RUNS)) delete out[stale];
    return out as T;
  };
  return {
    take(runId) {
      const used = counts.get()[runId] ?? 0;
      if (used >= maxConsultsPerRun) return false;
      counts.set(trim({ ...counts.get(), [runId]: used + 1 }));
      return true;
    },
    markRevised(runId, key) {
      const keys = revised.get()[runId] ?? [];
      if (!keys.includes(key)) revised.set(trim({ ...revised.get(), [runId]: [...keys, key] }));
    },
    wasRevised(runId, key) {
      return (revised.get()[runId] ?? []).includes(key);
    },
  };
};

/** A stable key for "the same tool with the same arguments", so a revise cannot loop. */
export function callKey(name: string, args: Readonly<Record<string, JsonValue>>): string {
  const stable = (value: JsonValue): string => {
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    if (typeof value === "object" && value !== null) {
      return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stable(value[key] as JsonValue)}`)
        .join(",")}}`;
    }
    return JSON.stringify(value);
  };
  return `${name}:${stable(args as JsonValue)}`;
}

/** What one consult asked and what came back. The advice text never enters an event. */
export interface ConsultAnswer {
  readonly text: string;
  readonly totalTokens?: number;
}

/** A prompt for one consult: instructions, the rendered slice, then the question. */
export function consultPrompt(instructions: string, transcript: string, question: string): string {
  const seen = transcript.length === 0 ? "There is no earlier conversation." : `The conversation so far:\n${transcript}`;
  return `${instructions}\n\n${seen}\n\n${question}`;
}

export interface AdvisorRuntime {
  readonly config: AdvisorConfig;
  readonly client: ModelClient;
  readonly model: ModelConfig;
  readonly instructions: string;
  readonly context: ResolvedContext;
  readonly adviceMaxChars: number;
  readonly maxConsultsPerRun: number;
  readonly ledger: ConsultLedger;
}
