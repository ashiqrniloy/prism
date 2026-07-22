import { RunAgentInputSchema, type ResumeEntry } from "@ag-ui/core";
import { AgUiError } from "./errors.js";
import type { ResolvedAgUiLimits } from "./limits.js";

export interface ParsedAgUiInput {
  readonly threadId: string;
  readonly runId: string;
  readonly parentRunId?: string;
  readonly userText?: string;
  readonly resume: readonly ResumeEntry[];
}

/** Parses official input, then narrows it to Prism's text-only, host-owned boundary. */
export function parseAgUiInput(value: unknown, limits: ResolvedAgUiLimits): ParsedAgUiInput {
  const result = RunAgentInputSchema.safeParse(value);
  if (!result.success) throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "Invalid AG-UI run input");
  const input = result.data;
  assertId(input.threadId, "threadId");
  assertId(input.runId, "runId");
  if (input.parentRunId !== undefined) assertId(input.parentRunId, "parentRunId");
  if (input.messages.length > limits.maxInputMessages) throw new AgUiError("ERR_PRISM_AG_UI_LIMIT", "Too many input messages");
  if (input.tools.length !== 0 || !emptyState(input.state)) throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "Frontend tools and state are not supported");

  const resume = input.resume ?? [];
  if (resume.length > 0) return { threadId: input.threadId, runId: input.runId, parentRunId: input.parentRunId, resume };
  const message = [...input.messages].reverse().find((item) => item.role === "user");
  if (!message) throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "A user message is required");
  const userText = textContent(message.content);
  if (Buffer.byteLength(userText, "utf8") > limits.maxInputTextBytes) throw new AgUiError("ERR_PRISM_AG_UI_LIMIT", "User message exceeds maxInputTextBytes");
  return { threadId: input.threadId, runId: input.runId, parentRunId: input.parentRunId, userText, resume };
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content) || content.some((part) => !part || typeof part !== "object" || (part as { type?: unknown }).type !== "text" || typeof (part as { text?: unknown }).text !== "string")) {
    throw new AgUiError("ERR_PRISM_AG_UI_INPUT", "Only text user content is supported");
  }
  return content.map((part) => (part as { text: string }).text).join("");
}

function emptyState(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0);
}

function assertId(value: string, name: string): void {
  if (value.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) throw new AgUiError("ERR_PRISM_AG_UI_INPUT", `${name} is invalid`);
}
