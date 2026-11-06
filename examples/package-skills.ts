import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgent, type ProviderRequest } from "@arnilo/prism";
import { mockProvider, providerDone, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism/testing";
import { toolsCoding } from "@arnilo/prism-tools-coding";
import { toolsWeb } from "@arnilo/prism-tools-web";

/**
 * Package skills and availability, offline on the mock provider.
 * - `@arnilo/prism-tools-web` ships `web-research`; it declares `requiresTools: ["web_search", "web_fetch"]`, so the
 *   catalog lists it only while both tools reach the model. `agent.inspect().skills` shows `package` and `requiresTools`.
 * - A run with `tools: { only: ["read"] }` narrows the tools: `web-research` leaves the catalog, and a scripted
 *   `load_skill("web-research")` returns `skill_unavailable` instead of the body.
 * - The same agent without the narrowing lists the skill. A host writes its own product rules as `skills.dirs`;
 *   package skills only cover how to use a module.
 * Imports only public package entry points and `@arnilo/prism/testing`; no credential, no network.
 * Run: timeout 120 bun examples/package-skills.ts
 */

const MODEL = { provider: "mock", model: "demo" } as const;

function catalogOf(request: ProviderRequest, names: ReadonlySet<string>): string[] {
  const text = request.messages
    .flatMap((message) => message.content)
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n");
  return [...text.matchAll(/^- ([a-z0-9-]+): /gm)].map((match) => match[1] as string)
    .filter((name) => names.has(name));
}

export async function demo(): Promise<Record<string, unknown>> {
  const root = await mkdtemp(join(tmpdir(), "prism-package-skills-"));
  try {
    const requests: ProviderRequest[] = [];
    const load = toolCallContent("call-1", "load_skill", { name: "web-research" });
    const agent = await createAgent({
      id: "package-skills",
      model: MODEL,
      ownership: { tenantId: "local" },
      principal: { kind: "user", id: "local" },
      packages: [
        mockProvider(
          [
            [providerTextDelta("Full tools."), providerDone()],
            [providerToolCall(load), providerDone()],
            [providerTextDelta("Narrowed."), providerDone()],
          ],
          { id: "mock", onRequest: (request) => requests.push(request) },
        ),
        // `searxng` registers `web_search` and `web_fetch` with no key and no request at setup.
        toolsWeb({ backend: "searxng", searxng: { origin: "http://127.0.0.1:8080", allowLoopback: true } }),
        toolsCoding({ root }),
      ],
    });

    const skills = agent.inspect().skills.map((skill) => ({
      name: skill.name,
      package: skill.package,
      requiresTools: skill.requiresTools,
    }));
    const names = new Set(skills.map((skill) => skill.name));

    const session = await agent.session();
    // 1. Every tool reaches the model: the catalog lists `web-research`.
    await session.run("What skills do you have?");
    // 2. Only `read` reaches the model: the catalog drops it, and `load_skill` refuses the name.
    const events = [];
    for await (const event of session.stream("Load web-research.", { tools: { only: ["read"] } })) events.push(event);
    await session.close();
    await agent.dispose();

    const loadResult = events.find((event) => event.type === "tool.completed" && event.name === "load_skill");
    return {
      skills: skills.filter((skill) => skill.name === "web-research"),
      fullCatalog: catalogOf(requests[0] as ProviderRequest, names),
      narrowedCatalog: catalogOf(requests[1] as ProviderRequest, names),
      loadSkill: loadResult === undefined ? null : JSON.stringify(loadResult).includes("skill_unavailable") ? "skill_unavailable" : "loaded",
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
