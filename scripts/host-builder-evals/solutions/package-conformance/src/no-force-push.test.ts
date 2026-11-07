import { expect, test } from "bun:test";
import { createAgent } from "@arnilo/prism";
import { mockProvider, packageConformance, providerDone, providerToolCall, toolCallContent } from "@arnilo/prism/testing";
import noForcePush from "./no-force-push.ts";

test("passes package conformance", async () => {
  const result = await packageConformance(noForcePush);
  expect(result.checks.filter((check) => !check.ok)).toEqual([]);
  expect(result.ok).toBe(true);
});

test("denies force pushes and allows other shell calls", async () => {
  const ran: string[] = [];
  const agent = await createAgent({
    model: { provider: "mock", model: "demo" },
    packages: [
      mockProvider([
        [providerToolCall(toolCallContent("c1", "shell", { command: "git push --force origin main" })), providerDone()],
        [providerToolCall(toolCallContent("c2", "shell", { command: "git status" })), providerDone()],
        [providerDone()],
      ]),
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
    expect(ran).toEqual(["git status"]);
  } finally {
    await agent.dispose();
  }
});
