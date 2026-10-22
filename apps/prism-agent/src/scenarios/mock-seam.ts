import type { PackageInstance } from "@arnilo/prism";
import { mockProvider, providerDone, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism/testing";

/** Scripts a fresh process can load. The bin reads `PRISM_AGENT_MOCK` and never puts this on the command line. */
export function mockPackages(kind: string): readonly PackageInstance[] {
  if (kind === "write-suspend") {
    return [mockProvider([[providerToolCall(toolCallContent("w1", "write", { path: "note.txt", content: "approved" })), providerDone()]])];
  }
  if (kind === "write-resume") return [mockProvider([[providerTextDelta("done"), providerDone()]])];
  if (kind === "text") return [mockProvider([[providerTextDelta("ok"), providerDone()]])];
  // Scheduled firings: one reply per tick, enough for every tick a scenario drives.
  if (kind === "schedule-text") {
    return [mockProvider(Array.from({ length: 16 }, () => [providerTextDelta("daily brief"), providerDone()]))];
  }
  if (kind === "fail") return [mockProvider([[{ type: "error", error: { message: "provider failed" } }]])];
  if (kind === "cite-fail") return [mockProvider([[providerTextDelta("[[cite:S9]]"), providerDone()]])];
  // The remote worker's own agent: gate `save`, then answer once the host approved it.
  if (kind === "remote-approve") {
    return [
      mockProvider([
        [providerToolCall(toolCallContent("r1", "save", {})), providerDone()],
        [providerTextDelta("Remote approved report"), providerDone()],
      ]),
    ];
  }
  return [];
}
