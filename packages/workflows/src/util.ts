import { createHash } from "node:crypto";
import type { OwnershipScope, SecretRedactor } from "@arnilo/prism";
import { WorkflowCheckpointError } from "./errors.js";
import {
  DEFAULT_MAX_CHECKPOINT_BYTES,
  DEFAULT_MAX_NODE_OUTPUT_BYTES,
} from "./limits.js";
import type { WorkflowDefinition, WorkflowNodeDefinition } from "./types.js";

export function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortValue);
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    out[key] = sortValue(record[key]);
  }
  return out;
}

export function hashWorkflowDefinition(workflow: WorkflowDefinition): string {
  const nodes: Record<string, { kind: string; metadata?: unknown }> = {};
  for (const [id, node] of Object.entries(workflow.nodes).sort(([a], [b]) => a.localeCompare(b))) {
    nodes[id] = { kind: node.kind, metadata: node.metadata };
  }
  const payload = {
    id: workflow.id,
    nodes,
    edges: workflow.edges.map(([from, to]) => [from, to]),
    limits: workflow.limits ?? {},
  };
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

export function measureJsonBytes(value: unknown): number {
  return utf8ByteLength(stableStringify(value));
}

export function assertWithinBytes(value: unknown, maxBytes: number, label: string): void {
  const size = measureJsonBytes(value);
  if (size > maxBytes) {
    throw new WorkflowCheckpointError(`${label} exceeds max bytes (${size} > ${maxBytes})`);
  }
}

export function redactValue<T>(value: T, redactor?: SecretRedactor): T {
  return redactor ? redactor.redact(value) : value;
}

export function boundNodeOutput(
  output: unknown,
  options: { maxNodeOutputBytes?: number; redactor?: SecretRedactor } = {},
): unknown {
  const redacted = redactValue(output, options.redactor);
  assertWithinBytes(redacted, options.maxNodeOutputBytes ?? DEFAULT_MAX_NODE_OUTPUT_BYTES, "Node output");
  return redacted;
}

export function boundCheckpointValue(
  value: unknown,
  options: { maxCheckpointBytes?: number; redactor?: SecretRedactor } = {},
): unknown {
  const redacted = redactValue(value, options.redactor);
  assertWithinBytes(redacted, options.maxCheckpointBytes ?? DEFAULT_MAX_CHECKPOINT_BYTES, "Checkpoint");
  return redacted;
}

export function ownershipMatches(
  expected: OwnershipScope | undefined,
  actual: OwnershipScope | undefined,
): boolean {
  if (!expected) return true;
  if (expected.tenantId !== undefined && expected.tenantId !== actual?.tenantId) return false;
  if (expected.accountId !== undefined && expected.accountId !== actual?.accountId) return false;
  if (expected.userId !== undefined && expected.userId !== actual?.userId) return false;
  return true;
}

export function nodeKindOf(node: WorkflowNodeDefinition): string {
  return node.kind;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function createRunId(): string {
  return `wfr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function combineSignals(signals: readonly (AbortSignal | undefined)[]): AbortSignal | undefined {
  const active = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  if (typeof AbortSignal.any === "function") return AbortSignal.any(active);
  const controller = new AbortController();
  const onAbort = () => {
    controller.abort(active.find((signal) => signal.aborted)?.reason);
  };
  for (const signal of active) {
    if (signal.aborted) {
      onAbort();
      break;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }
  return controller.signal;
}

export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  if (signal?.aborted) throw new DOMException(String(signal.reason ?? "Aborted"), "AbortError");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException(String(signal?.reason ?? "Aborted"), "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: string }).name;
  return name === "AbortError" || name === "WorkflowAbortError";
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function errorCode(error: unknown): string | number | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" || typeof code === "number") return code;
  }
  return undefined;
}
