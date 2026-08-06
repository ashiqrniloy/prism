import type { AgentEvent, ThinkingContent } from "@arnilo/prism";
import { truncateUtf8 } from "./ag-ui-mapper.js";
import { DEFAULT_MAX_REASONING_BYTES, HARD_MAX_REASONING_BYTES } from "./limits.js";
import type { AgUiReasoningProjection } from "./projection.js";

export interface CreateReasoningEncryptedValueOptions {
  /** Host-owned encryption for this AG-UI client; return `undefined` to decline. */
  readonly encrypt: (content: ThinkingContent, event: AgentEvent) => string | undefined;
  /** Redacted Prism thinking content (same value the `reasoning` projection receives). */
  readonly content: ThinkingContent;
  /** The Prism event carrying the thinking content. */
  readonly event: AgentEvent;
  /** Optional byte cap; defaults to `DEFAULT_MAX_REASONING_BYTES`, clamped to `HARD_MAX_REASONING_BYTES`. */
  readonly maxBytes?: number;
}

/**
 * Bounded `AgUiReasoningProjection.encryptedValue` fragment (FR-3).
 *
 * Passes the redacted `ThinkingContent` and event to the host-owned `encrypt`
 * function and returns `{ encryptedValue }` — or `undefined` when the host
 * declines, `encrypt` is missing, throws, or returns a non-string. The helper
 * never infers an encrypted value from a Prism reasoning signature; it only
 * forwards what `encrypt` produced, truncated to `maxBytes`. Synchronous and
 * pure like the other projection callbacks; the mapper additionally caps the
 * emitted value at the resolved `maxReasoningBytes` limit.
 */
export function createReasoningEncryptedValue(
  options: CreateReasoningEncryptedValueOptions,
): AgUiReasoningProjection | undefined {
  const { encrypt, content, event } = options;
  if (typeof encrypt !== "function") return undefined;
  let value: string | undefined;
  try {
    value = encrypt(content, event);
  } catch {
    return undefined;
  }
  if (typeof value !== "string" || value.length === 0) return undefined;
  const maxBytes = Math.min(options.maxBytes ?? DEFAULT_MAX_REASONING_BYTES, HARD_MAX_REASONING_BYTES);
  return { encryptedValue: truncateUtf8(value, maxBytes) };
}
