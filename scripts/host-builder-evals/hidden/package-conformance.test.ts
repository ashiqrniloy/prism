import { expect, test } from "bun:test";
import { createAgent } from "@arnilo/prism";
import { mockProvider, packageConformance, providerDone, providerToolCall, toolCallContent } from "@arnilo/prism/testing";
import noForcePush from "../src/no-force-push.ts";

async function runShell(commands: string[]) {
  const ran: string[] = [];
  let last: { messages: Array<{ content: Array<{ type: string; error?: { message?: string } }> }> } | undefined;
  const agent = await createAgent({
    model: { provider: "mock", model: "demo" },
    packages: [
      mockProvider(
        [
          ...commands.map((command, index) => [providerToolCall(toolCallContent(`c${index}`, "shell", { command })), providerDone()]),
          [providerDone()],
        ] as never,
        {
          onRequest: (request: never) => void (last = request),
        },
      ),
      noForcePush(),
    ],
    tools: {
      add: [
        {
          name: "shell",
          description: "stub",
          parameters: { type: "object", properties: { command: { type: "string" } } },
          effects: ["read"],
          execute: (args: Record<string, unknown>) => {
            ran.push(String(args.command));
            return { toolCallId: "x", name: "shell", value: "ok" };
          },
        },
      ],
    },
  });
  try {
    const session = await agent.session();
    await session.run("go");
    const blocked = (last?.messages ?? [])
      .flatMap((message) => message.content)
      .filter((block) => block.type === "tool_result" && block.error)
      .map((block) => String(block.error?.message));
    return { ran, blocked, name: agent.inspect().packages.map((entry: { name: string }) => entry.name) };
  } finally {
    await agent.dispose();
  }
}

test("the package is named and versioned as asked and passes conformance", async () => {
  const result = await packageConformance(noForcePush);
  expect(result.checks.filter((check) => !check.ok)).toEqual([]);
  const { name } = await runShell([]);
  expect(name).toContain("@acme/no-force-push");
});

test("force pushes are denied in every spelling and the reason names force push", async () => {
  const { ran, blocked } = await runShell([
    "git push --force origin main",
    "git push -f",
    "git push origin main --force-with-lease",
    "git status",
    "git push origin main",
  ]);
  expect(ran).toEqual(["git status", "git push origin main"]);
  expect(blocked.length).toBe(3);
  expect(blocked.every((reason) => /force push/i.test(reason))).toBe(true);
});
