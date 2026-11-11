import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgent,
  type ModelProvider,
  providerDone,
  providerTextDelta,
  providerToolCallDelta,
  type ToolDefinition,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { mockProvider } from "@arnilo/prism/testing";
import {
  type CommandHookHandler,
  type HooksJsonConfig,
  type HooksJsonOptions,
  type HooksWarning,
  hookCommandHash,
  hooksJson,
} from "../index.js";

async function until(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 80 && !predicate(); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 25));
  assert.ok(predicate(), `timed out waiting for ${what}`);
}

/** Collect guardrail decision reasons as they are emitted; the model-visible text stays neutral. */
function _collectGuardrailReasons(session: {
  subscribe(): AsyncIterable<{ type: string; name?: string; record?: { reason?: string } }>;
}): string[] {
  const reasons: string[] = [];
  void (async () => {
    for await (const event of session.subscribe()) {
      if (event.type === "package.event" && event.name === "guardrail.decision" && event.record?.reason) reasons.push(event.record.reason);
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

function _hooksPackage(raw: object, options: HooksJsonOptions = {}): ReturnType<typeof hooksJson> {
  return hooksJson({ ...options, config: { ...(raw as HooksJsonConfig), allowCommands: "all" } });
}

async function toolAgent(options: {
  readonly requests: unknown[];
  readonly execute: (args: Record<string, unknown>) => void;
  readonly middleware?: unknown;
  readonly guardrails?: unknown;
  readonly hooks?: ReturnType<typeof hooksJson>;
  readonly instructionInjectors?: unknown;
  readonly stopHooks?: unknown;
}) {
  const provider: ModelProvider = {
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
  return await createAgent({
    model: { provider: "mock", model: "demo" },
    packages: [providerPackage("test-provider", [provider]), ...(options.hooks ? [options.hooks] : [])],
    tools: { add: [write] },
    ...(options.middleware ? { middleware: options.middleware as never } : {}),
    ...(options.guardrails ? { guardrails: options.guardrails as never } : {}),
    ...(options.instructionInjectors ? { instructionInjectors: options.instructionInjectors as never } : {}),
    ...(options.stopHooks ? { stopHooks: options.stopHooks as never } : {}),
  });
}

function parseHooksConfig<T>(value: T): T {
  return value;
}

function compileFixture(config: object, options: HooksJsonOptions & { readonly trusted?: "all" | Readonly<Record<string, string>> } = {}) {
  const { trusted, ...rest } = options;
  return hooksJson({ ...rest, config: { ...(config as HooksJsonConfig), allowCommands: trusted ?? "all" } });
}

async function loadHooks(hooks: ReturnType<typeof hooksJson>) {
  return { activated: { hooks }, warnings: [] as { type?: string; metadata?: { code?: string } }[] };
}

describe("compileFixture: PreToolUse", () => {
  it("applies updatedInput through the tool_call middleware", async () => {
    const hooks = compileFixture(
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
    const agent = await toolAgent({
      requests,
      execute: (args) => void executed.push(args),
      hooks: activated.hooks,
    });

    const result = await (await agent.session({ id: "pre-rewrite", create: true })).run("write it");

    assert.equal(result.status, "completed");
    assert.equal(executed.length, 1);
    assert.deepEqual(executed[0], { path: "rewritten.txt" }, "the tool sees exactly the rewritten input");
  });

  it("rewrite_does_not_double_run_pre_tool_use", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-hooks-json-once-"));
    const counter = join(dir, "runs.txt");
    try {
      const handler = script(
        `require("node:fs").appendFileSync(${JSON.stringify(counter)}, "x"); ${jsonDecision({ hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { path: "rewritten.txt" } } })}`,
      );
      const hooks = compileFixture(parseHooksConfig({ PreToolUse: [{ matcher: "write", hooks: [handler] }] }), { trusted: "all" });
      const { activated } = await loadHooks(hooks);
      const executed: Record<string, unknown>[] = [];
      const agent = await toolAgent({ requests: [], execute: (args) => void executed.push(args), hooks: activated.hooks });

      await (await agent.session({ id: "pre-rewrite-once", create: true })).run("write it");

      assert.deepEqual(executed[0], { path: "rewritten.txt" });
      assert.equal(readFileSync(counter, "utf8"), "x", "the PreToolUse handler runs once for a rewritten call");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("denies through the tool_input guardrail when a handler exits 2", async () => {
    const hooks = compileFixture(
      parseHooksConfig({ PreToolUse: [{ matcher: "write", hooks: [script('process.stderr.write("no writes today"); process.exit(2)')] }] }),
      { trusted: "all" },
    );
    const { activated } = await loadHooks(hooks);
    const executed: Record<string, unknown>[] = [];
    const requests: { messages: readonly { content: readonly { type: string; text?: string }[] }[] }[] = [];
    const agent = await toolAgent({
      requests,
      execute: (args) => void executed.push(args),
      hooks: activated.hooks,
    });

    const session = await agent.session({ id: "pre-deny", create: true });
    const result = await session.run("write it");

    assert.equal(result.status, "completed");
    assert.equal(executed.length, 0, "a denied call never reaches the tool");
    assert.match(JSON.stringify(requests[1]), /no writes today/, "the model sees the hook's denial reason");
  });
});

describe("compileFixture: PostToolUse", () => {
  it("blocks a tool result through the tool_output guardrail", async () => {
    const hooks = compileFixture(
      parseHooksConfig({
        PostToolUse: [{ matcher: "write", hooks: [script(jsonDecision({ decision: "block", reason: "result not allowed" }))] }],
      }),
      { trusted: "all" },
    );
    const { activated } = await loadHooks(hooks);
    const executed: Record<string, unknown>[] = [];
    const requests: unknown[] = [];
    const agent = await toolAgent({
      requests,
      execute: (args) => void executed.push(args),
      hooks: activated.hooks,
    });

    const session = await agent.session({ id: "post-deny", create: true });
    const result = await session.run("write it");

    assert.equal(result.status, "completed");
    assert.equal(executed.length, 1, "the tool ran; only its result was withheld");
    assert.match(JSON.stringify(requests[1]), /result not allowed/);
  });
});

describe("compileFixture: Stop", () => {
  it("continues through the stop hook and stops cleanly at maxStopContinuations", async () => {
    const hooks = compileFixture(
      parseHooksConfig({ Stop: [{ hooks: [script('process.stderr.write("verify the checklist"); process.exit(2)')] }] }),
      { trusted: "all" },
    );
    const { activated } = await loadHooks(hooks);
    let turns = 0;
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [
        activated.hooks,
        providerPackage("test-provider", [
          {
            id: "mock",
            async *generate() {
              turns += 1;
              yield providerTextDelta(`turn ${turns}`);
              yield providerDone();
            },
          },
        ]),
      ],
    });

    const result = await (await agent.session({ id: "stop-cap", create: true })).run("go");

    assert.equal(result.stopReason, "hook_limit", "the cap ends the run cleanly instead of looping forever");
    assert.equal(turns, 4, "one provider turn plus the default three continuations");
  });

  it("honours `continue: false` as a stop, winning over a continuation decision", async () => {
    const hooks = compileFixture(
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
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [
        activated.hooks,
        providerPackage("test-provider", [
          {
            id: "mock",
            async *generate() {
              turns += 1;
              yield providerTextDelta(`turn ${turns}`);
              yield providerDone();
            },
          },
        ]),
      ],
    });

    const result = await (await agent.session({ id: "stop-continue-false", create: true })).run("go");

    assert.equal(result.status, "completed");
    assert.equal(result.stopReason, undefined, "continue: false ends the run instead of continuing it");
    assert.equal(turns, 1, "no continuation turn runs");
  });

  it("stops naturally when the hook has no opinion", async () => {
    const hooks = compileFixture(parseHooksConfig({ Stop: [{ hooks: [script("process.exit(0)")] }] }), { trusted: "all" });
    const { activated } = await loadHooks(hooks);
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [activated.hooks, mockProvider([[providerDone()]])],
    });

    const result = await (await agent.session({ id: "stop-natural", create: true })).run("go");

    assert.equal(result.status, "completed");
    assert.equal(result.stopReason, undefined);
  });
});

describe("compileFixture: context injection", () => {
  it("injects UserPromptSubmit additionalContext once, at the next assembly", async () => {
    const hooks = compileFixture(
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
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [
        activated.hooks,
        providerPackage("test-provider", [
          {
            id: "mock",
            async *generate(request) {
              requests.push(request);
              yield providerTextDelta("ok");
              yield providerDone();
            },
          },
        ]),
      ],
    });
    const session = await agent.session({ id: "ctx", create: true });

    await session.run("first");
    await session.run("second");

    assert.match(JSON.stringify(requests[0]), /PROJECT-RULE/);
    assert.doesNotMatch(JSON.stringify(requests[1]?.messages.at(-1)), /PROJECT-RULE/);
  });

  it("uses a handler's own additionalContextLimit over the config limit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-hooks-handler-limit-"));
    try {
      const hooks = compileFixture(
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
      const agent = await createAgent({
        model: { provider: "mock", model: "demo" },
        packages: [
          activated.hooks,
          providerPackage("test-provider", [
            {
              id: "mock",
              async *generate(request) {
                requests.push(request);
                yield providerDone();
              },
            },
          ]),
        ],
      });

      await (await agent.session({ id: "handler-limit", create: true })).run("go");

      assert.match(JSON.stringify(requests[0]), /PPPPP/, "the handler's `0` = unlimited limit wins over the config limit");
      assert.equal(readdirSync(dir).length, 0, "nothing spilled");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("queues PreToolUse additionalContext for the next assembly, dropping it when the call is denied", async () => {
    const hooks = compileFixture(
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
    const agent = await toolAgent({
      requests,
      execute: () => undefined,
      hooks: activated.hooks,
    });

    await (await agent.session({ id: "pre-context", create: true })).run("write it");

    assert.match(JSON.stringify(requests[1]), /TOOL-NOTE/, "the note reaches the turn after the tool call");
  });

  it("spills oversized context to the hook output directory instead of inlining it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-hooks-spill-"));
    try {
      const hooks = compileFixture(
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
      const agent = await createAgent({
        model: { provider: "mock", model: "demo" },
        packages: [
          activated.hooks,
          providerPackage("test-provider", [
            {
              id: "mock",
              async *generate(request) {
                requests.push(request);
                yield providerDone();
              },
            },
          ]),
        ],
      });

      await (await agent.session({ id: "spill", create: true })).run("go");

      assert.match(JSON.stringify(requests[0]), /exceeded the inline context limit and was written to /);
      const files = (await import("node:fs")).readdirSync(dir);
      assert.equal(files.length, 1, "exactly one spill file");
      assert.equal(existsSync(join(dir, String(files[0]))), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("delivers async handler context at a later turn boundary and never blocks the event path", async () => {
    const hooks = compileFixture(
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
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [
        activated.hooks,
        providerPackage("test-provider", [
          {
            id: "mock",
            async *generate(request) {
              requests.push(request);
              yield providerTextDelta("ok");
              yield providerDone();
            },
          },
        ]),
      ],
    });
    const session = await agent.session({ id: "async", create: true });

    await session.run("first");
    assert.doesNotMatch(JSON.stringify(requests[0]), /LATE-CONTEXT/, "the run did not wait for the async handler");
    for (let attempt = 0; attempt < 40 && !JSON.stringify(requests).includes("LATE-CONTEXT"); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await session.run("second");
    assert.match(JSON.stringify(requests), /LATE-CONTEXT/, "the async context lands at a later assembly");
  });
});

describe("compileFixture: mcp_tool handlers", () => {
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the literal template syntax is the feature under test.
  it("substitutes ${field.path} templates and injects the returned additionalContext", async () => {
    const calls: { server: string; tool: string; arguments: Readonly<Record<string, unknown>> }[] = [];
    const hooks = compileFixture(
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
    const agent = await toolAgent({
      requests: [],
      execute: (args) => void executed.push(args),
      hooks: activated.hooks,
    });

    await (await agent.session({ id: "mcp-hook", create: true })).run("write it");

    assert.deepEqual(calls, [{ server: "audit", tool: "check", arguments: { path: "a.txt", event: "PreToolUse" } }]);
    assert.deepEqual(executed, [{ path: "from-mcp.txt" }], "the MCP decision rewrites the tool input");
  });

  it("reports a missing client and an error result as warnings instead of blocking", async () => {
    const withoutClient = compileFixture(
      parseHooksConfig({ PostToolUse: [{ hooks: [{ type: "mcp_tool", server: "audit", tool: "check" }] }] }),
      { trusted: "all" },
    );
    const warnings: string[] = [];
    const hooks = compileFixture(parseHooksConfig({ PostToolUse: [{ hooks: [{ type: "mcp_tool", server: "audit", tool: "check" }] }] }), {
      trusted: "all",
      onWarning: (warning) => void warnings.push(warning.code),
      mcpClient: {
        async callTool() {
          return { isError: true, content: [{ type: "text", text: "upstream boom" }] };
        },
      },
    });
    const { activated } = await loadHooks(hooks);
    await loadHooks(withoutClient);
    const executed: Record<string, unknown>[] = [];
    const agent = await toolAgent({
      requests: [],
      execute: (args) => void executed.push(args),
      hooks: activated.hooks,
    });

    const result = await (await agent.session({ id: "mcp-error", create: true })).run("write it");

    assert.equal(result.status, "completed", "a failing hook never fails the run");
    assert.equal(executed.length, 1);
    await until(() => warnings.length > 0, "handler_failed warning");
    assert.ok(warnings.includes("handler_failed"), `expected a handler_failed warning, got ${warnings.join(", ")}`);
  });
});

describe("compileFixture: trust", () => {
  it("unlisted_command_fails_closed_at_load", async () => {
    const handler = script(jsonDecision({ hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { path: "rewritten.txt" } } }));
    const hooks = compileFixture(parseHooksConfig({ PreToolUse: [{ matcher: "write", hooks: [handler] }] }), {
      trusted: { [handler.command]: "sha256-0000" },
    });
    await assert.rejects(() => toolAgent({ requests: [], execute: () => undefined, hooks }), /not allow-listed/);
  });

  it("runs a handler trusted by its exact argv hash", async () => {
    const handler = script(jsonDecision({ hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { path: "trusted.txt" } } }));
    const hooks = compileFixture(parseHooksConfig({ PreToolUse: [{ matcher: "write", hooks: [handler] }] }), {
      trusted: { [handler.command]: hookCommandHash(handler) },
    });
    const { activated, warnings } = await loadHooks(hooks);
    const executed: Record<string, unknown>[] = [];
    const agent = await toolAgent({
      requests: [],
      execute: (args) => void executed.push(args),
      hooks: activated.hooks,
    });

    await (await agent.session({ id: "trust-ok", create: true })).run("write it");

    assert.deepEqual(executed, [{ path: "trusted.txt" }]);
    assert.equal(warnings.length, 0);
  });

  it('logs the trusted: "all" escape hatch through onWarning', async () => {
    const seen: HooksWarning[] = [];
    const hooks = compileFixture(parseHooksConfig({ Stop: [{ hooks: [script("process.exit(0)")] }] }), {
      trusted: "all",
      onWarning: (warning) => void seen.push(warning),
    });
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [hooks, mockProvider([[providerDone()]])],
    });
    await agent.dispose();

    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.code, "trust_all");
  });
});
