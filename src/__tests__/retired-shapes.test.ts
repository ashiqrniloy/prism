/**
 * Plan 215 Task 27 (ex-plan 185 Task 3): the migration-era shapes stay retired, and every
 * secret-bearing field in a first-party package is ref-only.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, it } from "bun:test";
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

/** Every workspace package under `packages/<group>/<name>` whose root entry exports a package definition. */
async function packageDefinitions(): Promise<{ name: string; config: JsonSchema }[]> {
  const found: { name: string; config: JsonSchema }[] = [];
  for (const group of readdirSync(join(ROOT, "packages")).sort()) {
    const groupDir = join(ROOT, "packages", group);
    if (!statSync(groupDir).isDirectory()) continue;
    for (const name of readdirSync(groupDir).sort()) {
      const manifestPath = join(groupDir, name, "package.json");
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { name: string; exports?: string | Record<string, unknown> };
      const entry = typeof manifest.exports === "string" ? manifest.exports : manifest.exports?.["."];
      if (typeof entry !== "string") continue;
      const mod = (await import(pathToFileURL(join(groupDir, name, entry)).href)) as { default?: { config?: JsonSchema } };
      const definition = mod.default;
      if ((typeof definition === "object" || typeof definition === "function") && definition?.config !== undefined) {
        found.push({ name: manifest.name, config: definition.config });
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
