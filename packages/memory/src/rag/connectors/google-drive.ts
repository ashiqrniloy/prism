import { createHash } from "node:crypto";
import { pinnedFetch, type SsrfPolicy } from "@arnilo/prism";
import type { SourceAccessGrant } from "../../types.js";
import { RagLimitError, RagSyncCursorError, RagSyncThrottleError, RagValidationError } from "../errors.js";
import { htmlParser, pdfParser, textParser } from "../parsers.js";
import type { KnowledgeChange, KnowledgeChangePage, KnowledgeConnector } from "../sync.js";
import { assertNotAborted } from "../util.js";

const DEFAULT_BASE = "https://www.googleapis.com/drive/v3";
const GOOGLE_DOC = "application/vnd.google-apps.document";
const FOLDER = "application/vnd.google-apps.folder";
const FILE_FIELDS = "id,name,mimeType,md5Checksum,trashed,size,driveId,permissions(id,type,emailAddress,role)";

export interface DrivePermission {
  readonly id?: string;
  readonly type?: string;
  readonly emailAddress?: string;
  readonly role?: string;
}

export interface DriveAccessMapping {
  readonly principalId?: string;
  readonly groupId?: string;
}

export interface GoogleDriveConnectorOptions {
  readonly tokenProvider: (input?: { readonly signal?: AbortSignal }) => Promise<string> | string;
  /** Host maps a Drive permission to a principal/group. Unmapped `anyone`/`domain` withholds the file. */
  readonly resolveAccess: (permission: DrivePermission) => DriveAccessMapping | undefined;
  readonly driveId?: string;
  readonly folderId?: string;
  readonly baseUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly ssrf?: SsrfPolicy;
  readonly allowLoopback?: boolean;
  readonly maxResponseBytes?: number;
  readonly signal?: AbortSignal;
}

interface DriveCursor {
  readonly v: 1;
  readonly phase: "list" | "changes";
  readonly pageToken?: string;
  readonly startPageToken: string;
}

export function createGoogleDriveConnector(options: GoogleDriveConnectorOptions): KnowledgeConnector {
  if (options.driveId !== undefined) requireId(options.driveId, "driveId");
  if (options.folderId !== undefined) requireId(options.folderId, "folderId");
  const base = new URL((options.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, ""));
  if (base.protocol !== "https:" && !(options.allowLoopback && base.protocol === "http:")) {
    throw new RagValidationError("Drive baseUrl must use https");
  }
  if (base.username || base.password || base.hash) throw new RagValidationError("Drive baseUrl must not embed credentials or a fragment");
  const maxBytes = options.maxResponseBytes ?? 1_048_576;
  if (!Number.isInteger(maxBytes) || maxBytes < 1) throw new RagValidationError("maxResponseBytes must be a positive integer");
  const transport =
    options.fetch ??
    ((input: RequestInfo | URL, init?: RequestInit) =>
      pinnedFetch(input instanceof URL ? input : new URL(String(input)), init, {
        errorPrefix: "Drive",
        hostnameErrorPrefix: "Drive",
        ssrf: options.ssrf,
        allowLoopback: options.allowLoopback,
        maxResponseBytes: maxBytes,
      }));

  return {
    async listChanges(input) {
      const signal = input.signal ?? options.signal;
      assertNotAborted(signal);
      const cursor = parseCursor(input.cursor);
      if (!cursor) {
        const startPageToken = await startToken(base, options, transport, signal, maxBytes);
        return listFiles({ ...options, base, transport, maxBytes }, { v: 1, phase: "list", startPageToken }, input.limit, signal);
      }
      if (cursor.phase === "list") return listFiles({ ...options, base, transport, maxBytes }, cursor, input.limit, signal);
      return listDriveChanges({ ...options, base, transport, maxBytes }, cursor, input.limit, signal);
    },
  };
}

async function listFiles(
  deps: GoogleDriveConnectorOptions & { base: URL; transport: typeof fetch; maxBytes: number },
  cursor: DriveCursor,
  limit: number,
  signal?: AbortSignal,
): Promise<KnowledgeChangePage> {
  const url = new URL(`${deps.base.toString().replace(/\/+$/, "")}/files`);
  url.searchParams.set("pageSize", String(limit));
  url.searchParams.set("fields", `nextPageToken,files(${FILE_FIELDS})`);
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  url.searchParams.set("q", filesQuery(deps.folderId));
  if (deps.driveId) {
    url.searchParams.set("corpora", "drive");
    url.searchParams.set("driveId", deps.driveId);
  }
  if (cursor.pageToken) url.searchParams.set("pageToken", cursor.pageToken);
  const body = asObject(await driveJson(url, deps, signal, deps.maxBytes));
  const files = Array.isArray(body.files) ? body.files : [];
  const changes: KnowledgeChange[] = [];
  for (const file of files) {
    const mapped = await mapFile(file, deps, signal);
    if (mapped) changes.push(mapped);
  }
  const next = typeof body.nextPageToken === "string" ? body.nextPageToken : undefined;
  if (next) {
    return {
      changes,
      resumeCursor: encodeCursor({ v: 1, phase: "list", pageToken: next, startPageToken: cursor.startPageToken }),
      done: false,
    };
  }
  return {
    changes,
    resumeCursor: encodeCursor({ v: 1, phase: "changes", pageToken: cursor.startPageToken, startPageToken: cursor.startPageToken }),
    done: false,
  };
}

async function listDriveChanges(
  deps: GoogleDriveConnectorOptions & { base: URL; transport: typeof fetch; maxBytes: number },
  cursor: DriveCursor,
  limit: number,
  signal?: AbortSignal,
): Promise<KnowledgeChangePage> {
  const url = new URL(`${deps.base.toString().replace(/\/+$/, "")}/changes`);
  url.searchParams.set("pageToken", cursor.pageToken ?? cursor.startPageToken);
  url.searchParams.set("pageSize", String(limit));
  url.searchParams.set("fields", `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FILE_FIELDS}))`);
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  if (deps.driveId) url.searchParams.set("driveId", deps.driveId);
  const body = asObject(await driveJson(url, deps, signal, deps.maxBytes));
  const raw = Array.isArray(body.changes) ? body.changes : [];
  const changes: KnowledgeChange[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const fileId = typeof row.fileId === "string" ? row.fileId : undefined;
    if (!fileId) continue;
    if (row.removed === true) {
      changes.push({ kind: "delete", sourceId: sourceIdFor(fileId) });
      continue;
    }
    const mapped = await mapFile(row.file, deps, signal);
    if (mapped) changes.push(mapped);
  }
  const next = typeof body.nextPageToken === "string" ? body.nextPageToken : undefined;
  const start = typeof body.newStartPageToken === "string" ? body.newStartPageToken : undefined;
  if (next) {
    return {
      changes,
      resumeCursor: encodeCursor({ v: 1, phase: "changes", pageToken: next, startPageToken: cursor.startPageToken }),
      done: false,
    };
  }
  if (!start) throw new RagSyncCursorError("Drive changes page missing newStartPageToken");
  return { changes, resumeCursor: encodeCursor({ v: 1, phase: "changes", pageToken: start, startPageToken: start }), done: true };
}

async function mapFile(
  file: unknown,
  deps: GoogleDriveConnectorOptions & { base: URL; transport: typeof fetch; maxBytes: number },
  signal?: AbortSignal,
): Promise<KnowledgeChange | undefined> {
  if (!file || typeof file !== "object") return undefined;
  const row = file as Record<string, unknown>;
  const fileId = typeof row.id === "string" ? row.id : undefined;
  if (!fileId) return undefined;
  const sourceId = sourceIdFor(fileId);
  if (row.trashed === true) return { kind: "delete", sourceId };
  const mimeType = typeof row.mimeType === "string" ? row.mimeType : "";
  if (mimeType === FOLDER || !ingestible(mimeType)) return undefined;
  const grants = grantsFrom(sourceId, Array.isArray(row.permissions) ? row.permissions : [], deps.resolveAccess);
  if (!grants) return { kind: "withhold", sourceId, freshness: "unavailable" };
  try {
    const text = await loadText(fileId, mimeType, deps, signal);
    const hash =
      typeof row.md5Checksum === "string" && /^[0-9a-f]{32}$/i.test(row.md5Checksum) ? row.md5Checksum.toLowerCase() : sha256(text);
    return { kind: "upsert", sourceId, text, contentHash: hash, grants };
  } catch (error) {
    if (error instanceof DriveHttpError && error.status === 404) return { kind: "delete", sourceId };
    if (error instanceof DriveHttpError && error.status === 403) return { kind: "withhold", sourceId, freshness: "unavailable" };
    throw error;
  }
}

async function loadText(
  fileId: string,
  mimeType: string,
  deps: GoogleDriveConnectorOptions & { base: URL; transport: typeof fetch; maxBytes: number },
  signal?: AbortSignal,
): Promise<string> {
  const root = deps.base.toString().replace(/\/+$/, "");
  const url =
    mimeType === GOOGLE_DOC
      ? new URL(`${root}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent("text/plain")}`)
      : new URL(`${root}/files/${encodeURIComponent(fileId)}?alt=media`);
  const bytes = await driveBytes(url, deps, signal, deps.maxBytes);
  const media = mimeType === GOOGLE_DOC ? "text/plain" : mimeType || "text/plain";
  const document = { uri: sourceIdFor(fileId), mediaType: media, data: bytes };
  if (media === "text/html" || media === "application/xhtml+xml") return (await htmlParser.parse(document)).text;
  if (media === "application/pdf") return (await pdfParser.parse(document)).text;
  return (await textParser.parse({ ...document, mediaType: "text/plain" })).text;
}

function ingestible(mimeType: string): boolean {
  return mimeType === GOOGLE_DOC || mimeType === "application/pdf" || mimeType === "application/json" || mimeType.startsWith("text/");
}

function grantsFrom(
  sourceId: string,
  permissions: unknown[],
  resolve: GoogleDriveConnectorOptions["resolveAccess"],
): SourceAccessGrant | undefined {
  const principalIds: string[] = [];
  const groupIds: string[] = [];
  for (const entry of permissions) {
    if (!entry || typeof entry !== "object") continue;
    const permission = entry as DrivePermission;
    const mapped = resolve(permission);
    if (!mapped) {
      if (permission.type === "anyone" || permission.type === "domain") return undefined;
      continue;
    }
    if (mapped.principalId) principalIds.push(mapped.principalId);
    if (mapped.groupId) groupIds.push(mapped.groupId);
  }
  if (principalIds.length === 0 && groupIds.length === 0) return undefined;
  return { sourceId, principalIds: unique(principalIds), groupIds: unique(groupIds), accessVersion: 1 };
}

async function startToken(
  base: URL,
  options: GoogleDriveConnectorOptions,
  transport: typeof fetch,
  signal: AbortSignal | undefined,
  maxBytes: number,
): Promise<string> {
  const url = new URL(`${base.toString().replace(/\/+$/, "")}/changes/startPageToken`);
  url.searchParams.set("supportsAllDrives", "true");
  if (options.driveId) url.searchParams.set("driveId", options.driveId);
  const body = asObject(await driveJson(url, { tokenProvider: options.tokenProvider, transport }, signal, maxBytes));
  if (typeof body.startPageToken !== "string" || !body.startPageToken) throw new RagSyncCursorError("Drive startPageToken missing");
  return body.startPageToken;
}

async function driveJson(
  url: URL,
  deps: { tokenProvider: GoogleDriveConnectorOptions["tokenProvider"]; transport: typeof fetch },
  signal: AbortSignal | undefined,
  maxBytes: number,
): Promise<unknown> {
  const response = await driveRequest(url, deps, signal);
  const text = await boundText(response, maxBytes);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RagValidationError("Drive response is not JSON");
  }
}

async function driveBytes(
  url: URL,
  deps: { tokenProvider: GoogleDriveConnectorOptions["tokenProvider"]; transport: typeof fetch },
  signal: AbortSignal | undefined,
  maxBytes: number,
): Promise<Uint8Array> {
  const response = await driveRequest(url, deps, signal);
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes) throw new RagLimitError(`Drive file exceeds ${maxBytes} bytes`);
  return buffer;
}

async function driveRequest(
  url: URL,
  deps: { tokenProvider: GoogleDriveConnectorOptions["tokenProvider"]; transport: typeof fetch },
  signal?: AbortSignal,
): Promise<Response> {
  assertNotAborted(signal);
  const token = await Promise.resolve(deps.tokenProvider({ signal }));
  if (typeof token !== "string" || !token.trim()) throw new RagValidationError("Drive token provider returned an empty token");
  const response = await deps.transport(url, { headers: { authorization: `Bearer ${token}` }, signal });
  if (response.status === 429 || (response.status === 403 && /rateLimitExceeded|userRateLimitExceeded/i.test(await peek(response)))) {
    const retryAfter = Number(response.headers.get("retry-after"));
    throw new RagSyncThrottleError(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 250);
  }
  if (response.status === 400 || response.status === 410) throw new RagSyncCursorError("Drive page token is invalid");
  if (!response.ok) throw new DriveHttpError(response.status);
  return response;
}

async function peek(response: Response): Promise<string> {
  try {
    return await response.clone().text();
  } catch {
    return "";
  }
}

async function boundText(response: Response, maxBytes: number): Promise<string> {
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new RagLimitError(`Drive response exceeds ${maxBytes} bytes`);
  return text;
}

class DriveHttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Drive request failed (${status})`);
    this.name = "DriveHttpError";
    this.status = status;
  }
}

function parseCursor(raw?: string): DriveCursor | undefined {
  if (raw === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RagSyncCursorError();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new RagSyncCursorError();
  const cursor = parsed as DriveCursor;
  if (cursor.v !== 1 || (cursor.phase !== "list" && cursor.phase !== "changes") || typeof cursor.startPageToken !== "string") {
    throw new RagSyncCursorError();
  }
  return cursor;
}

function encodeCursor(cursor: DriveCursor): string {
  return JSON.stringify(cursor);
}

function filesQuery(folderId?: string): string {
  return folderId ? `'${folderId}' in parents and trashed = false` : "trashed = false";
}

function sourceIdFor(fileId: string): string {
  return `drive:${fileId}`;
}

function requireId(value: string, label: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new RagValidationError(`${label} must be a Drive identifier`);
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RagValidationError("Drive JSON object expected");
  return value as Record<string, unknown>;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
