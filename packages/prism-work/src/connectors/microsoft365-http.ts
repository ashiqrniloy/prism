import { type AgentIdentity, type ArtifactBodyStore, assertIdentityActive, type CheckpointStore, type JsonObject } from "@arnilo/prism";
import { createCheckpointWorkDraftStore, createMemoryWorkDraftStore } from "./drafts.js";
import { WorkToolError } from "./errors.js";
import { assertContentHash, readUploadBytes } from "./file-bytes.js";
import { createWorkHttpClient } from "./http.js";
import { resolveWorkLimits } from "./limits.js";
import { DEFAULT_M365_OPS } from "./microsoft365.js";
import type { Microsoft365Adapter, Microsoft365Op, WorkDraftStore, WorkLimits, WorkTokenProvider } from "./types.js";

const GRAPH_ORIGIN = "https://graph.microsoft.com";

export interface Microsoft365HttpAdapterOptions {
  readonly identity: AgentIdentity;
  readonly tokenProvider: WorkTokenProvider;
  readonly accessEnvVar: string;
  readonly allowedOps?: readonly Microsoft365Op[];
  readonly limits?: WorkLimits;
  readonly fetch?: typeof globalThis.fetch;
  readonly draftStore?: WorkDraftStore;
  readonly checkpoints?: CheckpointStore;
  readonly bodies?: ArtifactBodyStore;
  readonly ephemeralDrafts?: boolean;
}

/** Microsoft Graph adapter with pinned default fetch and host-owned OAuth tokens. */
export function createMicrosoft365HttpAdapter(options: Microsoft365HttpAdapterOptions): Microsoft365Adapter {
  if (!options || typeof options.tokenProvider?.tokenEnv !== "function") {
    throw new WorkToolError("ERR_PRISM_WORK_CREDENTIAL", "Microsoft 365 HTTP adapter requires a tokenProvider");
  }
  if (typeof options.accessEnvVar !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(options.accessEnvVar)) {
    throw new WorkToolError("ERR_PRISM_WORK_INPUT", "accessEnvVar must be an environment variable name");
  }
  if (options.fetch !== undefined && typeof options.fetch !== "function") {
    throw new WorkToolError("ERR_PRISM_WORK_INPUT", "fetch must be a function");
  }
  assertIdentityActive(options.identity);
  const limits = resolveWorkLimits(options.limits);
  const allowedOps = new Set<Microsoft365Op>(options.allowedOps ?? [...DEFAULT_M365_OPS, "file.get"]);
  const request = createWorkHttpClient({
    identity: options.identity,
    tokenProvider: options.tokenProvider,
    accessEnvVar: options.accessEnvVar,
    allowedOrigins: [GRAPH_ORIGIN],
    limits,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  const draftStore: WorkDraftStore =
    options.draftStore ??
    (options.checkpoints
      ? createCheckpointWorkDraftStore({ checkpoints: options.checkpoints, bodies: options.bodies, limits: options.limits })
      : createMemoryWorkDraftStore({ ephemeral: options.ephemeralDrafts ?? true }));
  let readyVersion: string | undefined;

  const assertAllowed = (op: Microsoft365Op) => {
    if (!allowedOps.has(op)) throw new WorkToolError("ERR_PRISM_WORK_CAPABILITY", `Operation ${op} not allowed for this identity`);
  };
  const ensureReady = async (signal?: AbortSignal): Promise<string> => {
    if (readyVersion) return readyVersion;
    assertAllowed("version");
    const profile = asRecord(await request({ url: graphUrl("/me?$select=id,userPrincipalName"), signal }));
    readyVersion = string(profile?.userPrincipalName) ?? string(profile?.id) ?? "microsoft365";
    return readyVersion;
  };

  return {
    provider: "microsoft365",
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
          return request({ url: listUrl(mailPath(args), args, limits.maxItemsPerPage), signal });
        case "mail.get":
          return request({ url: graphUrl(`${userPath(args)}/messages/${encodeURIComponent(reqString(args, "id"))}`), signal });
        case "mail.send":
          return request({
            url: graphUrl("/me/sendMail"),
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ message: graphMessage(args), saveToSentItems: true }),
            signal,
          });
        case "calendar.list":
          return request({ url: calendarListUrl(args, limits.maxItemsPerPage), signal });
        case "calendar.add":
          return request({
            url: calendarPath(args),
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              subject: reqString(args, "subject"),
              start: graphDateTime(reqString(args, "start")),
              end: graphDateTime(reqString(args, "end")),
            }),
            signal,
          });
        case "file.list":
          safeResourceUrl(reqString(args, "webUrl"), "webUrl");
          return request({ url: listUrl(`${graphDriveItem(args, "folderUrl").path}/children`, args, limits.maxItemsPerPage), signal });
        case "file.get":
          return request({
            url: graphUrl(`/me/drive/items/${encodeURIComponent(reqString(args, "id"))}/content`),
            responseType: "bytes",
            maxResponseBytes: limits.maxFileBytes,
            signal,
          });
        case "file.add":
          return uploadFile(request, args, limits, options.bodies, signal);
        case "file.copy":
          return copyFile(request, args, signal);
        case "file.share":
          return createOrganizationLink(request, args, signal);
        case "todo.list":
          return request({ url: listUrl(`${todoListPath(args)}/tasks`, args, limits.maxItemsPerPage), signal });
        case "todo.add":
          return request({
            url: graphUrl(`${todoListPath(args)}/tasks`),
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: reqString(args, "title") }),
            signal,
          });
        case "todo.complete":
          return request({
            url: graphUrl(`${todoListPath(args)}/tasks/${encodeURIComponent(reqString(args, "id"))}`),
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ status: "completed" }),
            signal,
          });
        case "planner.list":
          return request({
            url: listUrl(`/planner/plans/${encodeURIComponent(reqString(args, "planId"))}/tasks`, args, limits.maxItemsPerPage),
            signal,
          });
        case "planner.add":
          return request({
            url: graphUrl("/planner/tasks"),
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              title: reqString(args, "title"),
              planId: reqString(args, "planId"),
              bucketId: reqString(args, "bucketId"),
            }),
            signal,
          });
        case "planner.complete":
          return request({
            url: graphUrl(`/planner/tasks/${encodeURIComponent(reqString(args, "id"))}`),
            method: "PATCH",
            headers: { "content-type": "application/json", "if-match": "*" },
            body: JSON.stringify({ percentComplete: 100 }),
            signal,
          });
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
        provider: "microsoft365",
        op,
        identity: options.identity,
        payload,
        policyRevision: draftOpts?.policyRevision,
      });
    },
    getDraft(draftId) {
      return draftStore.getDraft({ draftId, identity: options.identity, provider: "microsoft365" });
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

function graphUrl(path: string): URL {
  return new URL(`/v1.0${path}`, GRAPH_ORIGIN);
}

function userPath(args: JsonObject): string {
  const userName = optString(args, "userName");
  const userId = optString(args, "userId");
  if (userName && userId) throw new WorkToolError("ERR_PRISM_WORK_INPUT", "Specify userName or userId, not both");
  const user = userName ?? userId;
  return user ? `/users/${encodeURIComponent(user)}` : "/me";
}

function mailPath(args: JsonObject): string {
  const folderName = optString(args, "folderName");
  const folderId = optString(args, "folderId");
  if (folderName && folderId) throw new WorkToolError("ERR_PRISM_WORK_INPUT", "Specify folderName or folderId, not both");
  if (folderName && folderName.toLowerCase() !== "inbox") {
    throw new WorkToolError("ERR_PRISM_WORK_CAPABILITY", "Microsoft Graph HTTP mail.list supports inbox or folderId");
  }
  return `${userPath(args)}/mailFolders/${encodeURIComponent(folderId ?? "inbox")}/messages`;
}

function calendarPath(args: JsonObject): URL {
  const calendarId = optString(args, "calendarId");
  const calendarName = optString(args, "calendarName");
  if (calendarId && calendarName) throw new WorkToolError("ERR_PRISM_WORK_INPUT", "Specify calendarId or calendarName, not both");
  if (calendarName && calendarName.toLowerCase() !== "calendar") {
    throw new WorkToolError("ERR_PRISM_WORK_CAPABILITY", "Microsoft Graph HTTP calendar supports Calendar or calendarId");
  }
  return graphUrl(`${userPath(args)}${calendarId ? `/calendars/${encodeURIComponent(calendarId)}` : "/calendar"}/events`);
}

function calendarListUrl(args: JsonObject, maxItems: number): URL {
  const start = optString(args, "startDateTime");
  const end = optString(args, "endDateTime");
  if ((start === undefined) !== (end === undefined)) {
    throw new WorkToolError("ERR_PRISM_WORK_INPUT", "startDateTime and endDateTime must be supplied together");
  }
  const url = start === undefined ? calendarPath(args) : graphUrl(`${userPath(args)}/calendarView`);
  if (start !== undefined && end !== undefined) {
    url.searchParams.set("startDateTime", start);
    url.searchParams.set("endDateTime", end);
  }
  url.searchParams.set("$top", boundedPageSize(args, maxItems));
  return url;
}

function listUrl(path: string, args: JsonObject, maxItems: number): URL {
  const url = graphUrl(path);
  url.searchParams.set("$top", boundedPageSize(args, maxItems));
  return url;
}

function graphMessage(args: JsonObject): Record<string, unknown> {
  const contentType = optString(args, "bodyContentType") ?? "Text";
  if (contentType !== "Text" && contentType !== "HTML") {
    throw new WorkToolError("ERR_PRISM_WORK_INPUT", "bodyContentType must be Text or HTML");
  }
  const cc = optString(args, "cc");
  const bcc = optString(args, "bcc");
  return {
    subject: reqString(args, "subject"),
    body: { contentType, content: reqString(args, "bodyContents") },
    toRecipients: recipients(reqString(args, "to")),
    ...(cc ? { ccRecipients: recipients(cc) } : {}),
    ...(bcc ? { bccRecipients: recipients(bcc) } : {}),
  };
}

function recipients(value: string): readonly { emailAddress: { address: string } }[] {
  const addresses = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (addresses.length === 0 || addresses.some((address) => address.includes("\r") || address.includes("\n"))) {
    throw new WorkToolError("ERR_PRISM_WORK_INPUT", "Recipient addresses must be comma-separated single-line values");
  }
  return addresses.map((address) => ({ emailAddress: { address } }));
}

function graphDateTime(value: string): { dateTime: string; timeZone: string } {
  return { dateTime: value, timeZone: "UTC" };
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
  const folder = graphDriveItem(args, "folderUrl");
  return request({
    url: graphUrl(`${folder.path}:/${encodeURIComponent(source.name)}:/content`),
    method: "PUT",
    headers: { "content-type": "application/octet-stream" },
    body: source.bytes,
    signal,
  });
}

async function copyFile(request: ReturnType<typeof createWorkHttpClient>, args: JsonObject, signal?: AbortSignal): Promise<unknown> {
  const source = graphDriveItem(args, "sourceUrl", true);
  const target = graphDriveItem(args, "targetUrl", true);
  return request({
    url: graphUrl(`${source.path}/copy`),
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ parentReference: { driveId: target.driveId, id: target.itemId } }),
    signal,
  });
}

async function createOrganizationLink(
  request: ReturnType<typeof createWorkHttpClient>,
  args: JsonObject,
  signal?: AbortSignal,
): Promise<unknown> {
  safeResourceUrl(reqString(args, "webUrl"), "webUrl");
  const type = reqString(args, "type");
  if (type !== "view" && type !== "edit") throw new WorkToolError("ERR_PRISM_WORK_INPUT", "type must be view or edit");
  const scope = optString(args, "scope") ?? "organization";
  if (scope === "anonymous") throw new WorkToolError("ERR_PRISM_WORK_POLICY", "Anonymous share denied");
  if (scope !== "organization") throw new WorkToolError("ERR_PRISM_WORK_INPUT", "scope must be organization");
  const fileId = optString(args, "fileId");
  const file = fileId ? { path: `/me/drive/items/${encodeURIComponent(fileId)}` } : graphDriveItem(args, "fileUrl");
  return request({
    url: graphUrl(`${file.path}/createLink`),
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type, scope }),
    signal,
  });
}

function todoListPath(args: JsonObject): string {
  const listName = optString(args, "listName");
  const listId = optString(args, "listId");
  if (listName && listId) throw new WorkToolError("ERR_PRISM_WORK_INPUT", "Specify listName or listId, not both");
  if (listName) throw new WorkToolError("ERR_PRISM_WORK_CAPABILITY", "Microsoft Graph HTTP To Do operations require listId");
  if (!listId) throw new WorkToolError("ERR_PRISM_WORK_INPUT", "Specify listName or listId");
  return `/me/todo/lists/${encodeURIComponent(listId)}`;
}

function graphDriveItem(args: JsonObject, key: string): { path: string; driveId?: string; itemId?: string };
function graphDriveItem(args: JsonObject, key: string, requireDriveId: true): { path: string; driveId: string; itemId: string };
function graphDriveItem(args: JsonObject, key: string, requireDriveId = false): { path: string; driveId?: string; itemId?: string } {
  const url = safeResourceUrl(reqString(args, key), key);
  if (url.origin !== GRAPH_ORIGIN) {
    throw new WorkToolError("ERR_PRISM_WORK_CAPABILITY", `${key} must be a Microsoft Graph drive item URL for single-request execution`);
  }
  const [version, kind, driveId, itemKeyword, itemId] = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (
    version === "v1.0" &&
    kind === "drives" &&
    driveId &&
    itemKeyword === "items" &&
    itemId &&
    url.pathname.split("/").filter(Boolean).length === 5
  ) {
    return { path: `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`, driveId, itemId };
  }
  if (
    !requireDriveId &&
    version === "v1.0" &&
    kind === "me" &&
    driveId === "drive" &&
    itemKeyword === "items" &&
    itemId &&
    url.pathname.split("/").filter(Boolean).length === 5
  ) {
    return { path: `/me/drive/items/${encodeURIComponent(itemId)}`, itemId };
  }
  throw new WorkToolError("ERR_PRISM_WORK_CAPABILITY", `${key} must identify a Microsoft Graph drive item`);
}

function safeResourceUrl(value: string, key: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new WorkToolError("ERR_PRISM_WORK_INPUT", `${key} must be an HTTPS Microsoft Graph or SharePoint URL`);
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (hostname !== "graph.microsoft.com" && !hostname.endsWith(".sharepoint.com"))
  ) {
    throw new WorkToolError("ERR_PRISM_WORK_POLICY", `${key} must be an HTTPS Microsoft Graph or SharePoint URL`);
  }
  return url;
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

function boundedPageSize(args: JsonObject, maximum: number): string {
  const value = optString(args, "maxResults") ?? String(maximum);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) {
    throw new WorkToolError("ERR_PRISM_WORK_INPUT", `maxResults must be an integer from 1 to ${maximum}`);
  }
  return String(number);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
