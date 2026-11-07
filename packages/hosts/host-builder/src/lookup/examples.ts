import { HostBuilderError } from "../errors.js";
import type { ExampleRecord, ExamplesIndex, LoadHostBuilderIndexOptions } from "../indexes.js";
import { readExampleSource } from "../indexes.js";
import { byteLength, MAX_RESULT_BYTES, truncateBytes, truncationMarker } from "./bound.js";
import { nearest, tokens } from "./text.js";

export interface ExamplesQuery {
  /** Words matched against the example path, title and imported packages. */
  readonly query?: string;
  /** Only examples that import this package. */
  readonly package?: string;
  /** An indexed example path (`examples/define-package.ts`): returns its source. */
  readonly path?: string;
}

export interface ExampleMatch extends Pick<ExampleRecord, "path" | "title" | "imports" | "needsCredentials" | "requiresEnv" | "gate"> {}

export interface ExamplesResult {
  readonly found: boolean;
  readonly matches: readonly ExampleMatch[];
  readonly nearest: readonly string[];
  /** The verbatim source, when `path` was given and found. */
  readonly source?: string;
  readonly truncated?: boolean;
  readonly note?: string;
}

const MAX_MATCHES = 15;
/** Leaves room for the JSON envelope around the source. */
const SOURCE_BUDGET = MAX_RESULT_BYTES - 4096;

function toMatch(example: ExampleRecord): ExampleMatch {
  return {
    path: example.path,
    title: example.title,
    imports: example.imports,
    needsCredentials: example.needsCredentials,
    requiresEnv: example.requiresEnv,
    gate: example.gate,
  };
}

/**
 * Ranked examples, or one example's source. `path` resolves only to a path `examples.json` lists (an example or
 * a support file), so anything else, including a traversal, is "not found". Without `path`, `query` and
 * `package` filter and rank the examples.
 */
export async function lookupExamples(
  index: ExamplesIndex,
  input: ExamplesQuery,
  options?: LoadHostBuilderIndexOptions,
): Promise<ExamplesResult> {
  if (input.path !== undefined) {
    const path = input.path.trim();
    const record = index.examples.find((example) => example.path === path);
    try {
      const raw = await readExampleSource(path, options);
      const cut = truncateBytes(raw, SOURCE_BUDGET);
      const source = cut.truncated ? `${cut.text}${truncationMarker(byteLength(raw) - byteLength(cut.text))}` : cut.text;
      return {
        found: true,
        matches: record !== undefined ? [toMatch(record)] : [],
        nearest: [],
        source,
        ...(cut.truncated ? { truncated: true } : {}),
        ...(record === undefined ? { note: "support file of an example, not an example itself" } : {}),
      };
    } catch (error) {
      if (!(error instanceof HostBuilderError) || error.code !== "ERR_PRISM_HOST_BUILDER_EXAMPLE") throw error;
      return {
        found: false,
        matches: [],
        nearest: nearest([...index.examples.map((example) => example.path), ...index.support], path),
        note: `"${path}" is not an indexed example`,
      };
    }
  }
  const pool =
    input.package === undefined ? index.examples : index.examples.filter((example) => example.imports.includes(input.package as string));
  const words = tokens(input.query ?? "");
  if (words.length === 0) {
    const matches = pool.slice(0, MAX_MATCHES).map(toMatch);
    return {
      found: matches.length > 0,
      matches,
      nearest: [],
      ...(pool.length > MAX_MATCHES ? { note: `${pool.length - MAX_MATCHES} more; narrow with query or package` } : {}),
      ...(matches.length === 0 ? { note: "no example imports that package" } : {}),
    };
  }
  const scored: Array<{ example: ExampleRecord; score: number }> = [];
  for (const example of pool) {
    const path = example.path.toLowerCase();
    const title = tokens(example.title);
    const imports = example.imports.join(" ").toLowerCase();
    let score = 0;
    for (const word of words) {
      if (title.includes(word)) score += 6;
      if (path.includes(word)) score += 4;
      if (imports.includes(word)) score += 2;
    }
    if (score > 0) scored.push({ example, score });
  }
  scored.sort((a, b) => b.score - a.score);
  if (scored.length === 0) {
    return {
      found: false,
      matches: [],
      nearest: nearest(
        pool.map((example) => example.path),
        (input.query ?? "").trim(),
      ),
      note: "no example matched the query",
    };
  }
  return { found: true, matches: scored.slice(0, MAX_MATCHES).map((entry) => toMatch(entry.example)), nearest: [] };
}
