import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  createAgent,
  definePackage,
  type HostUi,
  type PackageInstance,
  type ProviderEvent,
  providerDone,
  providerTextDelta,
  toolCallContent,
} from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import approval from "@arnilo/prism-approval";

export async function create({ hostUi, stateDirectory }: { hostUi: HostUi; stateDirectory: string }) {
  const storeModule = "@arnilo/prism-store-sqlite";
  const sqliteStore: (config: { path: string }) => PackageInstance = (await import(storeModule)).default;
  await mkdir(stateDirectory, { recursive: true });
  const events: ProviderEvent[] = [];
  const provider = mockProvider([events], {
    onRequest(request) {
      const text = JSON.stringify(request.messages);
      const approve = text.includes("approve") && !text.includes('"tool_result"');
      events.splice(
        0,
        events.length,
        ...(approve
          ? [{ type: "tool_call" as const, call: toolCallContent("write-1", "write", {}) }, providerDone()]
          : [providerTextDelta("finished"), providerDone()]),
      );
    },
  });
  return createAgent({
    id: "conformance",
    name: "conformance",
    model: { provider: "mock", model: "test" },
    host: { ui: hostUi },
    packages: [
      provider,
      approval({ mode: "ask" }),
      sqliteStore({ path: join(stateDirectory, "sessions.db") }),
      definePackage({
        name: "conformance-fixture",
        version: "1.0.0",
        requires: { api: 1 },
        setup(prism) {
          prism.commands.register({ name: "ping", description: "Conformance command", run: () => "pong" });
        },
      }),
    ],
    tools: {
      add: [
        {
          name: "write",
          parameters: {},
          effects: ["write"],
          execute: (_args, ctx) => ({ toolCallId: ctx.toolCallId, name: "write", value: "written" }),
        },
      ],
    },
  });
}

export async function createFault(options: { hostUi: HostUi; stateDirectory: string }, fault: "origin" | "suspension") {
  const hostUi: HostUi =
    fault === "suspension"
      ? {
          async request(request) {
            const answer = await options.hostUi.request(request);
            return answer.status === "unavailable" ? { status: "dismissed" } : answer;
          },
        }
      : options.hostUi;
  const agent = await create({ ...options, hostUi });
  if (fault === "suspension") return agent;
  return {
    ...agent,
    async session(...args: Parameters<typeof agent.session>) {
      const session = await agent.session(...args);
      return {
        ...session,
        async *stream(...input: Parameters<typeof session.stream>) {
          for await (const event of session.stream(...input))
            yield { ...event, origin: { kind: "prism" as const, agent: "broken", agentId: "broken", depth: 0, remote: "" } };
        },
      };
    },
  };
}
