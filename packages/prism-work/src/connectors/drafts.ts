import { createHash, randomUUID } from "node:crypto";
import {
  type AgentIdentity,
  type ArtifactBodyRef,
  type ArtifactBodyStore,
  assertIdentityActive,
  CheckpointConflictError,
  type CheckpointStore,
  type JsonObject,
  type OwnershipScope,
  type SecretRedactor,
} from "@arnilo/prism";
import { WorkToolError } from "./errors.js";
import { identityKey } from "./idempotency.js";
import { resolveWorkLimits } from "./limits.js";
import type { SyncWorkDraftStore, WorkDraft, WorkDraftApproval, WorkDraftStore, WorkLimits, WorkProvider } from "./types.js";

export const WORK_DRAFT_CHECKPOINT_NAMESPACE = "prism.work.draft";

export function canonicalJson(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) {
        out[key] = canonicalJson(v);
      }
    }
    return out;
  }
  throw new WorkToolError("ERR_PRISM_WORK_INPUT", "Draft payload must be JSON serializable");
}

export function computePayloadDigest(payload: JsonObject): string {
  const canonical = canonicalJson(payload);
  const json = JSON.stringify(canonical);
  return `sha256:${createHash("sha256").update(json).digest("hex")}`;
}

export function extractDraftRecipients(payload: JsonObject): readonly string[] {
  const recipients: string[] = [];
  const add = (val: unknown) => {
    if (typeof val === "string") {
      for (const part of val.split(/[,;\s]+/)) {
        const trimmed = part.trim().toLowerCase();
        if (trimmed && !recipients.includes(trimmed)) recipients.push(trimmed);
      }
    } else if (Array.isArray(val)) {
      for (const item of val) add(item);
    }
  };
  add(payload.to);
  add(payload.cc);
  add(payload.bcc);
  add(payload.emailAddress);
  add(payload.recipients);
  add(payload.user);
  return Object.freeze(recipients);
}

export function draftCheckpointKey(provider: WorkProvider, draftId: string): string {
  return `${provider}:${draftId}`;
}

function extractOwnership(identity: AgentIdentity): OwnershipScope {
  return {
    tenantId: identity.tenantId,
    ...(identity.accountId !== undefined ? { accountId: identity.accountId } : {}),
    ...(identity.userId !== undefined ? { userId: identity.userId } : {}),
  };
}

export function validateApproval(
  draft: WorkDraft,
  approval: WorkDraftApproval,
  options?: { readonly policyRevision?: string; readonly now?: number },
): void {
  if (approval.draftId !== draft.draftId) {
    throw new WorkToolError("ERR_PRISM_WORK_DRAFT", `Approval draftId ${approval.draftId} does not match draft ${draft.draftId}`);
  }
  if (approval.revision !== draft.revision) {
    throw new WorkToolError(
      "ERR_PRISM_WORK_DRAFT_STALE",
      `Approval revision ${approval.revision} does not match draft revision ${draft.revision}`,
    );
  }
  if (approval.payloadDigest !== draft.payloadDigest) {
    throw new WorkToolError(
      "ERR_PRISM_WORK_DRAFT_DIGEST",
      `Approval payloadDigest ${approval.payloadDigest} does not match draft digest ${draft.payloadDigest}`,
    );
  }
  if (approval.identityKey && draft.identityKey && approval.identityKey !== draft.identityKey) {
    throw new WorkToolError("ERR_PRISM_WORK_IDENTITY", "Approval identity does not match draft identity");
  }
  if (approval.expiresAt) {
    const expiresMs = Date.parse(approval.expiresAt);
    const currentTime = options?.now ?? Date.now();
    if (Number.isFinite(expiresMs) && expiresMs <= currentTime) {
      throw new WorkToolError("ERR_PRISM_WORK_APPROVAL_EXPIRED", "Approval has expired");
    }
  }
  const expectedPolicy = options?.policyRevision ?? draft.policyRevision;
  if (expectedPolicy !== undefined && approval.policyRevision !== expectedPolicy) {
    throw new WorkToolError(
      "ERR_PRISM_WORK_POLICY",
      `Policy revision changed (expected ${expectedPolicy}, got ${approval.policyRevision ?? "none"})`,
    );
  }
}

export interface MemoryWorkDraftStoreOptions {
  readonly ephemeral?: boolean;
}

export function createMemoryWorkDraftStore(options: MemoryWorkDraftStoreOptions = {}): SyncWorkDraftStore {
  const mode = (options.ephemeral ?? true) ? "ephemeral" : ("durable" as const);
  const drafts = new Map<string, { draft: WorkDraft; checkpointVersion: number }>();

  return {
    mode,
    createDraft(input) {
      assertIdentityActive(input.identity);
      input.signal?.throwIfAborted();
      const draftId = input.draftId ?? randomUUID();
      const key = draftCheckpointKey(input.provider, draftId);
      if (drafts.has(key)) {
        throw new WorkToolError("ERR_PRISM_WORK_DRAFT_CONFLICT", `Draft ${draftId} already exists`);
      }
      const now = new Date().toISOString();
      const payloadDigest = computePayloadDigest(input.payload);
      const recipients = extractDraftRecipients(input.payload);
      const draft: WorkDraft = {
        draftId,
        provider: input.provider,
        op: input.op,
        identityKey: identityKey(input.identity),
        payload: { ...input.payload },
        revision: 1,
        payloadDigest,
        ...(recipients.length > 0 ? { recipients } : {}),
        createdAt: now,
        updatedAt: now,
        status: "pending_approval",
        concurrencyToken: randomUUID(),
        ...(input.policyRevision ? { policyRevision: input.policyRevision } : {}),
        mode,
      };
      drafts.set(key, { draft, checkpointVersion: 1 });
      return draft;
    },

    getDraft(input) {
      assertIdentityActive(input.identity);
      input.signal?.throwIfAborted();
      const idKey = identityKey(input.identity);
      let entry: { draft: WorkDraft; checkpointVersion: number } | undefined;
      if (input.provider) {
        entry = drafts.get(draftCheckpointKey(input.provider, input.draftId));
      } else {
        for (const [k, v] of drafts) {
          if (k.endsWith(`:${input.draftId}`) || v.draft.draftId === input.draftId) {
            entry = v;
            break;
          }
        }
      }
      if (!entry) return undefined;
      if (entry.draft.identityKey !== idKey) {
        return undefined;
      }
      return entry.draft;
    },

    updateDraft(input) {
      assertIdentityActive(input.identity);
      input.signal?.throwIfAborted();
      const idKey = identityKey(input.identity);
      let foundKey: string | undefined;
      let entry: { draft: WorkDraft; checkpointVersion: number } | undefined;
      for (const [k, v] of drafts) {
        if (v.draft.draftId === input.draftId) {
          foundKey = k;
          entry = v;
          break;
        }
      }
      if (!entry || !foundKey) {
        throw new WorkToolError("ERR_PRISM_WORK_DRAFT", `Draft ${input.draftId} not found`);
      }
      if (entry.draft.identityKey !== idKey) {
        throw new WorkToolError("ERR_PRISM_WORK_IDENTITY", "Draft identity mismatch");
      }
      if (entry.draft.status === "executed") {
        throw new WorkToolError("ERR_PRISM_WORK_DRAFT_EXECUTED", "Executed draft cannot be modified");
      }
      if (input.expectedRevision !== undefined && entry.draft.revision !== input.expectedRevision) {
        throw new WorkToolError("ERR_PRISM_WORK_DRAFT_CONFLICT", "Draft revision conflict");
      }
      if (input.expectedConcurrencyToken !== undefined && entry.draft.concurrencyToken !== input.expectedConcurrencyToken) {
        throw new WorkToolError("ERR_PRISM_WORK_DRAFT_CONFLICT", "Draft concurrency token conflict");
      }
      const now = new Date().toISOString();
      const payloadDigest = computePayloadDigest(input.payload);
      const recipients = extractDraftRecipients(input.payload);
      const updatedDraft: WorkDraft = {
        ...entry.draft,
        payload: { ...input.payload },
        revision: entry.draft.revision + 1,
        payloadDigest,
        recipients: recipients.length > 0 ? recipients : undefined,
        updatedAt: now,
        status: "pending_approval",
        approval: undefined,
        concurrencyToken: randomUUID(),
        ...(input.policyRevision ? { policyRevision: input.policyRevision } : {}),
      };
      drafts.set(foundKey, { draft: updatedDraft, checkpointVersion: entry.checkpointVersion + 1 });
      return updatedDraft;
    },

    approveDraft(input) {
      assertIdentityActive(input.identity);
      input.signal?.throwIfAborted();
      const idKey = identityKey(input.identity);
      let foundKey: string | undefined;
      let entry: { draft: WorkDraft; checkpointVersion: number } | undefined;
      for (const [k, v] of drafts) {
        if (v.draft.draftId === input.draftId) {
          foundKey = k;
          entry = v;
          break;
        }
      }
      if (!entry || !foundKey) {
        throw new WorkToolError("ERR_PRISM_WORK_DRAFT", `Draft ${input.draftId} not found`);
      }
      if (entry.draft.identityKey !== idKey) {
        throw new WorkToolError("ERR_PRISM_WORK_IDENTITY", "Draft identity mismatch");
      }
      if (entry.draft.status === "executed") {
        throw new WorkToolError("ERR_PRISM_WORK_DRAFT_EXECUTED", "Draft already executed");
      }
      if (entry.draft.status === "rejected") {
        throw new WorkToolError("ERR_PRISM_WORK_DRAFT_REJECTED", "Draft was rejected");
      }
      if (input.expectedConcurrencyToken !== undefined && entry.draft.concurrencyToken !== input.expectedConcurrencyToken) {
        throw new WorkToolError("ERR_PRISM_WORK_DRAFT_CONFLICT", "Draft concurrency token conflict");
      }
      validateApproval(entry.draft, input.approval);
      if (
        entry.draft.status === "approved" &&
        entry.draft.approval &&
        entry.draft.approval.revision === input.approval.revision &&
        entry.draft.approval.payloadDigest === input.approval.payloadDigest
      ) {
        return entry.draft;
      }
      const now = new Date().toISOString();
      const approvedDraft: WorkDraft = {
        ...entry.draft,
        status: "approved",
        approval: {
          ...input.approval,
          approvedAt: input.approval.approvedAt ?? now,
        },
        updatedAt: now,
        concurrencyToken: randomUUID(),
      };
      drafts.set(foundKey, { draft: approvedDraft, checkpointVersion: entry.checkpointVersion + 1 });
      return approvedDraft;
    },

    markDraft(input) {
      assertIdentityActive(input.identity);
      input.signal?.throwIfAborted();
      const idKey = identityKey(input.identity);
      let foundKey: string | undefined;
      let entry: { draft: WorkDraft; checkpointVersion: number } | undefined;
      for (const [k, v] of drafts) {
        if (v.draft.draftId === input.draftId) {
          foundKey = k;
          entry = v;
          break;
        }
      }
      if (!entry || !foundKey) {
        throw new WorkToolError("ERR_PRISM_WORK_DRAFT", `Draft ${input.draftId} not found`);
      }
      if (entry.draft.identityKey !== idKey) {
        throw new WorkToolError("ERR_PRISM_WORK_IDENTITY", "Draft identity mismatch");
      }
      if (input.expectedConcurrencyToken !== undefined && entry.draft.concurrencyToken !== input.expectedConcurrencyToken) {
        throw new WorkToolError("ERR_PRISM_WORK_DRAFT_CONFLICT", "Draft concurrency token conflict");
      }
      const now = new Date().toISOString();
      const markedDraft: WorkDraft = {
        ...entry.draft,
        status: input.status,
        concurrencyToken: input.concurrencyToken ?? randomUUID(),
        updatedAt: now,
        ...(input.status === "executed" ? { executedAt: now } : {}),
      };
      drafts.set(foundKey, { draft: markedDraft, checkpointVersion: entry.checkpointVersion + 1 });
      return markedDraft;
    },
  };
}

export interface CheckpointWorkDraftStoreOptions {
  readonly checkpoints: CheckpointStore;
  readonly bodies?: ArtifactBodyStore;
  readonly limits?: WorkLimits;
  readonly redactor?: SecretRedactor;
}

export function createCheckpointWorkDraftStore(options: CheckpointWorkDraftStoreOptions): WorkDraftStore {
  const checkpoints = options.checkpoints;
  const limits = resolveWorkLimits(options.limits);
  const mode = "durable" as const;

  async function loadCheckpointEntry(
    identity: AgentIdentity,
    provider: WorkProvider | undefined,
    draftId: string,
    signal?: AbortSignal,
  ): Promise<{ checkpointKey: string; checkpoint: Awaited<ReturnType<CheckpointStore["loadCheckpoint"]>> } | undefined> {
    const ownership = extractOwnership(identity);
    if (provider) {
      const key = draftCheckpointKey(provider, draftId);
      const cp = await checkpoints.loadCheckpoint({
        namespace: WORK_DRAFT_CHECKPOINT_NAMESPACE,
        key,
        ...ownership,
        signal,
      });
      return cp ? { checkpointKey: key, checkpoint: cp } : undefined;
    }
    for (const p of ["microsoft365", "google-workspace"] as const) {
      const key = draftCheckpointKey(p, draftId);
      const cp = await checkpoints.loadCheckpoint({
        namespace: WORK_DRAFT_CHECKPOINT_NAMESPACE,
        key,
        ...ownership,
        signal,
      });
      if (cp) return { checkpointKey: key, checkpoint: cp };
    }
    return undefined;
  }

  return {
    mode,
    async createDraft(input) {
      assertIdentityActive(input.identity);
      input.signal?.throwIfAborted();
      const draftId = input.draftId ?? randomUUID();
      const key = draftCheckpointKey(input.provider, draftId);
      const ownership = extractOwnership(input.identity);
      const now = new Date().toISOString();
      const payloadDigest = computePayloadDigest(input.payload);
      const recipients = extractDraftRecipients(input.payload);

      const payloadJson = JSON.stringify(input.payload);
      if (Buffer.byteLength(payloadJson) > limits.maxRequestBytes) {
        throw new WorkToolError("ERR_PRISM_WORK_LIMIT", "Draft payload exceeds byte limit");
      }

      let bodyRef: ArtifactBodyRef | undefined;
      if (options.bodies) {
        const bodyContent =
          typeof input.payload.bodyContents === "string"
            ? input.payload.bodyContents
            : typeof input.payload.body === "string"
              ? input.payload.body
              : undefined;
        if (bodyContent) {
          const bodyBytes = Buffer.from(bodyContent, "utf8");
          const hash = createHash("sha256").update(bodyBytes).digest("hex");
          bodyRef = {
            ...ownership,
            threadId: `work-draft:${input.provider}`,
            artifactId: draftId,
            version: 1,
            hash,
            mime: "text/plain",
            size: bodyBytes.byteLength,
          };
          await options.bodies.put(bodyRef, bodyBytes);
        }
      }

      const draft: WorkDraft = {
        draftId,
        provider: input.provider,
        op: input.op,
        identityKey: identityKey(input.identity),
        payload: { ...input.payload },
        revision: 1,
        payloadDigest,
        ...(recipients.length > 0 ? { recipients } : {}),
        createdAt: now,
        updatedAt: now,
        status: "pending_approval",
        concurrencyToken: randomUUID(),
        ...(input.policyRevision ? { policyRevision: input.policyRevision } : {}),
        ...(bodyRef ? { bodyRef } : {}),
        mode,
      };

      try {
        await checkpoints.saveCheckpoint({
          namespace: WORK_DRAFT_CHECKPOINT_NAMESPACE,
          key,
          ...ownership,
          version: 1,
          expectedVersion: 0,
          value: draft,
          category: "work_draft",
          signal: input.signal,
        });
      } catch (error) {
        if (error instanceof CheckpointConflictError) {
          throw new WorkToolError("ERR_PRISM_WORK_DRAFT_CONFLICT", `Draft ${draftId} already exists`);
        }
        throw error;
      }
      return draft;
    },

    async getDraft(input) {
      assertIdentityActive(input.identity);
      input.signal?.throwIfAborted();
      const idKey = identityKey(input.identity);
      const entry = await loadCheckpointEntry(input.identity, input.provider, input.draftId, input.signal);
      if (!entry?.checkpoint) return undefined;
      const draft = entry.checkpoint.value as WorkDraft;
      if (draft.identityKey !== idKey) return undefined;
      return draft;
    },

    async updateDraft(input) {
      assertIdentityActive(input.identity);
      input.signal?.throwIfAborted();
      const idKey = identityKey(input.identity);
      const entry = await loadCheckpointEntry(input.identity, undefined, input.draftId, input.signal);
      if (!entry?.checkpoint) {
        throw new WorkToolError("ERR_PRISM_WORK_DRAFT", `Draft ${input.draftId} not found`);
      }
      const currentDraft = entry.checkpoint.value as WorkDraft;
      if (currentDraft.identityKey !== idKey) {
        throw new WorkToolError("ERR_PRISM_WORK_IDENTITY", "Draft identity mismatch");
      }
      if (currentDraft.status === "executed") {
        throw new WorkToolError("ERR_PRISM_WORK_DRAFT_EXECUTED", "Executed draft cannot be modified");
      }
      if (input.expectedRevision !== undefined && currentDraft.revision !== input.expectedRevision) {
        throw new WorkToolError("ERR_PRISM_WORK_DRAFT_CONFLICT", "Draft revision conflict");
      }
      if (input.expectedConcurrencyToken !== undefined && currentDraft.concurrencyToken !== input.expectedConcurrencyToken) {
        throw new WorkToolError("ERR_PRISM_WORK_DRAFT_CONFLICT", "Draft concurrency token conflict");
      }

      const ownership = extractOwnership(input.identity);
      const payloadJson = JSON.stringify(input.payload);
      if (Buffer.byteLength(payloadJson) > limits.maxRequestBytes) {
        throw new WorkToolError("ERR_PRISM_WORK_LIMIT", "Draft payload exceeds byte limit");
      }

      const newRevision = currentDraft.revision + 1;
      let bodyRef: ArtifactBodyRef | undefined;
      if (options.bodies) {
        const bodyContent =
          typeof input.payload.bodyContents === "string"
            ? input.payload.bodyContents
            : typeof input.payload.body === "string"
              ? input.payload.body
              : undefined;
        if (bodyContent) {
          const bodyBytes = Buffer.from(bodyContent, "utf8");
          const hash = createHash("sha256").update(bodyBytes).digest("hex");
          bodyRef = {
            ...ownership,
            threadId: `work-draft:${currentDraft.provider}`,
            artifactId: currentDraft.draftId,
            version: newRevision,
            hash,
            mime: "text/plain",
            size: bodyBytes.byteLength,
          };
          await options.bodies.put(bodyRef, bodyBytes);
        }
      }

      const now = new Date().toISOString();
      const payloadDigest = computePayloadDigest(input.payload);
      const recipients = extractDraftRecipients(input.payload);
      const updatedDraft: WorkDraft = {
        ...currentDraft,
        payload: { ...input.payload },
        revision: newRevision,
        payloadDigest,
        recipients: recipients.length > 0 ? recipients : undefined,
        updatedAt: now,
        status: "pending_approval",
        approval: undefined,
        concurrencyToken: randomUUID(),
        ...(input.policyRevision ? { policyRevision: input.policyRevision } : {}),
        bodyRef,
      };

      try {
        await checkpoints.saveCheckpoint({
          namespace: WORK_DRAFT_CHECKPOINT_NAMESPACE,
          key: entry.checkpointKey,
          ...ownership,
          version: entry.checkpoint.version + 1,
          expectedVersion: entry.checkpoint.version,
          value: updatedDraft,
          category: "work_draft",
          signal: input.signal,
        });
      } catch (error) {
        if (error instanceof CheckpointConflictError) {
          throw new WorkToolError("ERR_PRISM_WORK_DRAFT_CONFLICT", "Concurrent draft modification");
        }
        throw error;
      }
      return updatedDraft;
    },

    async approveDraft(input) {
      assertIdentityActive(input.identity);
      input.signal?.throwIfAborted();
      const idKey = identityKey(input.identity);
      const entry = await loadCheckpointEntry(input.identity, undefined, input.draftId, input.signal);
      if (!entry?.checkpoint) {
        throw new WorkToolError("ERR_PRISM_WORK_DRAFT", `Draft ${input.draftId} not found`);
      }
      const currentDraft = entry.checkpoint.value as WorkDraft;
      if (currentDraft.identityKey !== idKey) {
        throw new WorkToolError("ERR_PRISM_WORK_IDENTITY", "Draft identity mismatch");
      }
      if (currentDraft.status === "executed") {
        throw new WorkToolError("ERR_PRISM_WORK_DRAFT_EXECUTED", "Draft already executed");
      }
      if (currentDraft.status === "rejected") {
        throw new WorkToolError("ERR_PRISM_WORK_DRAFT_REJECTED", "Draft was rejected");
      }
      if (input.expectedConcurrencyToken !== undefined && currentDraft.concurrencyToken !== input.expectedConcurrencyToken) {
        throw new WorkToolError("ERR_PRISM_WORK_DRAFT_CONFLICT", "Draft concurrency token conflict");
      }
      validateApproval(currentDraft, input.approval);
      if (
        currentDraft.status === "approved" &&
        currentDraft.approval &&
        currentDraft.approval.revision === input.approval.revision &&
        currentDraft.approval.payloadDigest === input.approval.payloadDigest
      ) {
        return currentDraft;
      }

      const ownership = extractOwnership(input.identity);
      const now = new Date().toISOString();
      const approvedDraft: WorkDraft = {
        ...currentDraft,
        status: "approved",
        approval: {
          ...input.approval,
          approvedAt: input.approval.approvedAt ?? now,
        },
        updatedAt: now,
        concurrencyToken: randomUUID(),
      };

      try {
        await checkpoints.saveCheckpoint({
          namespace: WORK_DRAFT_CHECKPOINT_NAMESPACE,
          key: entry.checkpointKey,
          ...ownership,
          version: entry.checkpoint.version + 1,
          expectedVersion: entry.checkpoint.version,
          value: approvedDraft,
          category: "work_draft",
          signal: input.signal,
        });
      } catch (error) {
        if (error instanceof CheckpointConflictError) {
          throw new WorkToolError("ERR_PRISM_WORK_DRAFT_CONFLICT", "Concurrent draft modification");
        }
        throw error;
      }
      return approvedDraft;
    },

    async markDraft(input) {
      assertIdentityActive(input.identity);
      input.signal?.throwIfAborted();
      const idKey = identityKey(input.identity);
      const entry = await loadCheckpointEntry(input.identity, undefined, input.draftId, input.signal);
      if (!entry?.checkpoint) {
        throw new WorkToolError("ERR_PRISM_WORK_DRAFT", `Draft ${input.draftId} not found`);
      }
      const currentDraft = entry.checkpoint.value as WorkDraft;
      if (currentDraft.identityKey !== idKey) {
        throw new WorkToolError("ERR_PRISM_WORK_IDENTITY", "Draft identity mismatch");
      }
      if (input.expectedConcurrencyToken !== undefined && currentDraft.concurrencyToken !== input.expectedConcurrencyToken) {
        throw new WorkToolError("ERR_PRISM_WORK_DRAFT_CONFLICT", "Draft concurrency token conflict");
      }

      const ownership = extractOwnership(input.identity);
      const now = new Date().toISOString();
      const markedDraft: WorkDraft = {
        ...currentDraft,
        status: input.status,
        concurrencyToken: input.concurrencyToken ?? randomUUID(),
        updatedAt: now,
        ...(input.status === "executed" ? { executedAt: now } : {}),
      };

      try {
        await checkpoints.saveCheckpoint({
          namespace: WORK_DRAFT_CHECKPOINT_NAMESPACE,
          key: entry.checkpointKey,
          ...ownership,
          version: entry.checkpoint.version + 1,
          expectedVersion: entry.checkpoint.version,
          value: markedDraft,
          category: "work_draft",
          signal: input.signal,
        });
      } catch (error) {
        if (error instanceof CheckpointConflictError) {
          throw new WorkToolError("ERR_PRISM_WORK_DRAFT_CONFLICT", "Concurrent draft modification");
        }
        throw error;
      }
      return markedDraft;
    },
  };
}
