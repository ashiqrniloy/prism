import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import type { ScriptedDialect } from "@arnilo/prism/testing";
import type { AgentAdapter, RequestContext } from "@arnilo/prism-hosts/driver-process";
import type { AdapterConformanceFixtures } from "@arnilo/prism-hosts/driver-process/testing";

// Computed imports keep unpublished examples outside the package declaration build's rootDir.
const exampleRoot = "../../../../../examples/adapters/";
const { rpcServer }: { rpcServer: AgentAdapter } = await import(`${exampleRoot}rpc-server.ts`);
const { rpcServerDialect, rpcServerFixtures }: { rpcServerDialect: ScriptedDialect; rpcServerFixtures: AdapterConformanceFixtures } =
  await import(`${exampleRoot}rpc-server.dialect.ts`);

test("rpc_server_question_routes_to_host_ui", async () => {
  const handler = rpcServer.requests?.["user/input"];
  assert(handler);
  let asked = false;
  const answer = await handler({
    params: { question: "Which file?" },
    host: {
      ui: {
        request: async () => {
          asked = true;
          return { status: "answered", value: "README.md" };
        },
      },
    },
  } as unknown as RequestContext);
  expect(asked).toBe(true);
  expect(answer).toEqual({ answer: "README.md" });
});

test("rpc_server_client_tool_call_fires_tool_call", async () => {
  const handler = rpcServer.requests?.["item/tool/call"];
  assert(handler);
  const calls: unknown[] = [];
  const answer = await handler({
    params: { toolCallId: "t-1", name: "read", args: { path: "README.md" } },
    bridge: {
      tools: [],
      invoke: async (call: { id: string; name: string }) => {
        calls.push(call);
        return { toolCallId: call.id, name: call.name, value: "contents" };
      },
    },
  } as unknown as RequestContext);
  expect(calls).toEqual([{ type: "tool_call", id: "t-1", name: "read", arguments: { path: "README.md" } }]);
  expect(answer).toEqual({ result: "contents" });
});

test("rpc_server_locate_reports_inherited_home_and_hides_it_under_strict_flags", () => {
  assert(rpcServerFixtures.home && rpcServerDialect.locate);
  const files = new Map(Object.values(rpcServerFixtures.home).map((item) => [join("/fake", item.path), item.content]));
  const input = { argv: [] as string[], env: { HOME: "/fake" }, cwd: "/", readFile: (path: string) => files.get(path) };
  expect(rpcServerDialect.locate(input).loaded).toEqual([...files.keys()]);
  expect(rpcServerDialect.locate({ ...input, argv: ["--no-user-config"] }).loaded).toEqual([]);
});
