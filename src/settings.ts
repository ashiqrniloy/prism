import type { JsonObject, SettingsProvider } from "./contracts.js";
import { assertJsonObject } from "./config.js";

export function createStaticSettingsProvider(settings: JsonObject): SettingsProvider {
  assertJsonObject(settings, "settings");
  return {
    get<T = unknown>(key: string): T | undefined {
      return key.split(".").reduce<unknown>((value, part) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
        return (value as Record<string, unknown>)[part];
      }, settings) as T | undefined;
    },
  };
}

export function createChainedSettingsProvider(providers: readonly SettingsProvider[]): SettingsProvider {
  return {
    async get<T = unknown>(key: string): Promise<T | undefined> {
      for (const provider of providers) {
        const value = await provider.get<T>(key);
        if (value !== undefined) return value;
      }
      return undefined;
    },
  };
}
