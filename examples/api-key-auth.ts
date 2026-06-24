import {
  createEnvCredentialResolver,
  createExplicitCredentialResolver,
  createMemoryCredentialStore,
} from "@arnilo/prism";

// Compose an explicit API-key resolver order. Prism never reads process.env on
// its own; the host supplies the env object and the provider→env-name map.
export function demo() {
  const env = { OPENAI_API_KEY: "fake-openai-key", OPENROUTER_API_KEY: "fake-openrouter-key" };
  const envResolver = createEnvCredentialResolver(env, { openai: "OPENAI_API_KEY", openrouter: "OPENROUTER_API_KEY" });

  const store = createMemoryCredentialStore([
    { name: "apiKey", provider: "openai", credential: { type: "api_key", value: "fake-openai-key" } },
  ]);
  // Order is host-controlled: try the explicit store first, then env.
  const chained = createExplicitCredentialResolver([
    { name: "store", resolver: store },
    { name: "env", resolver: envResolver },
  ]);

  return { chained };
}
