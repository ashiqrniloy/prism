import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type JsonObject, pinnedFetch } from "@arnilo/prism";

import type { ToolsOpenapiSpecConfig } from "./config.js";
import { OpenApiToolError } from "./errors.js";
import type { ResolvedOpenApiLimits } from "./limits.js";

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/**
 * Read one spec once at setup: a local JSON file, or an `https:` URL through the kernel's
 * DNS-pinned, redirect-free, byte-bounded fetch. YAML documents are not supported.
 */
export async function loadSpecDocument(spec: ToolsOpenapiSpecConfig, limits: ResolvedOpenApiLimits): Promise<JsonObject> {
  let text: string;
  if (isHttpUrl(spec.source)) {
    const response = await pinnedFetch(new URL(spec.source), undefined, {
      maxResponseBytes: limits.maxDocumentBytes,
      errorPrefix: "OpenAPI spec",
    });
    text = await response.text();
  } else {
    const data = readFileSync(resolve(spec.source));
    if (data.byteLength > limits.maxDocumentBytes) {
      throw new OpenApiToolError("ERR_PRISM_OPENAPI_DOCUMENT_BOUNDS", `spec ${spec.id} exceeds maxDocumentBytes`);
    }
    text = data.toString("utf8");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new OpenApiToolError("ERR_PRISM_OPENAPI_DOCUMENT_BOUNDS", `spec ${spec.id} is not valid JSON`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new OpenApiToolError("ERR_PRISM_OPENAPI_DOCUMENT_BOUNDS", `spec ${spec.id} must be a JSON object`);
  }
  return parsed as JsonObject;
}

/** The first absolute `servers[].url`, used as the pinned origin when `baseUrl` is absent. */
export function firstServerUrl(document: JsonObject): string | undefined {
  const servers = document.servers;
  if (!Array.isArray(servers)) return undefined;
  for (const entry of servers) {
    const url = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>).url : undefined;
    if (typeof url !== "string" || url.length === 0) continue;
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") return url;
    } catch {
      // Relative server URLs resolve against the pinned base, so they cannot supply one.
    }
  }
  return undefined;
}

/** Every `operationId` the document declares, in path/method order. */
export function listOperationIds(document: JsonObject): string[] {
  const paths = document.paths;
  if (typeof paths !== "object" || paths === null || Array.isArray(paths)) return [];
  const ids: string[] = [];
  for (const pathItem of Object.values(paths as Record<string, unknown>)) {
    if (typeof pathItem !== "object" || pathItem === null) continue;
    for (const method of HTTP_METHODS) {
      const operation = (pathItem as Record<string, unknown>)[method];
      if (typeof operation !== "object" || operation === null) continue;
      const operationId = (operation as Record<string, unknown>).operationId;
      if (typeof operationId === "string" && operationId.length > 0) ids.push(operationId);
    }
  }
  return ids;
}

/** `include` wins; otherwise every operation minus `exclude`. */
export function selectOperations(document: JsonObject, spec: ToolsOpenapiSpecConfig): string[] {
  if (spec.include !== undefined) return [...spec.include];
  const excluded = new Set(spec.exclude ?? []);
  return listOperationIds(document).filter((id) => !excluded.has(id));
}
