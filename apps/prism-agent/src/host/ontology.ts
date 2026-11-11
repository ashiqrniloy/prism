import { join } from "node:path";
import type { PackageInstance } from "@arnilo/prism";
import { wiki } from "@arnilo/prism-knowledge/wiki";
import type { HostConfig } from "./config.js";

/**
 * The opt-in wiki (plan 216 Task 3): the knowledge package, nothing else. Off by default (`ontology` unset). It keeps
 * its own store under `<workspace>/.prism/wiki` and reads long-term memory read-only when `memory` is on. A pass uses
 * `ontologyModel` when the config names one, else the worker's own model.
 */
export function ontologyPackages(config: HostConfig, workspaceRoot: string): readonly PackageInstance[] {
  if (config.ontology !== true) return [];
  const model = config.ontologyModel;
  const ref = model === undefined ? undefined : typeof model === "string" ? model : `${model.provider}/${model.model}`;
  return [
    wiki({ workspaceRoot, root: join(workspaceRoot, ".prism", "wiki"), ...(ref === undefined ? {} : { consolidate: { model: ref } }) }),
  ];
}
