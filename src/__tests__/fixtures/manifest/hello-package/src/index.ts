// A manifest fixture package. It imports nothing, so it resolves from any managed directory; the
// installer re-defines it with the host's `definePackage`.
const marker = globalThis as unknown as Record<string, number | undefined>;
marker.__prismHelloImports = (marker.__prismHelloImports ?? 0) + 1;

export default {
  name: "@acme/hello",
  version: "1.2.3",
  description: "Manifest fixture package.",
  capabilities: ["host-ui"],
  config: {
    type: "object",
    properties: {
      greeting: { type: "string", default: "hello" },
      apiKey: { type: "string", "x-prism-secret": true },
    },
  },
  setup(): void {},
};
