import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Agent, createAgent } from "@arnilo/prism";
import { approvalPackage } from "@arnilo/prism-approval";
import contextEngineering from "@arnilo/prism-context-engineering";
import { contextFiles } from "@arnilo/prism-context-files";
import { type HooksJsonConfig, hooksJson } from "@arnilo/prism-hooks-json";
import compaction from "@arnilo/prism-memory-compaction";
import memoryFabric from "@arnilo/prism-memory-fabric";
import observational from "@arnilo/prism-memory-observational";
import { toolsCoding } from "@arnilo/prism-tools-coding";
import type { HostConfig, HostDeps } from "./config.js";
import { hostPortOf } from "./config.js";
import { compactionTriggerFor, contextBudgetNotice, foldClearAtLeastTokensFor, observationalCompactAtFor } from "./context-budgets.js";
import { ontologyPackages } from "./ontology.js";
import { sqlitePackage } from "./store.js";

const COMPACTION = "@arnilo/prism-memory-compaction";

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
    ...(deps.hooks === undefined ? {} : { hooks: deps.hooks }),
    // Both memory packages claim the compaction slot. The assignment is the SDK's conflict resolution.
    slots: { compaction: COMPACTION },
    packages: [
      sqlitePackage(config.storePath),
      toolsCoding({ root: config.workspace, principal: { id: "prism-agent" } }),
      approvalPackage({ mode: config.approval }),
      ...(config.memory === undefined
        ? []
        : [memoryFabric({ preset: config.memory, tools: { root: join(dirname(config.storePath), "memory") } })]),
      ...ontologyPackages(config, config.workspace),
      contextFiles({ root: config.workspace }),
      hooksFromWorkspace(config.workspace),
      observational({ context: { compactAt: observationalCompactAtFor(config.models.coding) } }),
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
