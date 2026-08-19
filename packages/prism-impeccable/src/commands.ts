import type { CommandDefinition, JsonObject } from "@arnilo/prism";

import { IMPECCABLE_SKILL_NAME } from "./skills.js";

export function createImpeccableCommand(): CommandDefinition {
  return {
    name: IMPECCABLE_SKILL_NAME,
    description: "Dispatch upstream Impeccable skill.",
    parameters: { type: "object" } as JsonObject,
    execute() {
      return {
        name: IMPECCABLE_SKILL_NAME,
        value: { skill: IMPECCABLE_SKILL_NAME, dispatch: "load_skill" },
        content: [{ type: "text", text: "Load skill impeccable." }],
        metadata: { skill: IMPECCABLE_SKILL_NAME },
      };
    },
  };
}
