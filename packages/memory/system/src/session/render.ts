import { redactSecrets } from "@arnilo/prism";
import { DEFAULT_MAX_TASK_STATE_BYTES, truncateWorkerText } from "@arnilo/prism-memory-system/core";
import { attributionLabel, isAssistantProposal } from "./attribution.js";
import { HARD_MAX_RENDERED_MEMORY_BYTES } from "./memory-bounds.js";
import { parseNeededLaterSteps } from "./scope.js";
import type { MemoryObservation, MemoryTaskState, MemoryWmItem, MemoryWmItemKind } from "./types.js";

export interface RenderObservationalMemoryOptions {
  readonly taskState?: MemoryTaskState;
  readonly maxTaskStateBytes?: number;
  readonly secrets?: readonly (string | undefined)[];
  readonly maxBytes?: number;
  /** Include recall guidance only when recall is available. Default true. */
  readonly advertiseRecall?: boolean;
  /**
   * Records WM took off the surface (tombstoned). Set only at compaction (plan 218.2 Task 7): with recall advertised and a
   * count above zero, one line says how many there are and that `recall` with a query searches them.
   */
  readonly discardedCount?: number;
  /**
   * The scope's remaining step ordinals, in order (`remainingStepOrdinals`, plan 218.3 Task 8). WM items whose
   * `neededLater` names the next remaining step render first, then those for later remaining steps, then the rest.
   */
  readonly remainingSteps?: readonly number[];
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
      `Use these source-backed memories when relevant and cite the ids you rely on as [id].${(options.advertiseRecall ?? true) ? " To inspect evidence, call recall with an id; detail full returns the original messages and tool outputs it cites. Do not guess ids." : ""}`,
    );
    const discarded = options.discardedCount ?? 0;
    if ((options.advertiseRecall ?? true) && discarded > 0) {
      prefix.push(
        `${discarded} earlier record${discarded === 1 ? " was" : "s were"} taken off this surface by working memory; call recall with a query to search them.`,
      );
    }
    prefix.push("");
  }
  // Design §5.1: the WM surface (facts, then summaries, then events), the STM surface not yet processed, then the task
  // state. One function renders it for compaction, the pinned block and `memory:session:view`.
  const wm = orderWmItems(wmItems, options.remainingSteps ?? []);
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
      // sides.
      lines.push(
        `- [${item.id}] ${date.slice(11, 16)} (${item.relevance}) ${attributionLabel(item.kind, item.attribution, isAssistantProposal(item))}${signalMarks(item)}${(item.count ?? 1) > 1 ? ` ×${item.count}` : ""}: ${item.description}${item.referencedAt ? ` (refers to ${item.referencedAt})` : ""}`,
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

/** Plan 218.2 Task 2: the recorder's signals after the kind: `(failed)`, `(constraint)`, `(correction)`, `(verbatim)`. */
function signalMarks(item: MemoryObservation): string {
  const marks = [item.status, item.durable, item.corrects ? "correction" : undefined, item.verbatim ? "verbatim" : undefined].filter(
    Boolean,
  );
  return marks.length ? ` (${marks.join(", ")})` : "";
}

/** The order WM items render in: facts, summaries, events. */
const WM_KIND_ORDER: readonly MemoryWmItemKind[] = ["fact", "summary", "event"];

/**
 * WM items in block order: by the first remaining step their `neededLater` names (the next step first), items naming
 * no remaining step last; facts, summaries, events within each group. Stable otherwise.
 */
export function orderWmItems(items: readonly MemoryWmItem[], remainingSteps: readonly number[]): readonly MemoryWmItem[] {
  const position = new Map(remainingSteps.map((step, index) => [step, index]));
  const rank = (item: MemoryWmItem) =>
    Math.min(...parseNeededLaterSteps(item.neededLater).map((step) => position.get(step) ?? Number.POSITIVE_INFINITY));
  return items
    .map((item, index) => ({ item, index, rank: rank(item), kind: WM_KIND_ORDER.indexOf(item.kind) }))
    .sort((a, b) => a.rank - b.rank || a.kind - b.kind || a.index - b.index)
    .map(({ item }) => item);
}

/** A WM item's speaker mark (Task 4.1): the STM record marks, after the kind. */
function wmMark(item: MemoryWmItem): string {
  return item.attribution === "assistant" ? " (assistant proposal)" : item.attribution === "mixed" ? " (user + assistant)" : "";
}

/** One WM item line: kind, relevance, its time span and its speaker mark. */
export function renderWmItem(item: MemoryWmItem): string {
  const span = item.observedFrom && item.observedTo ? `(${item.observedFrom} – ${item.observedTo}) ` : "";
  return `- [${item.id}] ${span}(${item.relevance}) ${item.kind}${wmMark(item)}: ${item.text}`;
}
