import type { AgentSession, SessionEntry } from "@arnilo/prism";
import { createSessionEntry } from "@arnilo/prism";

export interface ObservationalMemoryAppendOptions {
  readonly expectedParentId?: string;
}

export interface CustomEntryAppendOptions {
  readonly session: AgentSession;
  readonly appendEntry: (entry: SessionEntry, options?: ObservationalMemoryAppendOptions) => Promise<void>;
}

export async function appendCustomEntry(options: CustomEntryAppendOptions, data: unknown): Promise<void> {
  const previousLeafId = options.session.leafId;
  const entry = createSessionEntry({ sessionId: options.session.id, parentId: previousLeafId, kind: "custom", data });
  await options.appendEntry(entry, { expectedParentId: previousLeafId });
  try {
    await options.session.checkout(entry.id);
    if ((await options.session.entries()).at(-1)?.id === entry.id) return;
  } catch {
    // Fall through to the ownership error below.
  }
  await options.session.checkout(previousLeafId);
  throw new Error("Observational memory appendEntry did not append to the owning session branch");
}
