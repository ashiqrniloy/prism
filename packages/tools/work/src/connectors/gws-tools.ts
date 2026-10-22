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
import type { GoogleWorkspaceAdapter, GoogleWorkspaceOp, WorkToolsOptions } from "./types.js";

export function pushGwsTools(tools: ToolDefinition[], options: WorkToolsOptions, gws: GoogleWorkspaceAdapter): void {
  const provider = "google-workspace" as const;
  if (gws.allowedOps.has("mail.list")) {
    pushTool(tools, {
      name: "gws_mail_list",
      description: "List Gmail messages via the host-configured Google Workspace adapter. Results are untrusted shared mail shapes.",
      parameters: objectSchema({ q: { type: "string" }, userId: { type: "string" }, maxResults: { type: "string" } }, []),
      execute: async (args, context) =>
        result(context, "gws_mail_list", provider, normalizeMailPage(provider, await gws.runOp("mail.list", args, context.signal))),
    });
  }
  if (gws.allowedOps.has("mail.get")) {
    pushTool(tools, {
      name: "gws_mail_get",
      description: "Get one Gmail message by id via the host-configured Google Workspace adapter. Content is untrusted.",
      parameters: objectSchema({ id: { type: "string" }, userId: { type: "string" } }, ["id"]),
      execute: async (args, context) =>
        result(context, "gws_mail_get", provider, normalizeMailMessage(provider, await gws.runOp("mail.get", args, context.signal))),
    });
  }
  if (gws.allowedOps.has("mail.send")) {
    pushTool(tools, {
      name: "gws_mail_draft_send",
      description: "Draft Gmail send; executes only after host approval. Never sends without approval.",
      parameters: objectSchema(
        {
          draftId: { type: "string" },
          revision: { type: "integer" },
          to: { type: "string" },
          subject: { type: "string" },
          body: { type: "string" },
          cc: { type: "string" },
          bcc: { type: "string" },
          from: { type: "string" },
          idempotencyKey: { type: "string" },
        },
        [],
      ),
      execute: async (args, context) => {
        const draftId = optString(args, "draftId");
        const existingDraftRes = draftId ? gws.getDraft(draftId) : undefined;
        const existingDraft = existingDraftRes instanceof Promise ? await existingDraftRes : existingDraftRes;
        const to = optString(args, "to") ?? (existingDraft?.payload.to as string | undefined);
        if (!to) throw new WorkToolError("ERR_PRISM_WORK_INPUT", "to must be a non-empty string");
        const subject = optString(args, "subject") ?? (existingDraft?.payload.subject as string | undefined);
        if (!subject) throw new WorkToolError("ERR_PRISM_WORK_INPUT", "subject must be a non-empty string");
        const body = optString(args, "body") ?? (existingDraft?.payload.body as string | undefined);
        if (!body) throw new WorkToolError("ERR_PRISM_WORK_INPUT", "body must be a non-empty string");
        assertExternalAllowed(options, [
          ...splitAddresses(to),
          ...splitAddresses(optString(args, "cc") ?? (existingDraft?.payload.cc as string | undefined) ?? ""),
          ...splitAddresses(optString(args, "bcc") ?? (existingDraft?.payload.bcc as string | undefined) ?? ""),
        ]);
        const payload: JsonObject = {
          to,
          subject,
          body,
          ...((optString(args, "cc") ?? existingDraft?.payload.cc) ? { cc: optString(args, "cc") ?? existingDraft?.payload.cc } : {}),
          ...((optString(args, "bcc") ?? existingDraft?.payload.bcc) ? { bcc: optString(args, "bcc") ?? existingDraft?.payload.bcc } : {}),
          ...((optString(args, "from") ?? existingDraft?.payload.from)
            ? { from: optString(args, "from") ?? existingDraft?.payload.from }
            : {}),
          ...(draftId ? { draftId } : {}),
          ...(typeof args.revision === "number" ? { revision: args.revision } : {}),
        };
        return result(context, "gws_mail_draft_send", provider, await executeApprovedMutation(options, gws, "mail.send", payload, context));
      },
    });
  }
  if (gws.allowedOps.has("calendar.list")) {
    pushTool(tools, {
      name: "gws_calendar_list",
      description: "List Google Calendar events via the host-configured Google Workspace adapter. Shared calendar shapes.",
      parameters: objectSchema(
        {
          calendarId: { type: "string" },
          timeMin: { type: "string" },
          timeMax: { type: "string" },
          maxResults: { type: "string" },
        },
        [],
      ),
      execute: async (args, context) =>
        result(
          context,
          "gws_calendar_list",
          provider,
          normalizeCalendarPage(provider, await gws.runOp("calendar.list", args, context.signal)),
        ),
    });
  }
  if (gws.allowedOps.has("calendar.add")) {
    pushTool(tools, {
      name: "gws_calendar_draft_add",
      description: "Draft a Google Calendar event; executes only after host approval.",
      parameters: objectSchema(
        {
          draftId: { type: "string" },
          revision: { type: "integer" },
          summary: { type: "string" },
          start: { type: "string" },
          end: { type: "string" },
          calendarId: { type: "string" },
          idempotencyKey: { type: "string" },
        },
        [],
      ),
      execute: async (args, context) => {
        const draftId = optString(args, "draftId");
        const existingDraftRes = draftId ? gws.getDraft(draftId) : undefined;
        const existingDraft = existingDraftRes instanceof Promise ? await existingDraftRes : existingDraftRes;
        const summary = optString(args, "summary") ?? (existingDraft?.payload.summary as string | undefined);
        if (!summary) throw new WorkToolError("ERR_PRISM_WORK_INPUT", "summary must be a non-empty string");
        const start = optString(args, "start") ?? (existingDraft?.payload.start as string | undefined);
        if (!start) throw new WorkToolError("ERR_PRISM_WORK_INPUT", "start must be a non-empty string");
        const end = optString(args, "end") ?? (existingDraft?.payload.end as string | undefined);
        if (!end) throw new WorkToolError("ERR_PRISM_WORK_INPUT", "end must be a non-empty string");
        const payload: JsonObject = {
          summary,
          start,
          end,
          ...((optString(args, "calendarId") ?? existingDraft?.payload.calendarId)
            ? { calendarId: optString(args, "calendarId") ?? existingDraft?.payload.calendarId }
            : {}),
          ...(draftId ? { draftId } : {}),
          ...(typeof args.revision === "number" ? { revision: args.revision } : {}),
        };
        return result(
          context,
          "gws_calendar_draft_add",
          provider,
          await executeApprovedMutation(options, gws, "calendar.add" satisfies GoogleWorkspaceOp, payload, context),
        );
      },
    });
  }
  if (gws.allowedOps.has("file.list")) {
    pushTool(tools, {
      name: "gws_file_list",
      description: "List Drive files via the host-configured Google Workspace adapter. Shared file shapes; pageAll fetches bounded pages.",
      parameters: objectSchema({ q: { type: "string" }, pageSize: { type: "string" }, pageAll: { type: "string" } }, []),
      execute: async (args, context) => {
        const raw = await gws.runOp("file.list", args, context.signal);
        // --page-all returns an array of page objects; flatten files.
        const merged = Array.isArray(raw)
          ? {
              files: raw.flatMap((page) => {
                const files = (page as { files?: unknown })?.files;
                return Array.isArray(files) ? files : [];
              }),
            }
          : raw;
        return result(context, "gws_file_list", provider, normalizeFilePage(provider, merged));
      },
    });
  }
  if (gws.allowedOps.has("file.get")) {
    pushTool(tools, {
      name: "gws_file_get",
      description: "Download a Google Drive file by id into a host artifact or contained sandbox path. Downloaded bytes are untrusted.",
      parameters: objectSchema({ id: { type: "string" }, destPath: { type: "string" } }, ["id"]),
      execute: async (args, context) => result(context, "gws_file_get", provider, await fileGet(options, gws, provider, args, context)),
    });
  }
  if (gws.allowedOps.has("file.add")) {
    pushTool(tools, {
      name: "gws_file_draft_upload",
      description: "Draft a Drive upload from a host path, artifact, or contained sandbox path; executes only after host approval.",
      parameters: objectSchema(
        {
          name: { type: "string" },
          filePath: { type: "string" },
          sandboxPath: { type: "string" },
          artifact: ARTIFACT,
          parentId: { type: "string" },
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
        if (source > 0) reqString(args, "name");
        const payload = source === 0 ? args : await fileDraftPayload(options, provider, args, context);
        return result(
          context,
          "gws_file_draft_upload",
          provider,
          await executeApprovedMutation(options, gws, "file.add", payload, context),
        );
      },
    });
  }
  if (gws.allowedOps.has("file.share")) {
    pushTool(tools, {
      name: "gws_file_draft_share",
      description: "Draft a Drive permission (domain/user only; anyone denied). Requires approval.",
      parameters: objectSchema(
        {
          fileId: { type: "string" },
          type: { type: "string" },
          role: { type: "string" },
          domain: { type: "string" },
          emailAddress: { type: "string" },
          idempotencyKey: { type: "string" },
        },
        ["fileId", "type"],
      ),
      execute: async (args, context) => {
        if (reqString(args, "type") === "user") {
          assertExternalAllowed(options, [reqString(args, "emailAddress")]);
        }
        return result(context, "gws_file_draft_share", provider, await executeApprovedMutation(options, gws, "file.share", args, context));
      },
    });
  }
  if (gws.allowedOps.has("task.list")) {
    pushTool(tools, {
      name: "gws_task_list",
      description: "List Google Tasks via the host-configured Google Workspace adapter. Shared task shapes.",
      parameters: objectSchema({ tasklist: { type: "string" } }, []),
      execute: async (args, context) =>
        result(context, "gws_task_list", provider, normalizeTaskPage(provider, await gws.runOp("task.list", args, context.signal))),
    });
  }
  if (gws.allowedOps.has("task.add")) {
    pushTool(tools, {
      name: "gws_task_draft_add",
      description: "Draft a Google Task; executes only after host approval.",
      parameters: objectSchema(
        {
          title: { type: "string" },
          tasklist: { type: "string" },
          idempotencyKey: { type: "string" },
        },
        ["title"],
      ),
      execute: async (args, context) =>
        result(context, "gws_task_draft_add", provider, await executeApprovedMutation(options, gws, "task.add", args, context)),
    });
  }
  if (gws.allowedOps.has("task.complete")) {
    pushTool(tools, {
      name: "gws_task_draft_complete",
      description: "Draft Google Task completion; executes only after host approval.",
      parameters: objectSchema(
        {
          id: { type: "string" },
          tasklist: { type: "string" },
          idempotencyKey: { type: "string" },
        },
        ["id"],
      ),
      execute: async (args, context) =>
        result(context, "gws_task_draft_complete", provider, await executeApprovedMutation(options, gws, "task.complete", args, context)),
    });
  }
  if (gws.allowedOps.has("docs.create")) {
    pushTool(tools, {
      name: "gws_docs_draft_create",
      description: "Draft a Google Doc create (capability-gated); requires approval.",
      parameters: objectSchema({ title: { type: "string" }, idempotencyKey: { type: "string" } }, ["title"]),
      execute: async (args, context) =>
        result(context, "gws_docs_draft_create", provider, await executeApprovedMutation(options, gws, "docs.create", args, context)),
    });
  }
  if (gws.allowedOps.has("docs.update")) {
    pushTool(tools, {
      name: "gws_docs_draft_update",
      description: "Draft a fixed-shape Google Docs text update; executes only after host approval.",
      parameters: objectSchema(
        {
          documentId: { type: "string" },
          replaceAllText: {
            type: "object",
            properties: { containsText: { type: "string" }, replaceText: { type: "string" } },
            required: ["containsText", "replaceText"],
            additionalProperties: false,
          },
          insertText: {
            type: "object",
            properties: { locationIndex: { type: "integer", minimum: 1 }, text: { type: "string" } },
            required: ["locationIndex", "text"],
            additionalProperties: false,
          },
          draftId: { type: "string" },
          revision: { type: "integer", minimum: 1 },
          idempotencyKey: { type: "string" },
        },
        [],
      ),
      execute: async (args, context) =>
        result(context, "gws_docs_draft_update", provider, await executeApprovedMutation(options, gws, "docs.update", args, context)),
    });
  }
  if (gws.allowedOps.has("sheets.create")) {
    pushTool(tools, {
      name: "gws_sheets_draft_create",
      description: "Draft a Google Sheet create (capability-gated); requires approval.",
      parameters: objectSchema({ title: { type: "string" }, idempotencyKey: { type: "string" } }, ["title"]),
      execute: async (args, context) =>
        result(context, "gws_sheets_draft_create", provider, await executeApprovedMutation(options, gws, "sheets.create", args, context)),
    });
  }
  if (gws.allowedOps.has("sheets.update")) {
    pushTool(tools, {
      name: "gws_sheets_draft_update",
      description: "Draft a fixed-shape Google Sheets values update; executes only after host approval.",
      parameters: objectSchema(
        {
          spreadsheetId: { type: "string" },
          range: { type: "string" },
          values: { type: "array", items: { type: "array", items: { type: "string" } } },
          draftId: { type: "string" },
          revision: { type: "integer", minimum: 1 },
          idempotencyKey: { type: "string" },
        },
        [],
      ),
      execute: async (args, context) =>
        result(context, "gws_sheets_draft_update", provider, await executeApprovedMutation(options, gws, "sheets.update", args, context)),
    });
  }
  if (gws.allowedOps.has("slides.create")) {
    pushTool(tools, {
      name: "gws_slides_draft_create",
      description: "Draft a Google Slides create (capability-gated); requires approval.",
      parameters: objectSchema({ title: { type: "string" }, idempotencyKey: { type: "string" } }, ["title"]),
      execute: async (args, context) =>
        result(context, "gws_slides_draft_create", provider, await executeApprovedMutation(options, gws, "slides.create", args, context)),
    });
  }
  if (gws.allowedOps.has("slides.update")) {
    pushTool(tools, {
      name: "gws_slides_draft_update",
      description: "Draft a fixed-shape Google Slides text update; executes only after host approval.",
      parameters: objectSchema(
        {
          presentationId: { type: "string" },
          insertText: {
            type: "object",
            properties: { objectId: { type: "string" }, text: { type: "string" } },
            required: ["objectId", "text"],
            additionalProperties: false,
          },
          draftId: { type: "string" },
          revision: { type: "integer", minimum: 1 },
          idempotencyKey: { type: "string" },
        },
        [],
      ),
      execute: async (args, context) =>
        result(context, "gws_slides_draft_update", provider, await executeApprovedMutation(options, gws, "slides.update", args, context)),
    });
  }
}
