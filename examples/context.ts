import { resolveContextProviders } from "@arnilo/prism";
import type { ContextProvider, Message } from "@arnilo/prism";

// Ordered context provider pipeline: each provider contributes context blocks
// resolved in order. Host-owned — providers cannot grant tools or permissions.
export async function demo() {
  const clock: ContextProvider = {
    name: "clock",
    resolve: () => [{ content: `UTC: ${new Date(0).toISOString()}` }],
  };
  const notes: ContextProvider = {
    name: "notes",
    resolve: () => [{ content: "Project notes placeholder." }],
  };

  const messages: Message[] = [{ role: "user", content: [{ type: "text", text: "Hi" }] }];
  const blocks = await resolveContextProviders({ messages, providers: [clock, notes] });

  return { count: blocks.length, contents: blocks.map((b) => b.content) };
}
