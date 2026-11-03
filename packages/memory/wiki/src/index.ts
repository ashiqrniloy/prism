/**
 * `@arnilo/prism-memory-wiki` — the ontology tier of Prism's three-tier memory (plan 207).
 *
 * The fabric (T1) keeps atomic, scoped notes as evidence. This package maintains the ontology on top of it:
 * one concept note per subject, every claim citing the T1 notes or ingested sources it rests on. It stores
 * nothing of its own: concepts are fabric notes, read with `memory.recall` and `memory.read`, and forgetting
 * a cited note removes the claims that rested on it (the fabric's deletion cascade, no model call).
 *
 * It requires the `memory.fabric` service and fails closed without it. The fabric provides that service only
 * when `semantic` memory is on, so `semantic: false` fails the same way.
 *
 * Cost: setup makes no model call. The concept pass is a background job on the model named in
 * `consolidate.model`; installing this package is what opts in to it.
 *
 * ```ts
 * import memoryFabric from "@arnilo/prism-memory-fabric";
 * import memoryWiki from "@arnilo/prism-memory-wiki";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model: "openai/gpt-5",
 *   packages: [memoryFabric({ preset: "coding" }), memoryWiki({ consolidate: { model: "openai/gpt-5-mini" } })],
 * });
 * ```
 */
import { definition } from "./extension.js";

export * from "./exports.js";

export default definition;
