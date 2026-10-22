import { CAPABILITIES } from "../packages/capabilities.js";
import type { JsonSchema } from "../packages/schema.js";
import { SLOT_NAMES } from "../slots/index.js";

/** npm-style package name: optional `@scope/`, lower-case. */
const NAME_PATTERN = "^(@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$";
/** SRI sha512: 64 bytes in base64 is 86 characters plus `==`. */
const INTEGRITY_PATTERN = "^sha512-[A-Za-z0-9+/]{86}==$";

const NAME: JsonSchema = { type: "string", minLength: 1, maxLength: 214, pattern: NAME_PATTERN };

/**
 * The manifest v1 schema, in the keyword subset the kernel validator supports (roadmap §2.7). It is
 * the source of truth: `dist/manifest/packages.v1.schema.json` (exported as `@arnilo/prism/manifest/schema.json`) is
 * this object plus a `$schema` line, written at build. The schema cannot express "`version`, `integrity`, and `capabilities` come
 * together"; `parseManifest` enforces that (a project entry may omit all three to override only
 * `config`, `enabled`, or `optional` of a user entry).
 */
export const MANIFEST_V1_SCHEMA: JsonSchema = {
  title: "Prism package manifest v1",
  type: "object",
  properties: {
    version: { const: 1 },
    packages: {
      type: "array",
      maxItems: 512,
      items: {
        type: "object",
        properties: {
          name: NAME,
          version: { type: "string", minLength: 1, maxLength: 128 },
          integrity: {
            type: "string",
            pattern: INTEGRITY_PATTERN,
            description:
              "SRI sha512 hash over the installed package and its full runtime dependency closure (dependencies and non-optional peerDependencies), combined in sorted name order.",
          },
          capabilities: { type: "array", maxItems: 16, items: { enum: [...CAPABILITIES] } },
          config: { type: "object", additionalProperties: true },
          enabled: { type: "boolean" },
          optional: { type: "boolean" },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
    slots: {
      type: "object",
      properties: Object.fromEntries(SLOT_NAMES.map((slot) => [slot, NAME])),
      additionalProperties: false,
    },
  },
  required: ["version", "packages"],
  additionalProperties: false,
};

/** The published document: the schema plus its `$schema` line. `scripts/emit-manifest-schema.mjs` writes it at build. */
export function manifestSchemaDocument(): JsonSchema & { readonly $schema: string } {
  return { $schema: "http://json-schema.org/draft-07/schema#", ...MANIFEST_V1_SCHEMA };
}
