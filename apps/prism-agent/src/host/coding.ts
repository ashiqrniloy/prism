import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Agent, createAgent } from "@arnilo/prism";
import { approvalPackage } from "@arnilo/prism-extensions/approval";
import compaction from "@arnilo/prism-extensions/compaction";
import contextEngineering from "@arnilo/prism-extensions/context-engineering";
import { contextFiles } from "@arnilo/prism-extensions/context-files";
import { type HooksJsonConfig, hooksJson } from "@arnilo/prism-extensions/hooks-json";
import { toolsCoding } from "@arnilo/prism-tools/coding";
import type { HostConfig, HostDeps } from "./config.js";
import { hostPortOf } from "./config.js";
import { compactionTriggerFor, contextBudgetNotice, foldClearAtLeastTokensFor } from "./context-budgets.js";
import { memoryProfileFor } from "./memory.js";
import { ontologyPackages } from "./ontology.js";
import { sqlitePackage } from "./store.js";

const COMPACTION = "@arnilo/prism-extensions/compaction";

function hooksFromWorkspace(workspace: string) {
  const path = join(workspace, ".prism", "hooks.json");
  if (!existsSync(path)) return hooksJson({ cwd: workspace });
  const config = JSON.parse(readFileSync(path, "utf8")) as HooksJsonConfig;
  return hooksJson({ cwd: workspace, config });
}

export async function createCodingWorker(config: HostConfig, deps: HostDeps = {}): Promise<Agent> {
  const host = hostPortOf(deps);
  return createAgent({
    name: "coding",
    model: config.models.coding,
    principal: { kind: "user", id: "prism-agent" },
    ownership: { tenantId: "prism-agent", userId: "prism-agent" },
    ...(host === undefined ? {} : { host }),
    ...(deps.limits === undefined ? {} : { limits: deps.limits }),
    ...(deps.hooks === undefined ? {} : { hooks: deps.hooks }),
    // Compaction and the memory system's session tiers (opt-in) both claim the compaction slot. The assignment is the SDK's conflict resolution.
    slots: { compaction: COMPACTION },
    packages: [
      sqlitePackage(config.storePath),
      toolsCoding({ root: config.workspace, principal: { id: "prism-agent" } }),
      approvalPackage({ mode: config.approval }),
      // Memory is the experimental opt-in: unset, the worker loads no experimental package (plan 215 Task 3).
      ...(config.memory === undefined ? [] : [memoryProfileFor({ ...config, memory: config.memory }, config.models.coding)]),
      ...ontologyPackages(config, config.workspace),
      contextFiles({ root: config.workspace }),
      hooksFromWorkspace(config.workspace),
      compaction({ profile: "coding", trigger: compactionTriggerFor(config.models.coding) }),
      contextEngineering({
        fold: {
          minAgeTurns: 2,
          minBytes: 2_048,
          keepLast: 3,
          clearAtLeastTokens: foldClearAtLeastTokensFor(config.models.coding),
        },
        accounting: true,
      }),
      contextBudgetNotice(config.models.coding),
      ...(deps.packages ?? []),
    ],
  });
}
