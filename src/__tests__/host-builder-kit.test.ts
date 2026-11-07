// Plan 215 Task 15: the prism-host-builder skill and its references cannot drift from the code they describe.
//
// `checkKit` is the gate (`host_builder_kit_matches_surface`). It runs in `release:gate` and against fixture kits
// below, which each break exactly one rule.
//
// Conventions the gate reads (also stated in the package README, "The skill"):
//   - a fenced ```ts block is typechecked; a block that cannot be gets `<!-- no-check: <reason> -->` on the line before
//   - `node_modules/@arnilo/<pkg>/<path>` must be a file in that package's packed file list
//   - `examples/<file>` must be listed in data/examples.json
//   - an `ERR_PRISM_*` token anywhere, and every backticked token in the `Code` column of a table, must be a code
//     in data/errors.json with a `meaning`
//   - a retired name (scripts/retired-tool-names.json, the left column of the tables in docs/migrate-to-0.13.md)
//     appears only in the left column of a table in references/upgrading.md

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error the generator is a plain .mjs script with no declarations
import { SECRET_SHAPES } from "../../scripts/host-builder-index.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const KIT = "packages/hosts/host-builder/skills/prism-host-builder";
const DATA = "packages/hosts/host-builder/data";

interface Failure {
  readonly check: string;
  readonly file: string;
  readonly message: string;
}
interface CheckOptions {
  readonly root?: string;
  readonly kitDir?: string;
  /** Workspace root used to resolve `@arnilo/*` packages and the data files. */
  readonly typecheck?: boolean;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function markdownFiles(kitDir: string): string[] {
  const files = [join(kitDir, "SKILL.md")];
  const references = join(kitDir, "references");
  if (existsSync(references)) {
    for (const name of readdirSync(references).sort()) if (name.endsWith(".md")) files.push(join(references, name));
  }
  return files.filter((file) => existsSync(file));
}

/** Workspace package name -> directory (the root manifest is the kernel). */
function workspacePackages(root: string): Map<string, string> {
  const found = new Map<string, string>();
  const rootManifest = join(root, "package.json");
  if (existsSync(rootManifest)) found.set(readJson<{ name: string }>(rootManifest).name, root);
  const packagesDir = join(root, "packages");
  if (!existsSync(packagesDir)) return found;
  for (const group of readdirSync(packagesDir)) {
    const groupDir = join(packagesDir, group);
    if (!existsSync(groupDir) || !readdirSync(groupDir, { withFileTypes: true }).length) continue;
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      const manifest = join(groupDir, entry.name, "package.json");
      if (entry.isDirectory() && existsSync(manifest)) found.set(readJson<{ name: string }>(manifest).name, join(groupDir, entry.name));
    }
  }
  return found;
}

function globToRegExp(pattern: string): RegExp {
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\/?/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, "(?:.*/)?");
  return new RegExp(`^${source}$`);
}

function filesEntryMatches(entry: string, rel: string): boolean {
  const clean = entry.replace(/^\.\//, "").replace(/\/$/, "");
  if (clean.includes("*")) return globToRegExp(clean).test(rel) || globToRegExp(`${clean}/**`).test(rel);
  return rel === clean || rel.startsWith(`${clean}/`);
}

/** Whether `rel` is in the pack of the package at `dir`: its `files` list, plus the files npm always includes. */
function inPackedFiles(dir: string, rel: string): boolean {
  if (!existsSync(join(dir, rel))) return false;
  const manifest = readJson<{ files?: string[] }>(join(dir, "package.json"));
  if (/^(?:package\.json|README(?:\.[a-z]+)?|LICEN[CS]E(?:\.[a-z]+)?|CHANGELOG(?:\.[a-z]+)?)$/i.test(rel)) return true;
  const entries = manifest.files ?? [];
  const included = entries.filter((entry) => !entry.startsWith("!")).some((entry) => filesEntryMatches(entry, rel));
  const excluded = entries.filter((entry) => entry.startsWith("!")).some((entry) => filesEntryMatches(entry.slice(1), rel));
  return included && !excluded;
}

/** Pages the docs index leaves out because they describe retired contracts. */
const RETIRED_DOCS = /^docs\/(?:history\/|migrate-to-0\.(?:5|6|7|8|9|11)\.md$|migration\.md$)/;

interface Table {
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());
}

/** Every pipe table of a document: its header row and body rows. */
function allTables(text: string): Table[] {
  const lines = text.split("\n");
  const tables: Table[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const next = lines[i + 1] ?? "";
    if (line.trim().startsWith("|") && /^\s*\|?\s*:?-{3,}/.test(next)) {
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && (lines[j] ?? "").trim().startsWith("|")) {
        rows.push(splitRow(lines[j] ?? ""));
        j++;
      }
      tables.push({ header: splitRow(line), rows });
      i = j;
    } else i++;
  }
  return tables;
}

const backticked = (cell: string): string[] => [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? "");

/** The retired identifiers in the left column of every table of the migration page. */
function migrationRetiredNames(root: string, current: ReadonlySet<string>): Set<string> {
  const page = join(root, "docs/migrate-to-0.13.md");
  const names = new Set<string>();
  if (!existsSync(page)) return names;
  for (const table of allTables(readFileSync(page, "utf8"))) {
    for (const row of table.rows) {
      for (const token of backticked(row[0] ?? "")) {
        const match = /^(@?[A-Za-z][A-Za-z0-9_/.-]*)(\(.*\)|\*)?$/.exec(token.trim());
        const name = match?.[1];
        if (!name || !/[A-Z_@-]/.test(name) || current.has(name)) continue;
        names.add(name);
      }
    }
  }
  return names;
}

function stripLeftColumn(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      if (!line.trim().startsWith("|")) return line;
      const cells = splitRow(line);
      return `| ${cells.slice(1).join(" | ")} |`;
    })
    .join("\n");
}

function containsName(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9_@/-])${escaped}(?![A-Za-z0-9_-])`).test(text);
}

interface TsBlock {
  readonly file: string;
  readonly code: string;
  readonly skip: string | undefined;
  readonly noCheckWithoutReason: boolean;
}

function tsBlocks(file: string, text: string): TsBlock[] {
  const blocks: TsBlock[] = [];
  const pattern = /(?:^|\n)(<!--\s*no-check(?::\s*([^>]*?))?\s*-->\s*\n)?```ts\n([\s\S]*?)\n```/g;
  for (const match of text.matchAll(pattern)) {
    const marked = match[1] !== undefined;
    const reason = (match[2] ?? "").trim();
    blocks.push({ file, code: match[3] ?? "", skip: marked ? reason : undefined, noCheckWithoutReason: marked && reason === "" });
  }
  return blocks;
}

/** Typecheck the extracted blocks with the settings of `examples/tsconfig.json`. */
function typecheckBlocks(root: string, blocks: readonly TsBlock[]): Failure[] {
  const checked = blocks.filter((block) => block.skip === undefined);
  if (checked.length === 0) return [];
  const examples = join(root, "examples");
  const dir = mkdtempSync(join(examples, ".host-builder-kit-"));
  try {
    for (const [index, block] of checked.entries()) writeFileSync(join(dir, `block-${index}.ts`), `${block.code}\n`);
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({ extends: "../tsconfig.json", compilerOptions: { noEmit: true }, include: ["./*.ts"] }),
    );
    const result = spawnSync("bun", ["x", "tsc", "-p", join(dir, "tsconfig.json"), "--noEmit", "--pretty", "false"], {
      cwd: root,
      encoding: "utf8",
      timeout: 55_000,
    });
    if (result.status === 0) return [];
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    const failures: Failure[] = [];
    for (const line of output.split("\n")) {
      const match = /block-(\d+)\.ts\((\d+),\d+\): (.*)$/.exec(line);
      if (!match) continue;
      const block = checked[Number(match[1])];
      failures.push({ check: "typecheck", file: block?.file ?? "?", message: `line ${match[2]}: ${match[3]}` });
    }
    if (failures.length === 0) failures.push({ check: "typecheck", file: "?", message: output.trim().slice(0, 400) || "tsc failed" });
    return failures;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

interface ExamplesIndex {
  readonly examples: readonly { readonly path: string }[];
  readonly support: readonly string[];
}
interface ErrorsIndex {
  readonly codes: readonly { readonly code: string; readonly meaning: string | null }[];
}
interface ApiIndex {
  readonly packages: readonly {
    readonly name: string;
    readonly entries: readonly { readonly exports: readonly { readonly name: string }[] }[];
  }[];
}

/** The gate. Returns every failure; an empty list means the kit matches the surface. */
function checkKit(options: CheckOptions = {}): Failure[] {
  const root = options.root ?? REPO;
  const kitDir = options.kitDir ?? join(root, KIT);
  const dataDir = join(root, DATA);
  const failures: Failure[] = [];
  const fail = (check: string, file: string, message: string) => failures.push({ check, file, message });
  const files = markdownFiles(kitDir);
  if (files.length === 0) {
    fail("kit", kitDir, "no SKILL.md found");
    return failures;
  }
  const examples = readJson<ExamplesIndex>(join(dataDir, "examples.json"));
  const errors = readJson<ErrorsIndex>(join(dataDir, "errors.json"));
  const api = readJson<ApiIndex>(join(dataDir, "api.json"));
  const indexedExamples = new Set([...examples.examples.map((row) => row.path), ...examples.support]);
  const codes = new Map(errors.codes.map((row) => [row.code, row.meaning]));
  const workspaces = workspacePackages(root);
  const current = new Set<string>([...workspaces.keys()]);
  for (const pkg of api.packages) {
    current.add(pkg.name);
    for (const entry of pkg.entries) for (const row of entry.exports) current.add(row.name);
  }
  const retiredTools = existsSync(join(root, "scripts/retired-tool-names.json"))
    ? readJson<{ tools: { name: string }[] }>(join(root, "scripts/retired-tool-names.json")).tools.map((tool) => tool.name)
    : [];
  const retired = new Set<string>([...retiredTools, ...migrationRetiredNames(root, current)]);

  const blocks: TsBlock[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const shown = file.startsWith(root) ? file.slice(root.length + 1) : file;
    const isUpgrading = file.endsWith(join("references", "upgrading.md"));

    // (1) ts blocks
    for (const block of tsBlocks(shown, text)) {
      if (block.noCheckWithoutReason) fail("no_check_reason", shown, "a <!-- no-check --> marker must give its reason");
      blocks.push(block);
    }

    // (2) tarball paths
    for (const match of text.matchAll(/node_modules\/(@arnilo\/[a-z0-9-]+)\/([A-Za-z0-9._\-/]*[A-Za-z0-9_-]\.[A-Za-z0-9]+)/g)) {
      const name = match[1] ?? "";
      const rel = match[2] ?? "";
      const dir = workspaces.get(name);
      if (!dir) fail("tarball_path", shown, `${name} is not a workspace package (${match[0]})`);
      else if (name === "@arnilo/prism" && RETIRED_DOCS.test(rel)) fail("tarball_path", shown, `${match[0]} is a retired contract page`);
      else if (!inPackedFiles(dir, rel)) fail("tarball_path", shown, `${match[0]} is not in the packed files of ${name}`);
    }

    // (3) examples
    for (const match of text.matchAll(/\bexamples\/[A-Za-z0-9_./-]*[A-Za-z0-9_-]\.(?:ts|mjs|js)\b/g)) {
      if (!indexedExamples.has(match[0])) fail("example", shown, `${match[0]} is not in data/examples.json`);
    }

    // (4) error codes
    const mentioned = new Set<string>([...text.matchAll(/\bERR_PRISM_[A-Z0-9]+(?:_[A-Z0-9]+)*\b/g)].map((match) => match[0]));
    for (const table of allTables(text)) {
      if (table.header[0]?.toLowerCase() !== "code") continue;
      for (const row of table.rows) for (const token of backticked(row[0] ?? "")) mentioned.add(token);
    }
    for (const code of mentioned) {
      if (!codes.has(code)) fail("error_code", shown, `${code} is not in data/errors.json`);
      else if (!codes.get(code)) fail("error_code", shown, `${code} has no meaning; add a doc comment at its declaration`);
    }

    // (5) retired names; upgrading.md may hold them in the left column of a table only
    const scanned = isUpgrading ? stripLeftColumn(text) : text;
    for (const name of retired) if (containsName(scanned, name)) fail("retired_name", shown, `names the retired \`${name}\``);

    // security: no secret-shaped literal
    for (const shape of SECRET_SHAPES as RegExp[]) if (shape.test(text)) fail("secret", shown, `matches a secret shape ${shape}`);
  }

  if (options.typecheck !== false) failures.push(...typecheckBlocks(root, blocks));
  return failures;
}

const describeFailures = (failures: readonly Failure[]) => failures.map((f) => `${f.check} ${f.file}: ${f.message}`).join("\n");

describe("host-builder kit", () => {
  it("host_builder_kit_matches_surface", () => {
    const started = performance.now();
    const failures = checkKit();
    assert.deepEqual(failures, [], describeFailures(failures));
    assert.ok(performance.now() - started < 60_000, "the gate stays under 60 s");
  }, 90_000);

  it("the skill body is at most 8 KiB and the references exist", () => {
    const body = readFileSync(join(REPO, KIT, "SKILL.md"), "utf8");
    assert.ok(new TextEncoder().encode(body).byteLength <= 8 * 1024);
    for (const name of ["choosing", "layout", "recipes", "pitfalls", "security", "verification", "upgrading"]) {
      assert.ok(existsSync(join(REPO, KIT, "references", `${name}.md`)), `${name}.md`);
      assert.ok(body.includes(`references/${name}.md`), `SKILL.md maps references/${name}.md`);
    }
  });

  it("host_builder_skill_conforms", async () => {
    // @ts-expect-error the gate is a plain .mjs script with no declarations
    const gate = (await import("../../scripts/package-skills-conformance.mjs")) as {
      runPackageSkillsGate(options?: Record<string, unknown>): Promise<{
        packages: { package: string; skills: string[] }[];
        failures: { package: string; check: string; message: string }[];
      }>;
    };
    const report = await gate.runPackageSkillsGate({ referenceHost: false });
    const mine = report.failures.filter((failure) => failure.package === "@arnilo/prism-host-builder");
    assert.deepEqual(mine, []);
    assert.deepEqual(report.packages.find((row) => row.package === "@arnilo/prism-host-builder")?.skills, ["prism-host-builder"]);
  }, 60_000);

  describe("fixture kits each fail one rule", () => {
    /** A copy of the real kit in a scratch directory, with `edit` applied to one file. */
    function variant(file: string, edit: (text: string) => string): { kitDir: string; cleanup: () => void } {
      const scratch = mkdtempSync(join(tmpdir(), "prism-host-builder-kit-"));
      const kitDir = join(scratch, "prism-host-builder");
      mkdirSync(kitDir, { recursive: true });
      cpSync(join(REPO, KIT), kitDir, { recursive: true });
      const target = join(kitDir, file);
      writeFileSync(target, edit(readFileSync(target, "utf8")));
      return { kitDir, cleanup: () => rmSync(scratch, { recursive: true, force: true }) };
    }
    const run = (file: string, edit: (text: string) => string, options: CheckOptions = { typecheck: false }) => {
      const { kitDir, cleanup } = variant(file, edit);
      try {
        return checkKit({ kitDir, ...options });
      } finally {
        cleanup();
      }
    };
    const checks = (failures: readonly Failure[]) => new Set(failures.map((f) => f.check));

    it("a block importing a nonexistent export", () => {
      const { kitDir, cleanup } = variant(
        "references/layout.md",
        (text) => `${text}\n\`\`\`ts\nimport { noSuchPrismExport } from "@arnilo/prism";\n\nconsole.log(noSuchPrismExport);\n\`\`\`\n`,
      );
      try {
        const failures = checkKit({ kitDir });
        assert.ok(checks(failures).has("typecheck"), describeFailures(failures));
      } finally {
        cleanup();
      }
    }, 90_000);

    it("a no-check marker without a reason", () => {
      const failures = run("references/layout.md", (text) => `${text}\n<!-- no-check -->\n\`\`\`ts\nconst x: = ;\n\`\`\`\n`);
      assert.ok(checks(failures).has("no_check_reason"), describeFailures(failures));
    });

    it("a no-check marker with a reason is skipped", () => {
      const failures = run("references/layout.md", (text) => `${text}\n<!-- no-check: sketch -->\n\`\`\`ts\nconst x: = ;\n\`\`\`\n`);
      assert.deepEqual(failures, []);
    });

    it("a path missing from a tarball", () => {
      const failures = run("references/layout.md", (text) => `${text}\nSee node_modules/@arnilo/prism/docs/no-such-page.md.\n`);
      assert.ok(checks(failures).has("tarball_path"), describeFailures(failures));
    });

    it("a retired contract page", () => {
      const failures = run("references/layout.md", (text) => `${text}\nSee node_modules/@arnilo/prism/docs/migrate-to-0.9.md.\n`);
      assert.ok(checks(failures).has("tarball_path"), describeFailures(failures));
    });

    it("an unindexed example", () => {
      const failures = run("references/recipes.md", (text) => `${text}\nCopy examples/no-such-example.ts.\n`);
      assert.ok(checks(failures).has("example"), describeFailures(failures));
    });

    it("an unknown error code", () => {
      const failures = run("references/pitfalls.md", (text) => `${text}\nAlso ERR_PRISM_NO_SUCH_CODE_X.\n`);
      assert.ok(checks(failures).has("error_code"), describeFailures(failures));
    });

    it("an unknown short code in a Code column", () => {
      const failures = run("references/pitfalls.md", (text) => text.replace("| `config_invalid` |", "| `config_invalidd` |"));
      assert.ok(checks(failures).has("error_code"), describeFailures(failures));
    });

    it("a retired name outside upgrading.md", () => {
      const retiredTool = readJson<{ tools: { name: string }[] }>(join(REPO, "scripts/retired-tool-names.json")).tools[0]?.name ?? "";
      const failures = run("references/recipes.md", (text) => `${text}\nTry ${retiredTool} here.\n`);
      assert.ok(checks(failures).has("retired_name"), describeFailures(failures));
    });

    it("a retired migration name outside upgrading.md", () => {
      const retiredFactory = ["define", "Agent"].join("");
      const failures = run("SKILL.md", (text) => `${text}\nUse ${retiredFactory}.\n`);
      assert.ok(checks(failures).has("retired_name"), describeFailures(failures));
    });

    it("a retired name in the right column of upgrading.md", () => {
      const retiredFactory = ["define", "Agent"].join("");
      const failures = run("references/upgrading.md", (text) => `${text}\n| \`x\` | ${retiredFactory} |\n`);
      assert.ok(checks(failures).has("retired_name"), describeFailures(failures));
    });

    it("a secret-shaped literal", () => {
      const key = `sk-${"a1B2".repeat(10)}`;
      const failures = run("references/security.md", (text) => `${text}\nKey ${key}\n`);
      assert.ok(checks(failures).has("secret"), describeFailures(failures));
    });
  });
});
