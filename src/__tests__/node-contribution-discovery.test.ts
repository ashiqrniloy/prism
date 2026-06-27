import { mkdtemp, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { discoverContributions } from "../node/contribution-discovery.js";

async function makeRoot(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `prism-disc-${prefix}-`));
}

async function writeFileDeep(path: string, text: string): Promise<void> {
  const dir = path.split("/").slice(0, -1).join("/");
  await mkdir(dir, { recursive: true });
  await writeFile(path, text, "utf8");
}

describe("discoverContributions", () => {
  it("discovers a workspace skill with parsed Skill fields and origin workspace", async () => {
    const root = await makeRoot("ws-skill");
    await writeFileDeep(
      `${root}/.agent/skills/my-skill/SKILL.md`,
      "---\nname: my-skill\ndescription: greets\ntoolNames: [greet-tool]\n---\n\nsay hi\n",
    );

    const found = await discoverContributions({ kinds: ["skill"], workspaceRoot: root });

    assert.equal(found.length, 1);
    const entry = found[0];
    assert.equal(entry.kind, "skill");
    assert.equal(entry.name, "my-skill");
    assert.equal(entry.origin, "workspace");
    assert.equal(entry.skill?.description, "greets");
    assert.deepEqual([...(entry.skill?.toolNames ?? [])], ["greet-tool"]);
    assert.match(entry.skill?.instructions ?? "", /^say hi/);
  });

  it("discovers a global skill with origin global", async () => {
    const globalRoot = await mkdtemp(join(tmpdir(), "prism-disc-global-"));
    await writeFileDeep(
      `${globalRoot}/.prism/agent/skills/global-skill/SKILL.md`,
      "---\nname: global-skill\ndescription: g\n---\nbody\n",
    );

    const found = await discoverContributions({ kinds: ["skill"], globalRoot, workspaceRoot: undefined });

    assert.equal(found.length, 1);
    assert.equal(found[0].origin, "global");
    assert.equal(found[0].name, "global-skill");
  });

  it("same-name global + workspace yields one entry, workspace wins", async () => {
    const globalRoot = await mkdtemp(join(tmpdir(), "prism-merge-g-"));
    const workspaceRoot = await makeRoot("merge-ws");
    await writeFileDeep(
      `${globalRoot}/.prism/agent/skills/dup/SKILL.md`,
      "---\nname: dup\ndescription: global-text\n---\ngbody\n",
    );
    await writeFileDeep(
      `${workspaceRoot}/.agent/skills/dup/SKILL.md`,
      "---\nname: dup\ndescription: workspace-text\n---\nwbody\n",
    );

    const found = await discoverContributions({ kinds: ["skill"], globalRoot, workspaceRoot });

    assert.equal(found.length, 1);
    assert.equal(found[0].origin, "workspace");
    assert.equal(found[0].skill?.description, "workspace-text");
  });

  it("missing kind directory returns no entries and does not throw", async () => {
    const root = await makeRoot("missing");
    const found = await discoverContributions({ kinds: ["skill", "tool"], workspaceRoot: root });
    assert.equal(found.length, 0);
  });

  it("discovers a tool dir via manifest.json as a declaration", async () => {
    const root = await makeRoot("tool");
    await writeFileDeep(
      `${root}/.agent/tools/my-tool/manifest.json`,
      JSON.stringify({ name: "my-tool", module: "@scope/my-tool", exportName: "default", metadata: { x: 1 } }),
    );

    const found = await discoverContributions({ kinds: ["tool"], workspaceRoot: root });

    assert.equal(found.length, 1);
    assert.equal(found[0].kind, "tool");
    assert.equal(found[0].declaration?.kind, "tool");
    assert.equal(found[0].declaration?.module, "@scope/my-tool");
    assert.equal(found[0].declaration?.exportName, "default");
    assert.deepEqual(found[0].declaration?.metadata, { x: 1 });
  });

  it("discovers an agent dir via AGENT.md as a declaration with resource", async () => {
    const root = await makeRoot("agent");
    await writeFileDeep(
      `${root}/.agent/agents/agent-x/AGENT.md`,
      "---\nname: agent-x\ndescription: an agent\n---\nbody\n",
    );

    const found = await discoverContributions({ kinds: ["agent"], workspaceRoot: root });

    assert.equal(found.length, 1);
    assert.equal(found[0].kind, "agent");
    assert.equal(found[0].declaration?.kind, "agent");
    assert.equal(found[0].declaration?.resource, join(root, ".agent", "agents", "agent-x", "AGENT.md"));
    assert.equal(found[0].declaration?.metadata?.description, "an agent");
  });

  it("performs no import(); file content is read, not module-loaded", async () => {
    // A skill file containing JS-like text is never evaluated as code.
    const root = await makeRoot("noeval");
    await writeFileDeep(
      `${root}/.agent/skills/j-skill/SKILL.md`,
      "---\nname: j-skill\n---\nrequire('fs')\nprocess.exit(1)\n",
    );
    const found = await discoverContributions({ kinds: ["skill"], workspaceRoot: root });
    assert.equal(found.length, 1);
    assert.match(found[0].skill?.instructions ?? "", /require\('fs'\)/);
  });

  it("untrusted workspace root yields no entries and does not throw; kind-root not read", async () => {
    const root = await makeRoot("untrusted");
    await writeFileDeep(
      `${root}/.agent/skills/s/SKILL.md`,
      "---\nname: s\n---\nb\n",
    );
    const checked: string[] = [];
    const trust = {
      check: (req: { target: string }) => {
        checked.push(req.target);
        return { trusted: false, reason: "nope" };
      },
    };

    const found = await discoverContributions({ kinds: ["skill"], workspaceRoot: root, trust });

    assert.equal(found.length, 0);
    assert.ok(checked.some((t) => t.endsWith(".agent/skills")), "kind-root was trust-checked");
  });

  it("trusted workspace root invokes permission per directory read inside the root", async () => {
    const root = await makeRoot("perm");
    await writeFileDeep(`${root}/.agent/skills/a/SKILL.md`, "---\nname: a\n---\nb\n");
    await writeFileDeep(`${root}/.agent/skills/b/SKILL.md`, "---\nname: b\n---\nb\n");
    const checked: string[] = [];
    const permission = {
      check: (req: { kind: string; action: string; target: string }) => {
        checked.push(`${req.kind}:${req.action}:${req.target}`);
        return { allowed: true };
      },
    };

    const found = await discoverContributions({ kinds: ["skill"], workspaceRoot: root, permission });

    assert.equal(found.length, 2);
    assert.ok(checked.every((c) => c.startsWith("resource:load:")), "every read gated by permission");
  });

  it("symlink escaping the workspace kind-root is excluded", async () => {
    const root = await makeRoot("symlink");
    const outside = await mkdtemp(join(tmpdir(), "prism-outside-"));
    await writeFileDeep(`${outside}/SKILL.md`, "---\nname: escaped\n---\nb\n");
    await mkdir(`${root}/.agent/skills`, { recursive: true });
    await symlink(outside, `${root}/.agent/skills/escaped`, "dir");

    const found = await discoverContributions({ kinds: ["skill"], workspaceRoot: root });

    assert.equal(found.length, 0);
  });

  it("global root not scanned when not passed; no FS access to real homedir", async () => {
    // workspace only; no globalRoot → global dir (real homedir/~/.prism) must NOT be touched.
    const root = await makeRoot("noglobal");
    await writeFileDeep(`${root}/.agent/skills/only-ws/SKILL.md`, "---\nname: only-ws\n---\nb\n");
    const checked: string[] = [];
    const trust = {
      check: (req: { target: string }) => {
        checked.push(req.target);
        return { trusted: true };
      },
    };

    const found = await discoverContributions({ kinds: ["skill"], workspaceRoot: root, trust });

    assert.equal(found.length, 1);
    assert.equal(found[0].name, "only-ws");
    assert.ok(checked.every((t) => !t.includes(".prism")),
      "global root never scanned when globalRoot omitted");
  });

  it("contribution-discovery subpath is declared in package exports", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as { exports: Record<string, unknown> };
    assert.deepEqual(packageJson.exports["./node/contribution-discovery"], {
      types: "./dist/node/contribution-discovery.d.ts",
      default: "./dist/node/contribution-discovery.js",
    });
  });
});
