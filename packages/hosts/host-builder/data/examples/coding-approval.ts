import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgent } from "@arnilo/prism";
import {
  createScriptedHostUi,
  mockProvider,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism/testing";
import { approvalPackage } from "@arnilo/prism-approval";
import { contextFiles, readContextFileLayers } from "@arnilo/prism-context-files";
import { toolsCoding } from "@arnilo/prism-tools-coding";

/**
 * Phase 7 Part A on one agent, on the mock provider and a temp workspace:
 * - `@arnilo/prism-tools-coding` provides the file tools plus the hard deny that keeps paths inside `root`;
 * - `@arnilo/prism-approval` in `ask` mode gates the `edit` call: the scripted `HostUi` answers the
 *   `confirm` and the follow-up `select` (`once`), and the file changes;
 * - `@arnilo/prism-context-files` layers `SYSTEM.md` and `AGENTS.md` from the same `root`.
 * The second agent sets `disable: { tools: ["shell"] }`: `shell` is gone from the tool list and a
 * scripted call to it is blocked as an unknown tool without starting.
 * Imports only public package entry points and `@arnilo/prism/testing`; no credential, no network.
 * Run: npm run build:core && node examples/coding-approval.ts
 */

const MODEL = { provider: "mock", model: "demo" } as const;
const NOTE = "note.txt";
const EDIT_CALL = toolCallContent("call-1", "edit", {
  path: NOTE,
  edits: [{ oldText: "before", newText: "after" }],
});

export async function demo(): Promise<Record<string, unknown>> {
  const root = await mkdtemp(join(tmpdir(), "prism-coding-approval-"));
  const started = Date.now();
  try {
    await writeFile(join(root, "SYSTEM.md"), "Answer with the file contents you were asked for.\n");
    await writeFile(join(root, "AGENTS.md"), "Edit files in place, never outside the workspace.\n");
    await writeFile(join(root, NOTE), "before\n");
    const layers = await readContextFileLayers({
      workspaceRoot: root,
      systemMdPath: join(root, "SYSTEM.md"),
      agentsMdPaths: [join(root, "AGENTS.md")],
    });

    // 1. `ask` mode: the edit asks, the scripted host answers, the file changes.
    const gate = createScriptedHostUi({ confirm: true, select: "once" });
    const approved = await createAgent({
      id: "coding-approval",
      model: MODEL,
      ownership: { tenantId: "local" },
      principal: { kind: "user", id: "local" },
      host: { ui: gate.ui },
      packages: [
        mockProvider([
          [providerToolCall(EDIT_CALL), providerDone()],
          [providerTextDelta("Edited note.txt."), providerDone()],
        ]),
        toolsCoding({ root }),
        approvalPackage({ mode: "ask" }),
        contextFiles({ root }),
      ],
    });
    const session = await approved.session();
    const approvedRun = await session.run("Rewrite note.txt");
    const approvedFile = (await readFile(join(root, NOTE), "utf8")).trim();
    await session.close();
    await approved.dispose();

    // 2. `disable.tools` removes the shell before dispatch: the provider never sees it, and a call is blocked.
    const disabled = await createAgent({
      id: "coding-approval-disabled",
      model: MODEL,
      ownership: { tenantId: "local" },
      principal: { kind: "user", id: "local" },
      disable: { tools: ["shell"] },
      packages: [
        mockProvider([[providerToolCall(toolCallContent("call-2", "shell", { command: "echo hi" })), providerDone()], [providerDone()]], {
          id: "mock",
        }),
        toolsCoding({ root }),
      ],
    });
    const toolNames = disabled.tools.map((tool) => tool.name);
    const disabledSession = await disabled.session();
    const events = [];
    for await (const event of disabledSession.stream("echo hi")) events.push(event);
    await disabledSession.close();
    await disabled.dispose();
    const blocked = events.find((event) => event.type === "tool.completed" && event.status === "blocked");

    return {
      approved: {
        status: approvedRun.status,
        file: approvedFile,
        confirmRequests: gate.requestsOf("confirm").length,
        selectRequests: gate.requestsOf("select").length,
        layers: layers.map((layer) => layer.id),
      },
      disabled: {
        shellInTools: toolNames.includes("shell"),
        shellBlocked: blocked?.type === "tool.completed" ? blocked.reason : null,
        started: events.some((event) => event.type === "tool.started"),
      },
      elapsedMs: Date.now() - started,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
