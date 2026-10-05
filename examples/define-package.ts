import {
  type AgentEvent,
  type ModelProvider,
  createAgent,
  createMemorySessionStore,
  definePackage,
  providerDone,
  providerTextDelta,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";

/**
 * Two packages on one agent (roadmap §2.6). Listing a package is all the wiring there is.
 *
 * - `@acme/audit` denies a `shell` call (`tool.call`), observes finished tools, and notes its state.
 * - `@acme/counter` has a config schema with a secret ref, a tool visible only in one session, a
 *   command, session state kept in `package_state` entries, and a background task.
 *
 * The demo forks a session, reopens it from the store, prints `agent.inspect()`, and disposes. The
 * `env:` ref is fake; the inspection shows the ref and never the value it resolves to. Network-free.
 * Run: npm run build:core && node examples/define-package.ts
 */

// The kernel is 0.12.1 until the 0.13.0 release, so an in-tree package declares a range that admits it.
const requires = { prism: "^0.12.1 || ^0.13.0-0" } as const;
const ENV_VALUE = "demo-only-env-value-1234";
const finished: string[] = [];

const audit = definePackage({
  name: "@acme/audit",
  version: "1.0.0",
  requires,
  setup(prism) {
    prism.hooks.on("tool.call", (call) => (call.name === "shell" ? { deny: "shell is disabled by @acme/audit" } : "allow"));
    prism.hooks.on("tool.completed", () => void finished.push("tool"));
    prism.hooks.on("background.completed", (event: AgentEvent) => void finished.push(event.type));
    prism.status.note("info", "auditing tool calls");
  },
});

interface CounterConfig {
  readonly apiKey?: string;
  readonly step: number;
}

// The host does not choose session ids; the "main" session's generated id is recorded after it opens.
let mainSessionId: string | undefined;

const counter = definePackage<CounterConfig>({
  name: "@acme/counter",
  version: "1.2.0",
  requires,
  capabilities: ["session-state", "background"],
  config: {
    type: "object",
    properties: {
      apiKey: { type: "string", "x-prism-secret": true },
      step: { type: "integer", minimum: 1, default: 1 },
    },
  },
  setup(prism) {
    const total = prism.state.session("total", { n: 0 });
    const { step } = prism.config;

    // Visible in the "main" session only: `when` runs once per turn.
    prism.tools.register(
      {
        name: "count",
        description: "Adds one step to the session total.",
        parameters: {},
        execute: async (_args, context) => {
          const next = { n: total.get(context.session!).n + step };
          await total.set(context.session!, next);
          return { toolCallId: context.toolCallId, name: "count", value: next.n };
        },
      },
      { when: (session) => session.id === mainSessionId },
    );
    prism.commands.register({
      name: "bump",
      description: "Adds one step to the session total.",
      run: async (_args, { session }) => {
        const next = { n: total.get(session!).n + step };
        await total.set(session!, next);
        return next.n;
      },
    });
    prism.commands.register({ name: "total", description: "Reads the session total.", run: (_args, { session }) => total.get(session!).n });

    // A tracked background task; `close()` settles it and a `background.*` event reports it.
    prism.hooks.on("tool.completed", (_event, context) => {
      context.session!.background("flush", async () => prism.events.emit("flushed", { total: total.get(context.session!).n }));
    });
  },
});

export async function demo(): Promise<Record<string, unknown>> {
  process.env.DEMO_COUNTER_KEY = ENV_VALUE;
  const store = createMemorySessionStore();
  const advertised: Record<string, string[]> = {};
  let current = "";
  let turn = 0;
  let sawDenial = false;
  const provider: ModelProvider = {
    id: "mock",
    async *generate(request) {
      advertised[current] = (request.tools ?? []).map((tool) => tool.name);
      turn += 1;
      // The denied `shell` call reaches the model as an ordinary tool result.
      if (request.messages.some((m) => m.content.some((b) => b.type === "tool_result" && b.error?.code === "hook_denied"))) sawDenial = true;
      if (current === "main" && turn === 1) {
        yield { type: "tool_call" as const, call: toolCallContent("c1", "shell", {}) };
        yield { type: "tool_call" as const, call: toolCallContent("c2", "count", {}) };
        yield providerDone();
        return;
      }
      yield providerTextDelta("done");
      yield providerDone();
    },
  };

  try {
    const agent = await createAgent({
      id: "define-package",
      model: { provider: "mock", model: "demo" },
      packages: [audit, counter({ apiKey: "env:DEMO_COUNTER_KEY", step: 1 }), providerPackage("test-provider", [provider])],
    });

    current = "main";
    const main = await agent.session();
    mainSessionId = main.id;
    const result = await main.run("count something, then try the shell");
    current = "other";
    await (await agent.session()).run("hello");

    // State: the command and the tool write `package_state` entries. A fork carries them and keeps its own.
    const afterTool = await agent.commands.run("total", {}, { session: main });
    await agent.commands.run("bump", {}, { session: main });
    const fork = await main.fork();
    await agent.commands.run("bump", {}, { session: fork });
    const forkTotal = await agent.commands.run("total", {}, { session: fork });
    const mainTotal = await agent.commands.run("total", {}, { session: main });
    const reopened = await agent.session({ id: fork.id });
    const reopenedTotal = await agent.commands.run("total", {}, { session: reopened });

    await main.close(); // settles the background task, then fires `session.closed`
    const view = agent.inspect();
    const text = JSON.stringify(view);
    if (!sawDenial) throw new Error("the shell denial should reach the model");
    if (text.includes(ENV_VALUE)) throw new Error("inspect() leaked the env value");
    if (!text.includes("env:DEMO_COUNTER_KEY")) throw new Error("inspect() should show the ref");
    await agent.dispose();

    return {
      status: result.status,
      sawDenial,
      advertised,
      totals: { afterTool, mainTotal, forkTotal, reopenedTotal },
      background: finished.filter((type) => type === "background.completed").length,
      packages: view.packages.map((entry) => `${entry.name}@${entry.version}`),
      tools: view.tools.map((tool) => tool.name),
      hooks: Object.fromEntries(Object.entries(view.hooks).map(([name, list]) => [name, list.map((hook) => hook.id)])),
      slots: view.slots,
      notes: view.statusNotes.map((note) => note.message),
      configSources: view.packages[1]?.configSources,
    };
  } finally {
    delete process.env.DEMO_COUNTER_KEY;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
