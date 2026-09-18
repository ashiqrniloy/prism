import { randomUUID } from "node:crypto";
import { type AgentIdentity, type ArtifactBodyStore, assertIdentityActive, type CheckpointStore, type JsonObject } from "@arnilo/prism";
import { createCheckpointWorkDraftStore, createMemoryWorkDraftStore } from "./drafts.js";
import { WorkToolError } from "./errors.js";
import { assertContentHash, readUploadBytes } from "./file-bytes.js";
import { DEFAULT_GWS_OPS, googleWorkspaceUpdate } from "./google-workspace.js";
import { createWorkHttpClient } from "./http.js";
import { resolveWorkLimits } from "./limits.js";
import type { GoogleWorkspaceAdapter, GoogleWorkspaceOp, WorkDraftStore, WorkLimits, WorkTokenProvider } from "./types.js";

const GOOGLE_API_ORIGINS = [
  "https://docs.googleapis.com",
  "https://gmail.googleapis.com",
  "https://sheets.googleapis.com",
  "https://slides.googleapis.com",
  "https://www.googleapis.com",
  "https://tasks.googleapis.com",
];
const GOOGLE_DOC_MIME_TYPES = {
  "docs.create": "application/vnd.google-apps.document",
  "sheets.create": "application/vnd.google-apps.spreadsheet",
  "slides.create": "application/vnd.google-apps.presentation",
} as const;

export interface GoogleWorkspaceHttpAdapterOptions {
  readonly identity: AgentIdentity;
  readonly tokenProvider: WorkTokenProvider;
  readonly accessEnvVar: string;
  readonly allowedOps?: readonly GoogleWorkspaceOp[];
  readonly limits?: WorkLimits;
  readonly fetch?: typeof globalThis.fetch;
  readonly draftStore?: WorkDraftStore;
  readonly checkpoints?: CheckpointStore;
  readonly bodies?: ArtifactBodyStore;
  readonly ephemeralDrafts?: boolean;
}

/** Google Workspace REST adapter with pinned default fetch and host-owned OAuth tokens. */
export function createGoogleWorkspaceHttpAdapter(options: GoogleWorkspaceHttpAdapterOptions): GoogleWorkspaceAdapter {
  if (!options || typeof options.tokenProvider?.tokenEnv !== "function") {
    throw new WorkToolError("ERR_PRISM_WORK_CREDENTIAL", "Google Workspace HTTP adapter requires a tokenProvider");
  }
  if (typeof options.accessEnvVar !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(options.accessEnvVar)) {
    throw new WorkToolError("ERR_PRISM_WORK_INPUT", "accessEnvVar must be an environment variable name");
  }
  if (options.fetch !== undefined && typeof options.fetch !== "function") {
    throw new WorkToolError("ERR_PRISM_WORK_INPUT", "fetch must be a function");
  }
  assertIdentityActive(options.identity);
  const limits = resolveWorkLimits(options.limits);
  const allowedOps = new Set<GoogleWorkspaceOp>(options.allowedOps ?? [...DEFAULT_GWS_OPS, "file.get"]);
  const request = createWorkHttpClient({
    identity: options.identity,
    tokenProvider: options.tokenProvider,
    accessEnvVar: options.accessEnvVar,
    allowedOrigins: GOOGLE_API_ORIGINS,
    limits,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  const draftStore: WorkDraftStore =
    options.draftStore ??
    (options.checkpoints
      ? createCheckpointWorkDraftStore({ checkpoints: options.checkpoints, bodies: options.bodies, limits: options.limits })
      : createMemoryWorkDraftStore({ ephemeral: options.ephemeralDrafts ?? true }));
  let readyVersion: string | undefined;

  const assertAllowed = (op: GoogleWorkspaceOp) => {
    if (!allowedOps.has(op)) throw new WorkToolError("ERR_PRISM_WORK_CAPABILITY", `Operation ${op} not allowed for this identity`);
  };
  const ensureReady = async (signal?: AbortSignal): Promise<string> => {
    if (readyVersion) return readyVersion;
    assertAllowed("version");
    const profile = asRecord(await request({ url: new URL("https://gmail.googleapis.com/gmail/v1/users/me/profile"), signal }));
    readyVersion = string(profile?.emailAddress) ?? "google-workspace";
    return readyVersion;
  };

  return {
    provider: "google-workspace",
    identity: options.identity,
    allowedOps,
    draftStore,
    ensureReady,
    async runOp(op, args, signal) {
      assertAllowed(op);
      switch (op) {
        case "version":
          return ensureReady(signal);
        case "mail.list":
          return request({ url: gmailUrl("messages", args, limits.maxItemsPerPage), signal });
        case "mail.get":
          return request({ url: gmailUrl(`messages/${encodeURIComponent(reqString(args, "id"))}`, args), signal });
        case "mail.send":
          return request({
            url: new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages/send"),
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ raw: rfc822(args) }),
            signal,
          });
        case "calendar.list":
          return request({ url: calendarUrl("events", args, limits.maxItemsPerPage), signal });
        case "calendar.add":
          return request({
            url: calendarUrl("events", args),
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              summary: reqString(args, "summary"),
              start: { dateTime: reqString(args, "start") },
              end: { dateTime: reqString(args, "end") },
            }),
            signal,
          });
        case "file.list":
          return listFiles(request, args, limits, signal);
        case "file.get":
          return request({
            url: new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(reqString(args, "id"))}?alt=media`),
            responseType: "bytes",
            maxResponseBytes: limits.maxFileBytes,
            signal,
          });
        case "file.add":
          return uploadFile(request, args, limits, options.bodies, signal);
        case "file.share":
          return createDrivePermission(request, args, signal);
        case "task.list":
          return request({ url: tasksUrl("tasks", args, limits.maxItemsPerPage), signal });
        case "task.add":
          return request({
            url: tasksUrl("tasks", args),
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: reqString(args, "title") }),
            signal,
          });
        case "task.complete":
          return request({
            url: tasksUrl(`tasks/${encodeURIComponent(reqString(args, "id"))}`, args),
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ status: "completed" }),
            signal,
          });
        case "docs.create":
        case "sheets.create":
        case "slides.create":
          return request({
            url: new URL("https://www.googleapis.com/drive/v3/files"),
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: reqString(args, "title"), mimeType: GOOGLE_DOC_MIME_TYPES[op] }),
            signal,
          });
        case "docs.update":
        case "sheets.update":
        case "slides.update": {
          const update = googleWorkspaceUpdate(op, args);
          return request({
            url: googleWorkspaceUpdateUrl(op, update.resourceId, args),
            method: op === "sheets.update" ? "PUT" : "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(update.body),
            signal,
          });
        }
        default: {
          const _exhaustive: never = op;
          throw new WorkToolError("ERR_PRISM_WORK_OP", `Unknown op ${_exhaustive}`);
        }
      }
    },
    createDraft(op, payload, draftOpts) {
      assertAllowed(op);
      return draftStore.createDraft({
        draftId: draftOpts?.draftId,
        provider: "google-workspace",
        op,
        identity: options.identity,
        payload,
        policyRevision: draftOpts?.policyRevision,
      });
    },
    getDraft(draftId) {
      return draftStore.getDraft({ draftId, identity: options.identity, provider: "google-workspace" });
    },
    updateDraft(draftId, payload, draftOpts) {
      return draftStore.updateDraft({
        draftId,
        identity: options.identity,
        payload,
        expectedRevision: draftOpts?.expectedRevision,
        expectedConcurrencyToken: draftOpts?.concurrencyToken,
      });
    },
    approveDraft(approval) {
      return draftStore.approveDraft({ draftId: approval.draftId, identity: options.identity, approval });
    },
    markDraft(draftId, status, concurrencyToken) {
      return draftStore.markDraft({ draftId, identity: options.identity, status, concurrencyToken });
    },
  };
}

function googleWorkspaceUpdateUrl(op: "docs.update" | "sheets.update" | "slides.update", resourceId: string, args: JsonObject): URL {
  switch (op) {
    case "docs.update":
      return new URL(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(resourceId)}:batchUpdate`);
    case "sheets.update": {
      const url = new URL(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(resourceId)}/values/${encodeURIComponent(reqString(args, "range"))}`,
      );
      url.searchParams.set("valueInputOption", "RAW");
      return url;
    }
    case "slides.update":
      return new URL(`https://slides.googleapis.com/v1/presentations/${encodeURIComponent(resourceId)}:batchUpdate`);
  }
}

function gmailUrl(path: string, args: JsonObject, maxItems?: number): URL {
  const userId = optString(args, "userId") ?? "me";
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(userId)}/${path}`);
  setQuery(url, "q", optString(args, "q"));
  setQuery(url, "maxResults", boundedPageSize(args, "maxResults", maxItems));
  return url;
}

function calendarUrl(path: string, args: JsonObject, maxItems?: number): URL {
  const calendarId = optString(args, "calendarId") ?? "primary";
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/${path}`);
  setQuery(url, "timeMin", optString(args, "timeMin"));
  setQuery(url, "timeMax", optString(args, "timeMax"));
  setQuery(url, "maxResults", boundedPageSize(args, "maxResults", maxItems));
  return url;
}

function tasksUrl(path: string, args: JsonObject, maxItems?: number): URL {
  const tasklist = optString(args, "tasklist") ?? "@default";
  const url = new URL(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(tasklist)}/${path}`);
  setQuery(url, "maxResults", boundedPageSize(args, "maxResults", maxItems));
  return url;
}

async function listFiles(
  request: ReturnType<typeof createWorkHttpClient>,
  args: JsonObject,
  limits: ReturnType<typeof resolveWorkLimits>,
  signal?: AbortSignal,
) {
  const pageAll = args.pageAll === true || args.pageAll === "true";
  const pages: unknown[] = [];
  let pageToken: string | undefined;
  let aggregate = 0;
  do {
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    setQuery(url, "q", optString(args, "q"));
    setQuery(url, "pageSize", boundedInteger(args, "pageSize", limits.maxItemsPerPage) ?? String(Math.min(10, limits.maxItemsPerPage)));
    setQuery(url, "pageToken", pageToken);
    const page = await request({ url, signal });
    const files = array(asRecord(page)?.files);
    if (files.length > limits.maxItemsPerPage) throw new WorkToolError("ERR_PRISM_WORK_LIMIT", "Drive page exceeds item limit");
    aggregate += files.length;
    if (aggregate > limits.maxAggregateItems) throw new WorkToolError("ERR_PRISM_WORK_LIMIT", "Drive result exceeds aggregate item limit");
    if (!pageAll) return page;
    pages.push(page);
    pageToken = string(asRecord(page)?.nextPageToken);
    if (pageToken && pages.length >= limits.maxPaginationPages) {
      throw new WorkToolError("ERR_PRISM_WORK_LIMIT", "Drive pagination exceeds page limit");
    }
  } while (pageToken);
  return pages;
}

async function uploadFile(
  request: ReturnType<typeof createWorkHttpClient>,
  args: JsonObject,
  limits: ReturnType<typeof resolveWorkLimits>,
  bodies: ArtifactBodyStore | undefined,
  signal?: AbortSignal,
): Promise<unknown> {
  const source = await readUploadBytes(args, bodies, limits.maxFileBytes, signal);
  assertContentHash(args, source.contentHash);
  const parentId = optString(args, "parentId");
  const multipart = multipartUpload(
    { name: reqString(args, "name"), ...(parentId === undefined ? {} : { parents: [parentId] }) },
    source.bytes,
  );
  return request({
    url: new URL("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart"),
    method: "POST",
    headers: { "content-type": multipart.contentType },
    body: multipart.body,
    signal,
  });
}

async function createDrivePermission(
  request: ReturnType<typeof createWorkHttpClient>,
  args: JsonObject,
  signal?: AbortSignal,
): Promise<unknown> {
  const type = reqString(args, "type");
  if (type === "anyone") throw new WorkToolError("ERR_PRISM_WORK_POLICY", "Anonymous share denied");
  if (type !== "domain" && type !== "user") throw new WorkToolError("ERR_PRISM_WORK_INPUT", "type must be domain or user");
  const role = optString(args, "role") ?? "reader";
  if (role !== "reader" && role !== "writer" && role !== "commenter") {
    throw new WorkToolError("ERR_PRISM_WORK_INPUT", "role must be reader, writer, or commenter");
  }
  const body =
    type === "domain" ? { type, role, domain: reqString(args, "domain") } : { type, role, emailAddress: reqString(args, "emailAddress") };
  return request({
    url: new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(reqString(args, "fileId"))}/permissions`),
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

function rfc822(args: JsonObject): string {
  const headers = [
    ["To", reqString(args, "to")],
    ["Subject", reqString(args, "subject")],
    ["Cc", optString(args, "cc")],
    ["Bcc", optString(args, "bcc")],
    ["From", optString(args, "from")],
  ] as const;
  for (const [, value] of headers) {
    if (value?.includes("\r") || value?.includes("\n"))
      throw new WorkToolError("ERR_PRISM_WORK_INPUT", "Mail headers cannot contain newlines");
  }
  const message = [
    ...headers.filter(([, value]) => value !== undefined).map(([name, value]) => `${name}: ${value}`),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    reqString(args, "body"),
  ].join("\r\n");
  return Buffer.from(message, "utf8").toString("base64url");
}

function multipartUpload(metadata: Record<string, unknown>, file: Buffer): { body: Buffer; contentType: string } {
  const boundary = `prism-${randomUUID()}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`, "utf8"),
    Buffer.from(`--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`, "utf8"),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
  ]);
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

function reqString(args: JsonObject, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value) throw new WorkToolError("ERR_PRISM_WORK_INPUT", `${key} must be a non-empty string`);
  return value;
}

function optString(args: JsonObject, key: string): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value) throw new WorkToolError("ERR_PRISM_WORK_INPUT", `${key} must be a non-empty string`);
  return value;
}

function boundedInteger(args: JsonObject, key: string, maximum: number | undefined): string | undefined {
  const value = optString(args, key);
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || (maximum !== undefined && number > maximum)) {
    throw new WorkToolError("ERR_PRISM_WORK_INPUT", `${key} must be an integer from 1 to ${maximum}`);
  }
  return String(number);
}

function boundedPageSize(args: JsonObject, key: string, maximum: number | undefined): string | undefined {
  return boundedInteger(args, key, maximum) ?? (maximum === undefined ? undefined : String(maximum));
}

function setQuery(url: URL, name: string, value: string | undefined): void {
  if (value !== undefined) url.searchParams.set(name, value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
