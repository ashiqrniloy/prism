import { describe, it } from "node:test";
import type { AgentConfig, CredentialResolver, Extension, SettingsProvider } from "../index.js";

type ExpectFalse<T extends false> = T;
type HasKey<T, K extends PropertyKey> = K extends keyof T ? true : false;

// Compile fixture: inert host-wiring fields were removed from AgentConfig.
// Keep extensions/settings/credentials as host-owned seams outside createAgent().
type _AgentConfigHasNoExtensions = ExpectFalse<HasKey<AgentConfig, "extensions">>;
type _AgentConfigHasNoSettings = ExpectFalse<HasKey<AgentConfig, "settings">>;
type _AgentConfigHasNoCredentials = ExpectFalse<HasKey<AgentConfig, "credentials">>;

describe("AgentConfig host-wiring migration", () => {
  it("documents extensions/settings/credentials as host-owned outside AgentConfig", () => {
    const extension: Extension = { name: "demo", setup() { /* host loads via createExtensionKernel */ } };
    const settings: SettingsProvider = { get: () => undefined };
    const credentials: CredentialResolver = { resolve: () => undefined };
    // Host wires these into provider packages / kernels explicitly — not createAgent().
    void extension;
    void settings;
    void credentials;
    const config = { model: { provider: "mock", model: "demo" } } satisfies AgentConfig;
    void config;
  });
});
