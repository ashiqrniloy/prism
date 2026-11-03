import type { PackageInstance } from "@arnilo/prism";
import memoryWiki from "@arnilo/prism-memory-wiki";
import type { HostConfig } from "./config.js";

/**
 * The opt-in ontology tier for a worker that already has the fabric: the wiki package, nothing else. Off by default
 * (`ontology` unset). A pass uses `ontologyModel` when the config names one, else the worker's own model.
 */
export function ontologyPackages(config: HostConfig, workspaceRoot: string): readonly PackageInstance[] {
  if (config.ontology !== true) return [];
  if (config.memory === undefined) throw new Error("the ontology tier needs memory: set memory to conversational or coding");
  const model = config.ontologyModel;
  const ref = model === undefined ? undefined : typeof model === "string" ? model : `${model.provider}/${model.model}`;
  return [memoryWiki({ workspaceRoot, ...(ref === undefined ? {} : { consolidate: { model: ref } }) })];
}
