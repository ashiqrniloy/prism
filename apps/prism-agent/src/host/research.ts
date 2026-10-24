import { type Agent, createAgent } from "@arnilo/prism";
import { approvalPackage } from "@arnilo/prism-approval";
import compaction from "@arnilo/prism-memory-compaction";
import observational from "@arnilo/prism-memory-observational";
import { memoryRag } from "@arnilo/prism-memory-rag";
import { toolsBrowser } from "@arnilo/prism-tools-browser";
import { toolsResearch } from "@arnilo/prism-tools-research";
import { toolsWeb } from "@arnilo/prism-tools-web";
import type { HostConfig, HostDeps } from "./config.js";
import { sqlitePackage } from "./store.js";

const COMPACTION = "@arnilo/prism-memory-compaction";

/**
 * Network and read tools the research worker may run without a prompt. Browser writes stay ask.
 * `web_extract` is not listed: the host configures no extraction schema, so `toolsWeb` never
 * registers the tool and allow-listing it would only claim a capability that is absent.
 */
const ALLOWED = ["web_fetch", "web_search", "rag_search", "cite"] as const;

export async function createResearchWorker(config: HostConfig, deps: HostDeps = {}): Promise<Agent> {
  const repairs = config.maxRepairs ?? 1;
  return createAgent({
    name: "research",
    ...(deps.ownership === undefined ? {} : { ownership: deps.ownership }),
    model: config.models.research,
    ...(deps.host === undefined ? {} : { host: deps.host }),
    limits: { maxContinuations: repairs },
    slots: { compaction: COMPACTION },
    packages: [
      sqlitePackage(config.storePath),
      toolsWeb({
        backend: config.web.backend,
        ...(config.web.apiKey === undefined ? {} : { apiKey: config.web.apiKey }),
        ...(config.web.obscuraBinary === undefined ? {} : { obscura: { binary: config.web.obscuraBinary, nativeTools: false } }),
      }),
      toolsBrowser(),
      memoryRag(config.embeddings === undefined ? {} : { embeddings: { model: config.embeddings.model } }),
      toolsResearch({ maxRepairs: repairs }),
      approvalPackage({ mode: "ask", rules: ALLOWED.map((tool) => ({ tool })) }),
      observational,
      compaction,
      ...(deps.packages ?? []),
    ],
  });
}
