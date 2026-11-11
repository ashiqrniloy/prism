/**
 * Plan 215 Task 27 (ex-plan 185 Task 3): the migration-era shapes stay retired, and every
 * secret-bearing field in a first-party package is ref-only.
 */

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { JsonSchema } from "../packages/schema.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** A config key that carries a credential: `apiKey`, `token`, `webhookSecret`, `credential`, `password`, … */
const SECRET_KEY = /(apikey|token|secret|password|passphrase|credential)$/i;

interface SecretField {
  readonly path: string;
  readonly ref: boolean;
}

function secretFields(schema: JsonSchema | undefined, path: string, out: SecretField[]): void {
  if (schema === undefined || typeof schema !== "object") return;
  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    const at = `${path}.${key}`;
    if (SECRET_KEY.test(key) && child.type === "string") out.push({ path: at, ref: child["x-prism-secret"] === true });
    secretFields(child, at, out);
  }
  if (schema.items !== undefined && !Array.isArray(schema.items)) secretFields(schema.items as JsonSchema, `${path}[]`, out);
  if (typeof schema.additionalProperties === "object") secretFields(schema.additionalProperties, `${path}{}`, out);
  for (const branch of [...(schema.oneOf ?? []), ...(schema.anyOf ?? [])]) secretFields(branch, path, out);
}

/** Every package definition exported by the bundle map, including bundle-root definitions. */
async function packageDefinitions(): Promise<{ name: string; config: JsonSchema }[]> {
  const found: { name: string; config: JsonSchema }[] = [];
  const { bundles } = JSON.parse(readFileSync(join(ROOT, "scripts/bundles.json"), "utf8")) as {
    bundles: { name: string; subpaths: { path: string; kind: string }[] }[];
  };
  for (const bundle of bundles) {
    for (const row of bundle.subpaths.filter((row) => row.kind === "package")) {
      const name = bundle.name + (row.path === "." ? "" : row.path.slice(1));
      const mod = (await import(name)) as { default?: { config?: JsonSchema } };
      const definition = mod.default;
      if ((typeof definition === "object" || typeof definition === "function") && definition?.config !== undefined) {
        found.push({ name, config: definition.config });
      }
    }
  }
  return found;
}

/** Files the sweep reads: source, scripts, examples, templates, and docs, minus history and evidence. */
function sweepFiles(): string[] {
  const roots = ["src", "packages", "apps", "scripts", "examples", "templates", "docs"];
  const skipDir = new Set(["node_modules", "dist", "history", "_evidence", "__snapshots__"]);
  const keep = /\.(ts|tsx|mts|mjs|js|json|md|tmpl)$/;
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        // The concurrent host-builder test creates and deletes typecheck scratch files here.
        if (dir === join(ROOT, "examples") && entry.name.startsWith(".host-builder-kit-")) continue;
        if (!skipDir.has(entry.name)) walk(join(dir, entry.name));
      } else if (keep.test(entry.name)) {
        out.push(join(dir, entry.name));
      }
    }
  };
  for (const root of roots) if (existsSync(join(ROOT, root))) walk(join(ROOT, root));
  return out;
}

/**
 * Files that may still name a retired shape: the migration guides that record the replacement,
 * changelogs, this test and the type-level guards that assert the shape stays gone, the retired
 * `phase<N>-freeze` gates, which are immutable release evidence (`scripts/truth-current.test.mjs`),
 * the compat baselines (the 0.3.3 legacy-registry symbol source), and the dated budget ledger.
 */
function sanctioned(rel: string): boolean {
  return (
    /^docs\/migrat(e-to-[\d.]+|ion)\.md$/.test(rel) ||
    rel.endsWith("CHANGELOG.md") ||
    rel === "docs/credentials-and-redaction.md" ||
    rel === "src/__tests__/retired-shapes.test.ts" ||
    rel === "src/__tests__/public-contracts.test.ts" ||
    /^scripts\/phase\d+-(freeze|security)/.test(rel) ||
    rel.startsWith("scripts/compat-baseline/") ||
    rel === "scripts/retired-names.json" ||
    rel === "scripts/budgets.json"
  );
}

const RETIRED: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: "resolveCredentialValue", pattern: /\bresolveCredentialValue\b/ },
  { name: "CredentialValueSource", pattern: /\bCredentialValueSource\b/ },
  { name: "activateAllCapabilities", pattern: /\bactivateAllCapabilities\b/ },
  { name: "AgentDefinition.create", pattern: /\bAgentDefinition\.create\b/ },
  { name: "RunOptions.maxToolRounds guard", pattern: /RunOptions\.maxToolRounds was removed/ },
  { name: 'inputLayout: "legacy"', pattern: /inputLayout:\s*"legacy"/ },
  { name: 'toolCallStrictness: "legacy"', pattern: /toolCallStrictness\??:\s*[^\n;]*"legacy"/ },
  { name: 'InputAssemblyLayout "legacy"', pattern: /InputAssemblyLayout\s*=\s*[^\n;]*"legacy"/ },
];

describe("retired migration-era shapes (plan 215 Task 27)", () => {
  it("sweep_ignores_host_builder_typecheck_scratch", () => {
    const dir = mkdtempSync(join(ROOT, "examples", ".host-builder-kit-"));
    try {
      const file = join(dir, "block-0.ts");
      writeFileSync(file, "export {};\n");
      const files = sweepFiles();
      assert.equal(files.includes(file), false);
      assert.ok(files.includes(fileURLToPath(import.meta.url)), "ordinary source files remain covered");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("all_first_party_secret_fields_are_refs", async () => {
    const definitions = await packageDefinitions();
    assert.ok(definitions.length >= 30, `expected the first-party package definitions, found ${definitions.length}`);
    const fields: string[] = [];
    const literal: string[] = [];
    for (const { name, config } of definitions) {
      const out: SecretField[] = [];
      secretFields(config, "", out);
      for (const field of out) (field.ref ? fields : literal).push(`${name} config${field.path}`);
    }
    assert.deepEqual(literal, [], "every secret-bearing config field is an x-prism-secret ref (secretRefProperty)");
    assert.ok(fields.length >= 15, `the walk must see the provider/tool secret fields, saw ${fields.length}`);

    // Channels are host libraries, not packages: their connect options are refs resolved by
    // resolveChannelSecretRef, which rejects a literal, and the low-level adapters take a lazy source.
    const telegram = readFileSync(join(ROOT, "packages/hosts/channels/src/telegram.ts"), "utf8");
    const signal = readFileSync(join(ROOT, "packages/hosts/channels/src/signal.ts"), "utf8");
    assert.match(telegram, /resolveChannelSecretRef\(agent, options\.token\)/);
    assert.match(telegram, /resolveChannelSecretRef\(agent, options\.webhookSecret\)/);
    assert.match(signal, /resolveChannelSecretRef\(agent, options\.account\)/);
    assert.match(telegram, /readonly botToken: ChannelSecretSource;/);
    assert.match(telegram, /readonly webhookSecret: ChannelSecretSource;/);
  });

  it("retired_names_absent", () => {
    const hits: string[] = [];
    for (const file of sweepFiles()) {
      const rel = relative(ROOT, file).split("\\").join("/");
      if (sanctioned(rel)) continue;
      const text = readFileSync(file, "utf8");
      for (const { name, pattern } of RETIRED) {
        if (pattern.test(text)) hits.push(`${rel}: ${name}`);
      }
    }
    assert.deepEqual(hits, [], "a retired migration-era shape reappeared");
  });
});
