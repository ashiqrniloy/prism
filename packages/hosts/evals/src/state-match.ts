import { EvalError } from "./errors.js";
import { defineScorer } from "./scorer.js";
import type { DatasetItem, Scorer } from "./types.js";

export interface StateMatchScorerOptions<TInput = unknown, TExpected = unknown> {
  readonly id?: string;
  readonly expected: unknown | ((item: DatasetItem<TInput, TExpected> | undefined) => unknown);
  readonly select?: (environment: unknown) => unknown;
  readonly mode: "exact" | "subset";
  /** JSON pointers relative to the selected state; array positions are removed without reindexing. */
  readonly ignore?: readonly string[];
  readonly invariant?: boolean;
}

const MAX_STATE_BYTES = 1024 * 1024;

function snapshot(value: unknown): unknown {
  if (value === undefined) return undefined;
  const json = JSON.stringify(value, (_key, entry: unknown) => {
    if (typeof entry === "function" || typeof entry === "symbol" || typeof entry === "bigint"
      || (typeof entry === "number" && !Number.isFinite(entry))) {
      throw new EvalError("state must be JSON serializable", "ERR_PRISM_EVAL_STATE_INVALID");
    }
    return entry;
  });
  if (json === undefined) throw new EvalError("state must be JSON serializable", "ERR_PRISM_EVAL_STATE_INVALID");
  if (Buffer.byteLength(json) > MAX_STATE_BYTES) {
    throw new EvalError("state exceeds 1 MiB", "ERR_PRISM_EVAL_STATE_BOUNDS");
  }
  return JSON.parse(json);
}

function preview(value: unknown): unknown {
  if (value === undefined) return undefined;
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json) <= 256) return value;
  let text = "";
  for (const char of json) {
    if (Buffer.byteLength(JSON.stringify(text + char + "…")) > 256) break;
    text += char;
  }
  return text + "…";
}

function removePointer(state: unknown, tokens: readonly string[]): unknown {
  if (!tokens.length) return undefined;
  let parent = state;
  for (const token of tokens.slice(0, -1)) {
    if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, token)) return state;
    parent = (parent as Record<string, unknown>)[token];
  }
  if (parent && typeof parent === "object") delete (parent as Record<string, unknown>)[tokens[tokens.length - 1]!];
  return state;
}

export function createStateMatchScorer<TInput = unknown, TExpected = unknown>(
  options: StateMatchScorerOptions<TInput, TExpected>,
): Scorer<TInput, TExpected> {
  if (options.mode !== "exact" && options.mode !== "subset") {
    throw new EvalError("state match mode must be exact or subset", "ERR_PRISM_EVAL_SCORER");
  }
  const pointers = (options.ignore ?? []).map(pointer => {
    if (typeof pointer !== "string" || (pointer !== "" && !pointer.startsWith("/")) || /~(?![01])/u.test(pointer)) {
      throw new EvalError("invalid state ignore JSON pointer", "ERR_PRISM_EVAL_SCORER");
    }
    return pointer === "" ? [] : pointer.slice(1).split("/").map(token => token.replace(/~1/g, "/").replace(/~0/g, "~"));
  });
  return defineScorer({
    id: options.id ?? "state_match",
    description: `state match (${options.mode})`,
    requires: ["environment"],
    invariant: options.invariant,
    score(input) {
      if (input.environment === undefined) return { score: 0, reason: "no environment available for state scoring" };
      const goal = typeof options.expected === "function" ? options.expected(input.item) : options.expected;
      let expected = snapshot(goal);
      let actual = snapshot(options.select ? options.select(input.environment) : input.environment);
      if (input.redactor) {
        expected = snapshot(input.redactor.redact(expected));
        actual = snapshot(input.redactor.redact(actual));
      }
      for (const tokens of pointers) {
        expected = removePointer(expected, tokens);
        actual = removePointer(actual, tokens);
      }
      const diff: { path: string; expected: unknown; actual: unknown }[] = [];
      const mismatch = (path: string, expected: unknown, actual: unknown) => {
        diff.push({ path, expected: preview(expected), actual: preview(actual) });
      };
      const compare = (expected: unknown, actual: unknown, path: string): void => {
        if (diff.length >= 32 || expected === actual) return;
        if (!expected || !actual || typeof expected !== "object" || typeof actual !== "object"
          || Array.isArray(expected) !== Array.isArray(actual)) {
          mismatch(path, expected, actual);
          return;
        }
        const goal = expected as Record<string, unknown>;
        const state = actual as Record<string, unknown>;
        for (const key of Object.keys(goal)) {
          if (diff.length >= 32) return;
          const child = `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
          if (!Object.hasOwn(state, key)) mismatch(child, goal[key], undefined);
          else compare(goal[key], state[key], child);
        }
        if (options.mode === "exact") {
          for (const key of Object.keys(state)) {
            if (diff.length >= 32) return;
            if (!Object.hasOwn(goal, key)) mismatch(`${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`, undefined, state[key]);
          }
        }
      };
      compare(expected, actual, "");
      return diff.length ? { score: 0, reason: "state mismatch", metadata: { diff } } : { score: 1 };
    },
  });
}
