/**
 * Plan 089 Task 2: one place where a host turns declarative reranker config into
 * a `Reranker`. Local is the zero-service default; TEI and the hosted adapters
 * stay for scale. Configuration only — no I/O, and every failure is loud.
 */
import { RagValidationError } from "./errors.js";
import {
  createOpenAiCompatibleReranker,
  type CreateOpenAiCompatibleRerankerOptions,
  createVoyageReranker,
  type CreateVoyageRerankerOptions,
} from "./hosted-rerankers.js";
import { createLocalReranker, type CreateLocalRerankerOptions } from "./local-reranker.js";
import { createFakeReranker } from "./rerank-fake.js";
import { createTeiReranker, type CreateTeiRerankerOptions } from "./tei-reranker.js";
import type { Reranker } from "./types.js";

/**
 * Host configuration for the rerank seam. `local` needs no endpoint; `tei` and
 * the hosted kinds point at an operator service; `fake` is the deterministic
 * network-free test double.
 */
export type RerankerConfig =
  | { readonly kind: "none" }
  | { readonly kind: "fake" }
  | ({ readonly kind: "local" } & CreateLocalRerankerOptions)
  | ({ readonly kind: "tei" } & CreateTeiRerankerOptions)
  | ({ readonly kind: "openai-compatible" } & CreateOpenAiCompatibleRerankerOptions)
  | ({ readonly kind: "voyage" } & CreateVoyageRerankerOptions);

/** Resolve config to a `Reranker`, or `undefined` for `kind: "none"` / absent config (rerank off). */
export function resolveReranker(config: RerankerConfig | undefined): Reranker | undefined {
  if (!config || config.kind === "none") return undefined;
  switch (config.kind) {
    case "fake":
      return createFakeReranker();
    case "local":
      return createLocalReranker(config);
    case "tei":
      return createTeiReranker(config);
    case "openai-compatible":
      return createOpenAiCompatibleReranker(config);
    case "voyage":
      return createVoyageReranker(config);
    default: {
      const unknown: never = config;
      throw new RagValidationError(`unknown reranker kind ${JSON.stringify((unknown as { kind?: unknown }).kind ?? "")}`);
    }
  }
}
