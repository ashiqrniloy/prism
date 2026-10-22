import { createAgent, type CredentialValueSource } from "@arnilo/prism";
import { createRoutedProvider, providerPackage, replayFetch, type RecordedExchange } from "@arnilo/prism/provider-kit";

/**
 * Custom provider implementation using the routed provider builder.
 * Dispatches between OpenAI-compatible and Anthropic Messages routes.
 */
export function createAcmeProvider(options: {
  apiKey?: CredentialValueSource;
  baseUrl?: string;
  fetch?: typeof fetch;
}) {
  return createRoutedProvider({
    id: "acme",
    baseUrl: options.baseUrl ?? "https://api.acme.example/v1",
    apiKey: options.apiKey,
    fetch: options.fetch,
    routes: {
      openai: {
        format: "openai-chat",
        path: "/chat/completions",
        auth: "bearer",
        codec: { reasoningReplay: "reasoning_content" },
      },
      anthropic: {
        format: "anthropic-messages",
        path: "/messages",
        auth: "x-api-key+bearer",
      },
    },
  });
}

export async function demo(): Promise<Record<string, unknown>> {
  const recording: RecordedExchange = {
    method: "POST",
    path: "/v1/chat/completions",
    status: 200,
    contentType: "text/event-stream",
    responseBody: [
      `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello from Acme routed provider!" } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 8, completion_tokens: 7, total_tokens: 15 } })}\n\n`,
      "data: [DONE]\n\n",
    ].join(""),
  };

  const acmeProvider = createAcmeProvider({
    apiKey: "acme-test-key-demo",
    fetch: replayFetch(recording),
  });

  const agent = await createAgent({
    id: "custom-provider-agent",
    model: { provider: "acme", model: "acme-chat-v1" },
    packages: [providerPackage("acme-pkg", [acmeProvider])],
  });

  const session = await agent.session();
  const result = await session.run("Hello Acme");
  await agent.dispose();

  return {
    status: result.status,
    text: result.text,
  };
}

export async function main() {
  console.log(JSON.stringify(await demo()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
