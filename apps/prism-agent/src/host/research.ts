import { dirname, join } from "node:path";
import { type Agent, createAgent } from "@arnilo/prism";
import { approvalPackage } from "@arnilo/prism-approval";
import contextEngineering from "@arnilo/prism-context-engineering";
import compaction from "@arnilo/prism-memory-compaction";
import memoryFabric from "@arnilo/prism-memory-fabric";
import observational from "@arnilo/prism-memory-observational";
import { memoryRag } from "@arnilo/prism-memory-rag";
import { toolsBrowser } from "@arnilo/prism-tools-browser";
import { toolsResearch } from "@arnilo/prism-tools-research";
import { toolsWeb } from "@arnilo/prism-tools-web";
import type { HostConfig, HostDeps } from "./config.js";
import { compactionTriggerFor, contextBudgetNotice, foldClearAtLeastTokensFor, observationalCompactAtFor } from "./context-budgets.js";
import { sqlitePackage } from "./store.js";

const COMPACTION = "@arnilo/prism-memory-compaction";

/**
 * Network and read tools the research worker may run without a prompt. Browser writes stay ask.
 * `web_extract` is not listed: the host configures no extraction schema, so `toolsWeb` never
 * registers the tool and allow-listing it would only claim a capability that is absent.
 */
const ALLOWED = ["web_fetch", "web_search", "rag_search", "cite", "memory.recall", "memory.read"] as const;

export async function createResearchWorker(config: HostConfig, deps: HostDeps = {}): Promise<Agent> {
  const repairs = config.maxRepairs ?? 1;
  return createAgent({
    name: "research",
    ownership: deps.ownership ?? { tenantId: "prism-agent", userId: "prism-agent" },
    model: config.models.research,
    ...(deps.host === undefined ? {} : { host: deps.host }),
    ...(deps.hooks === undefined ? {} : { hooks: deps.hooks }),
    limits: { maxContinuations: repairs },
    slots: { compaction: COMPACTION },
    packages: [
      sqlitePackage(config.storePath),
      toolsWeb({
        backend: config.web.backend,
        ...(config.web.apiKey === undefined ? {} : { apiKey: config.web.apiKey }),
        ...(config.web.obscuraBinary === undefined ? {} : { obscura: { binary: config.web.obscuraBinary, nativeTools: false } }),
        ...(config.web.searxngOrigin === undefined ? {} : { searxng: { origin: config.web.searxngOrigin } }),
        ...(config.web.fetch === undefined ? {} : { fetch: config.web.fetch }),
        ...(config.web.domains === undefined ? {} : { domains: config.web.domains }),
        ...(config.web.cache === undefined ? {} : { cache: config.web.cache }),
      }),
      toolsBrowser(),
      memoryRag(config.embeddings === undefined ? {} : { embeddings: { model: config.embeddings.model } }),
      ...(config.memory === undefined
        ? []
        : [memoryFabric({ preset: config.memory, tools: { root: join(dirname(config.storePath), "memory") } })]),
      toolsResearch({ maxRepairs: repairs }),
      approvalPackage({ mode: "ask", rules: ALLOWED.map((tool) => ({ tool })) }),
      observational({ context: { compactAt: observationalCompactAtFor(config.models.research) } }),
      compaction({ trigger: compactionTriggerFor(config.models.research) }),
      contextEngineering({
        fold: {
          minAgeTurns: 2,
          minBytes: 2_048,
          keepLast: 3,
          clearAtLeastTokens: foldClearAtLeastTokensFor(config.models.research),
        },
        blocks: { maxShare: 0.2 },
        accounting: true,
      }),
      contextBudgetNotice(config.models.research),
      ...(deps.packages ?? []),
    ],
  });
}
