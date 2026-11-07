import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { loadHostBuilderIndex } from "../indexes.js";

const dirs: string[] = [];

/** Removes every directory `projectRoot` made. Call from `afterEach`. */
export function cleanup(): void {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

export function write(root: string, path: string, text: string): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/** The Prism version the shipped indexes describe. */
export async function indexVersion(): Promise<string> {
  return (await loadHostBuilderIndex("api")).prismVersion;
}

/**
 * A host project with `@arnilo/prism` installed at `version` (default: the version the indexes describe), a
 * current docs page, two pages the docs search must skip, and one package README.
 */
export async function projectRoot(version?: string): Promise<string> {
  const root = tempDir("host-builder-root-");
  const kernel = "node_modules/@arnilo/prism";
  write(root, `${kernel}/package.json`, JSON.stringify({ name: "@arnilo/prism", version: version ?? (await indexVersion()) }));
  write(root, `${kernel}/README.md`, "# Prism\n\nThe SDK kernel.\n");
  write(
    root,
    `${kernel}/docs/agent.md`,
    "# Agent\n\nOverview text.\n\n## Creating an agent\n\nCall `createAgent` with a model and a list of packages. The zebrafish option is rare.\n\n## Disposing\n\nCall `agent.dispose()` when done.\n",
  );
  write(root, `${kernel}/docs/migration.md`, "# Migration\n\nretiredquokka lives only in a retired page.\n");
  write(root, `${kernel}/docs/migrate-to-0.9.md`, "# Migrate to 0.9\n\nretiredquokka again.\n");
  write(root, "node_modules/@arnilo/prism-approval/package.json", JSON.stringify({ name: "@arnilo/prism-approval", version: "0.13.0" }));
  write(root, "node_modules/@arnilo/prism-approval/README.md", "# Approval\n\n## Modes\n\nThe `ask` mode prompts a person.\n");
  return root;
}

/** Replaces an installed file with a symlink to a file outside `node_modules`. */
export function symlinkOut(root: string, installedPath: string, outsideText: string): string {
  const outside = join(tempDir("host-builder-outside-"), "secret.md");
  writeFileSync(outside, outsideText);
  const link = join(root, installedPath);
  rmSync(link, { force: true });
  symlinkSync(outside, link);
  return outside;
}

const REPO = resolve(import.meta.dirname, "../../../../..");

/**
 * A host project whose `node_modules/@arnilo/prism` is this repository, so factories written into it import the
 * real kernel. Use it for the check tools, which run the host's code in a child process.
 */
export function checkRoot(): string {
  const root = tempDir("host-builder-check-root-");
  mkdirSync(join(root, "node_modules/@arnilo"), { recursive: true });
  symlinkSync(REPO, join(root, "node_modules/@arnilo/prism"), "dir");
  return root;
}

/** An inspection factory on the mock provider; `extra` is spliced into the package list. */
export const INSPECTION_AGENT = `import { createAgent } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
export async function createInspectionAgent() {
  return createAgent({ model: { provider: "mock", model: "demo" }, packages: [mockProvider()] });
}
`;
