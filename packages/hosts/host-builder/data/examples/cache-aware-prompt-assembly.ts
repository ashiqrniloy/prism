import { type ModelProvider, assembleProviderInput, type ModelConfig, type ProviderRequest, type Usage } from "@arnilo/prism";
import { cacheHitRate, cacheSavings, cacheUsageReport } from "@arnilo/prism/provider-kit";
import { createHyperProvider, defineHyperModel } from "@arnilo/prism-ai/hyper";
import { createOpenCodeGoProvider, defineOpenCodeGoModel } from "@arnilo/prism-ai/opencode-go";

const explicitCacheModel = defineHyperModel({
  model: "claude-sonnet-4",
  compat: { route: "openai" },
  cache: { kind: "cache_control", maxBreakpoints: 4, longRetention: true },
  cost: { input: 3, output: 15, cacheRead: 0.3, currency: "USD", unit: "1m_tokens" },
});

const implicitCacheModel = defineOpenCodeGoModel({
  model: "gpt-5.1-go",
  compat: { route: "openai" },
  cache: { kind: "implicit" },
  cost: { input: 1, output: 3, cacheRead: 0.25, currency: "USD", unit: "1m_tokens" },
});

async function assemble(model: ModelConfig): Promise<ProviderRequest> {
  return assembleProviderInput({
    model,
    inputLayout: "cache_aware",
    // Host context is a `context.build` handler now, so this assembler call sees only what the
    // kernel assembles: instructions, skills, attachments, summaries, and the transcript.
    systemInstructions: "Answer from the pinned workspace context.",
    skills: [{ name: "concise", description: "Keep answers short.", instructions: "Use concise answers." }],
    skillsDisclosure: "progressive",
    attachments: [{ name: "schema.md", text: "Stable response schema." }],
    summaries: ["Stable project summary reused across turns."],
    history: [
      { role: "user", content: [{ type: "text", text: "Summarize the cache plan." }] },
      { role: "assistant", content: [{ type: "text", text: "Keep stable context before new turns." }] },
    ],
    input: "What changed since the last turn?",
    // Agent sessions stamp sessionId from session.id; this custom assemble site still passes it.
    providerOptions: {
      sessionId: "workspace-cache-demo",
      cache: {
        mode: "on",
        key: "workspace-cache-demo",
        retention: "long",
        breakpoints: [{ location: "system_prompt" }, { location: "last_stable_message" }],
      },
    },
  });
}

async function run(provider: ModelProvider, request: ProviderRequest): Promise<Usage | undefined> {
  let usage: Usage | undefined;
  for await (const event of provider.generate(request)) {
    if (event.type === "usage") usage = event.usage;
    if (event.type === "done") usage = event.usage ?? usage;
    if (event.type === "error") throw new Error(event.error.message);
  }
  return usage;
}

function summarize(model: ModelConfig, usage: Usage | undefined) {
  const report = cacheUsageReport(usage, model);
  const hitRate = cacheHitRate(usage);
  const savings = cacheSavings(usage, model);
  return {
    provider: model.provider,
    cacheKind: model.cache?.kind,
    cacheReadTokens: report?.cacheReadTokens,
    cacheWriteTokens: report?.cacheWriteTokens,
    cacheHitRate: hitRate,
    cacheHitRatePercent: hitRate === undefined ? undefined : Math.round(hitRate * 100),
    cacheSavings: savings,
    currency: report?.currency,
  };
}

function sse(chunks: readonly unknown[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

function ok(body: ReadableStream<Uint8Array>) {
  return Promise.resolve(new Response(body, { status: 200 }));
}

export async function demo() {
  const hyperProvider = createHyperProvider({
    apiKey: async () => "fake-hyper-key",
    fetch: () =>
      ok(
        sse([
          { choices: [{ delta: { content: "Hyper" } }] },
          { choices: [{ delta: {}, finish_reason: "stop" }] },
          {
            usage: {
              prompt_tokens: 2000,
              completion_tokens: 20,
              total_tokens: 2020,
              prompt_tokens_details: { cached_tokens: 1500, cache_write_tokens: 400 },
            },
          },
        ]),
      ),
  });
  const opencodeGoProvider = createOpenCodeGoProvider({
    apiKey: async () => "fake-opencode-go-key",
    fetch: () =>
      ok(
        sse([
          { choices: [{ delta: { content: "OpenCodeGo" } }] },
          { choices: [{ delta: {}, finish_reason: "stop" }] },
          { usage: { prompt_tokens: 2000, completion_tokens: 20, total_tokens: 2020, prompt_tokens_details: { cached_tokens: 1600 } } },
        ]),
      ),
  });

  const hyper = await assemble(explicitCacheModel);
  const opencodeGo = await assemble(implicitCacheModel);

  return {
    hyper: summarize(explicitCacheModel, await run(hyperProvider, hyper)),
    opencodeGo: {
      ...summarize(implicitCacheModel, await run(opencodeGoProvider, opencodeGo)),
      note: "OpenCode Go receives stable-prefix input; its provider sends no explicit cache payload.",
    },
  };
}

export async function main() {
  console.log(JSON.stringify(await demo()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
