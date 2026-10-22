import { type AGUIEvent, EventType } from "@ag-ui/core";
import type { SecretRedactor, ToolCallDeltaContent, ToolResult } from "@arnilo/prism";
import { AgUiError } from "./errors.js";
import type { ParsedAgUiInput } from "./input.js";
import { assertBoundedJson } from "./input.js";
import type { ResolvedAgUiLimits } from "./limits.js";
import { projectAgUiJson, projectAgUiPatch } from "./projection.js";

export const A2UI_ACTIVITY_TYPE = "a2ui-surface";
export const A2UI_OPERATIONS_KEY = "a2ui_operations";
export const A2UI_VERSION = "v0.9";
export const A2UI_ERROR_EVENT = "prism.a2ui.error";

const OP_KEYS = ["createSurface", "updateComponents", "updateDataModel", "deleteSurface"] as const;

export const DEFAULT_MAX_A2UI_OPS_PER_MESSAGE = 64;
export const HARD_MAX_A2UI_OPS_PER_MESSAGE = 512;
export const DEFAULT_MAX_A2UI_OPERATION_BYTES = 64 * 1024;
export const HARD_MAX_A2UI_OPERATION_BYTES = 1024 * 1024;
export const DEFAULT_MAX_A2UI_SURFACES_PER_RUN = 16;
export const HARD_MAX_A2UI_SURFACES_PER_RUN = 64;
export const DEFAULT_MAX_A2UI_COMPONENT_DEPTH = 32;
export const HARD_MAX_A2UI_COMPONENT_DEPTH = 64;

export interface AgUiA2UiLimitOptions {
  readonly maxOperationsPerMessage?: number;
  readonly maxOperationBytes?: number;
  readonly maxSurfacesPerRun?: number;
  readonly maxComponentDepth?: number;
}

export interface ResolvedAgUiA2UiLimits {
  readonly maxOperationsPerMessage: number;
  readonly maxOperationBytes: number;
  readonly maxSurfacesPerRun: number;
  readonly maxComponentDepth: number;
}

export interface AgUiA2UiOptions {
  readonly catalogId: string;
  readonly allowedCatalogIds?: readonly string[];
  readonly mode: "fixed-schema" | "streaming" | "both";
  /** Default `render_a2ui`; streaming-mode source tool name. */
  readonly renderToolName?: string;
  readonly limits?: AgUiA2UiLimitOptions;
}

/** Documented untrusted action shape delivered to `input.project`. */
export interface AgUiA2UiAction {
  readonly type: "a2ui-action";
  readonly surfaceId: string;
  readonly actionName: string;
  readonly payload?: unknown;
}

export interface AgUiA2UiPainter {
  /** Fixed-schema paint from a dispatched tool result carrying `a2ui_operations`. */
  onToolFinished(result: ToolResult): readonly AGUIEvent[];
  /** Streaming paint: buffer `tool_call_delta.argumentsText` for the render tool. */
  onToolCallDelta(delta: ToolCallDeltaContent): readonly AGUIEvent[];
}

export function resolveAgUiA2UiLimits(options: AgUiA2UiLimitOptions = {}): ResolvedAgUiA2UiLimits {
  return {
    maxOperationsPerMessage: clamp(
      options.maxOperationsPerMessage ?? DEFAULT_MAX_A2UI_OPS_PER_MESSAGE,
      1,
      HARD_MAX_A2UI_OPS_PER_MESSAGE,
      "maxOperationsPerMessage",
    ),
    maxOperationBytes: clamp(
      options.maxOperationBytes ?? DEFAULT_MAX_A2UI_OPERATION_BYTES,
      1_024,
      HARD_MAX_A2UI_OPERATION_BYTES,
      "maxOperationBytes",
    ),
    maxSurfacesPerRun: clamp(
      options.maxSurfacesPerRun ?? DEFAULT_MAX_A2UI_SURFACES_PER_RUN,
      1,
      HARD_MAX_A2UI_SURFACES_PER_RUN,
      "maxSurfacesPerRun",
    ),
    maxComponentDepth: clamp(
      options.maxComponentDepth ?? DEFAULT_MAX_A2UI_COMPONENT_DEPTH,
      1,
      HARD_MAX_A2UI_COMPONENT_DEPTH,
      "maxComponentDepth",
    ),
  };
}

/** Stateful painter: one instance per AG-UI run stream. */
export function createAgUiA2UiPainter(options: AgUiA2UiOptions, limits: ResolvedAgUiLimits, redactor?: SecretRedactor): AgUiA2UiPainter {
  if (typeof options.catalogId !== "string" || options.catalogId.length === 0 || options.catalogId.length > 512) {
    throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "a2ui.catalogId is required");
  }
  const a2uiLimits = resolveAgUiA2UiLimits(options.limits);
  const allowed = new Set(options.allowedCatalogIds?.length ? options.allowedCatalogIds : [options.catalogId]);
  const renderToolName = options.renderToolName ?? "render_a2ui";
  const fixed = options.mode === "fixed-schema" || options.mode === "both";
  const streaming = options.mode === "streaming" || options.mode === "both";

  const surfaces = new Map<string, { messageId: string; ops: unknown[] }>();
  const streamBuffers = new Map<string, { name?: string; args: string; painted: number }>();
  const streamedSurfaceIds = new Set<string>();

  const redact = (value: unknown): unknown => redactor?.redact(value) ?? value;

  const errorEvent = (code: string, message: string): AGUIEvent => ({
    type: EventType.CUSTOM,
    name: A2UI_ERROR_EVENT,
    value: {
      code: truncateA2UiText(code, 128),
      message: truncateA2UiText(message, Math.min(limits.maxErrorBytes, 2_048)),
    },
  });

  const stamp = (ops: readonly Record<string, unknown>[]): Record<string, unknown>[] | undefined => {
    const out: Record<string, unknown>[] = [];
    for (const op of ops) {
      const stamped = stampCatalog(op, options.catalogId, allowed);
      if (!stamped) return undefined;
      out.push(stamped);
    }
    return out;
  };

  const paintOps = (toolCallId: string, rawOps: unknown[], mode: "fixed" | "stream"): AGUIEvent[] => {
    if (rawOps.length === 0) return [];
    if (rawOps.length > a2uiLimits.maxOperationsPerMessage) {
      return [errorEvent("ERR_PRISM_A2UI_LIMIT", "Too many A2UI operations")];
    }
    const validated: Record<string, unknown>[] = [];
    for (const item of rawOps) {
      const op = validateA2UiOp(item, a2uiLimits, limits);
      if (!op) return [errorEvent("ERR_PRISM_A2UI_OP", "Invalid A2UI operation")];
      validated.push(op);
    }
    const stamped = stamp(validated);
    if (!stamped) return [errorEvent("ERR_PRISM_A2UI_OP", "Invalid A2UI operation")];

    const bySurface = groupBySurface(stamped);
    const events: AGUIEvent[] = [];
    for (const [surfaceId, ops] of bySurface) {
      const existing = surfaces.get(surfaceId);
      if (!existing) {
        if (!ops.some((op) => "createSurface" in op)) {
          return [errorEvent("ERR_PRISM_A2UI_OP", "createSurface required before updates")];
        }
        if (surfaces.size >= a2uiLimits.maxSurfacesPerRun) {
          return [errorEvent("ERR_PRISM_A2UI_LIMIT", "Too many A2UI surfaces")];
        }
        const messageId = `a2ui-surface-${surfaceId}-${toolCallId}`;
        const content = projectAgUiJson(redact({ [A2UI_OPERATIONS_KEY]: ops }), limits.maxActivityBytes, limits, "a2ui");
        if (!content || typeof content !== "object" || Array.isArray(content)) {
          return [errorEvent("ERR_PRISM_A2UI_LIMIT", "A2UI activity exceeds bounds")];
        }
        surfaces.set(surfaceId, { messageId, ops: [...ops] });
        if (mode === "stream") streamedSurfaceIds.add(surfaceId);
        events.push({
          type: EventType.ACTIVITY_SNAPSHOT,
          messageId,
          activityType: A2UI_ACTIVITY_TYPE,
          content: content as Record<string, unknown>,
          replace: mode === "stream",
        });
        continue;
      }

      if (mode === "stream") {
        streamedSurfaceIds.add(surfaceId);
        // Progressive replace: cumulative ops for this surface under the stable messageId.
        const merged = [...existing.ops, ...ops];
        existing.ops = merged;
        const content = projectAgUiJson(redact({ [A2UI_OPERATIONS_KEY]: merged }), limits.maxActivityBytes, limits, "a2ui");
        if (!content || typeof content !== "object" || Array.isArray(content)) {
          return [errorEvent("ERR_PRISM_A2UI_LIMIT", "A2UI activity exceeds bounds")];
        }
        events.push({
          type: EventType.ACTIVITY_SNAPSHOT,
          messageId: existing.messageId,
          activityType: A2UI_ACTIVITY_TYPE,
          content: content as Record<string, unknown>,
          replace: true,
        });
        continue;
      }

      // Fixed-schema: subsequent batches become RFC 6902 deltas; drop duplicate createSurface.
      const deltaOps = ops.filter((op) => !("createSurface" in op));
      if (deltaOps.length === 0) continue;
      const patch = deltaOps.map((op) => ({ op: "add", path: `/${A2UI_OPERATIONS_KEY}/-`, value: op }));
      const projected = projectAgUiPatch(patch, limits.maxPatchOperations, limits.maxActivityBytes, limits, "a2uiDelta");
      if (!projected) return [errorEvent("ERR_PRISM_A2UI_LIMIT", "A2UI delta exceeds bounds")];
      existing.ops.push(...deltaOps);
      events.push({
        type: EventType.ACTIVITY_DELTA,
        messageId: existing.messageId,
        activityType: A2UI_ACTIVITY_TYPE,
        patch: [...projected],
      });
    }
    return events;
  };

  return {
    onToolFinished(result) {
      if (!fixed) return [];
      const ops = readOperations(result.value);
      if (ops === undefined) return [];
      if (ops === null) return [errorEvent("ERR_PRISM_A2UI_OP", "Invalid a2ui_operations envelope")];
      // Surfaces already painted via streaming this run are not re-painted from the final envelope.
      const remaining = ops.filter((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return true;
        const key = OP_KEYS.find((name) => name in (item as object));
        if (!key) return true;
        const body = (item as Record<string, unknown>)[key];
        const surfaceId =
          body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).surfaceId : undefined;
        return typeof surfaceId !== "string" || !streamedSurfaceIds.has(surfaceId);
      });
      if (remaining.length === 0) return [];
      return paintOps(result.toolCallId, remaining, "fixed");
    },
    onToolCallDelta(delta) {
      if (!streaming) return [];
      const id = delta.id;
      if (!id) return [];
      const entry = streamBuffers.get(id) ?? { name: delta.name, args: "", painted: 0 };
      if (delta.name) entry.name = delta.name;
      if (delta.argumentsText) entry.args += delta.argumentsText;
      streamBuffers.set(id, entry);
      if (entry.name !== undefined && entry.name !== renderToolName) return [];

      // Only probe when the delta could close a structure (official framing rule).
      const chunk = delta.argumentsText ?? "";
      if (!/[}\]"]/.test(chunk)) return [];

      const extracted = extractCompleteOperations(entry.args);
      if (extracted.length <= entry.painted) return [];
      const next = extracted.slice(entry.painted);
      entry.painted = extracted.length;
      return paintOps(id, next, "stream");
    },
  };
}

/**
 * Parse A2UI user-action envelopes from untrusted RunAgentInput.
 * Returns [] when none present; oversized/malformed actions are dropped closed.
 */
export function extractAgUiA2UiActions(
  input: ParsedAgUiInput,
  limits: ResolvedAgUiLimits,
  maxPayloadBytes = 16 * 1024,
): readonly AgUiA2UiAction[] {
  const actions: AgUiA2UiAction[] = [];
  const push = (raw: unknown): void => {
    const action = normalizeAction(raw, limits, maxPayloadBytes);
    if (action) actions.push(action);
  };

  const forwarded = input.forwardedProps;
  if (forwarded && typeof forwarded === "object" && !Array.isArray(forwarded)) {
    const props = forwarded as Record<string, unknown>;
    if (props.a2uiAction) push(props.a2uiAction);
    if (props.a2uiActions && Array.isArray(props.a2uiActions)) {
      for (const item of props.a2uiActions) push(item);
    }
  }

  for (const message of input.messages) {
    if (message.role === "tool") {
      try {
        const parsed = typeof message.content === "string" ? JSON.parse(message.content) : message.content;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const record = parsed as Record<string, unknown>;
          if (record.type === "a2ui-action" || record.a2uiAction || record.surfaceId) push(record.a2uiAction ?? record);
        }
      } catch {
        // ignore non-JSON tool content
      }
    }
    if (message.role === "user" && Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part && typeof part === "object" && (part as { type?: unknown }).type === "activity") {
          const activity = part as { activityType?: unknown; content?: unknown };
          if (activity.activityType === A2UI_ACTIVITY_TYPE || activity.activityType === "a2ui-action") {
            push(activity.content);
          }
        }
      }
    }
  }
  return actions;
}

function readOperations(value: unknown): unknown[] | null | undefined {
  if (value === undefined || value === null) return undefined;
  let current: unknown = value;
  if (typeof current === "string") {
    try {
      current = JSON.parse(current);
    } catch {
      return undefined;
    }
  }
  if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
  if (!Object.hasOwn(current, A2UI_OPERATIONS_KEY)) return undefined;
  const ops = (current as Record<string, unknown>)[A2UI_OPERATIONS_KEY];
  return Array.isArray(ops) ? ops : null;
}

export function validateA2UiOp(
  value: unknown,
  a2uiLimits: ResolvedAgUiA2UiLimits,
  limits: ResolvedAgUiLimits,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const op = value as Record<string, unknown>;
  if (op.version !== A2UI_VERSION && op.version !== "v1.0") return undefined;
  const keys = OP_KEYS.filter((key) => Object.hasOwn(op, key));
  if (keys.length !== 1) return undefined;
  const key = keys[0]!;
  const body = op[key];
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const surfaceId = (body as Record<string, unknown>).surfaceId;
  if (typeof surfaceId !== "string" || surfaceId.length === 0 || surfaceId.length > 128) return undefined;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(surfaceId)) return undefined;
  try {
    assertBoundedJson(op, a2uiLimits.maxOperationBytes, limits, "a2ui op");
  } catch {
    return undefined;
  }
  if (jsonDepth(op) > a2uiLimits.maxComponentDepth) return undefined;
  return { version: op.version, [key]: body };
}

function stampCatalog(op: Record<string, unknown>, catalogId: string, allowed: ReadonlySet<string>): Record<string, unknown> | undefined {
  if (!("createSurface" in op)) return op;
  const body = op.createSurface;
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const surface = { ...(body as Record<string, unknown>) };
  const current = surface.catalogId;
  if (typeof current !== "string" || current.length === 0 || !allowed.has(current)) {
    surface.catalogId = catalogId;
  }
  return { ...op, createSurface: surface };
}

function groupBySurface(ops: readonly Record<string, unknown>[]): Map<string, Record<string, unknown>[]> {
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const op of ops) {
    const key = OP_KEYS.find((name) => name in op);
    if (!key) continue;
    const body = op[key] as Record<string, unknown>;
    const surfaceId = String(body.surfaceId);
    const list = grouped.get(surfaceId) ?? [];
    list.push(op);
    grouped.set(surfaceId, list);
  }
  return grouped;
}

/**
 * Extract complete A2UI op objects from a partial JSON args buffer.
 * Never returns a partial object — brace-balanced scan only.
 */
function extractCompleteOperations(buffer: string): unknown[] {
  const opsKey = buffer.indexOf(`"${A2UI_OPERATIONS_KEY}"`);
  if (opsKey >= 0) {
    const arrayStart = buffer.indexOf("[", opsKey);
    if (arrayStart >= 0) return extractCompleteObjects(buffer.slice(arrayStart));
  }
  // Render-tool shape: synthesize ops once surfaceId + closed components are present.
  const synthesized = synthesizeFromRenderArgs(buffer);
  return synthesized ?? [];
}

function extractCompleteObjects(arraySlice: string): unknown[] {
  if (!arraySlice.startsWith("[")) return [];
  const items: unknown[] = [];
  let i = 1;
  while (i < arraySlice.length) {
    while (i < arraySlice.length && /[\s,]/.test(arraySlice[i]!)) i += 1;
    if (i >= arraySlice.length || arraySlice[i] === "]") break;
    if (arraySlice[i] !== "{") break;
    const start = i;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (; i < arraySlice.length; i += 1) {
      const ch = arraySlice[i]!;
      if (inString) {
        if (escape) escape = false;
        else if (ch === "\\") escape = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          i += 1;
          try {
            items.push(JSON.parse(arraySlice.slice(start, i)) as unknown);
          } catch {
            return items;
          }
          break;
        }
      }
    }
    if (depth !== 0) break;
  }
  return items;
}

function synthesizeFromRenderArgs(buffer: string): unknown[] | undefined {
  const surfaceId = extractStringField(buffer, "surfaceId");
  if (!surfaceId) return undefined;
  const components = extractClosedArray(buffer, "components");
  if (!components) return undefined;
  const catalogId = extractStringField(buffer, "catalogId");
  const ops: unknown[] = [
    {
      version: A2UI_VERSION,
      createSurface: { surfaceId, ...(catalogId ? { catalogId } : {}) },
    },
    {
      version: A2UI_VERSION,
      updateComponents: { surfaceId, components },
    },
  ];
  const data = extractClosedObjectField(buffer, "data");
  if (data !== undefined) {
    ops.push({ version: A2UI_VERSION, updateDataModel: { surfaceId, value: data } });
  }
  return ops;
}

function extractStringField(buffer: string, field: string): string | undefined {
  const re = new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`);
  const match = re.exec(buffer);
  if (!match) return undefined;
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return undefined;
  }
}

function extractClosedArray(buffer: string, field: string): unknown[] | undefined {
  const key = buffer.indexOf(`"${field}"`);
  if (key < 0) return undefined;
  const start = buffer.indexOf("[", key);
  if (start < 0) return undefined;
  const end = findMatching(buffer, start, "[", "]");
  if (end < 0) return undefined;
  try {
    const value = JSON.parse(buffer.slice(start, end + 1)) as unknown;
    return Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function extractClosedObjectField(buffer: string, field: string): unknown | undefined {
  const key = buffer.indexOf(`"${field}"`);
  if (key < 0) return undefined;
  const start = buffer.indexOf("{", key);
  if (start < 0) return undefined;
  const end = findMatching(buffer, start, "{", "}");
  if (end < 0) return undefined;
  try {
    return JSON.parse(buffer.slice(start, end + 1)) as unknown;
  } catch {
    return undefined;
  }
}

function findMatching(buffer: string, start: number, open: string, close: string): number {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < buffer.length; i += 1) {
    const ch = buffer[i]!;
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function normalizeAction(raw: unknown, limits: ResolvedAgUiLimits, maxPayloadBytes: number): AgUiA2UiAction | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const userAction =
    record.userAction && typeof record.userAction === "object" && !Array.isArray(record.userAction)
      ? (record.userAction as Record<string, unknown>)
      : record;
  const surfaceId = typeof userAction.surfaceId === "string" ? userAction.surfaceId : undefined;
  const actionName =
    typeof userAction.actionName === "string" ? userAction.actionName : typeof userAction.name === "string" ? userAction.name : undefined;
  if (!surfaceId || !actionName) return undefined;
  if (surfaceId.length > 128 || actionName.length > 256) return undefined;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(surfaceId)) return undefined;
  const payload = userAction.payload ?? userAction.context;
  if (payload !== undefined) {
    try {
      assertBoundedJson(payload, maxPayloadBytes, limits, "a2ui action");
    } catch {
      return undefined;
    }
  }
  return {
    type: "a2ui-action",
    surfaceId,
    actionName,
    ...(payload === undefined ? {} : { payload }),
  };
}

function jsonDepth(value: unknown, depth = 0): number {
  if (value === null || typeof value !== "object") return depth;
  if (Array.isArray(value)) {
    let max = depth;
    for (const item of value) max = Math.max(max, jsonDepth(item, depth + 1));
    return max;
  }
  let max = depth;
  for (const item of Object.values(value as Record<string, unknown>)) max = Math.max(max, jsonDepth(item, depth + 1));
  return max;
}

function clamp(value: number, min: number, hard: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < min || value > hard) {
    throw new AgUiError("ERR_PRISM_AG_UI_LIMIT", `${name} must be a safe integer from ${min} through ${hard}`);
  }
  return value;
}

export function truncateA2UiText(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value) <= maxBytes) return value;
  let bytes = 0;
  let end = 0;
  for (const char of value) {
    const size = Buffer.byteLength(char);
    if (bytes + size > maxBytes - 1) break;
    bytes += size;
    end += char.length;
  }
  return `${value.slice(0, end)}…`;
}
