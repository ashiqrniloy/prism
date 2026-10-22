import { redactSecrets } from "@arnilo/prism";
import { DEFAULT_MAX_TASK_STATE_BYTES, truncateWorkerText } from "./limits.js";
import { HARD_MAX_RENDERED_MEMORY_BYTES } from "./memory-bounds.js";
import type { MemoryObservation, MemoryReflection, MemoryTaskState } from "./types.js";

export interface RenderObservationalMemoryOptions {
  readonly taskState?: MemoryTaskState;
  readonly maxTaskStateBytes?: number;
  readonly secrets?: readonly (string | undefined)[];
  readonly maxBytes?: number;
  /** Include recall guidance only when recall is available. Default true. */
  readonly advertiseRecall?: boolean;
}

export function renderObservationalMemory(
  reflections: readonly MemoryReflection[],
  observations: readonly MemoryObservation[],
  secretsOrOptions: readonly (string | undefined)[] | RenderObservationalMemoryOptions = [],
): string {
  const options: RenderObservationalMemoryOptions = Array.isArray(secretsOrOptions)
    ? { secrets: secretsOrOptions }
    : (secretsOrOptions as RenderObservationalMemoryOptions);
  const secrets = options.secrets ?? [];
  const maxBytes = options.maxBytes ?? HARD_MAX_RENDERED_MEMORY_BYTES;
  const prefix = ["# Observational Memory"];
  if (reflections.length || observations.length || options.taskState) {
    prefix.push(
      `Use these source-backed memories when relevant and cite the ids you rely on as [id].${(options.advertiseRecall ?? true) ? " To inspect evidence, call recall with an id; do not guess ids." : ""}`,
      "",
    );
  }
  prefix.push(
    "## Reflections",
    ...(reflections.length
      ? reflections.map(
          (item) =>
            `- [${item.id}] ${item.observedFrom && item.observedTo ? `(${item.observedFrom} – ${item.observedTo}) ` : ""}${item.content}`,
        )
      : ["- none"]),
    "",
    "## Observations",
  );
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
      lines.push(
        `- [${item.id}] ${date.slice(11, 16)} (${item.relevance}) ${item.content}${item.referencedAt ? ` (refers to ${item.referencedAt})` : ""}`,
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
