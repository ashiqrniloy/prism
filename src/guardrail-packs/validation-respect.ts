import type { ToolResult } from "../contracts-protocol.js";
import { GuardrailPackError } from "./errors.js";
import type { GuardrailPackDefinition } from "./types.js";

const MUTATING_TOOLS = ["write", "edit", "delete", "move"] as const;
/** Validation-style tool names. `shell` is opt-in (`validationTools`): a non-zero shell exit is a failure signal too. */
const DEFAULT_VALIDATION_TOOLS = ["test", "run_tests", "validate", "validation", "lint", "typecheck", "check"] as const;
const MAX_VALIDATION_TOOLS = 16;
const MAX_VALIDATION_TOOL_CHARS = 128;

/** A tool result failed when it carries an error, or reported a non-zero `exitCode` (the shell tool's shape). */
function resultFailed(result: ToolResult): boolean {
  if (result.error !== undefined) return true;
  const value = result.value;
  if (!value || typeof value !== "object" || !("exitCode" in value)) return false;
  const exitCode = (value as { readonly exitCode?: unknown }).exitCode;
  return typeof exitCode === "number" && exitCode !== 0;
}

function readValidationTools(value: unknown): readonly string[] {
  if (value === undefined) return DEFAULT_VALIDATION_TOOLS;
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_VALIDATION_TOOLS) {
    throw new GuardrailPackError(
      `validation-respect options.validationTools must be a non-empty string array (max ${MAX_VALIDATION_TOOLS})`,
    );
  }
  return value.map((name) => {
    if (typeof name !== "string" || !name.trim()) {
      throw new GuardrailPackError("validation-respect options.validationTools entries must be non-empty strings");
    }
    return name;
  });
}

/** Canned "respect failed validation": once a validation tool result fails, file mutations are denied until one passes. */
export const validationRespectPack: GuardrailPackDefinition = {
  id: "validation-respect",
  version: 1,
  description: "Denies file mutations after a failed validation tool result until a later validation passes.",
  build(options) {
    const validationTools = readValidationTools(options.validationTools);
    return {
      observe(state, result, context) {
        if (!validationTools.includes(context.toolName)) return;
        state.validationFailed = resultFailed(result) ? context.toolName : undefined;
      },
      // Plan 104 Task 2: one tool name (or nothing) survives a resume, so a mutation the suspended
      // run denied stays denied. The codec is the pack's own bound: 128 chars, never arguments.
      state: {
        snapshot: (state) => (typeof state.validationFailed === "string" ? { validationFailed: state.validationFailed } : undefined),
        parse: (json) => {
          const record = typeof json === "object" && json !== null ? (json as Record<string, unknown>) : {};
          const failed = record.validationFailed;
          if (failed === undefined) return {};
          if (typeof failed !== "string" || !failed.trim() || failed.length > MAX_VALIDATION_TOOL_CHARS) {
            throw new GuardrailPackError(
              `validation-respect persisted state.validationFailed must be a non-empty string of at most ${MAX_VALIDATION_TOOL_CHARS} chars`,
            );
          }
          return { validationFailed: failed };
        },
      },
      rules: [
        {
          id: "no-mutation-after-failed-validation",
          tool: MUTATING_TOOLS,
          reason: "A previous validation result failed; fix it before mutating files",
          deny: (_args, context) => context.state.validationFailed !== undefined,
        },
      ],
    };
  },
};
