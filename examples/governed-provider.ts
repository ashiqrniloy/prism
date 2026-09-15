import type { AgentIdentity, AIProvider, ModelConfig, ProviderEvent, ProviderRequest } from "@arnilo/prism";
import { createModelRouter, type GovernedInvocationSettlement, isGovernedProvider } from "@arnilo/prism-core/governance/model-router";

// Mock provider factory for demonstration without network or credentials
function createMockProvider(id: string): AIProvider {
  return {
    id,
    async *generate(_request: ProviderRequest): AsyncIterable<ProviderEvent> {
      yield { type: "content_delta", content: { type: "text", text: `Hello from governed model [${id}]!` } };
      yield {
        type: "done",
        usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20, cost: 0.001 },
      };
    },
  };
}

export async function demo(): Promise<{
  governed: boolean;
  received: string[];
  settlement: GovernedInvocationSettlement | undefined;
}> {
  const primaryModel: ModelConfig = { provider: "anthropic", model: "claude-3-5-sonnet" };
  const fallbackModel: ModelConfig = { provider: "openai", model: "gpt-4o" };

  const identity: AgentIdentity = {
    tenantId: "tenant-acme",
    userId: "user-123",
    principal: { id: "user-123", kind: "user" },
    scopes: ["llm:generate"],
    verified: true,
    issuedAt: new Date().toISOString(),
  };

  let lastSettlement: GovernedInvocationSettlement | undefined;

  // 1. Create a ModelRouter with policy boundaries (budgets, allow-lists, fallbacks)
  const router = createModelRouter({
    allowList: { providers: ["anthropic", "openai"] },
    budgets: { maxTokens: 10_000, maxCostUsd: 5.0 },
    fallbacks: [fallbackModel],
    resolver: (target) => createMockProvider(target.provider),
  });

  // 2. Wrap into an opt-in GovernedProvider adapter
  const governed = router.createGovernedProvider({
    identity,
    model: primaryModel,
    maxTokens: 500,
    onSettlement: (settlement) => {
      lastSettlement = settlement;
    },
  });

  const received: string[] = [];

  // 3. Stream through the governed provider — admission, reservation, streaming, and settlement occur automatically
  for await (const event of governed.generate({ model: primaryModel, messages: [] })) {
    if (event.type === "content_delta" && event.content.type === "text") {
      received.push(event.content.text);
    }
  }

  return {
    governed: isGovernedProvider(governed),
    received,
    settlement: lastSettlement,
  };
}

// Run when executed directly
if (process.argv[1]?.endsWith("governed-provider.ts") || process.argv[1]?.endsWith("governed-provider.js")) {
  demo()
    .then((result) => {
      console.log("Governed Provider Demo completed successfully:");
      console.log(`- Is Governed Provider: ${result.governed}`);
      console.log(`- Received text: ${result.received.join("")}`);
      console.log(`- Settlement outcome: ${result.settlement?.outcome}`);
      console.log(`- Total tokens committed: ${result.settlement?.usage?.totalTokens}`);
    })
    .catch((err) => {
      console.error("Governed Provider Demo failed:", err);
      process.exit(1);
    });
}
