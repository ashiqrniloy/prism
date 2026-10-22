/** Built-in guardrail pack registry (plan 092 Task 2). Definitions are pure data + pure factories. */
import { codingStandardPack } from "./coding-standard.js";
import { destructiveCommandsPack } from "./destructive-commands.js";
import { secretsHygienePack } from "./secrets-hygiene.js";
import type { GuardrailPackDefinition } from "./types.js";
import { validationRespectPack } from "./validation-respect.js";

const DEFINITIONS: readonly GuardrailPackDefinition[] = [
  codingStandardPack,
  destructiveCommandsPack,
  validationRespectPack,
  secretsHygienePack,
];

export const BUILT_IN_GUARDRAIL_PACKS: ReadonlyMap<string, GuardrailPackDefinition> = new Map(
  DEFINITIONS.map((definition) => [definition.id, definition]),
);

/** Built-in pack ids, in registry order. */
export const BUILT_IN_GUARDRAIL_PACK_IDS: readonly string[] = DEFINITIONS.map((definition) => definition.id);
