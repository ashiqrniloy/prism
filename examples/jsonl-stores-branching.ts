import {
  createMemorySessionStore,
  createSessionEntry,
  rebuildSessionContext,
  getSessionBranchEntries,
  listSessionBranches,
} from "@arnilo/prism";
import { createJsonlSessionStore } from "@arnilo/prism/node/session-store-jsonl";
import { tmpdir } from "node:os";
import { join } from "node:path";

// In-memory store + branching; JSONL persistence via the Node subpath.
// Stores receive no provider credentials. Branching preserves old paths.
export async function demo() {
  const store = createMemorySessionStore();
  const sessionId = "s1";

  const root = createSessionEntry({ sessionId, kind: "message", parentId: undefined, message: { role: "user", content: [{ type: "text", text: "Hi" }] } });
  const leaf = createSessionEntry({ sessionId, kind: "message", parentId: root.id, message: { role: "assistant", content: [{ type: "text", text: "Hello" }] } });

  await store.append(root);
  await store.append(leaf);

  const entries = await store.list(sessionId);
  const branches = listSessionBranches(entries);
  const snapshot = rebuildSessionContext(entries);

  // JSONL persistence (caller-named file, host-controlled).
  const jsonl = createJsonlSessionStore({ path: join(tmpdir(), `prism-demo-${Date.now()}.jsonl`) });
  await jsonl.append(root);

  return {
    branchCount: branches.length,
    leafId: snapshot.leafId,
    branchEntryCount: getSessionBranchEntries(entries).length,
    jsonlRootId: (await jsonl.list(sessionId))[0]?.id,
  };
}
