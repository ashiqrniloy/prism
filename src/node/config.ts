import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { assertJsonObject, type ConfigLayer } from "../config.js";

export interface NodeConfigFile {
  readonly name: string;
  readonly path: string;
  readonly optional?: boolean;
}

export function defaultUserConfigPath(appName = "prism"): string {
  return join(homedir(), ".config", appName, "config.json");
}

export async function readConfigFile(path: string): Promise<ConfigLayer["config"]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`Failed to read config ${path}: ${errorMessage(error)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON config ${path}: ${errorMessage(error)}`);
  }

  try {
    assertJsonObject(parsed, `config ${path}`);
  } catch (error) {
    throw new Error(errorMessage(error));
  }
  return parsed;
}

export async function loadConfigFiles(files: readonly NodeConfigFile[]): Promise<ConfigLayer[]> {
  const layers: ConfigLayer[] = [];
  for (const file of files) {
    try {
      layers.push({ name: file.name, config: await readConfigFile(file.path) });
    } catch (error) {
      if (file.optional && isMissingFile(error)) continue;
      throw error;
    }
  }
  return layers;
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && error.message.includes("ENOENT");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
