/**
 * Test helpers for the WM `judge` call (plan 218.2 Task 5). Tests name records and items by id; the WM prompt shows
 * ordinals. `judgeArgs` finds each id's ordinal by the prompt line that ends with its description or text, so a test
 * reads like the verdicts it means. An id it cannot find stays as given and the tool refuses it (`unknown_id`).
 */
import type { ModelClient } from "@arnilo/prism";
import { providerDone, providerToolCall, toolCallContent } from "@arnilo/prism";

type ProviderRequest = Parameters<ModelClient["generate"]>[0];

/** A record (`description`) or WM item (`text`) a test refers to by id. */
export interface Named {
  readonly id: string;
  readonly description?: string;
  readonly text?: string;
}

export interface JudgeSpec {
  readonly keep?: readonly { readonly id: string; readonly reason: string; readonly neededLater?: string }[];
  readonly discard?: Readonly<Record<string, readonly string[]>>;
  readonly summaries?: readonly {
    readonly of: readonly string[];
    readonly text: string;
    readonly relevance: string;
    readonly supersedes?: readonly string[];
    readonly neededLater?: string;
  }[];
  readonly facts?: readonly {
    readonly support: readonly string[];
    readonly text: string;
    readonly relevance: string;
    readonly supersedes?: readonly string[];
    readonly neededLater?: string;
  }[];
}

/** The user prompt of a WM request. */
export const promptText = (request: ProviderRequest): string =>
  (request.messages.find((message) => message.role === "user")?.content ?? [])
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");

/** Ordinal labels (`r3`, `w1`, `j2`) by id, read from the prompt lines that end with each entry's description or text. */
export function ordinals(prompt: string, named: readonly Named[]): ReadonlyMap<string, string> {
  const lines = [...prompt.matchAll(/^- \[([rwj][0-9]+)\] (.*)$/gm)].map((match) => ({ label: match[1]!, rest: match[2]! }));
  const map = new Map<string, string>();
  for (const entry of named) {
    const text = entry.description ?? entry.text;
    const line = text === undefined ? undefined : lines.find((candidate) => candidate.rest.endsWith(`: ${text}`));
    if (line) map.set(entry.id, line.label);
  }
  return map;
}

/** `judge` arguments for `spec`, with ids turned into the prompt's ordinals. */
export function judgeArgs(prompt: string, named: readonly Named[], spec: JudgeSpec): Record<string, unknown> {
  const map = ordinals(prompt, named);
  const number = (id: string) => {
    const label = map.get(id);
    return label ? Number(label.slice(1)) : id;
  };
  const label = (id: string) => map.get(id) ?? id;
  return {
    ...(spec.keep
      ? {
          keep: spec.keep.map(({ id, reason, neededLater }) => ({
            [map.get(id)?.startsWith("j") ? "j" : "r"]: number(id),
            reason,
            ...(neededLater ? { neededLater } : {}),
          })),
        }
      : {}),
    ...(spec.discard
      ? { discard: Object.fromEntries(Object.entries(spec.discard).map(([reason, ids]) => [reason, ids.map(number)])) }
      : {}),
    ...(spec.summaries
      ? {
          summaries: spec.summaries.map(({ of, supersedes, ...rest }) => ({
            of: of.map(number),
            ...rest,
            ...(supersedes ? { supersedes: supersedes.map(label) } : {}),
          })),
        }
      : {}),
    ...(spec.facts
      ? {
          facts: spec.facts.map(({ support, supersedes, ...rest }) => ({
            support: support.map(label),
            ...rest,
            ...(supersedes ? { supersedes: supersedes.map(label) } : {}),
          })),
        }
      : {}),
  };
}

/** Whether a request is a WM request (it offers `judge`). */
export const isWmRequest = (request: ProviderRequest): boolean => request.tools?.some((tool) => tool.name === "judge") ?? false;

/**
 * A WM model that answers its first request with one `judge` call for `spec` (or what `spec` returns for the prompt),
 * then nothing. `requests` records every request.
 */
export function judgeClient(
  named: readonly Named[],
  spec: JudgeSpec | ((prompt: string) => JudgeSpec),
  requests: ProviderRequest[] = [],
): ModelClient {
  return {
    model: { provider: "mock", model: "m", limits: { contextWindow: 64_000, maxOutputTokens: 0 } },
    async *generate(request) {
      requests.push(request);
      if (!request.messages.some((message) => message.role === "tool")) {
        const prompt = promptText(request);
        const args = judgeArgs(prompt, named, typeof spec === "function" ? spec(prompt) : spec);
        yield providerToolCall(toolCallContent("j0", "judge", args as never));
      }
      yield providerDone();
    },
  };
}
