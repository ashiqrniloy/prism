import {
  createObservationalMemoryExtension,
  createMemoryStatusCommand,
  createMemoryViewCommand,
  createRecallMemoryTool,
  recallObservationalMemory,
} from "@arnilo/prism-compaction-observational-memory";
import { createExtensionKernel } from "@arnilo/prism";

// Observational memory: extension + recall tool + status/view commands.
// Compaction renders prepared memory (no model call during compaction). Recall
// returns exact source evidence for a known 12-hex id; fails closed otherwise.
export async function demo() {
  const getEntries = async (_sessionId: string) => [];

  const tool = createRecallMemoryTool({ getEntries });
  const status = createMemoryStatusCommand({ getEntries });
  const view = createMemoryViewCommand({ getEntries });
  const ext = createObservationalMemoryExtension({
    registerCompactionStrategy: false,
    recallTool: { getEntries },
    commands: { getEntries },
  });

  const kernel = createExtensionKernel();
  await kernel.load([ext]);

  // Recall on an empty branch fails closed for an invalid id.
  const result = recallObservationalMemory([], "not-a-valid-id");

  return {
    toolName: tool.name,
    statusCommand: status.name,
    viewCommand: view.name,
    found: result.found,
    reason: result.reason,
  };
}

// Runnable end-to-end demo: `node examples/observational-memory-recall-status-view.ts`
// (Node 24 strips types natively). No network, no real credentials.
export async function main() {
  const result = await demo();
  console.log(JSON.stringify(result));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
