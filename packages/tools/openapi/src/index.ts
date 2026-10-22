/**
 * `@arnilo/prism-tools-openapi` — compile host-selected OpenAPI 3.1 operations into bounded tools.
 *
 * Config lists `specs`; each spec is read once at setup (a local JSON file, or an `https:` URL
 * through the kernel's pinned fetch) and compiled into `<id>_<operationId>` tools. GET/HEAD
 * operations declare `["network"]`; every other method declares `["network", "external"]`. A spec
 * that fails to load or compile notes why and is skipped, and the other specs still register.
 *
 * Header values are ref-only (`env:`/`keyring:`) and resolved per request through
 * `prism.credentials.resolve`, so the resolved value joins the agent's secret set and is redacted
 * from events, notes, logs, errors, and tool results.
 *
 * ```ts
 * import toolsOpenapi from "@arnilo/prism-tools-openapi";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model,
 *   packages: [toolsOpenapi({ specs: [{ id: "petstore", source: "./petstore.json" }] })],
 * });
 * ```
 */

import { definePackage, type PackageAPI, type PackageInstance, type ToolDefinition } from "@arnilo/prism";
import manifest from "../package.json" with { type: "json" };

import { type ToolsOpenapiConfig, type ToolsOpenapiSpecConfig, toolsOpenapiConfigSchema } from "./config.js";
import { OpenApiToolError } from "./errors.js";
import { resolveOpenApiLimits } from "./limits.js";
import { firstServerUrl, loadSpecDocument, selectOperations } from "./specs.js";
import { createOpenApiTools } from "./tools.js";
import type { OpenApiCredentialResolver } from "./types.js";

export type { ToolsOpenapiConfig, ToolsOpenapiSpecConfig } from "./config.js";
export { toolsOpenapiConfigSchema } from "./config.js";
export { OpenApiToolError, type OpenApiToolErrorCode } from "./errors.js";
export type { OpenApiLimits, ResolvedOpenApiLimits } from "./limits.js";
export { DEFAULT_OPENAPI_LIMITS, HARD_OPENAPI_LIMITS, resolveOpenApiLimits } from "./limits.js";
export { firstServerUrl, listOperationIds, loadSpecDocument, selectOperations } from "./specs.js";
export { createOpenApiTools, effectsForMethod } from "./tools.js";
export type {
  OpenApiCredentialInput,
  OpenApiCredentialResolver,
  OpenApiPagination,
  OpenApiPolicyCheck,
  OpenApiToolsOptions,
} from "./types.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A per-request resolver over one spec's ref-only header config. */
function createHeaderResolver(prism: PackageAPI<ToolsOpenapiConfig>, spec: ToolsOpenapiSpecConfig): OpenApiCredentialResolver | undefined {
  const entries = Object.entries(spec.headers ?? {});
  if (entries.length === 0) return undefined;
  return async () => {
    const headers: Record<string, string> = {};
    for (const [name, ref] of entries) {
      const secret = await prism.credentials.resolve(ref);
      if (secret === undefined) {
        throw new OpenApiToolError("ERR_PRISM_OPENAPI_DOCUMENT_BOUNDS", `unresolved credential ref for header ${name}`);
      }
      headers[name] = secret.value;
    }
    return { headers };
  };
}

const definition = definePackage<ToolsOpenapiConfig>({
  name: "@arnilo/prism-tools-openapi",
  version: manifest.version,
  description:
    "OpenAPI 3.1 operation compiler: pinned-origin, allow-listed, schema-bounded tools with per-method effects and ref-only header credentials.",
  requires: { api: 1 },
  capabilities: ["credentials"],
  config: toolsOpenapiConfigSchema,
  setup: async (prism) => {
    const specs = prism.config.specs ?? [];
    if (specs.length === 0) {
      prism.status.note("warn", "openapi: config needs specs (at least one { id, source })");
      return;
    }
    const limits = resolveOpenApiLimits(prism.config.limits);
    for (const spec of specs) {
      let tools: readonly ToolDefinition[];
      try {
        const document = await loadSpecDocument(spec, limits);
        const server = spec.baseUrl ?? firstServerUrl(document);
        if (server === undefined) {
          throw new OpenApiToolError("ERR_PRISM_OPENAPI_SERVER_DRIFT", `spec ${spec.id} has no absolute servers url; set baseUrl`);
        }
        const operations = selectOperations(document, spec);
        if (operations.length === 0) {
          prism.status.note("warn", `openapi: spec ${spec.id} matched no operations`);
          continue;
        }
        tools = createOpenApiTools({
          document,
          operations,
          server,
          namePrefix: `${spec.id}_`,
          limits,
          credentials: createHeaderResolver(prism, spec),
        });
      } catch (error) {
        prism.status.note("warn", `openapi: spec ${spec.id} skipped: ${errorMessage(error)}`);
        continue;
      }
      // Registration stays outside the try: a cross-spec tool-name collision fails closed.
      for (const tool of tools) prism.tools.register(tool);
    }
  },
});

/** The package definition. Pass config through `packageConfig` or use {@link toolsOpenapi}. */
export default definition;

/** The package with config baked in, for `packages: [toolsOpenapi({ specs })]`. */
export function toolsOpenapi(config: ToolsOpenapiConfig): PackageInstance {
  return definition(config);
}

export const packageName = "@arnilo/prism-tools-openapi";
