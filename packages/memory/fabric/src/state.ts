/**
 * Read-time current-state view (plan 202 Task 7). The free grouping in `recall.ts` already orders
 * same-subject hits newest-first and marks older ones; this opt-in wrapper turns that grouped
 * evidence into one short StateMem-style table. It is the only model call on the read path and is
 * never part of the preset.
 */
import type { Message, ModelClient } from "@arnilo/prism";
import type { MemoryNoteHit } from "./types.js";

/** The wrapper's whole input budget, so a recall cannot grow the prompt without bound. */
export const STATE_INPUT_TOKEN_CAP = 2_000;
const STATE_INPUT_CHAR_CAP = STATE_INPUT_TOKEN_CAP * 4;
const STATE_NOTE_CHARS = 240;
const STATE_TABLE_CHARS = 4_000;
const STATE_SYSTEM =
  "You maintain a current-state table from recalled memory. Use only the notes. When notes disagree, the newest dated note wins. Write one line per subject: subject | current value | [id]. Cite the ids you use exactly. If the notes do not establish a current value, omit the subject. No preamble, no invented facts.";

export interface MemoryFabricStateConfig {
  /** Model ref for the wrapper; absent uses the host's default model. */
  readonly model?: string;
}

export interface ResolvedStateConfig {
  readonly model?: string;
}

/** `state: true` and `state: {}` both enable; absent or `false` makes no model call. */
export function resolveStateConfig(value: boolean | MemoryFabricStateConfig | undefined): false | ResolvedStateConfig {
  if (value === undefined || value === false) return false;
  if (value === true) return {};
  if (typeof value !== "object" || value === null) return false;
  return { ...(typeof value.model === "string" && value.model.length > 0 ? { model: value.model } : {}) };
}

export interface BuildStateTableInput {
  readonly query: string;
  /** Already grouped newest-first, and already selected by the recall budget. */
  readonly hits: readonly MemoryNoteHit[];
  readonly client: ModelClient;
  readonly signal?: AbortSignal;
}

function stateTime(hit: MemoryNoteHit): string {
  const ms = Date.parse(hit.dates?.[0]?.resolved ?? hit.tRef ?? hit.ingestedAt);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : hit.ingestedAt.slice(0, 10);
}

function stateRow(hit: MemoryNoteHit): string {
  const key = hit.key === undefined ? "" : ` key=${hit.key}`;
  const superseded = hit.supersededBy === undefined ? "" : ` superseded_by=${hit.supersededBy.id} on ${hit.supersededBy.at.slice(0, 10)}?`;
  return `[${hit.id}] ${hit.kind} ${stateTime(hit)}${key}${superseded}\n${hit.content.replace(/\s+/g, " ").slice(0, STATE_NOTE_CHARS)}`;
}

/**
 * One model call over the grouped hits, capped at {@link STATE_INPUT_TOKEN_CAP} by character
 * estimate. Returns `undefined` on empty/failed output or when the answer cites no shown id; a
 * wrapper is an aid, never a reason for recall to fail.
 */
export async function buildStateTable(input: BuildStateTableInput): Promise<string | undefined> {
  if (input.hits.length === 0) return undefined;
  const question = input.query.replace(/\s+/g, " ").trim().slice(0, 500);
  const rows: string[] = [];
  let chars = STATE_SYSTEM.length + question.length + 64;
  for (const hit of input.hits) {
    const row = stateRow(hit);
    if (chars + row.length + 1 > STATE_INPUT_CHAR_CAP && rows.length > 0) break;
    rows.push(row);
    chars += row.length + 1;
  }
  if (rows.length === 0) return undefined;
  const messages: readonly Message[] = [
    { role: "system", content: [{ type: "text", text: STATE_SYSTEM }] },
    {
      role: "user",
      content: [{ type: "text", text: `Question: ${question}\n\nNotes (newest first):\n${rows.join("\n")}` }],
    },
  ];
  let text = "";
  for await (const event of input.client.generate({
    messages,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  })) {
    if (event.type === "content_delta" && event.content.type === "text") text += event.content.text;
  }
  const table = text.trim();
  if (table.length === 0 || table.length > STATE_TABLE_CHARS) return undefined;
  return input.hits.some((hit) => table.includes(hit.id)) ? table : undefined;
}
