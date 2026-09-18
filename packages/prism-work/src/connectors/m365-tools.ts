import type { JsonObject, ToolDefinition } from "@arnilo/prism";
import { WorkToolError } from "./errors.js";
import { normalizeCalendarPage, normalizeFilePage, normalizeMailMessage, normalizeMailPage, normalizeTaskPage } from "./normalize.js";
import {
  ARTIFACT,
  assertExternalAllowed,
  executeApprovedMutation,
  fileDraftPayload,
  fileGet,
  objectSchema,
  optString,
  pushTool,
  reqString,
  result,
  sourceCount,
  splitAddresses,
} from "./tool-helpers.js";
import type { Microsoft365Adapter, Microsoft365Op, WorkToolsOptions } from "./types.js";

export function pushM365Tools(tools: ToolDefinition[], options: WorkToolsOptions, m365: Microsoft365Adapter): void {
  const provider = "microsoft365" as const;
  if (m365.allowedOps.has("mail.list")) {
    pushTool(tools, {
      name: "m365_mail_list",
      description: "List Outlook messages via the host-configured Microsoft 365 adapter. Results are untrusted shared mail shapes.",
      parameters: objectSchema({ folderName: { type: "string" }, folderId: { type: "string" } }, []),
      execute: async (args, context) =>
        result(context, "m365_mail_list", provider, normalizeMailPage(provider, await m365.runOp("mail.list", args, context.signal))),
    });
  }
  if (m365.allowedOps.has("mail.get")) {
    pushTool(tools, {
      name: "m365_mail_get",
      description: "Get one Outlook message by id via the host-configured Microsoft 365 adapter. Content is untrusted.",
      parameters: objectSchema({ id: { type: "string" } }, ["id"]),
      execute: async (args, context) =>
        result(context, "m365_mail_get", provider, normalizeMailMessage(provider, await m365.runOp("mail.get", args, context.signal))),
    });
  }
  if (m365.allowedOps.has("mail.send")) {
    pushTool(tools, {
      name: "m365_mail_draft_send",
      description: "Create a mail draft for approval, then send only when host approval gate allows. Never sends without approval.",
      parameters: objectSchema(
        {
          draftId: { type: "string" },
          revision: { type: "integer" },
          to: { type: "string" },
          subject: { type: "string" },
          bodyContents: { type: "string" },
          cc: { type: "string" },
          bcc: { type: "string" },
          bodyContentType: { type: "string" },
          idempotencyKey: { type: "string" },
        },
        [],
      ),
      execute: async (args, context) => {
        const draftId = optString(args, "draftId");
        const existingDraftRes = draftId ? m365.getDraft(draftId) : undefined;
        const existingDraft = existingDraftRes instanceof Promise ? await existingDraftRes : existingDraftRes;
        const to = optString(args, "to") ?? (existingDraft?.payload.to as string | undefined);
        if (!to) throw new WorkToolError("ERR_PRISM_WORK_INPUT", "to must be a non-empty string");
        const subject = optString(args, "subject") ?? (existingDraft?.payload.subject as string | undefined);
        if (!subject) throw new WorkToolError("ERR_PRISM_WORK_INPUT", "subject must be a non-empty string");
        const bodyContents = optString(args, "bodyContents") ?? (existingDraft?.payload.bodyContents as string | undefined);
        if (!bodyContents) throw new WorkToolError("ERR_PRISM_WORK_INPUT", "bodyContents must be a non-empty string");
        assertExternalAllowed(options, [
          ...splitAddresses(to),
          ...splitAddresses(optString(args, "cc") ?? (existingDraft?.payload.cc as string | undefined) ?? ""),
          ...splitAddresses(optString(args, "bcc") ?? (existingDraft?.payload.bcc as string | undefined) ?? ""),
        ]);
        const payload: JsonObject = {
          to,
          subject,
          bodyContents,
          ...((optString(args, "cc") ?? existingDraft?.payload.cc) ? { cc: optString(args, "cc") ?? existingDraft?.payload.cc } : {}),
          ...((optString(args, "bcc") ?? existingDraft?.payload.bcc) ? { bcc: optString(args, "bcc") ?? existingDraft?.payload.bcc } : {}),
          ...((optString(args, "bodyContentType") ?? existingDraft?.payload.bodyContentType)
            ? { bodyContentType: optString(args, "bodyContentType") ?? existingDraft?.payload.bodyContentType }
            : {}),
          ...(draftId ? { draftId } : {}),
          ...(typeof args.revision === "number" ? { revision: args.revision } : {}),
        };
        return result(
          context,
          "m365_mail_draft_send",
          provider,
          await executeApprovedMutation(options, m365, "mail.send", payload, context),
        );
      },
    });
  }
  if (m365.allowedOps.has("calendar.list")) {
    pushTool(tools, {
      name: "m365_calendar_list",
      description: "List Outlook calendar events (capability-gated). Shared calendar shapes.",
      parameters: objectSchema(
        {
          calendarName: { type: "string" },
          calendarId: { type: "string" },
          userName: { type: "string" },
          userId: { type: "string" },
          startDateTime: { type: "string" },
          endDateTime: { type: "string" },
        },
        [],
      ),
      execute: async (args, context) =>
        result(
          context,
          "m365_calendar_list",
          provider,
          normalizeCalendarPage(provider, await m365.runOp("calendar.list", args, context.signal)),
        ),
    });
  }
  if (m365.allowedOps.has("calendar.add")) {
    pushTool(tools, {
      name: "m365_calendar_draft_add",
      description: "Draft a calendar event; executes only after host approval.",
      parameters: objectSchema(
        {
          draftId: { type: "string" },
          revision: { type: "integer" },
          subject: { type: "string" },
          start: { type: "string" },
          end: { type: "string" },
          calendarName: { type: "string" },
          calendarId: { type: "string" },
          idempotencyKey: { type: "string" },
        },
        [],
      ),
      execute: async (args, context) => {
        const draftId = optString(args, "draftId");
        const existingDraftRes = draftId ? m365.getDraft(draftId) : undefined;
        const existingDraft = existingDraftRes instanceof Promise ? await existingDraftRes : existingDraftRes;
        const subject = optString(args, "subject") ?? (existingDraft?.payload.subject as string | undefined);
        if (!subject) throw new WorkToolError("ERR_PRISM_WORK_INPUT", "subject must be a non-empty string");
        const start = optString(args, "start") ?? (existingDraft?.payload.start as string | undefined);
        if (!start) throw new WorkToolError("ERR_PRISM_WORK_INPUT", "start must be a non-empty string");
        const end = optString(args, "end") ?? (existingDraft?.payload.end as string | undefined);
        if (!end) throw new WorkToolError("ERR_PRISM_WORK_INPUT", "end must be a non-empty string");
        const payload: JsonObject = {
          subject,
          start,
          end,
          ...((optString(args, "calendarName") ?? existingDraft?.payload.calendarName)
            ? { calendarName: optString(args, "calendarName") ?? existingDraft?.payload.calendarName }
            : {}),
          ...((optString(args, "calendarId") ?? existingDraft?.payload.calendarId)
            ? { calendarId: optString(args, "calendarId") ?? existingDraft?.payload.calendarId }
            : {}),
          ...(draftId ? { draftId } : {}),
          ...(typeof args.revision === "number" ? { revision: args.revision } : {}),
        };
        return result(
          context,
          "m365_calendar_draft_add",
          provider,
          await executeApprovedMutation(options, m365, "calendar.add" satisfies Microsoft365Op, payload, context),
        );
      },
    });
  }
  if (m365.allowedOps.has("file.list")) {
    pushTool(tools, {
      name: "m365_file_list",
      description: "List OneDrive/SharePoint files via the host-configured Microsoft 365 adapter. Untrusted shared file shapes.",
      parameters: objectSchema({ webUrl: { type: "string" }, folderUrl: { type: "string" } }, ["webUrl", "folderUrl"]),
      execute: async (args, context) =>
        result(context, "m365_file_list", provider, normalizeFilePage(provider, await m365.runOp("file.list", args, context.signal))),
    });
  }
  if (m365.allowedOps.has("file.get")) {
    pushTool(tools, {
      name: "m365_file_get",
      description: "Download a Microsoft 365 file by id into a host artifact or contained sandbox path. Downloaded bytes are untrusted.",
      parameters: objectSchema({ id: { type: "string" }, destPath: { type: "string" } }, ["id"]),
      execute: async (args, context) => result(context, "m365_file_get", provider, await fileGet(options, m365, provider, args, context)),
    });
  }
  if (m365.allowedOps.has("file.add")) {
    pushTool(tools, {
      name: "m365_file_draft_upload",
      description: "Draft a file upload from a host path, artifact, or contained sandbox path; executes only after host approval.",
      parameters: objectSchema(
        {
          folderUrl: { type: "string" },
          filePath: { type: "string" },
          sandboxPath: { type: "string" },
          artifact: ARTIFACT,
          name: { type: "string" },
          siteUrl: { type: "string" },
          draftId: { type: "string" },
          revision: { type: "integer", minimum: 1 },
          idempotencyKey: { type: "string" },
        },
        [],
      ),
      execute: async (args, context) => {
        const source = sourceCount(args);
        if (source === 0 && typeof args.draftId !== "string")
          throw new WorkToolError("ERR_PRISM_WORK_INPUT", "file upload requires a source");
        if (source > 0) reqString(args, "folderUrl");
        const payload = source === 0 ? args : await fileDraftPayload(options, provider, args, context);
        return result(
          context,
          "m365_file_draft_upload",
          provider,
          await executeApprovedMutation(options, m365, "file.add", payload, context),
        );
      },
    });
  }
  if (m365.allowedOps.has("file.copy")) {
    pushTool(tools, {
      name: "m365_file_draft_copy",
      description: "Draft a Microsoft 365 file copy; executes only after host approval.",
      parameters: objectSchema(
        {
          webUrl: { type: "string" },
          sourceUrl: { type: "string" },
          targetUrl: { type: "string" },
          draftId: { type: "string" },
          revision: { type: "integer", minimum: 1 },
          idempotencyKey: { type: "string" },
        },
        [],
      ),
      execute: async (args, context) => {
        if (typeof args.draftId !== "string") {
          reqString(args, "webUrl");
          reqString(args, "sourceUrl");
          reqString(args, "targetUrl");
        }
        return result(context, "m365_file_draft_copy", provider, await executeApprovedMutation(options, m365, "file.copy", args, context));
      },
    });
  }
  if (m365.allowedOps.has("file.share")) {
    pushTool(tools, {
      name: "m365_file_draft_share",
      description: "Draft an organization-scoped sharing link; anonymous scope denied. Requires approval.",
      parameters: objectSchema(
        {
          webUrl: { type: "string" },
          fileUrl: { type: "string" },
          fileId: { type: "string" },
          type: { type: "string" },
          idempotencyKey: { type: "string" },
        },
        ["webUrl", "type"],
      ),
      execute: async (args, context) =>
        result(
          context,
          "m365_file_draft_share",
          provider,
          await executeApprovedMutation(options, m365, "file.share", { ...args, scope: "organization" }, context),
        ),
    });
  }
  if (m365.allowedOps.has("todo.list")) {
    pushTool(tools, {
      name: "m365_todo_list",
      description: "List Microsoft To Do tasks (capability-gated). Shared task shapes.",
      parameters: objectSchema({ listName: { type: "string" }, listId: { type: "string" } }, []),
      execute: async (args, context) =>
        result(context, "m365_todo_list", provider, normalizeTaskPage(provider, await m365.runOp("todo.list", args, context.signal))),
    });
  }
  if (m365.allowedOps.has("todo.add")) {
    pushTool(tools, {
      name: "m365_todo_draft_add",
      description: "Draft a To Do task; executes only after host approval (capability-gated).",
      parameters: objectSchema(
        {
          title: { type: "string" },
          listName: { type: "string" },
          listId: { type: "string" },
          idempotencyKey: { type: "string" },
        },
        ["title"],
      ),
      execute: async (args, context) =>
        result(context, "m365_todo_draft_add", provider, await executeApprovedMutation(options, m365, "todo.add", args, context)),
    });
  }
  if (m365.allowedOps.has("todo.complete")) {
    pushTool(tools, {
      name: "m365_todo_draft_complete",
      description: "Draft To Do completion; executes only after host approval (capability-gated).",
      parameters: objectSchema(
        {
          id: { type: "string" },
          listName: { type: "string" },
          listId: { type: "string" },
          idempotencyKey: { type: "string" },
        },
        ["id"],
      ),
      execute: async (args, context) =>
        result(context, "m365_todo_draft_complete", provider, await executeApprovedMutation(options, m365, "todo.complete", args, context)),
    });
  }
}
