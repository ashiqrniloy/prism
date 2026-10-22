import { resolve } from "node:path";
import { MemoryValidationError } from "@arnilo/prism-memory-core";
import type { MemoryFabric, MemoryFabricRecallOptions } from "../types.js";
import type { Memory } from "@arnilo/prism-memory-core";
import { requireNonEmptyString } from "@arnilo/prism-memory-core";
import { assertFabricBlockLabel } from "../blocks.js";
import { rememberScopedFact } from "./facts.js";
import { onLegacyScopedLedger, scopedLedgerPath } from "./ledger.js";
import { renderScopedMirror } from "./mirror.js";
import type { ArchiveConfig } from "../lifecycle/index.js";
import { runScopedGcPass, scopedMemoryHealth } from "./lifecycle.js";
import { recallScopedMemory, type ScopedMemoryRecallResult } from "./read-policy.js";
import { reviewScopedSession, type ScopedMemoryReviewResult, type ScopedMemoryReviewer } from "./reviewer.js";
import { approveScopedPending, listScopedPending, rejectScopedPending } from "./trust.js";

export type ScopedMemoryApprovalMode = "off" | "staged";

export interface ScopedMemoryPolicyKnobs {
  readonly promotion?: { readonly reuseThreshold?: number };
  readonly activation?: { readonly topK?: number; readonly minSimilarity?: number };
  readonly facts?: { readonly block?: string; readonly maxChars?: number };
  readonly approval?: { readonly default?: ScopedMemoryApprovalMode };
}

export interface CreateScopedMemoryPolicyOptions {
  readonly memory: Memory;
  readonly fabric: MemoryFabric;
  readonly scopeRoot: string;
  readonly policy?: ScopedMemoryPolicyKnobs;
  /** Scope-session ordinal for the archive rule; without a clock the sweep proposes nothing. */
  readonly clock?: () => number;
  /** Archive thresholds; defaults to the lifecycle's own (plan 188.4 Task 4). */
  readonly archive?: ArchiveConfig;
  /** Called once per ledger file that still carries retired lifecycle fields. */
  readonly onLegacyLedger?: (ignored: number) => void;
}

export interface ScopedMemoryPolicySettings {
  readonly promotion: { readonly reuseThreshold: number };
  readonly activation: { readonly topK: number; readonly minSimilarity: number };
  readonly facts: { readonly block: string; readonly maxChars: number };
  readonly approval: { readonly default: ScopedMemoryApprovalMode };
}

export type { ScopedMemoryReviewResult, ScopedMemoryReviewer } from "./reviewer.js";

export interface ScopedMemoryPolicy {
  readonly scopeRoot: string;
  readonly settings: ScopedMemoryPolicySettings;
  recall(query: string, options?: MemoryFabricRecallOptions): Promise<ScopedMemoryRecallResult>;
  reviewSession(
    digest: string | readonly unknown[],
    options: { readonly reviewer: ScopedMemoryReviewer; readonly prompt?: string },
  ): Promise<ScopedMemoryReviewResult>;
  gcPass(): Promise<{ readonly proposed: number; readonly archived: number }>;
  health(): Promise<{
    readonly notes: { readonly candidate: number; readonly verified: number; readonly archived: number };
    readonly conversionRate: number;
    readonly activationRate: number;
    readonly duplicationRate: number;
  }>;
  rememberFact(text: string): Promise<void>;
  pending(): Promise<
    readonly { readonly id: string; readonly kind: "review" | "archive"; readonly gist: string; readonly createdAt: string }[]
  >;
  approve(id: string): Promise<void>;
  reject(id: string): Promise<void>;
  renderMirror(): Promise<void>;
}

const DEFAULT_SETTINGS: ScopedMemoryPolicySettings = Object.freeze({
  promotion: Object.freeze({ reuseThreshold: 2 }),
  activation: Object.freeze({ topK: 3, minSimilarity: 0.35 }),
  facts: Object.freeze({ block: "facts", maxChars: 2200 }),
  approval: Object.freeze({ default: "off" }),
});

function assertMemory(value: unknown): Memory {
  if (
    value === null ||
    typeof value !== "object" ||
    typeof (value as Memory).recall !== "function" ||
    typeof (value as Memory).remember !== "function" ||
    (value as Memory).scope === null ||
    typeof (value as Memory).scope !== "object"
  ) {
    throw new MemoryValidationError("createScopedMemoryPolicy requires a memory instance");
  }
  return value as Memory;
}

function assertFabric(value: unknown): MemoryFabric {
  if (
    value === null ||
    typeof value !== "object" ||
    typeof (value as MemoryFabric).recall !== "function" ||
    typeof (value as MemoryFabric).remember !== "function" ||
    typeof (value as MemoryFabric).tools !== "function"
  ) {
    throw new MemoryValidationError("createScopedMemoryPolicy requires a fabric instance");
  }
  return value as MemoryFabric;
}

function positiveInt(value: unknown, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new MemoryValidationError(`${label} must be a positive integer`);
  }
  return value as number;
}

function unitInterval(value: unknown, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new MemoryValidationError(`${label} must be a number in [0, 1]`);
  }
  return value;
}

function resolveSettings(policy: ScopedMemoryPolicyKnobs | undefined): ScopedMemoryPolicySettings {
  if (policy === undefined) return DEFAULT_SETTINGS;
  if (policy === null || typeof policy !== "object" || Array.isArray(policy)) {
    throw new MemoryValidationError("policy must be an options object");
  }
  const approval = policy.approval?.default ?? DEFAULT_SETTINGS.approval.default;
  if (approval !== "off" && approval !== "staged") {
    throw new MemoryValidationError('policy.approval.default must be "off" or "staged"');
  }
  return Object.freeze({
    promotion: Object.freeze({
      reuseThreshold: positiveInt(
        policy.promotion?.reuseThreshold,
        DEFAULT_SETTINGS.promotion.reuseThreshold,
        "policy.promotion.reuseThreshold",
      ),
    }),
    activation: Object.freeze({
      topK: positiveInt(policy.activation?.topK, DEFAULT_SETTINGS.activation.topK, "policy.activation.topK"),
      minSimilarity: unitInterval(
        policy.activation?.minSimilarity,
        DEFAULT_SETTINGS.activation.minSimilarity,
        "policy.activation.minSimilarity",
      ),
    }),
    facts: Object.freeze({
      block: (() => {
        if (policy.facts?.block === undefined) return DEFAULT_SETTINGS.facts.block;
        assertFabricBlockLabel(policy.facts.block);
        return policy.facts.block;
      })(),
      maxChars: positiveInt(policy.facts?.maxChars, DEFAULT_SETTINGS.facts.maxChars, "policy.facts.maxChars"),
    }),
    approval: Object.freeze({ default: approval }),
  });
}

export function createScopedMemoryPolicy(options: CreateScopedMemoryPolicyOptions): ScopedMemoryPolicy {
  if (options === null || typeof options !== "object") {
    throw new MemoryValidationError("createScopedMemoryPolicy requires options");
  }
  const memory = assertMemory(options.memory);
  const fabric = assertFabric(options.fabric);
  const scopeRoot = resolve(requireNonEmptyString(options.scopeRoot, "scopeRoot"));
  requireNonEmptyString(memory.scope.threadId, "threadId");
  const settings = resolveSettings(options.policy);
  const ledgerFile = scopedLedgerPath(scopeRoot);
  if (options.onLegacyLedger !== undefined) onLegacyScopedLedger(options.onLegacyLedger);
  return Object.freeze({
    scopeRoot,
    settings,
    recall: (query: string, recallOptions?: MemoryFabricRecallOptions) =>
      recallScopedMemory({ fabric, settings }, query, recallOptions),
    reviewSession: (
      digest: string | readonly unknown[],
      reviewOptions: { readonly reviewer: ScopedMemoryReviewer; readonly prompt?: string },
    ) => {
      if (typeof reviewOptions?.reviewer !== "function") {
        throw new MemoryValidationError("reviewSession requires reviewer");
      }
      return reviewScopedSession({
        fabric,
        ledgerFile,
        approval: settings.approval.default,
        digest,
        reviewer: reviewOptions.reviewer,
        ...(reviewOptions.prompt === undefined ? {} : { prompt: reviewOptions.prompt }),
      });
    },
    gcPass: () =>
      runScopedGcPass({
        memory,
        ledgerFile,
        clock: options.clock?.() ?? 0,
        ...(options.archive === undefined ? {} : { archive: options.archive }),
      }),
    health: () => scopedMemoryHealth(memory, ledgerFile),
    rememberFact: (text: string) => rememberScopedFact({ memory, block: settings.facts.block, maxChars: settings.facts.maxChars, text }),
    pending: () => listScopedPending(ledgerFile),
    approve: (id: string) => approveScopedPending({ fabric, ledgerFile, id }),
    reject: (id: string) => rejectScopedPending({ ledgerFile, id }),
    renderMirror: () => renderScopedMirror({ memory, scopeRoot, ledgerFile, factsBlock: settings.facts.block }),
  });
}
