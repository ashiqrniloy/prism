import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  type ModelProvider,
  createAgent,
  providerDone,
  providerTextDelta,
  providerToolCallDelta,
  type ToolDefinition,
} from "@arnilo/prism";
import { hookCommandHash, hooksJson } from "@arnilo/prism-extensions/hooks-json";
import { providerPackage } from "@arnilo/prism/provider-kit";

// hooks.json package: config is the file. SessionStart is session.opened. PreToolUse is tool.call.
// The handler is a local fixture spawned with an argv array. The allow-list is a hash pin.

const fixture = fileURLToPath(new URL("./hooks-audit-command.mjs", import.meta.url));
const handler = { type: "command" as const, command: `node ${fixture}`, timeout: 10 };
const config = {
  SessionStart: [{ hooks: [handler] }],
  PreToolUse: [{ matcher: "write", hooks: [handler] }],
  Stop: [{ hooks: [handler] }],
  allowCommands: { [handler.command]: hookCommandHash(handler) },
};

const written: string[] = [];
const write: ToolDefinition = {
  name: "write",
  parameters: {
    type: "object",
    properties: { path: { type: "string" }, text: { type: "string" } },
    required: ["path"],
  },
  execute(args, context) {
    written.push(String(args.path));
    return { toolCallId: context.toolCallId, name: "write", value: `wrote ${String(args.path)}` };
  },
};

let turn = 0;
const requests: unknown[] = [];
const provider: ModelProvider = {
  id: "mock",
  async *generate(request) {
    requests.push(request);
    turn += 1;
    if (turn === 1) {
      yield providerToolCallDelta({ index: 0, id: "call_notes", name: "write", argumentsText: '{"path":"notes.md","text":"hi"}' });
    } else if (turn === 2) {
      yield providerToolCallDelta({ index: 0, id: "call_env", name: "write", argumentsText: '{"path":".env","text":"secret"}' });
    } else {
      yield providerTextDelta("audit complete");
    }
    yield providerDone();
  },
};

const agent = await createAgent({
  model: { provider: "mock", model: "demo" },
  tools: { add: [write] },
  packages: [
    hooksJson({ config, onWarning: (warning) => console.log(`warning: ${warning.code} ${warning.message}`) }),
    providerPackage("test-provider", [provider]),
  ],
});

const session = await agent.session({ id: "hooks-json-example", create: true });
const result = await session.run("Record the notes, then the environment file.");

console.log(
  JSON.stringify(
    {
      status: result.status,
      written,
      envBlocked: written.includes(".env") === false,
      sessionStartContextInjected: JSON.stringify(requests).includes("Audit trail: every write is logged."),
      seams: {
        // Every hooks.json event now arrives as one hook registration on the agent's bus.
        hooks: Object.keys(agent.inspect().hooks),
        fixtureReadable: readFileSync(fixture, "utf8").length > 0,
      },
    },
    null,
    0,
  ),
);
