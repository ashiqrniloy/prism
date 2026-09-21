import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  type AIProvider,
  activateKernel,
  createAgent,
  createExtensionKernel,
  providerDone,
  providerTextDelta,
  providerToolCallDelta,
  type ToolDefinition,
} from "@arnilo/prism";
import { createHooksExtension, hookCommandHash, parseHooksConfig } from "@arnilo/prism-hooks";

// hooks.json adapter: a host loads a Claude/Codex-shaped hooks config and gets an
// Extension back. The package compiles the declarative events onto public seams —
// `session_start` middleware (SessionStart), the `input` guardrail + instruction
// injector (UserPromptSubmit), `tool_call` middleware + `tool_input` guardrail
// (PreToolUse), `tool_result` middleware + `tool_output` guardrail (PostToolUse),
// and a registered stop hook (Stop). Guardrails and stop hooks stay inert until
// the host activates them, exactly like every other kernel contribution.
//
// The handler here is a local fixture script (`hooks-audit-command.mjs`) spawned
// with an argv array — no shell, no network, no credentials. Trust is an
// explicit hash allowlist; `trusted: "all"` is the escape hatch and logs loudly.

const fixture = fileURLToPath(new URL("./hooks-audit-command.mjs", import.meta.url));
const config = parseHooksConfig(`
{
  "SessionStart": [
    { "hooks": [{ "type": "command", "command": "node ${fixture}", "timeout": 10 }] }
  ],
  "PreToolUse": [
    { "matcher": "write", "hooks": [{ "type": "command", "command": "node ${fixture}", "timeout": 10 }] }
  ],
  "Stop": [
    { "hooks": [{ "type": "command", "command": "node ${fixture}", "timeout": 10 }] }
  ]
}
`);

if (config.events.PreToolUse?.[0]?.matcher !== "write") throw new Error("hooks config did not parse");
if (config.additionalContextLimit !== 2500) throw new Error("default additionalContextLimit changed");

const handler = { type: "command", command: `node ${fixture}`, timeout: 10 } as const;
const hooks = createHooksExtension(config, {
  trusted: { [handler.command]: hookCommandHash(handler) },
  onWarning: (warning) => console.log(`warning: ${warning.code} ${warning.message}`),
});

const kernel = createExtensionKernel();
await kernel.load([hooks]);
const activated = activateKernel(kernel);

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
const provider: AIProvider = {
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

const agent = createAgent({
  model: { provider: "mock", model: "demo" },
  provider,
  tools: [write],
  guardrails: hooks.guardrails,
  instructionInjectors: activated.instructionInjectors,
  stopHooks: activated.stopHooks,
  middleware: activated.middleware,
});

const session = agent.createSession({ id: "hooks-json-example" });
const result = await session.run("Record the notes, then the environment file.");

console.log(
  JSON.stringify(
    {
      status: result.status,
      written,
      envBlocked: written.includes(".env") === false,
      sessionStartContextInjected: JSON.stringify(requests).includes("Audit trail: every write is logged."),
      seams: {
        guardrails: Object.keys(hooks.guardrails).sort(),
        stopHooks: activated.stopHooks?.length ?? 0,
        instructionInjectors: activated.instructionInjectors?.length ?? 0,
        fixtureReadable: readFileSync(fixture, "utf8").length > 0,
      },
    },
    null,
    0,
  ),
);
