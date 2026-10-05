import { createEnvRefCredentialResolver, type CredentialResolver, type Secret } from "@arnilo/prism";

// Compose an explicit API-key resolver order through the credentials slot. Prism
// never reads process.env on its own; the host supplies the env object and a
// small name-keyed store, then chains them in the order it wants.
export function demo() {
  const env = { OPENAI_API_KEY: "fake-openai-key", OPENROUTER_API_KEY: "fake-openrouter-key" };
  const records = new Map<string, Secret>([["keyring:openai", { type: "api_key", value: "fake-openai-key" }]]);
  const store: CredentialResolver = {
    resolve: (ref) => records.get(ref),
    store: (ref, secret) => void records.set(ref, secret),
    delete: (ref) => void records.delete(ref),
  };
  const envResolver = createEnvRefCredentialResolver(env);
  // Order is host-controlled: try the explicit store first, then env.
  const chained: CredentialResolver = {
    async resolve(ref, ctx) {
      return (await store.resolve(ref, ctx)) ?? envResolver.resolve(ref, ctx);
    },
  };

  return { chained };
}
