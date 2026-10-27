import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type JsonSchema, validateJsonSchema } from "@arnilo/prism";
import { memoryObservationalConfigSchema } from "@arnilo/prism-memory-observational";
import { memoryFabricConfigSchema } from "../config.js";

type Tier = "contract" | "tuning";

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
function readmeTiers(readme: string): Map<string, Tier> {
  const start = readme.indexOf("### Config stability");
  assert.notEqual(start, -1, "the README has a Config stability section");
  const end = readme.indexOf("\n### ", start + 1);
  const section = readme.slice(start, end === -1 ? undefined : end);
  const tiers = new Map<string, Tier>();
  for (const line of section.split("\n")) {
    const match = /^\| `([^`]+)` \| (contract|tuning) \|$/.exec(line);
    if (match) tiers.set(match[1] as string, match[2] as Tier);
  }
  return tiers;
}

const readme = (name: string) => readFileSync(join(import.meta.dirname, "..", "..", "..", name), "utf8");

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

const cases: Array<[string, JsonSchema, string]> = [
  ["fabric", memoryFabricConfigSchema, "fabric/README.md"],
  ["observational", memoryObservationalConfigSchema, "observational/README.md"],
];

describe("config stability tiers", () => {
  for (const [name, schema, readmePath] of cases) {
    const suffix = name === "fabric" ? "" : `_${name}`;
    it(`every_${name}_config_field_has_a_stability_tier`, () => {
      for (const [path, node] of fields(schema)) {
        assert.ok(tierOf(node) === "contract" || tierOf(node) === "tuning", `${name}: ${path} has a stability tier`);
      }
    });

    it(`stability_tiers_match_readme_table${suffix}`, () => {
      const schemaTiers = new Map(fields(schema).map(([path, node]) => [path, tierOf(node)]));
      const documented = readmeTiers(readme(readmePath));
      assert.deepEqual([...documented.entries()].sort(), [...schemaTiers.entries()].sort());
    });
  }

  it("stability_annotation_does_not_change_validation", () => {
    const samples: unknown[] = [
      {},
      { preset: "conversational" },
      { preset: "coding" },
      { inject: { query: "task", kinds: ["exchange"], budgetTokens: 2000 } },
      { inject: { query: "nope" } },
      { enabled: "yes" },
      { unknownKey: true },
    ];
    for (const sample of samples) {
      assert.deepEqual(
        validateJsonSchema(memoryFabricConfigSchema, sample),
        validateJsonSchema(withoutStability(memoryFabricConfigSchema), sample),
      );
      assert.deepEqual(
        validateJsonSchema(memoryObservationalConfigSchema, sample),
        validateJsonSchema(withoutStability(memoryObservationalConfigSchema), sample),
      );
    }
  });
});
