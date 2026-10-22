/**
 * `shell_output`: read, wait on, or kill a process started by `shell({ background: true })`
 * (plan 189 Task 9).
 *
 * Registered only alongside `shell`, and only when the backend can start a process at all. Output is
 * the increment since the previous call for that id, capped like the shell's tail; the process state
 * and exit code are reported, never fabricated.
 */
import type { JsonObject, ToolDefinition, ToolResult } from "@arnilo/prism";

import { CODING_UNSUPPORTED_EFFECT } from "./effects.js";
import { type BackgroundProcesses, HARD_MAX_BACKGROUND_WAIT_SECONDS } from "./shell-background.js";

export interface ShellOutputToolOptions {
  readonly background: BackgroundProcesses;
}

function statusLine(state: string, running: boolean, exitCode: number | null): string {
  if (running) return "[process is still running]";
  if (state === "killed") return "[process killed]";
  return exitCode === null ? "[process ended]" : `[process exited with code ${exitCode}]`;
}

export function createShellOutputTool(options: ShellOutputToolOptions): ToolDefinition {
  const { background } = options;
  return {
    name: "shell_output",
    kind: "execute",
    effect: CODING_UNSUPPORTED_EFFECT,
    effects: ["execute"],
    description: `Read, wait on, or kill a background process started by shell({ background: true }). Returns the output produced since the previous shell_output call for that id (tail-capped), whether the process is still running, and its exit code once it ended. waitSeconds (default 0, max ${HARD_MAX_BACKGROUND_WAIT_SECONDS}) waits for new output or exit; kill: true ends the process. An id from another session is an error.`,
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Process id returned by shell({ background: true })" },
        waitSeconds: {
          type: "number",
          description: `Seconds to wait for new output or exit (default 0, max ${HARD_MAX_BACKGROUND_WAIT_SECONDS})`,
        },
        kill: { type: "boolean", description: "End the process before reading its remaining output" },
      },
      required: ["id"],
      additionalProperties: false,
    } as JsonObject,
    async execute(args, context): Promise<ToolResult> {
      const toolCallId = context.toolCallId;
      const id = typeof args.id === "string" ? args.id.trim() : "";
      if (id.length === 0) {
        const message = "id is required and must be a non-empty string.";
        return { toolCallId, name: "shell_output", content: [{ type: "text", text: message }], error: { message } };
      }
      const waitSeconds = typeof args.waitSeconds === "number" && Number.isFinite(args.waitSeconds) ? Math.max(0, args.waitSeconds) : 0;
      const kill = args.kill === true;
      const sessionId = context.sessionId ?? "";
      try {
        const result = await background.read({ id, sessionId, waitSeconds, kill });
        const status = statusLine(result.state, result.running, result.exitCode);
        return {
          toolCallId,
          name: "shell_output",
          content: [{ type: "text", text: result.output ? `${result.output}\n\n${status}` : status }],
          metadata: {
            id: result.id,
            state: result.state,
            running: result.running,
            exitCode: result.exitCode,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { toolCallId, name: "shell_output", content: [{ type: "text", text: message }], error: { message } };
      }
    },
  };
}
