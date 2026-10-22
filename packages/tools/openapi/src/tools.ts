import type { ToolCapabilityKind, ToolDefinition } from "@arnilo/prism";
import { compileOpenApiDocument } from "./compile.js";
import { executeOpenApiOperation } from "./execute.js";
import { resolveOpenApiLimits } from "./limits.js";
import type { OpenApiToolsOptions } from "./types.js";

const READ_EFFECTS: readonly ToolCapabilityKind[] = ["network"];
const MUTATING_EFFECTS: readonly ToolCapabilityKind[] = ["network", "external"];

/** GET/HEAD reach the network only; every other method also mutates an external system. */
export function effectsForMethod(method: string): readonly ToolCapabilityKind[] {
  return method === "GET" || method === "HEAD" ? READ_EFFECTS : MUTATING_EFFECTS;
}

/**
 * Compile host-selected OpenAPI 3.1 operations into bounded Prism `ToolDefinition`s.
 *
 * Only the explicitly listed `operationIds` compile; the pinned `server` origin must
 * match every document/path/operation `servers` entry; schemas are resolved with
 * depth/ref bounds and no external refs; mutating methods carry
 * `{ kind: "external_mutation", idempotency: "required" }` so the core run loop gates
 * approval and deduplicates via the effect store. Responses are untrusted data.
 */
export function createOpenApiTools(options: OpenApiToolsOptions): readonly ToolDefinition[] {
  const limits = resolveOpenApiLimits(options.limits);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const prefix = options.namePrefix ?? "";
  const compiled = compileOpenApiDocument({
    document: options.document,
    operations: options.operations,
    server: options.server,
    limits,
    pagination: options.pagination,
  });
  return compiled.map((operation) => {
    const toolName = `${prefix}${operation.toolName}`;
    return {
      name: toolName,
      description: operation.description,
      parameters: operation.parameters,
      effect: operation.effect,
      effects: effectsForMethod(operation.method),
      execute: (args, context) =>
        executeOpenApiOperation({
          operation,
          server: options.server,
          toolName,
          args,
          context,
          credentials: options.credentials,
          policy: options.policy,
          redactor: options.redactor,
          pagination: options.pagination,
          idempotencyKeyHeader: options.idempotencyKeyHeader,
          limits,
          fetchImpl,
        }),
    } satisfies ToolDefinition;
  });
}
