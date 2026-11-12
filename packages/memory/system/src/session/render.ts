import { redactSecrets } from "@arnilo/prism";
import { DEFAULT_MAX_TASK_STATE_BYTES, truncateWorkerText } from "@arnilo/prism-memory-system/core";
import { attributionLabel, isAssistantProposal } from "./attribution.js";
import { HARD_MAX_RENDERED_MEMORY_BYTES } from "./memory-bounds.js";
import type { MemoryObservation, MemoryTaskState, MemoryWmItem, MemoryWmItemKind } from "./types.js";

export interface RenderObservationalMemoryOptions {
  readonly taskState?: MemoryTaskState;
  readonly maxTaskStateBytes?: number;
  readonly secrets?: readonly (string | undefined)[];
  readonly maxBytes?: number;
  /** Include recall guidance only when recall is available. Default true. */
  readonly advertiseRecall?: boolean;
}

export function renderObservationalMemory(
  wmItems: readonly MemoryWmItem[],
  observations: readonly MemoryObservation[],
  secretsOrOptions: readonly (string | undefined)[] | RenderObservationalMemoryOptions = [],
): string {
  const options: RenderObservationalMemoryOptions = Array.isArray(secretsOrOptions)
    ? { secrets: secretsOrOptions }
    : (secretsOrOptions as RenderObservationalMemoryOptions);
  const secrets = options.secrets ?? [];
  const maxBytes = options.maxBytes ?? HARD_MAX_RENDERED_MEMORY_BYTES;
  const prefix = ["# Session Memory"];
  if (wmItems.length || observations.length || options.taskState) {
    prefix.push(
      `Use these source-backed memories when relevant and cite the ids you rely on as [id].${(options.advertiseRecall ?? true) ? " To inspect evidence, call recall with an id; [chunk] marks a record whose verbatim source text recall returns. Do not guess ids." : ""}`,
      "",
    );
  }
  // Design §5.1: the WM surface (facts, then summaries, then events), the STM surface not yet processed, then the task
  // state. One function renders it for compaction, the pinned block and `memory:session:view`.
  const wm = WM_KIND_ORDER.flatMap((kind) => wmItems.filter((item) => item.kind === kind));
  prefix.push("## Working memory", ...(wm.length ? wm.map(renderWmItem) : ["- none"]), "", "## Observations");
  const dateOf = (item: MemoryObservation) => item.observedAt ?? item.timestamp;
  const kept = [...observations].sort((a, b) => Date.parse(dateOf(a)) - Date.parse(dateOf(b)));
  const task = options.taskState;
  const taskLines = task
    ? [
        "",
        "## Current task",
        `- [${task.id}] Goal: ${task.goal}`,
        ...(["openQuestions", "decisions", "nextSteps"] as const).flatMap((key) =>
          task[key]?.length
            ? [
                `${{ openQuestions: "Open questions", decisions: "Decisions", nextSteps: "Next steps" }[key]}:`,
                ...task[key]!.map((text) => `- ${text}`),
              ]
            : [],
        ),
      ]
    : [];
  const taskText = truncateWorkerText(taskLines.join("\n"), options.maxTaskStateBytes ?? DEFAULT_MAX_TASK_STATE_BYTES);
  const render = (start: number) => {
    const lines: string[] = [];
    let previousDate: string | undefined;
    for (const item of kept.slice(start)) {
      const date = dateOf(item);
      if (date.slice(0, 10) !== previousDate) lines.push(`### ${date.slice(0, 10)}`);
      previousDate = date.slice(0, 10);
      // Task 4.1: an assistant-only request, statement or decision renders `assistant proposal`; a mixed one names both
      // sides. Chunk text never renders here: a record with chunks shows only the `[chunk]` marker; `recall` reads them.
      lines.push(
        `- [${item.id}] ${date.slice(11, 16)} (${item.relevance}) ${attributionLabel(item.kind, item.attribution, isAssistantProposal(item))}${(item.count ?? 1) > 1 ? ` ×${item.count}` : ""}: ${item.description}${item.referencedAt ? ` (refers to ${item.referencedAt})` : ""}${item.chunkRefs?.length ? " [chunk]" : ""}`,
      );
    }
    return redactSecrets([...prefix, ...(lines.length ? lines : ["- none"]), ...(taskText ? [taskText] : [])].join("\n"), secrets);
  };
  let start = 0;
  let text = render(start);
  while (start < kept.length && Buffer.byteLength(text, "utf8") > maxBytes) text = render(++start);
  if (taskText && Buffer.byteLength(text, "utf8") > maxBytes) {
    const tail = truncateWorkerText(redactSecrets(taskText, secrets), maxBytes);
    const body = text.slice(0, text.lastIndexOf("\n## Current task"));
    const remaining = maxBytes - Buffer.byteLength(tail, "utf8");
    return `${truncateWorkerText(body, remaining)}${tail}`;
  }
  return truncateWorkerText(text, maxBytes);
}

/** The order WM items render in: facts, summaries, events. */
const WM_KIND_ORDER: readonly MemoryWmItemKind[] = ["fact", "summary", "event"];

/** A WM item's speaker mark (Task 4.1): the STM record marks, after the kind. */
function wmMark(item: MemoryWmItem): string {
  return item.attribution === "assistant" ? " (assistant proposal)" : item.attribution === "mixed" ? " (user + assistant)" : "";
}

/** One WM item line: kind, relevance, its time span, its speaker mark, and the `[chunk]` marker when it holds chunks (never their text). */
export function renderWmItem(item: MemoryWmItem): string {
  const span = item.observedFrom && item.observedTo ? `(${item.observedFrom} – ${item.observedTo}) ` : "";
  return `- [${item.id}] ${span}(${item.relevance}) ${item.kind}${wmMark(item)}: ${item.text}${item.chunkRefs?.length ? " [chunk]" : ""}`;
}
