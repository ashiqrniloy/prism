import { resolveContextProviders } from "@arnilo/prism";
// Ordered context provider pipeline: each provider contributes context blocks
// resolved in order. Host-owned — providers cannot grant tools or permissions.
export async function demo() {
    const clock = {
        name: "clock",
        resolve: () => [{ content: `UTC: ${new Date(0).toISOString()}` }],
    };
    const notes = {
        name: "notes",
        resolve: () => [{ content: "Project notes placeholder." }],
    };
    const messages = [{ role: "user", content: [{ type: "text", text: "Hi" }] }];
    const blocks = await resolveContextProviders({ messages, providers: [clock, notes] });
    return { count: blocks.length, contents: blocks.map((b) => b.content) };
}
