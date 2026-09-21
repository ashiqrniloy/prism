import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  type AIProvider,
  activateKernel,
  createAgent,
  createExtensionKernel,
  createMockProvider,
  type ExtensionEvent,
  providerDone,
  providerTextDelta,
  providerToolCallDelta,
  type ToolDefinition,
} from "@arnilo/prism";
import { type CommandHookHandler, createHooksExtension, type HooksWarning, hookCommandHash, parseHooksConfig } from "../index.js";

async function until(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 80 && !predicate(); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 25));
  assert.ok(predicate(), `timed out waiting for ${what}`);
}

/** Collect guardrail decision reasons as they are emitted; the model-visible text stays neutral. */
function collectGuardrailReasons(session: { subscribe(): AsyncIterable<{ type: string; record?: { reason?: string } }> }): string[] {
  const reasons: string[] = [];
  void (async () => {
    for await (const event of session.subscribe()) {
      if (event.type === "guardrail_decision" && event.record?.reason) reasons.push(event.record.reason);
    }
  })();
  return reasons;
}

const node = process.execPath;

/** A command handler that prints a fixed script's stdout (JSON decisions included). */
function script(source: string, extra: Partial<CommandHookHandler> = {}): CommandHookHandler {
  return { type: "command", command: node, args: ["-e", source], ...extra };
}

function jsonDecision(value: unknown): string {
  return `process.stdout.write(${JSON.stringify(JSON.stringify(value))})`;
}

async function loadHooks(hooks: ReturnType<typeof createHooksExtension>) {
  const kernel = createExtensionKernel();
  const warnings: ExtensionEvent[] = [];
  kernel.events.on("hooks:warning", (event) => void warnings.push(event));
  await kernel.load([hooks]);
  return { kernel, activated: activateKernel(kernel), warnings };
}

function toolAgent(options: {
  readonly requests: unknown[];
  readonly execute: (args: Record<string, unknown>) => void;
  readonly middleware?: unknown;
  readonly guardrails?: unknown;
  readonly instructionInjectors?: unknown;
  readonly stopHooks?: unknown;
}) {
  const provider: AIProvider = {
    id: "mock",
    async *generate(request) {
      options.requests.push(request);
      if (options.requests.length === 1) {
        yield providerToolCallDelta({ index: 0, id: "call_1", name: "write", argumentsText: '{"path":"a.txt","text":"hi"}' });
      } else {
        yield providerTextDelta("done");
      }
      yield providerDone();
    },
  };
  const write: ToolDefinition = {
    name: "write",
    execute: (args, context) => {
      options.execute(args as Record<string, unknown>);
      return { toolCallId: context.toolCallId, name: "write", value: "written" };
    },
  };
  return createAgent({
    model: { provider: "mock", model: "demo" },
    provider,
    tools: [write],
    ...(options.middleware ? { middleware: options.middleware as never } : {}),
    ...(options.guardrails ? { guardrails: options.guardrails as never } : {}),
    ...(options.instructionInjectors ? { instructionInjectors: options.instructionInjectors as never } : {}),
    ...(options.stopHooks ? { stopHooks: options.stopHooks as never } : {}),
  });
}

describe("createHooksExtension: PreToolUse", () => {
  it("applies updatedInput through the tool_call middleware", async () => {
    const hooks = createHooksExtension(
      parseHooksConfig({
        PreToolUse: [
          {
            matcher: "write",
            hooks: [script(jsonDecision({ hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { path: "rewritten.txt" } } }))],
          },
        ],
      }),
      { trusted: "all" },
    );
    const { activated } = await loadHooks(hooks);
    const executed: Record<string, unknown>[] = [];
    const requests: unknown[] = [];
    const agent = toolAgent({
      requests,
      execute: (args) => void executed.push(args),
      middleware: activated.middleware,
      guardrails: hooks.guardrails,
    });

    const result = await agent.createSession({ id: "pre-rewrite" }).run("write it");

    assert.equal(result.status, "succeeded");
    assert.equal(executed.length, 1);
    assert.deepEqual(executed[0], { path: "rewritten.txt" }, "the tool sees exactly the rewritten input");
  });

  it("denies through the tool_input guardrail when a handler exits 2", async () => {
    const hooks = createHooksExtension(
      parseHooksConfig({ PreToolUse: [{ matcher: "write", hooks: [script('process.stderr.write("no writes today"); process.exit(2)')] }] }),
      { trusted: "all" },
    );
    const { activated } = await loadHooks(hooks);
    const executed: Record<string, unknown>[] = [];
    const requests: { messages: readonly { content: readonly { type: string; text?: string }[] }[] }[] = [];
    const agent = toolAgent({
      requests,
      execute: (args) => void executed.push(args),
      middleware: activated.middleware,
      guardrails: hooks.guardrails,
    });

    const session = agent.createSession({ id: "pre-deny" });
    const reasons = collectGuardrailReasons(session);
    const result = await session.run("write it");

    assert.equal(result.status, "succeeded");
    assert.equal(executed.length, 0, "a denied call never reaches the tool");
    assert.match(JSON.stringify(requests[1]), /Tool call blocked by guardrail/, "the model sees a blocked tool result");
    await until(() => reasons.length > 0, "guardrail_decision event");
    assert.deepEqual(reasons, ["no writes today"], "the denial reason is recorded on the guardrail decision");
  });
});

describe("createHooksExtension: PostToolUse", () => {
  it("blocks a tool result through the tool_output guardrail", async () => {
    const hooks = createHooksExtension(
      parseHooksConfig({
        PostToolUse: [{ matcher: "write", hooks: [script(jsonDecision({ decision: "block", reason: "result not allowed" }))] }],
      }),
      { trusted: "all" },
    );
    const { activated } = await loadHooks(hooks);
    const executed: Record<string, unknown>[] = [];
    const requests: unknown[] = [];
    const agent = toolAgent({
      requests,
      execute: (args) => void executed.push(args),
      middleware: activated.middleware,
      guardrails: hooks.guardrails,
    });

    const session = agent.createSession({ id: "post-deny" });
    const reasons = collectGuardrailReasons(session);
    const result = await session.run("write it");

    assert.equal(result.status, "succeeded");
    assert.equal(executed.length, 1, "the tool ran; only its result was withheld");
    assert.match(JSON.stringify(requests[1]), /Tool result blocked by guardrail/);
    await until(() => reasons.length > 0, "guardrail_decision event");
    assert.deepEqual(reasons, ["result not allowed"]);
  });
});

describe("createHooksExtension: Stop", () => {
  it("continues through the stop hook and stops cleanly at maxStopContinuations", async () => {
    const hooks = createHooksExtension(
      parseHooksConfig({ Stop: [{ hooks: [script('process.stderr.write("verify the checklist"); process.exit(2)')] }] }),
      { trusted: "all" },
    );
    const { activated } = await loadHooks(hooks);
    let turns = 0;
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: {
        id: "mock",
        async *generate() {
          turns += 1;
          yield providerTextDelta(`turn ${turns}`);
          yield providerDone();
        },
      },
      stopHooks: activated.stopHooks,
    });

    const result = await agent.createSession({ id: "stop-cap" }).run("go");

    assert.equal(result.stopReason, "hook_limit", "the cap ends the run cleanly instead of looping forever");
    assert.equal(turns, 4, "one provider turn plus the default three continuations");
  });

  it("honours `continue: false` as a stop, winning over a continuation decision", async () => {
    const hooks = createHooksExtension(
      parseHooksConfig({
        Stop: [
          {
            hooks: [
              script('process.stderr.write("keep going")'),
              script(jsonDecision({ continue: false, stopReason: "the task is done" })),
            ],
          },
        ],
      }),
      { trusted: "all" },
    );
    const { activated } = await loadHooks(hooks);
    let turns = 0;
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: {
        id: "mock",
        async *generate() {
          turns += 1;
          yield providerTextDelta(`turn ${turns}`);
          yield providerDone();
        },
      },
      stopHooks: activated.stopHooks,
    });

    const result = await agent.createSession({ id: "stop-continue-false" }).run("go");

    assert.equal(result.status, "succeeded");
    assert.equal(result.stopReason, undefined, "continue: false ends the run instead of continuing it");
    assert.equal(turns, 1, "no continuation turn runs");
  });

  it("stops naturally when the hook has no opinion", async () => {
    const hooks = createHooksExtension(parseHooksConfig({ Stop: [{ hooks: [script("process.exit(0)")] }] }), { trusted: "all" });
    const { activated } = await loadHooks(hooks);
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([providerDone()]),
      stopHooks: activated.stopHooks,
    });

    const result = await agent.createSession({ id: "stop-natural" }).run("go");

    assert.equal(result.status, "succeeded");
    assert.equal(result.stopReason, undefined);
  });
});

describe("createHooksExtension: context injection", () => {
  it("injects UserPromptSubmit additionalContext once, at the next assembly", async () => {
    const hooks = createHooksExtension(
      parseHooksConfig({
        UserPromptSubmit: [
          {
            hooks: [script(jsonDecision({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "PROJECT-RULE" } }))],
          },
        ],
      }),
      { trusted: "all" },
    );
    const { activated } = await loadHooks(hooks);
    const requests: { messages: readonly unknown[] }[] = [];
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: {
        id: "mock",
        async *generate(request) {
          requests.push(request);
          yield providerTextDelta("ok");
          yield providerDone();
        },
      },
      guardrails: hooks.guardrails,
      instructionInjectors: activated.instructionInjectors,
    });
    const session = agent.createSession({ id: "ctx" });

    await session.run("first");
    await session.run("second");

    assert.match(JSON.stringify(requests[0]), /PROJECT-RULE/);
    assert.doesNotMatch(JSON.stringify(requests[1]?.messages.at(-1)), /PROJECT-RULE/);
  });

  it("uses a handler's own additionalContextLimit over the config limit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-hooks-handler-limit-"));
    try {
      const hooks = createHooksExtension(
        parseHooksConfig({
          additionalContextLimit: 1,
          UserPromptSubmit: [
            {
              hooks: [
                script(jsonDecision({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "P".repeat(40) } }), {
                  additionalContextLimit: 0,
                }),
              ],
            },
          ],
        }),
        { trusted: "all", hookOutputDir: dir },
      );
      const { activated } = await loadHooks(hooks);
      const requests: unknown[] = [];
      const agent = createAgent({
        model: { provider: "mock", model: "demo" },
        provider: {
          id: "mock",
          async *generate(request) {
            requests.push(request);
            yield providerDone();
          },
        },
        guardrails: hooks.guardrails,
        instructionInjectors: activated.instructionInjectors,
      });

      await agent.createSession({ id: "handler-limit" }).run("go");

      assert.match(JSON.stringify(requests[0]), /PPPPP/, "the handler's `0` = unlimited limit wins over the config limit");
      assert.equal(readdirSync(dir).length, 0, "nothing spilled");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("queues PreToolUse additionalContext for the next assembly, dropping it when the call is denied", async () => {
    const hooks = createHooksExtension(
      parseHooksConfig({
        PreToolUse: [
          {
            hooks: [
              script(
                jsonDecision({
                  hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: "TOOL-NOTE", permissionDecision: "allow" },
                }),
              ),
            ],
          },
        ],
      }),
      { trusted: "all" },
    );
    const { activated } = await loadHooks(hooks);
    const requests: unknown[] = [];
    const agent = toolAgent({
      requests,
      execute: () => undefined,
      middleware: activated.middleware,
      guardrails: hooks.guardrails,
      instructionInjectors: activated.instructionInjectors,
    });

    await agent.createSession({ id: "pre-context" }).run("write it");

    assert.match(JSON.stringify(requests[1]), /TOOL-NOTE/, "the note reaches the turn after the tool call");
  });

  it("spills oversized context to the hook output directory instead of inlining it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-hooks-spill-"));
    try {
      const hooks = createHooksExtension(
        parseHooksConfig({
          additionalContextLimit: 10,
          UserPromptSubmit: [
            {
              hooks: [
                script(jsonDecision({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "x".repeat(400) } })),
              ],
            },
          ],
        }),
        { trusted: "all", hookOutputDir: dir },
      );
      const { activated } = await loadHooks(hooks);
      const requests: unknown[] = [];
      const agent = createAgent({
        model: { provider: "mock", model: "demo" },
        provider: {
          id: "mock",
          async *generate(request) {
            requests.push(request);
            yield providerDone();
          },
        },
        guardrails: hooks.guardrails,
        instructionInjectors: activated.instructionInjectors,
      });

      await agent.createSession({ id: "spill" }).run("go");

      assert.match(JSON.stringify(requests[0]), /exceeded the inline context limit and was written to /);
      const files = (await import("node:fs")).readdirSync(dir);
      assert.equal(files.length, 1, "exactly one spill file");
      assert.equal(existsSync(join(dir, String(files[0]))), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("delivers async handler context at a later turn boundary and never blocks the event path", async () => {
    const hooks = createHooksExtension(
      parseHooksConfig({
        UserPromptSubmit: [
          {
            hooks: [
              script(
                `setTimeout(() => process.stdout.write(${JSON.stringify(
                  JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "LATE-CONTEXT" } }),
                )}), 250)`,
                { async: true },
              ),
            ],
          },
        ],
      }),
      { trusted: "all" },
    );
    const { activated } = await loadHooks(hooks);
    const requests: unknown[] = [];
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: {
        id: "mock",
        async *generate(request) {
          requests.push(request);
          yield providerTextDelta("ok");
          yield providerDone();
        },
      },
      guardrails: hooks.guardrails,
      instructionInjectors: activated.instructionInjectors,
    });
    const session = agent.createSession({ id: "async" });

    await session.run("first");
    assert.doesNotMatch(JSON.stringify(requests[0]), /LATE-CONTEXT/, "the run did not wait for the async handler");
    for (let attempt = 0; attempt < 40 && !JSON.stringify(requests).includes("LATE-CONTEXT"); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await session.run("second");
    assert.match(JSON.stringify(requests), /LATE-CONTEXT/, "the async context lands at a later assembly");
  });
});

describe("createHooksExtension: mcp_tool handlers", () => {
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the literal template syntax is the feature under test.
  it("substitutes ${field.path} templates and injects the returned additionalContext", async () => {
    const calls: { server: string; tool: string; arguments: Readonly<Record<string, unknown>> }[] = [];
    const hooks = createHooksExtension(
      parseHooksConfig({
        PreToolUse: [
          {
            matcher: "write",
            hooks: [
              // biome-ignore lint/suspicious/noTemplateCurlyInString: the literal template syntax is the feature under test.
              { type: "mcp_tool", server: "audit", tool: "check", input: { path: "${tool_input.path}", event: "${event}" } },
            ],
          },
        ],
      }),
      {
        trusted: "all",
        mcpClient: {
          async callTool(request) {
            calls.push(request);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    hookSpecificOutput: {
                      hookEventName: "PreToolUse",
                      additionalContext: "audited",
                      updatedInput: { path: "from-mcp.txt" },
                    },
                  }),
                },
              ],
            };
          },
        },
      },
    );
    const { activated } = await loadHooks(hooks);
    const executed: Record<string, unknown>[] = [];
    const agent = toolAgent({
      requests: [],
      execute: (args) => void executed.push(args),
      middleware: activated.middleware,
      guardrails: hooks.guardrails,
    });

    await agent.createSession({ id: "mcp-hook" }).run("write it");

    assert.deepEqual(calls, [{ server: "audit", tool: "check", arguments: { path: "a.txt", event: "PreToolUse" } }]);
    assert.deepEqual(executed, [{ path: "from-mcp.txt" }], "the MCP decision rewrites the tool input");
  });

  it("reports a missing client and an error result as warnings instead of blocking", async () => {
    const withoutClient = createHooksExtension(
      parseHooksConfig({ PostToolUse: [{ hooks: [{ type: "mcp_tool", server: "audit", tool: "check" }] }] }),
      { trusted: "all" },
    );
    const warnings: string[] = [];
    const hooks = createHooksExtension(
      parseHooksConfig({ PostToolUse: [{ hooks: [{ type: "mcp_tool", server: "audit", tool: "check" }] }] }),
      {
        trusted: "all",
        onWarning: (warning) => void warnings.push(warning.code),
        mcpClient: {
          async callTool() {
            return { isError: true, content: [{ type: "text", text: "upstream boom" }] };
          },
        },
      },
    );
    const { activated } = await loadHooks(hooks);
    await loadHooks(withoutClient);
    const executed: Record<string, unknown>[] = [];
    const agent = toolAgent({
      requests: [],
      execute: (args) => void executed.push(args),
      middleware: activated.middleware,
      guardrails: hooks.guardrails,
    });

    const result = await agent.createSession({ id: "mcp-error" }).run("write it");

    assert.equal(result.status, "succeeded", "a failing hook never fails the run");
    assert.equal(executed.length, 1);
    await until(() => warnings.length > 0, "handler_failed warning");
    assert.ok(warnings.includes("handler_failed"), `expected a handler_failed warning, got ${warnings.join(", ")}`);
  });
});

describe("createHooksExtension: trust", () => {
  it("skips a handler whose hash does not match the allowlist and warns", async () => {
    const handler = script(jsonDecision({ hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { path: "rewritten.txt" } } }));
    const hooks = createHooksExtension(parseHooksConfig({ PreToolUse: [{ matcher: "write", hooks: [handler] }] }), {
      trusted: { [handler.command]: "sha256-0000" },
    });
    const { activated, warnings } = await loadHooks(hooks);
    const executed: Record<string, unknown>[] = [];
    const agent = toolAgent({
      requests: [],
      execute: (args) => void executed.push(args),
      middleware: activated.middleware,
      guardrails: hooks.guardrails,
    });

    await agent.createSession({ id: "trust-mismatch" }).run("write it");

    assert.deepEqual(executed, [{ path: "a.txt", text: "hi" }], "an untrusted handler never runs");
    assert.equal(warnings[0]?.type, "hooks:warning");
    assert.equal((warnings[0]?.metadata as { code?: string } | undefined)?.code, "untrusted_handler");
  });

  it("runs a handler trusted by its exact argv hash", async () => {
    const handler = script(jsonDecision({ hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { path: "trusted.txt" } } }));
    const hooks = createHooksExtension(parseHooksConfig({ PreToolUse: [{ matcher: "write", hooks: [handler] }] }), {
      trusted: { [handler.command]: hookCommandHash(handler) },
    });
    const { activated, warnings } = await loadHooks(hooks);
    const executed: Record<string, unknown>[] = [];
    const agent = toolAgent({
      requests: [],
      execute: (args) => void executed.push(args),
      middleware: activated.middleware,
      guardrails: hooks.guardrails,
    });

    await agent.createSession({ id: "trust-ok" }).run("write it");

    assert.deepEqual(executed, [{ path: "trusted.txt" }]);
    assert.equal(warnings.length, 0);
  });

  it('logs the trusted: "all" escape hatch through onWarning', async () => {
    const seen: HooksWarning[] = [];
    const hooks = createHooksExtension(parseHooksConfig({ Stop: [{ hooks: [script("process.exit(0)")] }] }), {
      trusted: "all",
      onWarning: (warning) => void seen.push(warning),
    });
    await loadHooks(hooks);

    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.code, "trust_all");
  });
});
