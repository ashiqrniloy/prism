import type { AgentEvent, ToolCallContent, ToolResult } from "@arnilo/prism";

/** Host-owned allow-list. All callbacks receive redacted Prism values. */
export interface AgUiProjection {
  /** Return a safe display string to expose tool arguments; absent means omit them. */
  toolArguments?(call: ToolCallContent): string | undefined;
  /** Return a safe display string to expose a tool result; absent means status only. */
  toolResult?(result: ToolResult): string | undefined;
  /** Return a safe, JSON-serializable application-state addition; absent exposes status only. */
  state?(event: AgentEvent): unknown;
  /** Reserved for host-owned path projection in handlers; mapper never exposes paths itself. */
  path?(value: string): string | undefined;
}
