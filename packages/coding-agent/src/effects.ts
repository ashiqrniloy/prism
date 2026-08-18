import { Buffer } from "node:buffer";
import { readFile, stat } from "node:fs/promises";
import type { JsonObject, ToolEffectDeclaration, ToolEffectRecord, ToolResult } from "@arnilo/prism";
import { HARD_MAX_WRITE_BYTES } from "./limits.js";
import { resolveContainedMutationPath } from "./mutation-path.js";

export const CODING_OBSERVATION_EFFECT = { kind: "none", idempotency: "none" } as const satisfies ToolEffectDeclaration;
export const CODING_LOCAL_EFFECT = { kind: "local_mutation", idempotency: "optional" } as const satisfies ToolEffectDeclaration;
export const CODING_UNSUPPORTED_EFFECT = { kind: "external_mutation", idempotency: "unsupported" } as const satisfies ToolEffectDeclaration;

export function classifyGitBranchEffect(args: JsonObject): ToolEffectDeclaration {
  return args.action === "list" || args.action === "validate" ? CODING_OBSERVATION_EFFECT : CODING_LOCAL_EFFECT;
}

export function classifyGitWorktreeEffect(args: JsonObject): ToolEffectDeclaration {
  return args.action === "list" ? CODING_OBSERVATION_EFFECT : CODING_LOCAL_EFFECT;
}

export function classifyGitApplyEffect(args: JsonObject): ToolEffectDeclaration {
  return args.action === "check" ? CODING_OBSERVATION_EFFECT : CODING_LOCAL_EFFECT;
}

export interface CodingEffectReconciliationInput {
  readonly cwd: string;
  readonly record: Pick<ToolEffectRecord, "toolCallId" | "toolName">;
  readonly args: JsonObject;
  readonly signal?: AbortSignal;
}

export type CodingEffectReconciliation = { readonly status: "completed"; readonly result: ToolResult } | { readonly status: "unknown" };

/**
 * Checks only exact local postconditions. Callers retain the pending call arguments,
 * then pass a completed result to ToolEffectStore.resolveUnknown() when this returns one.
 */
export async function reconcileCodingToolEffect(input: CodingEffectReconciliationInput): Promise<CodingEffectReconciliation> {
  input.signal?.throwIfAborted();
  const completed = () => ({
    status: "completed" as const,
    result: {
      toolCallId: input.record.toolCallId,
      name: input.record.toolName,
      content: [{ type: "text" as const, text: "Local tool postcondition verified." }],
      value: { reconciled: true },
    },
  });

  try {
    if (input.record.toolName === "write") {
      const path = stringArg(input.args, "path");
      const content = stringArg(input.args, "content");
      if (path === undefined || content === undefined || Buffer.byteLength(content, "utf8") > HARD_MAX_WRITE_BYTES)
        return { status: "unknown" };
      const target = await resolveContainedMutationPath(input.cwd, path);
      const expected = Buffer.from(content, "utf8");
      if ((await stat(target)).size !== expected.length) return { status: "unknown" };
      return (await readFile(target)).equals(expected) ? completed() : { status: "unknown" };
    }
    if (input.record.toolName === "delete") {
      const path = stringArg(input.args, "path");
      if (path === undefined) return { status: "unknown" };
      await resolveContainedMutationPath(input.cwd, path, { allowMissing: true });
      return (await missing(input.cwd, path)) ? completed() : { status: "unknown" };
    }
    if (input.record.toolName === "move") {
      const from = stringArg(input.args, "from");
      const to = stringArg(input.args, "to");
      if (from === undefined || to === undefined) return { status: "unknown" };
      await Promise.all([
        resolveContainedMutationPath(input.cwd, from, { allowMissing: true }),
        resolveContainedMutationPath(input.cwd, to, { allowMissing: true }),
      ]);
      if (await missing(input.cwd, from)) {
        try {
          await resolveContainedMutationPath(input.cwd, to);
          return completed();
        } catch {
          return { status: "unknown" };
        }
      }
    }
  } catch {
    // Containment/read failure is not proof that an effect did not happen.
  }
  return { status: "unknown" };
}

function stringArg(args: JsonObject, name: string): string | undefined {
  const value = args[name];
  return typeof value === "string" ? value : undefined;
}

async function missing(cwd: string, path: string): Promise<boolean> {
  try {
    await resolveContainedMutationPath(cwd, path);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ENOTDIR";
  }
}
