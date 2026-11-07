import { readFileSync } from "node:fs";
import { isAbsolute, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { HostBuilderError } from "./errors.js";

export type HostBuilderIndexName = "api" | "errors" | "examples";

/** Written by `scripts/host-builder-index.mjs` at the top of every index. */
export interface HostBuilderIndexHeader {
  readonly schemaVersion: 1;
  /** The `@arnilo/prism` version the index describes. */
  readonly prismVersion: string;
  /** SHA-256 of the index body. */
  readonly contentHash: string;
}

export interface ApiExport {
  readonly name: string;
  readonly kind: "function" | "class" | "const" | "let" | "var" | "enum" | "interface" | "type" | "namespace" | "reexport";
  readonly signature: string;
  readonly summary?: string;
  /** Project-relative paths into the installed tarballs (`node_modules/@arnilo/<pkg>/...`) that mention the name in backticks. */
  readonly docs?: readonly string[];
  /** Paths of CI-tested examples that import the name. */
  readonly examples?: readonly string[];
}

export interface ApiEntry {
  /** The `exports` key: `.` or a subpath such as `./testing`. */
  readonly subpath: string;
  /** The import specifier, for example `@arnilo/prism/testing`. */
  readonly specifier: string;
  readonly exports: readonly ApiExport[];
}

export interface ApiPackage {
  readonly name: string;
  readonly version: string;
  readonly path: string;
  readonly experimental: boolean;
  readonly entries: readonly ApiEntry[];
}

export interface ApiIndex extends HostBuilderIndexHeader {
  readonly packages: readonly ApiPackage[];
}

export interface ErrorCodeRecord {
  readonly code: string;
  readonly namespace: "ERR_PRISM" | "short";
  readonly package: string;
  readonly file: string;
  readonly line: number;
  readonly type?: string;
  readonly errorClass: string | null;
  /** The doc comment at the declaration, or null. */
  readonly meaning: string | null;
  /** The message at the first throw site, or null. */
  readonly sampleMessage: string | null;
  readonly docs: readonly string[];
}

export interface ErrorsIndex extends HostBuilderIndexHeader {
  readonly codes: readonly ErrorCodeRecord[];
}

export interface ExampleRecord {
  readonly path: string;
  readonly title: string;
  /** `executed`, or `skip:<reason>` for an example the execution gate skips. */
  readonly gate: string;
  readonly imports: readonly string[];
  readonly requiresEnv: readonly string[];
  readonly needsCredentials: boolean;
}

export interface ExamplesIndex extends HostBuilderIndexHeader {
  readonly examples: readonly ExampleRecord[];
  /** Files an example imports or reads (helpers, adapters, sidecar sources). */
  readonly support: readonly string[];
}

export interface HostBuilderIndexes {
  readonly api: ApiIndex;
  readonly errors: ErrorsIndex;
  readonly examples: ExamplesIndex;
}

export interface LoadHostBuilderIndexOptions {
  /** Directory holding `api.json`, `errors.json`, `examples.json` and `examples/`. Defaults to this package's `data/`. */
  readonly dataDir?: string;
}

const DEFAULT_DATA_DIR = new URL("../data/", import.meta.url);
const cache = new Map<string, unknown>();

function dataDirOf(options: LoadHostBuilderIndexOptions | undefined): string {
  return options?.dataDir ?? fileURLToPath(DEFAULT_DATA_DIR);
}

/**
 * Loads one index. The file is read and parsed on the first call for a directory and cached after that.
 * Fails with `ERR_PRISM_HOST_BUILDER_INDEX` when the file is missing, is not JSON, or lacks the header.
 */
export async function loadHostBuilderIndex<N extends HostBuilderIndexName>(
  name: N,
  options?: LoadHostBuilderIndexOptions,
): Promise<HostBuilderIndexes[N]> {
  const dir = dataDirOf(options);
  const file = join(dir, `${name}.json`);
  const cached = cache.get(file);
  if (cached) return cached as HostBuilderIndexes[N];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new HostBuilderError(
      "ERR_PRISM_HOST_BUILDER_INDEX",
      `host-builder index "${name}" cannot be read at ${file}: ${error instanceof Error ? error.message : String(error)}. Reinstall @arnilo/prism-host-builder.`,
    );
  }
  const header = parsed as Partial<HostBuilderIndexHeader> | null;
  if (header?.schemaVersion !== 1 || typeof header.prismVersion !== "string" || typeof header.contentHash !== "string") {
    throw new HostBuilderError("ERR_PRISM_HOST_BUILDER_INDEX", `host-builder index "${name}" has no schemaVersion 1 header.`);
  }
  cache.set(file, parsed);
  return parsed as HostBuilderIndexes[N];
}

/**
 * The verbatim source of an indexed example, by its repository path (`examples/define-package.ts`).
 * Only paths the examples index lists (an example or a support file) are served, so a traversal path or a
 * file that is not shipped fails with `ERR_PRISM_HOST_BUILDER_EXAMPLE`.
 */
export async function readExampleSource(path: string, options?: LoadHostBuilderIndexOptions): Promise<string> {
  const index = await loadHostBuilderIndex("examples", options);
  const listed = new Set<string>([...index.examples.map((example) => example.path), ...index.support]);
  const clean = normalize(path);
  if (isAbsolute(path) || clean.split(sep).includes("..") || !listed.has(path)) {
    throw new HostBuilderError("ERR_PRISM_HOST_BUILDER_EXAMPLE", `"${path}" is not an indexed example.`);
  }
  return readFileSync(join(dataDirOf(options), path), "utf8");
}
