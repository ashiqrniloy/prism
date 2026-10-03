import type { CommandDefinition, JsonObject, JsonSchema, PackageCommand } from "@arnilo/prism";

const KEEP = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "default",
  "description",
  "title",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "minItems",
  "maxItems",
  "pattern",
  "oneOf",
  "anyOf",
]);

/** CommandDefinition parameters include keywords the package schema subset rejects (`format`). Drop those. */
function supportedSchema(value: unknown): JsonSchema {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { type: "object" };
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (!KEEP.has(key)) continue;
    if ((key === "properties" || key === "items") && child && typeof child === "object" && !Array.isArray(child)) {
      out[key] =
        key === "properties"
          ? Object.fromEntries(Object.entries(child as Record<string, unknown>).map(([name, schema]) => [name, supportedSchema(schema)]))
          : supportedSchema(child);
    } else {
      out[key] = child;
    }
  }
  return out as JsonSchema;
}

export function asPackageCommand(command: CommandDefinition): PackageCommand {
  return {
    name: command.name,
    description: command.description ?? command.name,
    ...(command.parameters ? { args: supportedSchema(command.parameters as JsonObject) } : {}),
    run: (args, ctx) => command.execute(args, { ...(ctx.session?.id ? { sessionId: ctx.session.id } : {}) }),
  };
}
