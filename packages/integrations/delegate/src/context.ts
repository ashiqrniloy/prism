import { type DelegateConfig } from "./config.js";
import {
  type Message,
  type OwnershipScope,
  type PackageAPI,
  type ProviderEvent,
  selectTranscript,
  type SessionContext,
  type SessionEntry,
  type TranscriptSlice,
} from "@arnilo/prism";

/** How much of the parent's conversation a child is given. Host-configured only: the tool has no argument for it. */
export type DelegateContextConfig = "none" | "summary" | { readonly lastTurns: number; readonly maxChars?: number };

export const DEFAULT_CONTEXT_MAX_CHARS = 24_000;
export const HARD_CONTEXT_MAX_CHARS = 120_000;
export const HARD_CONTEXT_LAST_TURNS = 50;
/** Input budget for the one summarization call: four times the summary it asks for. */
const SUMMARY_INPUT_CHARS = 48_000;
const SUMMARY_MAX_CHARS = 4_000;

export const SUMMARY_INSTRUCTION =
  "Summarize this conversation for a sub-agent: the goal, decisions, facts established, files touched, and open problems. Under 4,000 characters.";

export type ResolvedContext =
  | { readonly mode: "none" }
  | { readonly mode: "lastTurns"; readonly lastTurns: number; readonly maxChars: number; readonly clamped: boolean }
  | { readonly mode: "summary" };

/** `context` config → what the delegate runs; the shape is already schema-checked, so this only clamps. */
export function resolveChildContext(config: DelegateContextConfig | undefined): ResolvedContext {
  if (config === undefined || config === "none") return { mode: "none" };
  if (config === "summary") return { mode: "summary" };
  const requested = config.maxChars ?? DEFAULT_CONTEXT_MAX_CHARS;
  const maxChars = Math.min(requested, HARD_CONTEXT_MAX_CHARS);
  return { mode: "lastTurns", lastTurns: config.lastTurns, maxChars, clamped: maxChars !== requested };
}

export interface ContextUsed {
  readonly mode: "lastTurns" | "summary";
  readonly turns: number;
  readonly omittedTurns: number;
  readonly truncated: boolean;
}

export interface SeededContext {
  readonly sessionId: string;
  readonly entries: readonly SessionEntry[];
  readonly used: ContextUsed;
}

const entryId = () => `entry_${crypto.randomUUID()}`;

/** One `summary` entry per summary, then one `message` entry per message, chained and owner-stamped. */
function seedEntries(slice: TranscriptSlice, sessionId: string, ownership: OwnershipScope | undefined): SessionEntry[] {
  const out: SessionEntry[] = [];
  const push = (fields: Pick<SessionEntry, "kind" | "message" | "summary">) => {
    out.push({
      id: entryId(),
      ...(out.at(-1) === undefined ? {} : { parentId: (out.at(-1) as SessionEntry).id }),
      sessionId,
      timestamp: new Date().toISOString(),
      ...(ownership === undefined ? {} : { metadata: { ...ownership } }),
      ...fields,
    });
  };
  for (const summary of slice.summaries) push({ kind: "summary", summary });
  for (const message of [...slice.pinned, ...slice.messages]) push({ kind: "message", message });
  return out;
}

/** One provider call, text only: the summary the child will read instead of the conversation. */
async function summarize(prism: PackageAPI<DelegateConfig>, model: { provider: string; model: string }, slice: TranscriptSlice): Promise<string> {
  const transcript = [
    ...slice.summaries.map((summary) => `Summary of earlier conversation:\n${summary}`),
    ...slice.messages.map((message) => `${message.role}: ${messageText(message)}`),
  ].join("\n\n");
  const parts: string[] = [];
  let length = 0;
  for await (const event of prism.models.client({ provider: model.provider, model: model.model }).generate({
    messages: [{ role: "user", content: [{ type: "text", text: `${SUMMARY_INSTRUCTION}\n\n${transcript}` }] }],
  }) as AsyncIterable<ProviderEvent>) {
    if (event.type === "error") throw new Error("the summarization call failed");
    const content = (event as { content?: { type?: string; text?: string } }).content;
    if (event.type !== "content_delta" || content?.type !== "text" || typeof content.text !== "string") continue;
    parts.push(content.text);
    length += content.text.length;
    if (length >= SUMMARY_MAX_CHARS) break;
  }
  return parts.join("").slice(0, SUMMARY_MAX_CHARS);
}

function messageText(message: Message): string {
  return message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
}

/**
 * The entries a context-carrying child starts with, plus what to report. `"none"` never calls this.
 * A parent branch is read once; the summary mode adds one model call and seeds its answer only.
 */
export async function buildSeededContext(input: {
  readonly prism: PackageAPI<DelegateConfig>;
  readonly session: SessionContext;
  readonly model: { provider: string; model: string };
  readonly context: Exclude<ResolvedContext, { mode: "none" }>;
  readonly ownership: OwnershipScope | undefined;
  readonly signal?: AbortSignal;
}): Promise<SeededContext> {
  const entries = await input.session.entries();
  if (input.context.mode === "summary") {
    const slice = selectTranscript(entries, { maxChars: SUMMARY_INPUT_CHARS });
    const summary = await summarize(input.prism, input.model, slice);
    const sessionId = `session_${crypto.randomUUID()}`;
    return {
      sessionId,
      entries: seedEntries({ summaries: [summary], pinned: [], messages: [], turns: 0, omittedTurns: 0, truncated: false }, sessionId, input.ownership),
      used: { mode: "summary", turns: slice.turns, omittedTurns: slice.omittedTurns, truncated: slice.truncated },
    };
  }
  const slice = selectTranscript(entries, { lastTurns: input.context.lastTurns, maxChars: input.context.maxChars });
  const sessionId = `session_${crypto.randomUUID()}`;
  return {
    sessionId,
    entries: seedEntries(slice, sessionId, input.ownership),
    used: { mode: "lastTurns", turns: slice.turns, omittedTurns: slice.omittedTurns, truncated: slice.truncated },
  };
}
