import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentEvent } from "@arnilo/prism";
import { createScriptedHostUi, mockProvider } from "@arnilo/prism/testing";
import { createCodingWorker, type HostConfig } from "../host/index.js";
import { writeScript } from "./fixtures/scripts.js";

export async function approvalGatesCoding(config: HostConfig, allow: boolean): Promise<{ fileExists: boolean; denied: boolean }> {
  const ui = createScriptedHostUi({ confirm: allow, select: "once" });
  const agent = await createCodingWorker(config, {
    host: { ui: ui.ui },
    packages: [mockProvider(writeScript("note.txt", "approved"))],
  });
  const events: AgentEvent[] = [];
  try {
    const session = await agent.session({ create: true });
    const pump = (async () => {
      for await (const event of session.subscribe()) events.push(event);
    })();
    await session.run("write the note");
    await pump;
    const messages = JSON.stringify(await session.messages());
    const denied =
      messages.includes("hook_denied") ||
      events.some(
        (event) =>
          (event.type === "decision.resolved" && event.decisions.some((decision) => decision.outcome === "deny")) ||
          (event.type === "tool.completed" && event.status === "blocked" && /denied/i.test(event.reason ?? event.error?.message ?? "")),
      );
    return { fileExists: existsSync(join(config.workspace, "note.txt")), denied };
  } finally {
    await agent.dispose();
  }
}
