import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgent } from "@arnilo/prism";
import { mockProvider, providerDone, providerTextDelta } from "@arnilo/prism/testing";
import { toolsCoding } from "@arnilo/prism-tools/coding";
import { toolsWeb } from "@arnilo/prism-tools/web";

/**
 * Two halves of the same story, both offline.
 *
 * 1. A `toolsWeb` package whose key ref does not resolve registers nothing and writes a `warn`
 *    status note — the whole point of a ref-only key. `agent.inspect().statusNotes` names the
 *    missing ref, no `web_*` tool is registered, and the run still completes on the coding tools.
 *    The literal is never in the config, so the note can only echo the ref.
 * 2. `toolsWeb({ backend: "native" })` is the keyless case: `web_fetch` (DNS-pinned fetch plus
 *    Markdown conversion) registers with no credential and no status note, and registering makes no
 *    network request. A fetch is only attempted when the model calls the tool.
 *
 * Imports only public package entry points and `@arnilo/prism/testing`; no credential, no network.
 * Run: npm run build:core && node examples/web-no-key.ts
 */

const MODEL = { provider: "mock", model: "demo" } as const;

export async function demo(): Promise<Record<string, unknown>> {
  const root = await mkdtemp(join(tmpdir(), "prism-web-no-key-"));
  try {
    const agent = await createAgent({
      id: "web-no-key",
      model: MODEL,
      packages: [
        mockProvider([[providerTextDelta("No web tools; I'll answer from what I have."), providerDone()]]),
        toolsWeb({ backend: "brave", apiKey: "env:PRISM_EXAMPLE_UNSET_KEY" }),
        toolsCoding({ root }),
      ],
    });

    const inspection = agent.inspect();
    const webNote = inspection.statusNotes.find((note) => note.package === "@arnilo/prism-tools/web");
    const webTools = inspection.tools.filter((tool) => tool.name.startsWith("web_"));

    const session = await agent.session();
    const result = await session.run("Summarize the repo.");

    const native = await createAgent({
      id: "web-native",
      model: MODEL,
      packages: [
        mockProvider([[providerTextDelta("I can read a page without any key."), providerDone()]]),
        toolsWeb({ backend: "native" }),
      ],
    });
    let nativeTools: string[];
    let nativeNotes: string[];
    try {
      const nativeInspection = native.inspect();
      nativeTools = nativeInspection.tools.filter((tool) => tool.name.startsWith("web_")).map((tool) => tool.name);
      nativeNotes = nativeInspection.statusNotes.filter((note) => note.package === "@arnilo/prism-tools/web").map((note) => note.message);
    } finally {
      await native.dispose();
    }

    return {
      note: webNote?.message,
      level: webNote?.level,
      webTools: webTools.map((tool) => tool.name),
      codingToolsRegistered: inspection.tools.some((tool) => tool.package === "@arnilo/prism-tools/coding"),
      status: result.status,
      reply: (await session.messages()).at(-1)?.content,
      nativeTools,
      nativeNotes,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function main() {
  console.log(JSON.stringify(await demo(), null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
