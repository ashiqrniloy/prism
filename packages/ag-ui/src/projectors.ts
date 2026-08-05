import type { Message as AgUiMessage } from "@ag-ui/core";
import type { AgentEvent } from "@arnilo/prism";
import type { AgUiProjection } from "./projection.js";

/** Default / hard caps for standard message projectors (Task 0 freeze). */
export const DEFAULT_MAX_PROJECTOR_MESSAGES = 128;
export const HARD_MAX_PROJECTOR_MESSAGES = 1024;

/** Host-owned run-state snapshot source. Prism starts no watcher. */
export interface AgUiStateStore {
  get(): unknown;
  subscribe?(onChange: () => void): () => void;
}

export interface CreateMessagesFromSessionProjectionOptions {
  /**
   * Host-owned authorized AG-UI transcript (sync). Prefer this for full session history.
   * Absent → accumulate from `message_finished` events in the live stream.
   */
  readonly getMessages?: () => readonly AgUiMessage[];
  readonly redact?: (message: AgUiMessage) => AgUiMessage | undefined;
  readonly maxMessages?: number;
}

export interface CreateStateFromStoreProjectionOptions {
  readonly maxStateBytes?: number;
  readonly maxPatchOperations?: number;
}

export interface CreateActivityFromToolProgressProjectionOptions {
  readonly activityType?: string;
}

/**
 * Opt-in `MESSAGES_SNAPSHOT` projector. Emits when the authorized transcript is available
 * (host `getMessages`) or when the live stream finishes a message.
 */
export function createMessagesFromSessionProjection(options: CreateMessagesFromSessionProjectionOptions = {}): AgUiProjection {
  const maxMessages = clamp(options.maxMessages, DEFAULT_MAX_PROJECTOR_MESSAGES, HARD_MAX_PROJECTOR_MESSAGES);
  const accumulated: AgUiMessage[] = [];
  let lastKey: string | undefined;

  const project = (raw: readonly AgUiMessage[]): readonly AgUiMessage[] | undefined => {
    const out: AgUiMessage[] = [];
    for (const message of raw.slice(-maxMessages)) {
      try {
        const next = options.redact ? options.redact(message) : message;
        if (next) out.push(next);
      } catch {
        // redactor throw → drop that message closed
      }
    }
    const key = stableKey(out);
    if (key === lastKey) return undefined;
    lastKey = key;
    return out;
  };

  return {
    messages(event) {
      if (options.getMessages) {
        if (event.type !== "agent_started" && event.type !== "message_finished" && event.type !== "agent_finished") {
          return undefined;
        }
        try {
          return project(options.getMessages());
        } catch {
          return undefined;
        }
      }
      if (event.type === "message_finished") {
        const converted = prismMessageToAgUi(event.message);
        if (converted) accumulated.push(converted);
        return project(accumulated);
      }
      return undefined;
    },
  };
}

/**
 * Opt-in state projector. `STATE_SNAPSHOT` on `agent_started`; RFC 6902 `STATE_DELTA`
 * (add/replace/remove) when `store.get()` changes. Optional `subscribe` only marks dirty —
 * Prism starts no background watcher.
 */
export function createStateFromStoreProjection(store: AgUiStateStore, options: CreateStateFromStoreProjectionOptions = {}): AgUiProjection {
  const maxBytes = options.maxStateBytes ?? 64 * 1024;
  const maxOps = options.maxPatchOperations ?? 128;
  let last: unknown;
  let snapped = false;
  let dirty = true;
  store.subscribe?.(() => {
    dirty = true;
  });

  return {
    stateSnapshot(event) {
      if (event.type !== "agent_started" || snapped) return undefined;
      try {
        const value = store.get();
        if (!withinBytes(value, maxBytes)) return undefined;
        last = cloneJson(value);
        snapped = true;
        dirty = false;
        return last;
      } catch {
        return undefined;
      }
    },
    stateDelta() {
      if (!snapped) return undefined;
      try {
        const value = store.get();
        if (!dirty && stableKey(value) === stableKey(last)) return undefined;
        if (!withinBytes(value, maxBytes)) return undefined;
        const patch = jsonDiff(last, value);
        if (patch.length === 0 || patch.length > maxOps) return undefined;
        last = cloneJson(value);
        dirty = false;
        return patch;
      } catch {
        return undefined;
      }
    },
  };
}

/**
 * Opt-in activity projector for `tool_execution_progress`. First progress per tool call →
 * snapshot; later updates → delta. Missing/malformed payloads drop closed.
 */
export function createActivityFromToolProgressProjection(options: CreateActivityFromToolProgressProjectionOptions = {}): AgUiProjection {
  const activityType = options.activityType ?? "tool-progress";
  const last = new Map<string, Record<string, unknown>>();

  return {
    activity(event: AgentEvent) {
      if (event.type !== "tool_execution_progress") return undefined;
      if (event.progress === undefined && event.metadata === undefined) return undefined;
      const messageId = `tool-progress-${event.toolCallId}`;
      const content: Record<string, unknown> = {
        toolCallId: event.toolCallId,
        name: event.name,
        ...(event.progress !== undefined ? { progress: event.progress } : {}),
        ...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
      };
      const previous = last.get(event.toolCallId);
      if (!previous) {
        last.set(event.toolCallId, content);
        return { type: "snapshot" as const, messageId, activityType, content };
      }
      const patch = jsonDiff(previous, content);
      last.set(event.toolCallId, content);
      if (patch.length === 0) return undefined;
      return { type: "delta" as const, messageId, activityType, patch };
    },
  };
}

/** Merge projectors; **first defined callback wins** (left to right). Undefined fragments skipped. */
export function composeAgUiProjections(...projections: readonly (AgUiProjection | undefined)[]): AgUiProjection {
  const list = projections.filter((item): item is AgUiProjection => item !== undefined);
  const first = <K extends keyof AgUiProjection>(key: K): AgUiProjection[K] | undefined => {
    for (const projection of list) {
      const value = projection[key];
      if (value !== undefined) return value;
    }
    return undefined;
  };
  return {
    toolArguments: first("toolArguments"),
    toolResult: first("toolResult"),
    state: first("state"),
    stateSnapshot: first("stateSnapshot"),
    stateDelta: first("stateDelta"),
    messages: first("messages"),
    activity: first("activity"),
    reasoning: first("reasoning"),
    raw: first("raw"),
    custom: first("custom"),
    interrupt: first("interrupt"),
    coWork: first("coWork"),
    path: first("path"),
  };
}

/** Minimal RFC 6902 add/replace/remove diff. Arrays replaced as a whole when unequal. */
export function jsonDiff(from: unknown, to: unknown, path = ""): unknown[] {
  if (stableKey(from) === stableKey(to)) return [];
  if (!isPlainObject(from) || !isPlainObject(to)) {
    if (path === "") return [{ op: "replace", path: "", value: to }];
    return [{ op: from === undefined ? "add" : "replace", path, value: to }];
  }
  const ops: unknown[] = [];
  for (const key of Object.keys(to)) {
    const child = `${path}/${escapePointer(key)}`;
    if (!Object.hasOwn(from, key)) {
      ops.push({ op: "add", path: child, value: to[key] });
      continue;
    }
    const left = from[key];
    const right = to[key];
    if (stableKey(left) === stableKey(right)) continue;
    if (isPlainObject(left) && isPlainObject(right)) ops.push(...jsonDiff(left, right, child));
    else ops.push({ op: "replace", path: child, value: right });
  }
  for (const key of Object.keys(from)) {
    if (!Object.hasOwn(to, key)) ops.push({ op: "remove", path: `${path}/${escapePointer(key)}` });
  }
  return ops;
}

function prismMessageToAgUi(message: {
  readonly id?: string;
  readonly role: string;
  readonly content: readonly { readonly type: string; readonly text?: string }[];
}): AgUiMessage | undefined {
  if (message.role !== "user" && message.role !== "assistant" && message.role !== "system" && message.role !== "developer") {
    return undefined;
  }
  const text = message.content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("");
  const id = message.id ?? `msg-${message.role}-${text.length}`;
  switch (message.role) {
    case "user":
      return { id, role: "user", content: text };
    case "assistant":
      return { id, role: "assistant", content: text };
    case "system":
      return { id, role: "system", content: text };
    case "developer":
      return { id, role: "developer", content: text };
    default:
      return undefined;
  }
}

function escapePointer(key: string): string {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function stableKey(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "undefined";
  } catch {
    return "unserializable";
  }
}

function withinBytes(value: unknown, maxBytes: number): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? "null", "utf8") <= maxBytes;
  } catch {
    return false;
  }
}

function clamp(value: number | undefined, fallback: number, hard: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.min(Math.floor(value), hard);
}
