// @ts-nocheck — evaluation script fixtures, not shipped; run by bun.
import type { ToolDefinition } from "@arnilo/prism";

/** Tools that exist only so the offline arms carry the names a skill's `requiresTools` needs. */
export function stubTools(names: readonly string[]): ToolDefinition[] {
  return names.map((name) => ({
    name,
    description: `Offline stand-in for ${name}; never called by the scripted provider.`,
    effects: ["read"],
    parameters: { type: "object", properties: {}, additionalProperties: true },
    execute: async (_args, context) => ({ toolCallId: context.toolCallId, name, content: [{ type: "text", text: "offline stub" }] }),
  }));
}

/** Deterministic filler so a page is long enough that reading it in slices matters. */
export function filler(count: number, seed: string): string[] {
  const subjects = [
    "The scheduler",
    "A worker",
    "The status endpoint",
    "The audit log",
    "The retry queue",
    "The cache layer",
    "The admin console",
    "The export job",
  ];
  const verbs = ["batches", "reports", "records", "rotates", "validates", "compacts", "replays", "streams"];
  const objects = [
    "pending items in windows",
    "progress through a single endpoint",
    "every change with a timestamp",
    "its state when the process restarts",
    "configuration before it is applied",
    "older entries once a limit is reached",
  ];
  const out: string[] = [];
  let state = [...seed].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);
  const next = (bound: number) => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state % bound;
  };
  for (let index = 0; index < count; index += 1)
    out.push(
      `${subjects[next(subjects.length)]} ${verbs[next(verbs.length)]} ${objects[next(objects.length)]}; section ${index + 1} of this reference describes the surrounding behaviour in detail and links to related topics.`,
    );
  return out;
}
