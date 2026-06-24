import { createExtensionKernel, createMockProvider, providerDone } from "@arnilo/prism";
import type { Extension } from "@arnilo/prism";

// Extension kernel + event bus: load host-provided extensions in order,
// register contributions, and emit lifecycle events. Extension errors become
// events and do not crash unless host policy says so.
export async function demo() {
  const health: Extension = {
    name: "health",
    setup(api) {
      api.registerProvider(createMockProvider([providerDone()]));
    },
  };

  const kernel = createExtensionKernel();
  await kernel.load([health]);

  return { registeredProviders: kernel.registries.providers.list().length };
}
