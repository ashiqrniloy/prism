import { Readable, Writable } from "node:stream";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createAgent, createMockProvider } from "../index.js";
import { createSecretRedactor } from "../redaction.js";
import { parseCliArgs, runCli } from "../cli-runner.js";
import type { CliOptions } from "../cli-runner.js";
import type { AgentSession, ProviderRequest, RunOptions, SystemPromptContribution } from "../contracts.js";

class MemoryWritable extends Writable {
  chunks: string[] = [];
  _write(chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(String(chunk));
    callback();
  }
  text(): string { return this.chunks.join(""); }
}

function streams(input = "") {
  return { stdin: Readable.from(input), stdout: new MemoryWritable(), stderr: new MemoryWritable() };
}

async function makeRoot(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `prism-cli-sp-${prefix}-`));
}

/** Builds a session that wires the loaded `systemPromptLayers` into `AgentConfig.systemPrompt`
 *  (mirroring `defaultCreateSession`) and captures the assembled provider request.
 *  Optional `redactor` simulates a host-configured secret redactor. */
function capturingSession(
  captured: ProviderRequest[],
  extra: { redactor?: ReturnType<typeof createSecretRedactor> } = {},
): (options: CliOptions) => AgentSession {
  return (options) => {
    const provider = createMockProvider([{ type: "done" }], {
      onRequest: (req) => { captured.push(req); },
    });
    return createAgent({
      model: { provider: "mock", model: "m" },
      provider,
      instructions: options.system,
      ...(options.systemPromptLayers.length > 0 ? { systemPrompt: options.systemPromptLayers } : {}),
      ...(extra.redactor ? { redactor: extra.redactor } : {}),
    }).createSession();
  };
}

function textOf(request: ProviderRequest): string {
  return request.messages
    .flatMap((m) => (Array.isArray(m.content) ? m.content : [m.content]))
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n");
}

describe("cli system/project prompt flags (Phase 31 Task 5)", () => {
  it("parses --no-agents-md / --no-system-md / --agents-md-file / --system-md-file", () => {
    const parsed = parseCliArgs(["--no-agents-md", "--no-system-md", "--agents-md-file", "/a.md", "--system-md-file", "/s.md", "-p", "Hi"]);
    assert.equal(parsed.noAgentsMd, true);
    assert.equal(parsed.noSystemMd, true);
    assert.equal(parsed.agentsMdFile, "/a.md");
    assert.equal(parsed.systemMdFile, "/s.md");
  });

  it("auto-loads AGENTS.md + SYSTEM.md; composed prompt reaches the provider stacked base → GLOBAL → PROJECT", async () => {
    const workspace = await makeRoot("auto-ws");
    const global = await makeRoot("auto-glob");
    await mkdir(join(global, ".prism", "agent"), { recursive: true });
    await writeFile(join(global, ".prism", "agent", "SYSTEM.md"), "GLOBAL");
    await writeFile(join(workspace, "AGENTS.md"), "PROJECT");
    const captured: ProviderRequest[] = [];
    const io = streams();

    const code = await runCli(["--provider", "mock", "--system", "BASE", "-p", "Hi"], {
      ...io,
      workspaceRoot: workspace,
      globalRoot: global,
      createSession: capturingSession(captured),
    });

    assert.equal(code, 0);
    assert.ok(captured.length >= 1);
    const text = textOf(captured[0]);
    // Base instructions, then SYSTEM.md (user base layer), then AGENTS.md (app layer) — Phase 31 rank.
    assert.match(text, /System instruction:\nBASE\n\nGLOBAL\n\nPROJECT/);
  });

  it("--no-agents-md removes only the AGENTS.md layer (SYSTEM.md stays)", async () => {
    const workspace = await makeRoot("no-agents-ws");
    const global = await makeRoot("no-agents-glob");
    await mkdir(join(global, ".prism", "agent"), { recursive: true });
    await writeFile(join(global, ".prism", "agent", "SYSTEM.md"), "GLOBAL");
    await writeFile(join(workspace, "AGENTS.md"), "PROJECT");
    const captured: ProviderRequest[] = [];
    const io = streams();

    const code = await runCli(["--provider", "mock", "--system", "BASE", "--no-agents-md", "-p", "Hi"], {
      ...io,
      workspaceRoot: workspace,
      globalRoot: global,
      createSession: capturingSession(captured),
    });

    assert.equal(code, 0);
    const text = textOf(captured[0]);
    assert.match(text, /GLOBAL/);
    assert.doesNotMatch(text, /PROJECT/);
  });

  it("--no-system-md removes only the SYSTEM.md layer (AGENTS.md stays)", async () => {
    const workspace = await makeRoot("no-system-ws");
    const global = await makeRoot("no-system-glob");
    await mkdir(join(global, ".prism", "agent"), { recursive: true });
    await writeFile(join(global, ".prism", "agent", "SYSTEM.md"), "GLOBAL");
    await writeFile(join(workspace, "AGENTS.md"), "PROJECT");
    const captured: ProviderRequest[] = [];
    const io = streams();

    const code = await runCli(["--provider", "mock", "--system", "BASE", "--no-system-md", "-p", "Hi"], {
      ...io,
      workspaceRoot: workspace,
      globalRoot: global,
      createSession: capturingSession(captured),
    });

    assert.equal(code, 0);
    const text = textOf(captured[0]);
    assert.match(text, /PROJECT/);
    assert.doesNotMatch(text, /GLOBAL/);
  });

  it("--agents-md-file / --system-md-file load from the given paths", async () => {
    const custom = await makeRoot("override");
    await writeFile(join(custom, "my-agents.md"), "CUSTOM-PROJECT");
    await writeFile(join(custom, "my-system.md"), "CUSTOM-GLOBAL");
    // workspaceRoot = custom so the override file's parent is trusted (CLI adds dirname(agentsMdFile) too).
    const captured: ProviderRequest[] = [];
    const io = streams();

    const code = await runCli(
      ["--provider", "mock", "--system", "BASE",
       "--agents-md-file", join(custom, "my-agents.md"),
       "--system-md-file", join(custom, "my-system.md"),
       "-p", "Hi"],
      { ...io, workspaceRoot: custom, createSession: capturingSession(captured) },
    );

    assert.equal(code, 0);
    const text = textOf(captured[0]);
    assert.match(text, /CUSTOM-GLOBAL/);
    assert.match(text, /CUSTOM-PROJECT/);
  });

  it("fake secret in AGENTS.md is redacted before reaching the provider request", async () => {
    const workspace = await makeRoot("secret-ws");
    const SECRET = "FAKE_SECRET_AKIAPHASE31TOKEN";
    await writeFile(join(workspace, "AGENTS.md"), `Project rule. Token: ${SECRET}`);
    const captured: ProviderRequest[] = [];
    const io = streams();

    const code = await runCli(["--provider", "mock", "-p", "Hi"], {
      ...io,
      workspaceRoot: workspace,
      createSession: capturingSession(captured, { redactor: createSecretRedactor([SECRET]) }),
    });

    assert.equal(code, 0);
    const text = textOf(captured[0]);
    assert.doesNotMatch(text, /FAKE_SECRET_AKIAPHASE31TOKEN/);
    assert.match(text, /\[REDACTED\]/);
    assert.match(text, /Project rule\./); // non-secret content survives
  });

  it("a source:run RunOptions.systemPrompt contribution appends on top of file layers", async () => {
    // ponytail: direct createAgent + session.run — RunOptions.systemPrompt is not exposed as a CLI
    // flag (YAGNI per plan), so the composition pipeline is tested here, not via runCli.
    const fileLayers: readonly SystemPromptContribution[] = [
      { id: "system-md", source: "user", mode: "append", text: "GLOBAL" },
      { id: "agents-md", source: "app", mode: "append", text: "PROJECT" },
    ];
    const captured: ProviderRequest[] = [];
    const provider = createMockProvider([{ type: "done" }], { onRequest: (req) => { captured.push(req); } });
    const session = createAgent({
      model: { provider: "mock", model: "m" },
      provider,
      instructions: "BASE",
      systemPrompt: fileLayers,
    }).createSession();

    await session.run("Hi", { systemPrompt: [{ id: "run-call", source: "run", mode: "append", text: "RUN" }] });

    assert.match(textOf(captured[0]), /System instruction:\nBASE\n\nGLOBAL\n\nPROJECT\n\nRUN/);
  });

  it("RunOptions.systemPrompt:false disables all file layers but keeps base instructions", async () => {
    // ponytail: direct createAgent + session.run — see above; RunOptions.systemPrompt:false is the
    // documented kill switch and isn't surfaced as a CLI flag.
    const fileLayers: readonly SystemPromptContribution[] = [
      { id: "system-md", source: "user", mode: "append", text: "GLOBAL" },
      { id: "agents-md", source: "app", mode: "append", text: "PROJECT" },
    ];
    const captured: ProviderRequest[] = [];
    const provider = createMockProvider([{ type: "done" }], { onRequest: (req) => { captured.push(req); } });
    const session = createAgent({
      model: { provider: "mock", model: "m" },
      provider,
      instructions: "BASE",
      systemPrompt: fileLayers,
    }).createSession();

    await session.run("Hi", { systemPrompt: false } as RunOptions);

    const text = textOf(captured[0]);
    assert.match(text, /System instruction:\nBASE/);
    assert.doesNotMatch(text, /GLOBAL/);
    assert.doesNotMatch(text, /PROJECT/);
  });
});
