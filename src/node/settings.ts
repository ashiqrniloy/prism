import { homedir } from "node:os";
import { join } from "node:path";
import { type ConfigLayer, mergeConfigLayers } from "../config.js";
import type { SettingsProvider } from "../contracts.js";
import { createStaticSettingsProvider } from "../settings.js";
import { isNodeErrorCode, type NodeConfigFile, readConfigFile } from "./config.js";

export type NodeSettingsFile = NodeConfigFile;

export function defaultUserSettingsPath(appName = "prism"): string {
  return join(homedir(), ".config", appName, "settings.json");
}

export function readSettingsFile(path: string): Promise<ConfigLayer["config"]> {
  return readConfigFile(path);
}

export async function loadSettingsFiles(files: readonly NodeSettingsFile[]): Promise<SettingsProvider> {
  const layers: ConfigLayer[] = [];
  for (const file of files) {
    try {
      layers.push({ name: file.name, config: await readSettingsFile(file.path) });
    } catch (error) {
      if (file.optional && isNodeErrorCode(error, "ENOENT")) continue;
      throw error;
    }
  }
  return createStaticSettingsProvider(mergeConfigLayers(layers));
}
