/**
 * `@arnilo/prism-memory-wiki` — the LLM Wiki knowledge compiler as a native package (plan 158 Task 5).
 *
 * The package owns the 0.12 wiki library (manifest, ingest, compiler, linter, profiles, search,
 * retire/re-point) and adds the package surface the roadmap §2.9 row asks for: four wiki tools, four
 * package commands (`wiki-init`, `wiki-refresh`, `wiki-lint`, `wiki-ingest`), the bundled
 * `wiki-searcher` / `wiki-maintainer` skills, a `context.build` guidance injector, and the
 * `prism-wiki` CLI.
 *
 * Cost: no model call. `qmd` and the Context7 hydrator run only from a tool or command call, and
 * `url` ingest needs the `web.fetch` service (the wiki never fetches on its own). Setup writes
 * nothing unless `autoDeploySkills: true` asks for the 0.12 workspace deploy.
 *
 * ```ts
 * import toolsWeb from "@arnilo/prism-tools-web";
 * import memoryWiki from "@arnilo/prism-memory-wiki";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model: "openai/gpt-5",
 *   packages: [toolsWeb({ backend: "obscura" }), memoryWiki({ wikiRoot: ".wiki", profile: "codebase" })],
 * });
 * ```
 */
import { definition } from "./extension.js";

export * from "./exports.js";

export default definition;
