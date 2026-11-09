/**
 * `@arnilo/prism-wiki` — the wiki: Prism's knowledge base outside memory (plan 216 Task 3; plan 207 built it as the
 * ontology tier over the fabric).
 *
 * The wiki keeps its own store (markdown under `root` by default): one concept per subject, every claim citing the
 * notes or ingested sources it rests on, relations and open questions, and the subject bindings of that evidence.
 * The agent reads it with `wiki.search` (concepts first, claims with their cited ids) and `wiki.read` (a concept, or
 * a cited note), and gets at most one passive pointer per turn when a concept's subject is in play.
 *
 * Long-term memory is optional. When `@arnilo/prism-memory-system` is installed with `ltm` the wiki reads it through the
 * read-only `memory.ltm` service: claims may cite LTM notes, and forgetting a cited note removes the claims that
 * rested on it (the deletion feed plus an open-time liveness check, no model call). The wiki never writes memory.
 * Without memory it runs on its own sources, and `wiki:status` says so.
 *
 * Cost: setup makes no model call. The concept pass is a background job on the model named in
 * `consolidate.model`; installing this package is what opts in to it.
 *
 * ```ts
 * import memorySystem from "@arnilo/prism-memory-system";
 * import { wiki } from "@arnilo/prism-wiki";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model: "openai/gpt-5",
 *   packages: [memorySystem({ ltm: { preset: "coding" } }), wiki({ root: "./wiki", consolidate: { model: "openai/gpt-5-mini" } })],
 * });
 * ```
 */
import { definition } from "./extension.js";

export * from "./exports.js";

export default definition;
