import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isCavemanLevel } from "./mode.js";
import type { CavemanLevel } from "./types.js";
import { MAX_CONFIG_FILE_BYTES, redactPaths, UpstreamResolveError } from "./upstream.js";

export interface CavemanConfig {
  readonly defaultLevel: CavemanLevel;
  readonly showStatus: boolean;
}

export const DEFAULT_CAVEMAN_CONFIG: CavemanConfig = { defaultLevel: "full", showStatus: false };

export function readCavemanConfig(configPath?: string): CavemanConfig {
  if (!configPath) return { ...DEFAULT_CAVEMAN_CONFIG };
  try {
    const raw = readFileSync(configPath, "utf8");
    if (raw.length > MAX_CONFIG_FILE_BYTES) {
      throw new UpstreamResolveError(redactPaths(`Config exceeds ${MAX_CONFIG_FILE_BYTES} byte cap`, [configPath]));
    }
    const parsed = JSON.parse(raw) as { defaultLevel?: unknown; showStatus?: unknown };
    return {
      defaultLevel:
        typeof parsed.defaultLevel === "string" && isCavemanLevel(parsed.defaultLevel)
          ? parsed.defaultLevel
          : DEFAULT_CAVEMAN_CONFIG.defaultLevel,
      showStatus: typeof parsed.showStatus === "boolean" ? parsed.showStatus : DEFAULT_CAVEMAN_CONFIG.showStatus,
    };
  } catch (error) {
    if (error instanceof UpstreamResolveError) throw error;
    return { ...DEFAULT_CAVEMAN_CONFIG };
  }
}

export function writeCavemanConfig(configPath: string, config: CavemanConfig): void {
  const body = `${JSON.stringify(config, null, 2)}\n`;
  if (body.length > MAX_CONFIG_FILE_BYTES) {
    throw new UpstreamResolveError(redactPaths(`Config exceeds ${MAX_CONFIG_FILE_BYTES} byte cap`, [configPath]));
  }
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, body, "utf8");
}
