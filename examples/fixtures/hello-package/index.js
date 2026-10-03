// A local fixture package for examples/manifest.ts. It imports nothing, so it resolves from any managed
// directory; the installer re-defines it with the host's `definePackage`. Plain JS so the examples' tsc
// emit leaves it alone. The secret field takes an `env:` ref only.
export default {
  name: "@acme/hello",
  version: "1.0.0",
  description: "Greets by name. Declares one tool and one secret ref.",
  capabilities: ["host-ui"],
  config: {
    type: "object",
    properties: {
      greeting: { type: "string", default: "hello" },
      apiKey: { type: "string", "x-prism-secret": true },
    },
  },
  setup(prism) {
    const { greeting } = prism.config;
    prism.tools.register({
      name: "hello_greet",
      description: "Greets a name.",
      parameters: { type: "object", properties: { name: { type: "string" } } },
      execute: async (args, context) => ({
        toolCallId: context.toolCallId,
        name: "hello_greet",
        value: `${greeting} ${args.name ?? "world"}`,
      }),
    });
  },
};
