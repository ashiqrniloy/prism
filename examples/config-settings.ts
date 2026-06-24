import {
  mergeConfigLayers,
  createStaticSettingsProvider,
  createChainedSettingsProvider,
} from "@arnilo/prism";

// Layered config merge + settings provider. Core can run fully in-memory; the
// Node filesystem loaders are opt-in host/CLI utilities, not hidden behavior.
export function demo() {
  const defaults = mergeConfigLayers([
    { name: "builtin", config: { model: "demo", retries: 1 } },
    { name: "host", config: { retries: 3, tools: ["echo"] } },
  ]);

  const settings = createChainedSettingsProvider([
    createStaticSettingsProvider({ retries: String(defaults.retries) }),
  ]);

  return { model: defaults.model, retries: settings.get("retries") };
}
