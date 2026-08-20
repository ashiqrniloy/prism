import {
  type AntigravityConversationBinding,
  AntigravityConversationError,
  type AntigravityConversationStore,
  MAX_CONVERSATION_ID_BYTES,
} from "./types.js";

export function validateConversationId(conversationId: unknown): string {
  if (typeof conversationId !== "string" || !conversationId.trim()) {
    throw new AntigravityConversationError("Antigravity conversation ID must be a non-empty string");
  }
  const trimmed = conversationId.trim();
  if (/[\0\r\n]/.test(trimmed)) {
    throw new AntigravityConversationError("Antigravity conversation ID contains forbidden control characters");
  }
  if (Buffer.byteLength(trimmed, "utf8") > MAX_CONVERSATION_ID_BYTES) {
    throw new AntigravityConversationError(`Antigravity conversation ID exceeds ${MAX_CONVERSATION_ID_BYTES} bytes`);
  }
  return trimmed;
}

function makeKey(sessionId: string, branchId?: string): string {
  return `${sessionId}::${branchId ?? "main"}`;
}

export function createAntigravityConversationStore(): AntigravityConversationStore {
  const store = new Map<string, AntigravityConversationBinding>();
  const idToKey = new Map<string, string>();

  return {
    get(sessionId: string, branchId?: string): string | undefined {
      if (!sessionId) return undefined;
      const key = makeKey(sessionId, branchId);
      return store.get(key)?.conversationId;
    },

    set(sessionId: string, conversationId: string, branchId?: string): void {
      if (!sessionId) {
        throw new AntigravityConversationError("Cannot bind conversation ID without sessionId");
      }
      const validatedId = validateConversationId(conversationId);
      const key = makeKey(sessionId, branchId);

      // Verify that if this conversationId was already registered under a DIFFERENT session/branch,
      // it is not hijacked or collided
      const existingOwnerKey = idToKey.get(validatedId);
      if (existingOwnerKey !== undefined && existingOwnerKey !== key) {
        throw new AntigravityConversationError(
          `Conversation ID '${validatedId}' is already bound to another session/branch: ${existingOwnerKey}`,
        );
      }

      const existing = store.get(key);
      const now = new Date().toISOString();

      const binding: AntigravityConversationBinding = {
        sessionId,
        branchId,
        conversationId: validatedId,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      store.set(key, binding);
      idToKey.set(validatedId, key);
    },

    clear(sessionId: string, branchId?: string): void {
      if (!sessionId) return;
      const key = makeKey(sessionId, branchId);
      const existing = store.get(key);
      if (existing) {
        idToKey.delete(existing.conversationId);
        store.delete(key);
      }
    },

    has(sessionId: string, branchId?: string): boolean {
      if (!sessionId) return false;
      const key = makeKey(sessionId, branchId);
      return store.has(key);
    },

    entries(): readonly AntigravityConversationBinding[] {
      return Array.from(store.values());
    },
  };
}

export function assertConversationContinuation(
  store: AntigravityConversationStore,
  sessionId: string,
  requestedConversationId: string,
  branchId?: string,
): string {
  const validated = validateConversationId(requestedConversationId);
  const stored = store.get(sessionId, branchId);
  if (stored !== undefined && stored !== validated) {
    throw new AntigravityConversationError(
      `Session '${sessionId}' has bound conversation '${stored}', but requested continuation with '${validated}'`,
    );
  }
  return validated;
}
