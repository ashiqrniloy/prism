/**
 * Artifact HTTP handler (plan 070 Task 8 split of runtime/server/artifacts.ts, moved
 * verbatim): the host-authorizer types, `createArtifactHandler` and its route parsing,
 * JSON/error responses, and the bounded request-body readers.
 */
import {
  type ArtifactCitation,
  type ArtifactDeliveryToken,
  ArtifactError,
  assertIdentityActive,
  assertIdentityMatchesOwnership,
  type OwnershipScope,
  type SecretRedactor,
  trimTrailingSlashes,
} from "@arnilo/prism";
import { verifyArtifactDeliveryLink } from "./artifacts-delivery-links.js";
import { type ArtifactLimits, resolveArtifactLimits } from "./artifacts-limits.js";
import { type ArtifactService, ID_PATTERN } from "./artifacts-service.js";
import { type PrismRequestHandler, type PrismServerAuthorization, PrismServerError } from "./types.js";

export type ArtifactOperation =
  | "artifact.attach"
  | "artifact.list"
  | "artifact.get"
  | "artifact.revise"
  | "artifact.compare"
  | "artifact.approve"
  | "artifact.reject"
  | "artifact.last-validated"
  | "artifact.delivery-link"
  | "artifact.download";

export interface ArtifactAuthorizationInput {
  readonly request: Request;
  readonly operation: ArtifactOperation;
  readonly threadId?: string;
  readonly artifactId?: string;
  /** Present for download: the verified delivery token to reauthorize against. */
  readonly deliveryToken?: ArtifactDeliveryToken;
  readonly signal: AbortSignal;
}

export type ArtifactAuthorizer = (
  input: ArtifactAuthorizationInput,
) => false | PrismServerAuthorization | Promise<false | PrismServerAuthorization>;

export interface CreateArtifactHandlerOptions {
  readonly service: ArtifactService;
  readonly authorize: ArtifactAuthorizer;
  readonly linkSecret: string;
  readonly basePath?: string;
  readonly redactor?: SecretRedactor;
  readonly limits?: ArtifactLimits;
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

/** Framework-free HTTP adapter for one mounted artifact service (default base `/prism/artifacts`). */
export function createArtifactHandler(options: CreateArtifactHandlerOptions): PrismRequestHandler {
  const base = normalizeBasePath(options.basePath ?? "/prism/artifacts");
  const limits = resolveArtifactLimits(options.limits);

  return async (request) => {
    try {
      const route = parseArtifactRoute(request, base);
      if (!route) throw new PrismServerError("Not found", 404, "ERR_PRISM_SERVER_NOT_FOUND");
      let deliveryToken: ArtifactDeliveryToken | undefined;
      if (route.kind === "download") {
        const link = new URL(request.url).searchParams.get("link");
        if (link === null) throw new PrismServerError("link query parameter is required", 400, "ERR_PRISM_SERVER_INPUT");
        deliveryToken = verifyArtifactDeliveryLink(link, options.linkSecret, limits.deliveryLinkTokenBytes);
      }
      const authorization = await options.authorize({
        request,
        operation: route.operation,
        ...(route.threadId === undefined ? {} : { threadId: route.threadId }),
        ...(route.artifactId === undefined ? {} : { artifactId: route.artifactId }),
        ...(deliveryToken === undefined ? {} : { deliveryToken }),
        signal: request.signal,
      });
      if (!authorization) throw new PrismServerError("Forbidden", 403, "ERR_PRISM_SERVER_FORBIDDEN");
      if (authorization.identity) {
        assertIdentityActive(authorization.identity);
        assertIdentityMatchesOwnership(authorization.identity, authorization.ownership);
      }
      // Download reauthorizes against the token's ownership; a mismatch fails closed.
      if (deliveryToken && !ownershipMatches(authorization.ownership, deliveryToken)) {
        throw new PrismServerError("Forbidden", 403, "ERR_PRISM_SERVER_FORBIDDEN");
      }
      const input = {
        ownership: authorization.ownership,
        ...(authorization.identity === undefined ? {} : { identity: authorization.identity }),
        signal: request.signal,
      };
      const service = options.service;
      switch (route.kind) {
        case "attach": {
          const body = await readBody(request, limits.maxRequestBytes);
          const record = await service.attach({
            ...input,
            threadId: route.threadId,
            uri: readString(body.uri, "uri"),
            mime: readString(body.mime, "mime"),
            hash: readString(body.hash, "hash"),
            ...(body.size === undefined ? {} : { size: readNonNegativeInt(String(body.size), "size") }),
            ...(body.id === undefined ? {} : { id: readString(body.id, "id") }),
            ...(body.title === undefined ? {} : { title: readString(body.title, "title") }),
            ...(body.changeNote === undefined ? {} : { changeNote: readString(body.changeNote, "changeNote") }),
            ...(body.producerRunId === undefined ? {} : { producerRunId: readString(body.producerRunId, "producerRunId") }),
            ...(body.citations === undefined ? {} : { citations: readCitations(body.citations) }),
            ...(body.preview === undefined ? {} : { preview: readObject(body.preview, "preview") }),
          });
          return json(options, record, 201);
        }
        case "list": {
          const query = new URL(request.url).searchParams;
          const page = await service.list({
            ...input,
            threadId: route.threadId,
            ...(query.get("cursor") === null ? {} : { cursor: query.get("cursor") ?? undefined }),
            ...(query.get("limit") === null ? {} : { limit: readPositiveInt(query.get("limit"), "limit") }),
          });
          return json(options, page, 200);
        }
        case "get":
          return json(options, await service.get({ ...input, threadId: route.threadId, artifactId: route.artifactId }), 200);
        case "revise": {
          const body = await readBody(request, limits.maxRequestBytes);
          const record = await service.revise({
            ...input,
            threadId: route.threadId,
            artifactId: route.artifactId,
            uri: readString(body.uri, "uri"),
            hash: readString(body.hash, "hash"),
            ...(body.size === undefined ? {} : { size: readNonNegativeInt(String(body.size), "size") }),
            ...(body.mime === undefined ? {} : { mime: readString(body.mime, "mime") }),
            ...(body.changeNote === undefined ? {} : { changeNote: readString(body.changeNote, "changeNote") }),
            ...(body.producerRunId === undefined ? {} : { producerRunId: readString(body.producerRunId, "producerRunId") }),
            ...(body.citations === undefined ? {} : { citations: readCitations(body.citations) }),
            ...(body.preview === undefined ? {} : { preview: readObject(body.preview, "preview") }),
          });
          return json(options, record, 200);
        }
        case "compare": {
          const body = await readBody(request, limits.maxRequestBytes);
          const result = await service.compare({
            ...input,
            threadId: route.threadId,
            artifactId: route.artifactId,
            from: readPositiveInt(body.from === undefined ? null : String(body.from), "from"),
            to: readPositiveInt(body.to === undefined ? null : String(body.to), "to"),
          });
          return json(options, result, 200);
        }
        case "approve":
        case "reject": {
          const body = await readBody(request, limits.maxRequestBytes);
          const decision = {
            ...input,
            threadId: route.threadId,
            artifactId: route.artifactId,
            version: readPositiveInt(body.version === undefined ? null : String(body.version), "version"),
            ...(body.note === undefined ? {} : { note: readString(body.note, "note") }),
            ...(body.reviewer === undefined ? {} : { reviewer: readString(body.reviewer, "reviewer") }),
          };
          const record = route.kind === "approve" ? await service.approve(decision) : await service.reject(decision);
          return json(options, record, 200);
        }
        case "last-validated": {
          const revision = await service.lastValidated({ ...input, threadId: route.threadId, artifactId: route.artifactId });
          return json(options, revision, 200);
        }
        case "delivery-link": {
          const body = await readBody(request, limits.maxRequestBytes);
          const result = await service.deliveryLink({
            ...input,
            threadId: route.threadId,
            artifactId: route.artifactId,
            ...(body.version === undefined ? {} : { version: readPositiveInt(String(body.version), "version") }),
            ...(body.ttlSeconds === undefined ? {} : { ttlSeconds: readPositiveInt(String(body.ttlSeconds), "ttlSeconds") }),
          });
          return json(options, result, 200);
        }
        case "download": {
          // Token verified + reauthorized above; serve the authorized revision reference only
          // (host fetches the body). Reverify the artifact still has the version.
          const token = deliveryToken as ArtifactDeliveryToken;
          const record = await service.get({ ...input, threadId: token.threadId, artifactId: token.artifactId });
          const revision = record.revisions.find((item) => item.version === token.version);
          if (!revision) throw new PrismServerError("Revision not found", 404, "ERR_PRISM_SERVER_NOT_FOUND");
          return json(options, { artifactId: record.id, threadId: record.threadId, revision }, 200);
        }
      }
    } catch (error) {
      return artifactErrorResponse(error);
    }
  };
}

type ArtifactRoute =
  | { readonly kind: "attach"; readonly operation: "artifact.attach"; readonly threadId: string; readonly artifactId?: undefined }
  | { readonly kind: "list"; readonly operation: "artifact.list"; readonly threadId: string; readonly artifactId?: undefined }
  | { readonly kind: "get"; readonly operation: "artifact.get"; readonly threadId: string; readonly artifactId: string }
  | { readonly kind: "revise"; readonly operation: "artifact.revise"; readonly threadId: string; readonly artifactId: string }
  | { readonly kind: "compare"; readonly operation: "artifact.compare"; readonly threadId: string; readonly artifactId: string }
  | { readonly kind: "approve"; readonly operation: "artifact.approve"; readonly threadId: string; readonly artifactId: string }
  | { readonly kind: "reject"; readonly operation: "artifact.reject"; readonly threadId: string; readonly artifactId: string }
  | {
      readonly kind: "last-validated";
      readonly operation: "artifact.last-validated";
      readonly threadId: string;
      readonly artifactId: string;
    }
  | { readonly kind: "delivery-link"; readonly operation: "artifact.delivery-link"; readonly threadId: string; readonly artifactId: string }
  | { readonly kind: "download"; readonly operation: "artifact.download"; readonly threadId?: undefined; readonly artifactId?: undefined };

function parseArtifactRoute(request: Request, base: string): ArtifactRoute | undefined {
  const pathname = new URL(request.url).pathname;
  if (pathname === `${base}/download` && request.method === "GET") {
    return { kind: "download", operation: "artifact.download" };
  }
  if (pathname !== base && !pathname.startsWith(`${base}/`)) return undefined;
  let parts: string[];
  try {
    parts = pathname.slice(base.length).split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    throw new PrismServerError("Invalid route", 400, "ERR_PRISM_SERVER_ROUTE");
  }
  if (parts.length === 0) return undefined;
  const [threadId, artifactId, action] = parts;
  if (!ID_PATTERN.test(threadId) || threadId.length > 128) return undefined;
  if (parts.length === 1) {
    if (request.method === "POST") return { kind: "attach", operation: "artifact.attach", threadId };
    if (request.method === "GET") return { kind: "list", operation: "artifact.list", threadId };
    return undefined;
  }
  if (!ID_PATTERN.test(artifactId) || artifactId.length > 128) return undefined;
  if (parts.length === 2) {
    if (request.method === "GET") return { kind: "get", operation: "artifact.get", threadId, artifactId };
    return undefined;
  }
  if (parts.length !== 3) return undefined;
  if (action === "last-validated" && request.method === "GET")
    return { kind: "last-validated", operation: "artifact.last-validated", threadId, artifactId };
  if (request.method !== "POST") return undefined;
  if (action === "revise") return { kind: "revise", operation: "artifact.revise", threadId, artifactId };
  if (action === "compare") return { kind: "compare", operation: "artifact.compare", threadId, artifactId };
  if (action === "approve") return { kind: "approve", operation: "artifact.approve", threadId, artifactId };
  if (action === "reject") return { kind: "reject", operation: "artifact.reject", threadId, artifactId };
  if (action === "delivery-link") return { kind: "delivery-link", operation: "artifact.delivery-link", threadId, artifactId };
  return undefined;
}

function ownershipMatches(scope: OwnershipScope, token: ArtifactDeliveryToken): boolean {
  return scope.tenantId === token.tenantId && scope.accountId === token.accountId && scope.userId === token.userId;
}

function json(options: CreateArtifactHandlerOptions, value: unknown, status: number): Response {
  const safe = options.redactor?.redact(value) ?? value;
  return new Response(JSON.stringify(safe), { status, headers: JSON_HEADERS });
}

function artifactErrorResponse(error: unknown): Response {
  let status = 500;
  let code = "ERR_PRISM_SERVER_INTERNAL";
  let message = "Internal server error";
  if (error instanceof PrismServerError) {
    status = error.status;
    code = error.code;
    message = error.message;
  } else if (error instanceof ArtifactError) {
    code = error.code;
    message = error.message;
    status =
      error.reason === "not_found" || error.reason === "not_validated"
        ? 404
        : error.reason === "conflict"
          ? 409
          : error.reason === "ownership"
            ? 403
            : error.reason === "link_expired"
              ? 410
              : error.reason === "too_many_artifacts" || error.reason === "too_many_revisions"
                ? 422
                : error.reason === "invalid_link"
                  ? 401
                  : 400;
  } else if (error instanceof RangeError) {
    status = 400;
    code = "ERR_PRISM_SERVER_INPUT";
    message = error.message;
  } else if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ERR_PRISM_IDENTITY") {
    status = 403;
    code = "ERR_PRISM_SERVER_FORBIDDEN";
    message = "Forbidden";
  } else if (error instanceof DOMException && error.name === "AbortError") {
    status = 499;
    code = "ERR_PRISM_SERVER_ABORTED";
    message = "Request aborted";
  }
  return new Response(JSON.stringify({ error: { code, message } }), { status, headers: JSON_HEADERS });
}

function normalizeBasePath(value: string): string {
  if (!value.startsWith("/") || value.includes("?") || value.includes("#")) throw new RangeError("basePath must be an absolute URL path");
  const normalized = value.length > 1 ? trimTrailingSlashes(value) : value;
  if (normalized === "/") throw new RangeError("basePath cannot expose the URL root");
  return normalized;
}

async function readBody(request: Request, maxBytes: number): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new PrismServerError("Request body too large", 413, "ERR_PRISM_SERVER_BODY_LIMIT");
  }
  if (text.length === 0) return {};
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object");
    return value as Record<string, unknown>;
  } catch {
    throw new PrismServerError("Invalid JSON object body", 400, "ERR_PRISM_SERVER_BODY");
  }
}

function readString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new PrismServerError(`${name} must be a string`, 400, "ERR_PRISM_SERVER_INPUT");
  return value;
}

function readObject(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new PrismServerError(`${name} must be an object`, 400, "ERR_PRISM_SERVER_INPUT");
  return value as Record<string, unknown>;
}

function readCitations(value: unknown): ArtifactCitation[] {
  if (!Array.isArray(value)) throw new PrismServerError("citations must be an array", 400, "ERR_PRISM_SERVER_INPUT");
  return value as ArtifactCitation[];
}

function readPositiveInt(value: string | null, name: string): number {
  const parsed = value === null ? NaN : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new PrismServerError(`${name} must be a positive safe integer`, 400, "ERR_PRISM_SERVER_INPUT");
  return parsed;
}

function readNonNegativeInt(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new PrismServerError(`${name} must be a non-negative safe integer`, 400, "ERR_PRISM_SERVER_INPUT");
  return parsed;
}
