import type { JsonObject, ToolEffectDeclaration } from "@arnilo/prism";
import { OpenApiToolError } from "./errors.js";
import type { ResolvedOpenApiLimits } from "./limits.js";
import type { OpenApiPagination } from "./types.js";

export interface CompiledParameter {
  readonly name: string;
  readonly required: boolean;
  readonly schema: JsonObject;
}

export interface CompiledOperation {
  readonly toolName: string;
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
  readonly pathParams: readonly string[];
  readonly queryParams: readonly CompiledParameter[];
  readonly headerParams: readonly CompiledParameter[];
  readonly bodyParam?: { readonly name: string; readonly schema: JsonObject; readonly required: boolean };
  /** Full argument schema: path + query + header + body, no $refs, bounded. */
  readonly parameters: JsonObject;
  readonly description: string;
  readonly effect: ToolEffectDeclaration;
  readonly paginatable: boolean;
}

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const MAX_DESCRIPTION_BYTES = 16 * 1024;

/** Single-schema keywords (object values). */
const SCHEMA_OBJECT_KEYWORDS = new Set([
  "items",
  "additionalProperties",
  "not",
  "if",
  "then",
  "else",
  "contains",
  "propertyNames",
  "unevaluatedProperties",
  "unevaluatedItems",
]);
/** Schema-map keywords (object of schemas). */
const SCHEMA_MAP_KEYWORDS = new Set(["properties", "patternProperties", "dependentSchemas"]);
/** Schema-array keywords. */
const SCHEMA_ARRAY_KEYWORDS = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function validateServerUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OpenApiToolError("ERR_PRISM_OPENAPI_DOCUMENT_BOUNDS", `${label} is not an absolute URL`);
  }
  if (url.username || url.password) throw new OpenApiToolError("ERR_PRISM_OPENAPI_DOCUMENT_BOUNDS", `${label} must not embed credentials`);
  if (url.hash) throw new OpenApiToolError("ERR_PRISM_OPENAPI_DOCUMENT_BOUNDS", `${label} must not contain a fragment`);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHostname(url.hostname))) {
    throw new OpenApiToolError("ERR_PRISM_OPENAPI_DOCUMENT_BOUNDS", `${label} must be https (http allowed only for loopback hosts)`);
  }
  return url;
}

/** Every declared server URL must resolve to the pinned origin (relative URLs resolve against the pinned base). */
function assertServerOrigin(pinned: URL, serverUrl: unknown, label: string): void {
  if (typeof serverUrl !== "string" || !serverUrl) {
    throw new OpenApiToolError("ERR_PRISM_OPENAPI_SERVER_DRIFT", `${label} has an invalid server url`);
  }
  const resolved = new URL(serverUrl, pinned);
  if (resolved.origin !== pinned.origin) {
    throw new OpenApiToolError(
      "ERR_PRISM_OPENAPI_SERVER_DRIFT",
      `${label} origin ${resolved.origin} differs from pinned server origin ${pinned.origin}`,
    );
  }
}

function assertServers(servers: unknown, pinned: URL, label: string): void {
  if (servers === undefined) return;
  if (!Array.isArray(servers) || servers.length === 0) {
    throw new OpenApiToolError("ERR_PRISM_OPENAPI_SERVER_DRIFT", `${label} must be a non-empty array`);
  }
  for (const entry of servers) {
    const url = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>).url : undefined;
    assertServerOrigin(pinned, url, label);
  }
}

function parseDocument(document: string | JsonObject, maxDocumentBytes: number): Record<string, unknown> {
  let text: string;
  let parsed: unknown;
  if (typeof document === "string") {
    text = document;
    if (Buffer.byteLength(text, "utf8") > maxDocumentBytes) {
      throw new OpenApiToolError("ERR_PRISM_OPENAPI_DOCUMENT_BOUNDS", "document exceeds maxDocumentBytes");
    }
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new OpenApiToolError("ERR_PRISM_OPENAPI_DOCUMENT_BOUNDS", "document is not valid JSON");
    }
  } else {
    try {
      text = JSON.stringify(document);
    } catch {
      throw new OpenApiToolError("ERR_PRISM_OPENAPI_DOCUMENT_BOUNDS", "document is not JSON-serializable");
    }
    if (Buffer.byteLength(text, "utf8") > maxDocumentBytes) {
      throw new OpenApiToolError("ERR_PRISM_OPENAPI_DOCUMENT_BOUNDS", "document exceeds maxDocumentBytes");
    }
    parsed = document;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new OpenApiToolError("ERR_PRISM_OPENAPI_DOCUMENT_BOUNDS", "document must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function resolvePointer(doc: unknown, pointer: string): unknown {
  if (!pointer.startsWith("#/")) return undefined;
  const parts = pointer
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
  let current: unknown = doc;
  for (const part of parts) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Resolve internal $refs into a self-contained schema; cycles/depth/ref-count bounded, external refs rejected. */
function resolveSchema(
  value: unknown,
  doc: Record<string, unknown>,
  limits: ResolvedOpenApiLimits,
  state: { readonly refs: number; readonly depth: number },
): JsonObject {
  if (state.depth > limits.maxSchemaDepth) {
    throw new OpenApiToolError("ERR_PRISM_OPENAPI_SCHEMA_BOUNDS", "schema exceeds maxSchemaDepth (cycle or nesting)");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const schema = value as Record<string, unknown>;
  if (typeof schema.$ref === "string") {
    const refs = state.refs + 1;
    if (refs > limits.maxRefs) throw new OpenApiToolError("ERR_PRISM_OPENAPI_SCHEMA_BOUNDS", "schema exceeds maxRefs");
    if (!schema.$ref.startsWith("#/")) {
      throw new OpenApiToolError("ERR_PRISM_OPENAPI_SCHEMA_BOUNDS", `external $ref is unsupported: ${schema.$ref}`);
    }
    const target = resolvePointer(doc, schema.$ref);
    if (target === undefined) throw new OpenApiToolError("ERR_PRISM_OPENAPI_SCHEMA_BOUNDS", `unresolvable $ref: ${schema.$ref}`);
    return resolveSchema(target, doc, limits, { refs, depth: state.depth + 1 });
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(schema)) {
    if (key === "$ref") continue;
    if (SCHEMA_ARRAY_KEYWORDS.has(key) && Array.isArray(val)) {
      out[key] = val.map((item) => resolveSchema(item, doc, limits, { refs: state.refs, depth: state.depth + 1 }));
    } else if (SCHEMA_MAP_KEYWORDS.has(key) && typeof val === "object" && val !== null && !Array.isArray(val)) {
      const mapped: Record<string, unknown> = {};
      for (const [name, child] of Object.entries(val as Record<string, unknown>)) {
        mapped[name] = resolveSchema(child, doc, limits, { refs: state.refs, depth: state.depth + 1 });
      }
      out[key] = mapped as JsonObject;
    } else if (SCHEMA_OBJECT_KEYWORDS.has(key) && typeof val === "object" && val !== null && !Array.isArray(val)) {
      out[key] = resolveSchema(val, doc, limits, { refs: state.refs, depth: state.depth + 1 });
    } else {
      out[key] = val;
    }
  }
  return out as JsonObject;
}

function sanitizeToolName(operationId: string): string {
  const name = operationId.replace(/[^A-Za-z0-9._:-]/g, "_");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(name) || name.length > 128) {
    throw new OpenApiToolError("ERR_PRISM_OPENAPI_DOCUMENT_BOUNDS", `operationId cannot be represented as a tool name: ${operationId}`);
  }
  return name;
}

function effectForMethod(method: string): ToolEffectDeclaration {
  if (SAFE_METHODS.has(method)) return { kind: "none", idempotency: "none" };
  if (MUTATING_METHODS.has(method)) return { kind: "external_mutation", idempotency: "required" };
  throw new OpenApiToolError("ERR_PRISM_OPENAPI_DOCUMENT_BOUNDS", `unsupported HTTP method: ${method}`);
}

function pickJsonMedia(content: Record<string, unknown>): string | undefined {
  if (content["application/json"] !== undefined) return "application/json";
  return Object.keys(content).find((key) => /^application\/.*\+json$/i.test(key));
}

interface OperationRef {
  readonly method: string;
  readonly path: string;
  readonly operation: Record<string, unknown>;
  readonly pathItem: Record<string, unknown>;
}

function compileOperation(
  ref: OperationRef,
  doc: Record<string, unknown>,
  pinned: URL,
  limits: ResolvedOpenApiLimits,
  pagination: OpenApiPagination | undefined,
): CompiledOperation {
  const { method, path, operation, pathItem } = ref;
  const operationId = operation.operationId as string;
  assertServers(operation.servers, pinned, `servers for operation ${operationId}`);
  const toolName = sanitizeToolName(operationId);

  const merged = new Map<string, Record<string, unknown>>();
  for (const list of [pathItem.parameters, operation.parameters]) {
    if (!Array.isArray(list)) continue;
    for (const param of list) {
      if (typeof param !== "object" || param === null) continue;
      const p = param as Record<string, unknown>;
      if (typeof p.name !== "string" || typeof p.in !== "string") {
        throw new OpenApiToolError("ERR_PRISM_OPENAPI_SCHEMA_BOUNDS", `invalid parameter in operation ${operationId}`);
      }
      merged.set(`${p.in}:${p.name}`, p);
    }
  }

  const pathParams: string[] = [];
  for (const match of path.matchAll(/\{([^}]+)\}/g)) pathParams.push(match[1]);
  for (const name of pathParams) {
    if (!merged.has(`path:${name}`)) {
      throw new OpenApiToolError("ERR_PRISM_OPENAPI_SCHEMA_BOUNDS", `path parameter ${name} of ${operationId} has no declaration`);
    }
  }

  const queryParams: CompiledParameter[] = [];
  const headerParams: CompiledParameter[] = [];
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  const argNames = new Set<string>();
  const addArg = (name: string, schema: JsonObject, isRequired: boolean): void => {
    if (argNames.has(name)) {
      throw new OpenApiToolError("ERR_PRISM_OPENAPI_SCHEMA_BOUNDS", `duplicate argument name in ${operationId}: ${name}`);
    }
    argNames.add(name);
    properties[name] = schema;
    if (isRequired) required.push(name);
  };

  for (const [key, p] of merged) {
    const location = key.slice(0, key.indexOf(":"));
    const name = p.name as string;
    if (location === "cookie") {
      throw new OpenApiToolError("ERR_PRISM_OPENAPI_SCHEMA_BOUNDS", `cookie parameters are unsupported: ${name}`);
    }
    if (p.content !== undefined) {
      throw new OpenApiToolError("ERR_PRISM_OPENAPI_SCHEMA_BOUNDS", `parameter content is unsupported: ${name}`);
    }
    const schema = resolveSchema(p.schema ?? {}, doc, limits, { refs: 0, depth: 0 });
    const isRequired = p.required === true;
    if (location === "path") {
      addArg(name, schema, true);
    } else if (location === "query") {
      queryParams.push({ name, required: isRequired, schema });
      addArg(name, schema, isRequired);
    } else if (location === "header") {
      headerParams.push({ name, required: isRequired, schema });
      addArg(name, schema, isRequired);
    }
  }

  let bodyParam: CompiledOperation["bodyParam"];
  const requestBody = operation.requestBody;
  if (requestBody !== undefined) {
    if (typeof requestBody !== "object" || requestBody === null) {
      throw new OpenApiToolError("ERR_PRISM_OPENAPI_SCHEMA_BOUNDS", `requestBody of ${operationId} is invalid`);
    }
    const rb = requestBody as Record<string, unknown>;
    const content = rb.content;
    if (typeof content !== "object" || content === null) {
      throw new OpenApiToolError("ERR_PRISM_OPENAPI_SCHEMA_BOUNDS", `requestBody of ${operationId} has no content`);
    }
    const mediaName = pickJsonMedia(content as Record<string, unknown>);
    if (!mediaName) {
      throw new OpenApiToolError("ERR_PRISM_OPENAPI_SCHEMA_BOUNDS", `requestBody of ${operationId} has no application/json content`);
    }
    const media = (content as Record<string, unknown>)[mediaName];
    const schema = resolveSchema(
      typeof media === "object" && media !== null ? ((media as Record<string, unknown>).schema ?? {}) : {},
      doc,
      limits,
      { refs: 0, depth: 0 },
    );
    const name = "body";
    addArg(name, schema, rb.required === true);
    bodyParam = { name, schema, required: rb.required === true };
  }

  const parameters: JsonObject = {
    type: "object",
    properties: properties as JsonObject,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };

  const summary = typeof operation.summary === "string" ? operation.summary : "";
  const description = typeof operation.description === "string" ? operation.description : "";
  const full = [summary, description].filter(Boolean).join("\n\n");

  const paginatable = pagination !== undefined && queryParams.some((p) => p.name === pagination.pageParam);

  return {
    toolName,
    operationId,
    method,
    path,
    pathParams,
    queryParams,
    headerParams,
    bodyParam,
    parameters,
    description: full.slice(0, MAX_DESCRIPTION_BYTES),
    effect: effectForMethod(method),
    paginatable,
  };
}

export function compileOpenApiDocument(input: {
  readonly document: string | JsonObject;
  readonly operations: readonly string[];
  readonly server: string;
  readonly limits: ResolvedOpenApiLimits;
  readonly pagination?: OpenApiPagination;
}): readonly CompiledOperation[] {
  const { limits } = input;
  const doc = parseDocument(input.document, limits.maxDocumentBytes);
  const version = doc.openapi;
  if (typeof version !== "string" || !version.startsWith("3.1")) {
    throw new OpenApiToolError("ERR_PRISM_OPENAPI_DOCUMENT_BOUNDS", "only OpenAPI 3.1 documents are supported");
  }
  const pinned = validateServerUrl(input.server, "server");
  assertServers(doc.servers, pinned, "document servers");
  const paths = doc.paths;
  if (typeof paths !== "object" || paths === null || Array.isArray(paths)) {
    throw new OpenApiToolError("ERR_PRISM_OPENAPI_DOCUMENT_BOUNDS", "document paths must be an object");
  }
  if (input.operations.length > limits.maxOperations) {
    throw new OpenApiToolError("ERR_PRISM_OPENAPI_DOCUMENT_BOUNDS", "operations allow-list exceeds maxOperations");
  }

  const byId = new Map<string, OperationRef>();
  for (const [path, pathItemValue] of Object.entries(paths)) {
    if (typeof pathItemValue !== "object" || pathItemValue === null) continue;
    const pathItem = pathItemValue as Record<string, unknown>;
    assertServers(pathItem.servers, pinned, `servers for path ${path}`);
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (typeof operation !== "object" || operation === null) continue;
      const op = operation as Record<string, unknown>;
      const operationId = op.operationId;
      if (typeof operationId !== "string" || !operationId) continue;
      if (byId.has(operationId)) {
        throw new OpenApiToolError("ERR_PRISM_OPENAPI_DOCUMENT_BOUNDS", `duplicate operationId: ${operationId}`);
      }
      byId.set(operationId, { method: method.toUpperCase(), path, operation: op, pathItem });
    }
  }

  const compiled: CompiledOperation[] = [];
  const usedNames = new Set<string>();
  for (const operationId of input.operations) {
    const ref = byId.get(operationId);
    if (!ref) throw new OpenApiToolError("ERR_PRISM_OPENAPI_OPERATION_UNKNOWN", `operationId not present in document: ${operationId}`);
    const operation = compileOperation(ref, doc, pinned, limits, input.pagination);
    if (usedNames.has(operation.toolName)) {
      throw new OpenApiToolError("ERR_PRISM_OPENAPI_DOCUMENT_BOUNDS", `tool name collision after sanitization: ${operation.toolName}`);
    }
    usedNames.add(operation.toolName);
    compiled.push(operation);
  }
  return compiled;
}
