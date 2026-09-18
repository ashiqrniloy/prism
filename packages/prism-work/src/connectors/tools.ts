import { type ToolDefinition, type ToolEffectDeclaration } from "@arnilo/prism";
import { pushGwsTools } from "./gws-tools.js";
import { pushM365Tools } from "./m365-tools.js";
import type { WorkToolsOptions } from "./types.js";

const WORK_OBSERVATION_EFFECT = { kind: "none", idempotency: "none" } as const satisfies ToolEffectDeclaration;
const WORK_MUTATION_EFFECT = { kind: "external_mutation", idempotency: "tool_managed" } as const satisfies ToolEffectDeclaration;
const MUTATING_TOOL_NAMES = new Set([
  "m365_mail_draft_send",
  "m365_calendar_draft_add",
  "m365_file_draft_upload",
  "m365_file_draft_copy",
  "m365_file_draft_share",
  "m365_todo_draft_add",
  "m365_todo_draft_complete",
  "gws_mail_draft_send",
  "gws_calendar_draft_add",
  "gws_file_draft_upload",
  "gws_file_draft_share",
  "gws_task_draft_add",
  "gws_task_draft_complete",
  "gws_docs_draft_create",
  "gws_docs_draft_update",
  "gws_sheets_draft_create",
  "gws_sheets_draft_update",
  "gws_slides_draft_create",
  "gws_slides_draft_update",
]);

export function createWorkTools(options: WorkToolsOptions): readonly ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  if (options.microsoft365) pushM365Tools(tools, options, options.microsoft365);
  if (options.googleWorkspace) pushGwsTools(tools, options, options.googleWorkspace);
  return tools.map((tool) => ({
    ...tool,
    effect: MUTATING_TOOL_NAMES.has(tool.name) ? WORK_MUTATION_EFFECT : WORK_OBSERVATION_EFFECT,
  }));
}
