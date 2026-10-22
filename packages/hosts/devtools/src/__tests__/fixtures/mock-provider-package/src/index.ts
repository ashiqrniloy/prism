// A manifest fixture package that registers the `mock` provider. It imports nothing, so the
// installer can define it from any managed directory. `--model mock/demo` selects it.
export default {
  name: "@acme/mock-provider",
  version: "1.0.0",
  description: "Manifest fixture provider package.",
  requires: { api: 1 },
  capabilities: [],
  setup(prism: { providers: { register(provider: unknown): void } }): void {
    prism.providers.register({
      id: "mock",
      async *generate() {
        yield { type: "content_delta", content: { type: "text", text: "hello from manifest" } };
        yield { type: "done" };
      },
    });
  },
};
