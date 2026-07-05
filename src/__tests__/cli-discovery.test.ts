import { Readable, Writable } from "node:stream";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createAgent, createMockProvider, providerDone } from "../index.js";
import { createSkillRegistry } from "../skills.js";
import { parseCliArgs, runCli } from "../cli-runner.js";
import type { CliOptions } from "../cli-runner.js";
import type { AgentSession, ProviderRequest } from "../contracts.js";

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
  return mkdtemp(join(tmpdir(), `prism-cli-disc-${prefix}-`));
}

async function writeFileDeep(path: string, text: string): Promise<void> {
  const dir = path.split("/").slice(0, -1).join("/");
  await mkdir(dir, { recursive: true });
  await writeFile(path, text, "utf8");
}

/** Builds a session whose mock provider captures the assembled request messages,
 *  and whose skills come from the discovered skills threaded through CliOptions. */
function capturingSession(captured: ProviderRequest[]): (options: CliOptions) => AgentSession {
  return (options) => {
    const provider = createMockProvider([{ type: "done" }], {
      onRequest: (req) => { captured.push(req); },
    });
    return createAgent({
      model: { provider: "mock", model: "m" },
      provider,
      ...(options.discoveredSkills.length > 0 ? { skills: createSkillRegistry(options.discoveredSkills) } : {}),
    }).createSession();
  };
}

function textOf(request: ProviderRequest): string {
  return request.messages
    .flatMap((m) => (Array.isArray(m.content) ? m.content : [m.content]))
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n");
}

describe("cli discovery flags", () => {
  it("parses --discover / --discover-kinds / --no-discovery", () => {
    const parsed = parseCliArgs(["--discover", "--discover-kinds", "skill,tool", "-p", "Hi"]);
    assert.equal(parsed.discover, true);
    assert.deepEqual([...parsed.discoverKinds], ["skill", "tool"]);
    assert.equal(parsed.noDiscovery, false);

    const off = parseCliArgs(["--no-discovery", "-p", "Hi"]);
    assert.equal(off.discover, false);
    assert.equal(off.noDiscovery, true);
    assert.deepEqual([...off.discoverKinds], ["skill"]);
  });

  it("rejects invalid --discover-kinds values", () => {
    assert.throws(() => parseCliArgs(["--discover-kinds", "skill,bogus", "-p", "Hi"]), /Invalid kinds/);
  });

  it("rejects the removed --discover-global flag as unknown", () => {
    assert.throws(() => parseCliArgs(["--discover-global", "-p", "Hi"]), /Unknown flag: --discover-global/);
  });

  it("parses --agents-config <path>", () => {
    const parsed = parseCliArgs(["--agents-config", "/app/cfg", "-p", "Hi"]);
    assert.equal(parsed.agentsConfig, "/app/cfg");
    assert.deepEqual([...parsed.discoveredAgents], []);
  });

  it("--agents-config <path> loads agents from the given app config root", async () => {
    const configRoot = await makeRoot("agents-cfg");
    await writeFileDeep(`${configRoot}/agents/coding/AGENT.md`, "---\nname: coding\n---\nbody\n");
    await writeFileDeep(`${configRoot}/agents/office/AGENT.md`, "---\nname: office\n---\nbody\n");
    const seen: CliOptions[] = [];
    const io = streams();

    const code = await runCli(["--agents-config", configRoot, "-p", "Hi", "--provider", "mock"], {
      ...io,
      createSession: (options) => {
        seen.push(options);
        return createAgent({ model: { provider: "mock", model: "m" }, provider: createMockProvider([{ type: "done" }]) }).createSession();
      },
    });

    assert.equal(code, 0);
    assert.equal(seen[0].agentsConfig, configRoot);
    assert.equal(seen[0].discoveredAgents.length, 2);
    assert.deepEqual(seen[0].discoveredAgents.map((b) => b.name).sort(), ["coding", "office"]);
  });

  it("--discover activates a workspace skill and its instructions reach the provider input", async () => {
    const root = await makeRoot("ws");
    await writeFileDeep(
      `${root}/.agents/skills/greeter/SKILL.md`,
      "---\nname: greeter\ndescription: g\n---\nsay hi to the user warmly\n",
    );
    const captured: ProviderRequest[] = [];
    const io = streams();

    const code = await runCli(["--discover", "-p", "Hi", "--provider", "mock"], {
      ...io,
      workspaceRoot: root,
      createSession: capturingSession(captured),
    });

    assert.equal(code, 0);
    assert.ok(captured.length >= 1, "provider was called");
    const input = textOf(captured[0]);
    assert.match(input, /Skill greeter:/);
    assert.match(input, /say hi to the user warmly/);
  });

  it("default run (no --discover) performs no discovery; discoveredSkills stays empty", async () => {
    const root = await makeRoot("default");
    await writeFileDeep(`${root}/.agents/skills/greeter/SKILL.md`, "---\nname: greeter\n---\nb\n");
    const seen: CliOptions[] = [];
    const io = streams();

    const code = await runCli(["-p", "Hi", "--provider", "mock"], {
      ...io,
      workspaceRoot: root,
      createSession: (options) => {
        seen.push(options);
        return createAgent({ model: { provider: "mock", model: "m" }, provider: createMockProvider([{ type: "done" }]) }).createSession();
      },
    });

    assert.equal(code, 0);
    assert.equal(seen[0].discover, false);
    assert.equal(seen[0].discoveredSkills.length, 0);
  });

  it("--no-discovery hard-disables discovery even with --discover set", async () => {
    const root = await makeRoot("nodisc");
    await writeFileDeep(`${root}/.agents/skills/greeter/SKILL.md`, "---\nname: greeter\n---\nb\n");
    const seen: CliOptions[] = [];
    const io = streams();

    const code = await runCli(["--discover", "--no-discovery", "-p", "Hi", "--provider", "mock"], {
      ...io,
      workspaceRoot: root,
      createSession: (options) => {
        seen.push(options);
        return createAgent({ model: { provider: "mock", model: "m" }, provider: createMockProvider([{ type: "done" }]) }).createSession();
      },
    });

    assert.equal(code, 0);
    assert.equal(seen[0].discoveredSkills.length, 0);
  });

  it("--discover-kinds skill ignores stray tool dirs (only skills discovered)", async () => {
    const root = await makeRoot("kindskill");
    await writeFileDeep(`${root}/.agents/skills/greeter/SKILL.md`, "---\nname: greeter\n---\ninstr\n");
    await writeFileDeep(`${root}/.agents/tools/stray/manifest.json`, JSON.stringify({ name: "stray", module: "@x/stray" }));
    const seen: CliOptions[] = [];
    const io = streams();

    const code = await runCli(["--discover", "--discover-kinds", "skill", "-p", "Hi", "--provider", "mock"], {
      ...io,
      workspaceRoot: root,
      createSession: (options) => {
        seen.push(options);
        return createAgent({
          model: { provider: "mock", model: "m" },
          provider: createMockProvider([{ type: "done" }]),
          skills: createSkillRegistry(options.discoveredSkills),
        }).createSession();
      },
    });

    assert.equal(code, 0);
    assert.equal(seen[0].discoveredSkills.length, 1);
    assert.equal(seen[0].discoveredSkills[0].name, "greeter");
  });

});
