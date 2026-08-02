import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { isPonytailMode } from "./mode.js";
import type { PonytailMode } from "./types.js";
import { MAX_CONFIG_FILE_BYTES, redactPaths, UpstreamResolveError } from "./upstream.js";

export interface PonytailConfig {
  readonly defaultMode: PonytailMode;
  readonly quietStartup: boolean;
  readonly hideStatus: boolean;
}

export const DEFAULT_PONYTAIL_CONFIG: PonytailConfig = {
  defaultMode: "full",
  quietStartup: false,
  hideStatus: false,
};

export function readPonytailConfig(configPath?: string): PonytailConfig {
  if (!configPath) return { ...DEFAULT_PONYTAIL_CONFIG };
  try {
    const raw = readFileSync(configPath, "utf8").replace(/^\uFEFF/, "");
    if (raw.length > MAX_CONFIG_FILE_BYTES) {
      throw new UpstreamResolveError(redactPaths(`Config exceeds ${MAX_CONFIG_FILE_BYTES} byte cap`, [configPath]));
    }
    const parsed = JSON.parse(raw) as {
      defaultMode?: unknown;
      quietStartup?: unknown;
      hideStatus?: unknown;
    };
    return {
      defaultMode:
        typeof parsed.defaultMode === "string" && isPonytailMode(parsed.defaultMode)
          ? parsed.defaultMode
          : DEFAULT_PONYTAIL_CONFIG.defaultMode,
      quietStartup: typeof parsed.quietStartup === "boolean" ? parsed.quietStartup : DEFAULT_PONYTAIL_CONFIG.quietStartup,
      hideStatus: typeof parsed.hideStatus === "boolean" ? parsed.hideStatus : DEFAULT_PONYTAIL_CONFIG.hideStatus,
    };
  } catch (error) {
    if (error instanceof UpstreamResolveError) throw error;
    return { ...DEFAULT_PONYTAIL_CONFIG };
  }
}

export function writePonytailDefaultMode(configPath: string, mode: PonytailMode): void {
  const existing = readPonytailConfig(configPath);
  const body = `${JSON.stringify({ ...existing, defaultMode: mode }, null, 2)}\n`;
  if (body.length > MAX_CONFIG_FILE_BYTES) {
    throw new UpstreamResolveError(redactPaths(`Config exceeds ${MAX_CONFIG_FILE_BYTES} byte cap`, [configPath]));
  }
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, body, "utf8");
}

export function readInitialConfig(configPath: string | undefined, defaultMode?: PonytailMode, quietStartup?: boolean): PonytailConfig {
  const file = readPonytailConfig(configPath);
  return {
    defaultMode: defaultMode ?? file.defaultMode,
    quietStartup: quietStartup ?? file.quietStartup,
    hideStatus: file.hideStatus,
  };
}
