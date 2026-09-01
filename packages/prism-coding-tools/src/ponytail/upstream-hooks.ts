import { createRequire } from "node:module";
import { join } from "node:path";

export interface UpstreamPonytailConfig {
  readonly DEFAULT_MODE: string;
  readonly RUNTIME_MODES: readonly string[];
  readonly normalizeMode: (mode: unknown) => string | null;
  readonly normalizePersistedMode: (mode: unknown) => string | null;
  readonly isDeactivationCommand: (text: string) => boolean;
}

export interface UpstreamPonytailInstructions {
  readonly getPonytailInstructions: (mode: string) => string;
  readonly filterSkillBodyForMode: (body: string, mode: string) => string;
}

export interface UpstreamPonytailHooks {
  readonly config: UpstreamPonytailConfig;
  readonly instructions: UpstreamPonytailInstructions;
}

/** Load upstream hook modules from resolved root (no forked instruction strings). */
export function loadUpstreamHooks(upstreamRoot: string): UpstreamPonytailHooks {
  const configPath = join(upstreamRoot, "hooks/ponytail-config.js");
  const require = createRequire(configPath);
  const config = require(configPath) as UpstreamPonytailConfig;
  const instructions = require(join(upstreamRoot, "hooks/ponytail-instructions.js")) as UpstreamPonytailInstructions;
  return { config, instructions };
}
