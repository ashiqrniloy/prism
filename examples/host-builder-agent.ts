/**
 * A Prism agent as the builder of a host: it works on a host project the way a coding agent does, using the
 * `prism-host-builder` kit (plan 215 Task 19).
 *
 * 1. `prism-host-builder install --target prism` copies the skill into the project's `.agents/skills`.
 * 2. `contextFiles` discovers that skill, `tools-coding` is rooted in the project, and `@arnilo/prism-mcp`
 *    connects `prism-host-builder mcp` over stdio. The host starts the server; no model output chooses its
 *    command, root or check targets.
 * 3. A scripted turn loads the skill, looks up `createAgent` with `prism_api`, and runs the host's
 *    factory with `prism_inspect_host`.
 *
 * Mock provider, no credential, no network. Spawns one MCP server and, for the inspection, one check child.
 * Run: timeout 180 bun examples/host-builder-agent.ts
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type AgentEvent, createAgent } from "@arnilo/prism";
import { mockProvider, providerDone, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism/testing";
import { contextFiles } from "@arnilo/prism-context-files";
import { mcp } from "@arnilo/prism-mcp";
import { toolsCoding } from "@arnilo/prism-tools-coding";

const SKILL = "prism-host-builder";
const SERVER_ID = "host-builder";
const FACTORY = `import { createAgent } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";

export async function createInspectionAgent() {
  return createAgent({ model: { provider: "mock", model: "demo" }, packages: [mockProvider()] });
}
`;

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// `bin/prism-host-builder.ts` is what `bunx prism-host-builder` runs; the example calls it through the package.
const binEntry = fileURLToPath(
  new URL("../bin/prism-host-builder.ts", pathToFileURL(createRequire(import.meta.url).resolve("@arnilo/prism-host-builder"))),
);

/** The text a finished tool call returned (a blocked call returns its reason). */
function textOf(event: AgentEvent): string {
  if (event.type !== "tool.completed") return "";
  const content = (event.result as { content?: Array<{ type: string; text?: string }> } | undefined)?.content;
  return content?.map((block) => block.text ?? "").join("") ?? event.reason ?? "";
}

export async function demo(): Promise<Record<string, unknown>> {
  const root = await mkdtemp(join(tmpdir(), "prism-host-builder-agent-"));
  try {
    // The host project the builder works on: a factory to inspect, and the kernel installed under node_modules
    // (a symlink to this repository, where a real project has `bun add @arnilo/prism`).
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "node_modules", "@arnilo"), { recursive: true });
    await symlink(repo, join(root, "node_modules", "@arnilo", "prism"), "dir");
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "demo-host", private: true, type: "module" }));
    await writeFile(join(root, "src", "agent.ts"), FACTORY);

    // 1. Install the skill the way a user would. `--target prism` copies it into `.agents/skills`.
    const install = spawnSync(process.execPath, [binEntry, "install", "--target", "prism", "--root", root], { encoding: "utf8" });
    assert.equal(install.status, 0, `install exited ${install.status}\n${install.stderr}`);

    // 2. The builder: coding tools in the project, skill discovery, and the MCP server over stdio.
    const agent = await createAgent({
      id: "host-builder-agent",
      model: { provider: "mock", model: "demo" },
      ownership: { tenantId: "local" },
      principal: { kind: "user", id: "local" },
      packages: [
        mockProvider([
          [providerToolCall(toolCallContent("call-1", "load_skill", { name: SKILL })), providerDone()],
          [providerToolCall(toolCallContent("call-2", `mcp:${SERVER_ID}:prism_api`, { symbol: "createAgent" })), providerDone()],
          [
            providerToolCall(
              toolCallContent("call-3", `mcp:${SERVER_ID}:prism_inspect_host`, { entry: "src/agent.ts#createInspectionAgent" }),
            ),
            providerDone(),
          ],
          [providerTextDelta("Looked up createAgent and inspected the host: it lists the mock provider only."), providerDone()],
        ]),
        toolsCoding({ root }),
        contextFiles({ root }),
        mcp({
          servers: [
            {
              id: SERVER_ID,
              transport: "stdio",
              command: process.execPath,
              args: [binEntry, "mcp", "--root", root, "--entry", "src/agent.ts#createInspectionAgent"],
              allow: "stdio",
              connectTimeoutMs: 30_000,
            },
          ],
        }),
      ],
    });

    try {
      const skillFound = agent.skills.some((skill) => skill.name === SKILL);
      const toolNames = agent.tools.map((tool) => tool.name);
      const session = await agent.session();
      const events: AgentEvent[] = [];
      for await (const event of session.stream("Look up createAgent, then inspect this host.")) events.push(event);
      await session.close();

      const results = new Map<string, string>();
      for (const event of events) {
        if (event.type === "tool.completed") results.set(event.result?.name ?? "", textOf(event));
      }
      const loaded = results.get("load_skill") ?? "";
      const api = results.get(`mcp:${SERVER_ID}:prism_api`) ?? "";
      const inspected = results.get(`mcp:${SERVER_ID}:prism_inspect_host`) ?? "";

      assert.ok(skillFound, "contextFiles did not discover the installed skill");
      assert.ok(
        toolNames.includes("read") && toolNames.includes(`mcp:${SERVER_ID}:prism_api`),
        "tools-coding or the MCP tools are missing",
      );
      assert.ok(loaded.includes("Building a Prism host"), `load_skill did not return the skill: ${loaded.slice(0, 200)}`);
      const apiResult = JSON.parse(api) as { found: boolean; matches: Array<{ package: string; name: string; signature?: string }> };
      const inspection = JSON.parse(inspected) as { ok: boolean; result?: { packages: Array<{ name: string }> } };
      assert.ok(apiResult.found && apiResult.matches.some((match) => match.name === "createAgent"), `prism_api did not find createAgent`);
      assert.ok(inspection.ok, `prism_inspect_host failed: ${inspected.slice(0, 200)}`);

      return {
        skillDiscovered: skillFound,
        mcpTools: toolNames.filter((name) => name.startsWith(`mcp:${SERVER_ID}:`)).sort(),
        skillLoaded: true,
        createAgent: apiResult.matches.map((match) => `${match.package}: ${match.signature ?? match.name}`.slice(0, 120)),
        inspectedPackages: inspection.result?.packages.map((entry) => entry.name),
      };
    } finally {
      await agent.dispose();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function main(): Promise<void> {
  console.log(JSON.stringify(await demo(), null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
