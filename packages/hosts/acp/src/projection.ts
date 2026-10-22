import type { ToolCallContent, ToolResult } from "@arnilo/prism";

type Awaitable<T> = T | Promise<T>;

/** Coding lifecycle event fields the ACP mapper reads. `any` so the old AG-UI callers stay assignable until Task 3. */
export interface AcpLifecycleEvent {
  readonly type: string;
  readonly toolCallId?: string;
  readonly path?: string;
  readonly approvalId?: string;
  readonly toolName?: string;
  readonly sessionId?: string;
  readonly processId?: string;
  readonly planPath?: string;
  readonly todos?: readonly { readonly text: string; readonly done: boolean; readonly id?: string }[];
  readonly delegationId?: string;
  readonly childId?: string;
  readonly status?: string;
  readonly [key: string]: any;
}

/** Co-work event the mapper projects. Malformed kinds are dropped. */
export interface AcpCoWorkEvent {
  readonly kind: string;
  readonly [key: string]: unknown;
}

/** Host allow-list. Absent callbacks omit the field. Structurally compatible with the AG-UI projection hooks. */
export interface AcpProjection {
  toolArguments?(call: ToolCallContent): Awaitable<string | undefined>;
  toolResult?(
    result: ToolResult,
  ): Awaitable<string | { readonly type: "image"; readonly data: string; readonly mimeType: string } | undefined>;
  toolLocations?(result: ToolResult): Awaitable<readonly { readonly path: string; readonly line?: number | null }[] | undefined>;
  toolDiff?(result: ToolResult): Awaitable<{ readonly path: string; readonly oldText?: string; readonly newText: string } | undefined>;
  lifecycle?(event: any): Awaitable<string | undefined>;
  fileDiff?(event: any): Awaitable<{ readonly path: string; readonly oldText?: string; readonly newText: string } | undefined>;
  coWork?(event: any): Awaitable<unknown>;
}
