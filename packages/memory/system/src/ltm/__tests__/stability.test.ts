import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type JsonSchema, validateJsonSchema } from "@arnilo/prism";
import { memorySystemConfigSchema } from "../../config.js";
import { EXPERIMENTAL_CONFIG_FIELDS, memoryFabricConfigSchema } from "../config.js";

type Tier = "contract" | "tuning";
/** The README table adds `experimental`, which the kernel schema vocabulary does not have: those fields are `tuning` in the schema. */
type DocumentedTier = Tier | "experimental";

/** Every property path in the schema, in walk order, with the node that must carry the tier. */
function fields(schema: JsonSchema, path = ""): Array<[string, JsonSchema]> {
  const out: Array<[string, JsonSchema]> = [];
  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    const childPath = path ? `${path}.${key}` : key;
    out.push([childPath, child], ...fields(child, childPath));
  }
  for (const branch of [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])]) out.push(...fields(branch, path));
  return out;
}

function tierOf(node: JsonSchema): Tier | undefined {
  return node["x-prism-stability"];
}

/** The `### Config stability` table: ``| `field.path` | tier |``. */
function readmeTiers(readme: string): Map<string, DocumentedTier> {
  const start = readme.indexOf("### Config stability");
  assert.notEqual(start, -1, "the README has a Config stability section");
  const end = readme.indexOf("\n### ", start + 1);
  const section = readme.slice(start, end === -1 ? undefined : end);
  const tiers = new Map<string, DocumentedTier>();
  for (const line of section.split("\n")) {
    const match = /^\| `([^`]+)` \| (contract|tuning|experimental) \|$/.exec(line);
    if (match) tiers.set(match[1] as string, match[2] as DocumentedTier);
  }
  return tiers;
}

/** The package README (one table for the session fields and `ltm.*`, plan 216 Task 5). */
const readme = () => readFileSync(join(import.meta.dirname, "..", "..", "..", "README.md"), "utf8");
/** `EXPERIMENTAL_CONFIG_FIELDS` are paths inside the `ltm` section. */
const EXPERIMENTAL_PATHS = new Set([...EXPERIMENTAL_CONFIG_FIELDS].map((field) => `ltm.${field}`));

/** Drop the documentation keyword at every level, to prove it does not reach validation. */
function withoutStability(schema: JsonSchema): JsonSchema {
  const { "x-prism-stability": _tier, ...rest } = schema;
  return {
    ...rest,
    ...(rest.properties
      ? { properties: Object.fromEntries(Object.entries(rest.properties).map(([key, child]) => [key, withoutStability(child)])) }
      : {}),
    ...(rest.anyOf ? { anyOf: rest.anyOf.map(withoutStability) } : {}),
    ...(rest.oneOf ? { oneOf: rest.oneOf.map(withoutStability) } : {}),
  };
}

describe("config stability tiers", () => {
  it("every_config_field_has_a_stability_tier", () => {
    for (const [path, node] of fields(memorySystemConfigSchema)) {
      assert.ok(tierOf(node) === "contract" || tierOf(node) === "tuning", `${path} has a stability tier`);
    }
  });

  it("ltm_config_stability_table_matches_schema", () => {
    const schemaTiers = new Map<string, DocumentedTier | undefined>(
      fields(memorySystemConfigSchema).map(([path, node]) => [path, EXPERIMENTAL_PATHS.has(path) ? "experimental" : tierOf(node)]),
    );
    assert.ok(
      [...schemaTiers.keys()].some((path) => path.startsWith("ltm.")),
      "the schema carries the ltm section",
    );
    const documented = readmeTiers(readme());
    assert.deepEqual([...documented.entries()].sort(), [...schemaTiers.entries()].sort());
  });

  // Plan 210 Task 7: the five owner holds. A feature here has no measured benefit and no shown-harmless removal, so it
  // is outside the API level 1 promise. The README lists each under "May change in a minor version".
  it("experimental_tier_enforced_by_stability_test", () => {
    const experimentalFeatures = [
      "Multi-query recall",
      "`unmatchedTerms` in recall results",
      "Read-time state grouping",
      "The memory directory",
      "Agentic lexical navigation",
    ];
    const text = readme();
    const start = text.indexOf("### May change in a minor version");
    const section = text.slice(start, text.indexOf("\n### ", start + 1));
    for (const feature of experimentalFeatures) assert.ok(section.includes(feature), `README lists ${feature} as experimental`);
    // Every config field of an experimental feature is `tuning` in the schema, `experimental` in the table.
    const tiers = new Map(fields(memorySystemConfigSchema).map(([path, node]) => [path, tierOf(node)]));
    const documented = readmeTiers(text);
    assert.deepEqual([...EXPERIMENTAL_CONFIG_FIELDS].sort(), [
      "directory",
      "directory.maxFiles",
      "directory.maxTokens",
      "directory.maxTopics",
      "directory.stopWords",
    ]);
    for (const field of EXPERIMENTAL_PATHS) {
      assert.equal(tiers.get(field), "tuning", `${field} is tuning in the schema`);
      assert.equal(documented.get(field), "experimental", `${field} is experimental in the README table`);
    }
    // No other documented field is experimental: a hold without a config field adds none.
    const experimental = [...documented].filter(([, tier]) => tier === "experimental").map(([path]) => path);
    assert.deepEqual(experimental.sort(), [...EXPERIMENTAL_PATHS].sort());
    // Each held feature's own README section carries the marker.
    assert.equal((text.match(/^> \*\*Experimental\.\*\*/gm) ?? []).length, experimentalFeatures.length);
  });

  it("stability_annotation_does_not_change_validation", () => {
    const samples: unknown[] = [
      {},
      { preset: "conversational" },
      { preset: "coding" },
      { inject: { query: "task", kinds: ["exchange"], budgetTokens: 2000 } },
      { inject: { query: "nope" } },
      { enabled: "yes" },
      { unknownKey: true },
      { ltm: { preset: "conversational" } },
      { ltm: { inject: { query: "nope" } } },
      { ltm: { unknownKey: true } },
    ];
    for (const sample of samples) {
      assert.deepEqual(
        validateJsonSchema(memoryFabricConfigSchema, sample),
        validateJsonSchema(withoutStability(memoryFabricConfigSchema), sample),
      );
      assert.deepEqual(
        validateJsonSchema(memorySystemConfigSchema, sample),
        validateJsonSchema(withoutStability(memorySystemConfigSchema), sample),
      );
    }
  });
});
