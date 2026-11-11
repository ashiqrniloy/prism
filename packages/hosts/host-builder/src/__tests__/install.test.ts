import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HostBuilderError } from "../errors.js";
import { describeInstall, installHostBuilder } from "../install/install.js";
import { INSTALL_TARGET_NAMES, INSTALL_TARGETS, isInstallTargetName, SERVER_ENTRY } from "../install/targets.js";
import { cleanup, tempDir, write } from "./fixture.js";

afterEach(cleanup);

const BIN = join(import.meta.dirname, "../../bin/prism-host-builder.ts");
const STAMP = ".prism-host-builder.json";
const SKILL = "prism-host-builder";

function project(): string {
  return tempDir("host-builder-install-");
}

function read(root: string, path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function tree(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(join(dir, entry.name), rel);
      else out.push(rel);
    }
  };
  walk(root, "");
  return out.sort();
}

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof HostBuilderError) return error.code;
    throw error;
  }
  return "no error";
}

describe("installer", () => {
  it("install_copies_skill_per_target", () => {
    for (const target of INSTALL_TARGET_NAMES) {
      const root = project();
      const result = installHostBuilder({ target, root });
      const dir = `${INSTALL_TARGETS[target].skillDir}/${SKILL}`;
      assert.equal(result.skill.status, "installed", target);
      assert.equal(result.skill.dir, dir);
      assert.match(read(root, `${dir}/SKILL.md`), /^---\nname: prism-host-builder/, target);
      assert.ok(existsSync(join(root, dir, "references/pitfalls.md")), target);
      const stamp = JSON.parse(read(root, `${dir}/${STAMP}`));
      assert.equal(stamp.package, "@arnilo/prism-hosts/host-builder");
      assert.match(stamp.contentHash, /^[0-9a-f]{64}$/);
      assert.ok(stamp.files.includes("SKILL.md"));
      // Without --mcp, no agent configuration is touched.
      assert.ok(!existsSync(join(root, ".mcp.json")) && !existsSync(join(root, ".cursor")) && !existsSync(join(root, ".codex")), target);
    }
  });

  it("install_merges_mcp_json_preserving_entries", () => {
    for (const [target, file] of [
      ["claude", ".mcp.json"],
      ["cursor", ".cursor/mcp.json"],
    ] as const) {
      const root = project();
      const original = `{\n    "theme": "dark",\n    "mcpServers": {\n        "other": { "command": "x", "env": { "A": "kept" } }\n    },\n    "last": [1, 2]\n}\n`;
      write(root, file, original);
      const result = installHostBuilder({ target, root, mcp: true });
      assert.equal(result.mcp?.status, "added");
      const text = read(root, file);
      const parsed = JSON.parse(text);
      assert.deepEqual(Object.keys(parsed), ["theme", "mcpServers", "last"]);
      assert.deepEqual(parsed.mcpServers.other, { command: "x", env: { A: "kept" } });
      assert.deepEqual(parsed.mcpServers.prism, SERVER_ENTRY);
      assert.deepEqual(parsed.last, [1, 2]);
      // The file's own 4-space indent and trailing newline are kept.
      assert.match(text, /\n {4}"theme": "dark"/);
      assert.ok(text.endsWith("}\n"));
      // No secret and no env on the entry.
      assert.deepEqual(Object.keys(parsed.mcpServers.prism).sort(), ["args", "command"]);
    }
  });

  it("creates the config file with 2-space JSON when it is missing", () => {
    const root = project();
    installHostBuilder({ target: "claude", root, mcp: true });
    assert.equal(read(root, ".mcp.json"), `${JSON.stringify({ mcpServers: { prism: SERVER_ENTRY } }, null, 2)}\n`);
  });

  it("an identical server entry is a no-op and a different one is a conflict until --force", () => {
    const root = project();
    installHostBuilder({ target: "claude", root, mcp: true });
    const before = read(root, ".mcp.json");
    assert.equal(installHostBuilder({ target: "claude", root, mcp: true }).mcp?.status, "unchanged");
    assert.equal(read(root, ".mcp.json"), before);

    write(root, ".mcp.json", JSON.stringify({ mcpServers: { prism: { command: "node", args: ["mine.js"] } } }));
    assert.equal(
      code(() => installHostBuilder({ target: "claude", root, mcp: true })),
      "ERR_PRISM_HOST_BUILDER_INSTALL_CONFLICT",
    );
    assert.deepEqual(JSON.parse(read(root, ".mcp.json")).mcpServers.prism, { command: "node", args: ["mine.js"] });
    assert.equal(installHostBuilder({ target: "claude", root, mcp: true, force: true }).mcp?.status, "replaced");
    assert.deepEqual(JSON.parse(read(root, ".mcp.json")).mcpServers.prism, SERVER_ENTRY);
  });

  it("install_non_json_target_prints_snippet_writes_nothing", () => {
    const root = project();
    const result = installHostBuilder({ target: "codex", root, mcp: true });
    assert.equal(result.mcp?.status, "snippet");
    assert.equal(result.mcp?.file, ".codex/config.toml");
    assert.equal(
      result.mcp?.snippet,
      '[mcp_servers.prism]\ncommand = "bunx"\nargs = ["--package", "@arnilo/prism-hosts", "prism-host-builder", "mcp"]',
    );
    assert.ok(describeInstall(result).join("\n").includes("[mcp_servers.prism]"));
    assert.ok(!existsSync(join(root, ".codex")));
    // The skill still lands in .agents/skills, which Codex reads.
    assert.ok(existsSync(join(root, ".agents/skills", SKILL, "SKILL.md")));
  });

  it("prism target prints the packages snippet; agents with --mcp says there is no config", () => {
    const prism = installHostBuilder({ target: "prism", root: project() });
    const text = describeInstall(prism).join("\n");
    assert.match(text, /@arnilo\/prism-extensions\/context-files/);
    assert.match(text, /@arnilo\/prism-extensions\/mcp/);
    assert.match(text, /args: \["--package", "@arnilo\/prism-hosts", "prism-host-builder", "mcp"\]/);
    const agents = installHostBuilder({ target: "agents", root: project(), mcp: true });
    assert.equal(agents.mcp, undefined);
    assert.match(agents.notes.join("\n"), /no MCP configuration/);
  });

  it("install_same_version_noop", () => {
    const root = project();
    installHostBuilder({ target: "agents", root });
    const stamp = read(root, `.agents/skills/${SKILL}/${STAMP}`);
    const second = installHostBuilder({ target: "agents", root });
    assert.equal(second.skill.status, "unchanged");
    assert.equal(read(root, `.agents/skills/${SKILL}/${STAMP}`), stamp);
  });

  it("install_upgrade_replaces_unmodified", () => {
    const root = project();
    installHostBuilder({ target: "agents", root });
    const dir = `.agents/skills/${SKILL}`;
    // Pretend an older version installed a file the current skill no longer has.
    const stampPath = join(root, dir, STAMP);
    const stamp = JSON.parse(readFileSync(stampPath, "utf8"));
    writeFileSync(join(root, dir, "references/old.md"), "old\n");
    const SKILL_MD = readFileSync(join(root, dir, "SKILL.md"), "utf8");
    writeFileSync(join(root, dir, "SKILL.md"), "old skill\n");
    const files = [...stamp.files, "references/old.md"];
    const hash = createHash("sha256");
    for (const path of files) {
      const bytes = readFileSync(join(root, dir, path));
      hash.update(path);
      hash.update("\0");
      hash.update(String(bytes.length));
      hash.update("\0");
      hash.update(bytes);
      hash.update("\0");
    }
    writeFileSync(stampPath, JSON.stringify({ ...stamp, version: "0.0.1", contentHash: hash.digest("hex"), files }));
    const result = installHostBuilder({ target: "agents", root });
    assert.equal(result.skill.status, "upgraded");
    assert.equal(readFileSync(join(root, dir, "SKILL.md"), "utf8"), SKILL_MD);
    assert.ok(!existsSync(join(root, dir, "references/old.md")));
    assert.notEqual(JSON.parse(readFileSync(stampPath, "utf8")).version, "0.0.1");
  });

  it("install_local_edits_conflict", () => {
    const root = project();
    installHostBuilder({ target: "agents", root });
    const dir = `.agents/skills/${SKILL}`;
    const stampPath = join(root, dir, STAMP);
    const stamp = JSON.parse(readFileSync(stampPath, "utf8"));
    writeFileSync(stampPath, JSON.stringify({ ...stamp, version: "0.0.1" }));
    writeFileSync(join(root, dir, "SKILL.md"), "my edit\n");
    // The stamp's hash no longer matches the disk: a different version must not overwrite it.
    assert.equal(
      code(() => installHostBuilder({ target: "agents", root })),
      "ERR_PRISM_HOST_BUILDER_INSTALL_CONFLICT",
    );
    assert.equal(read(root, `${dir}/SKILL.md`), "my edit\n");
    // A same-version install keeps the edit too.
    writeFileSync(stampPath, JSON.stringify(stamp));
    assert.equal(installHostBuilder({ target: "agents", root }).skill.status, "unchanged");
    assert.equal(read(root, `${dir}/SKILL.md`), "my edit\n");
  });

  it("install_force_overwrites", () => {
    const root = project();
    installHostBuilder({ target: "agents", root });
    const dir = `.agents/skills/${SKILL}`;
    writeFileSync(join(root, dir, "SKILL.md"), "my edit\n");
    const result = installHostBuilder({ target: "agents", root, force: true });
    assert.equal(result.skill.status, "overwritten");
    assert.match(read(root, `${dir}/SKILL.md`), /^---\nname: prism-host-builder/);

    // A directory that is not ours is a conflict until --force, and --force leaves its other files alone.
    const other = project();
    write(other, `.claude/skills/${SKILL}/SKILL.md`, "someone else\n");
    write(other, `.claude/skills/${SKILL}/mine.md`, "keep\n");
    assert.equal(
      code(() => installHostBuilder({ target: "claude", root: other })),
      "ERR_PRISM_HOST_BUILDER_INSTALL_CONFLICT",
    );
    assert.equal(installHostBuilder({ target: "claude", root: other, force: true }).skill.status, "overwritten");
    assert.equal(read(other, `.claude/skills/${SKILL}/mine.md`), "keep\n");
  });

  it("install_malformed_config_refused", () => {
    for (const text of ["{ not json", "", "[1]", '{ "mcpServers": [] }', '{ // c\n "mcpServers": {} }']) {
      const root = project();
      write(root, ".mcp.json", text);
      assert.equal(
        code(() => installHostBuilder({ target: "claude", root, mcp: true })),
        "ERR_PRISM_HOST_BUILDER_INSTALL_CONFIG",
        text,
      );
      assert.equal(read(root, ".mcp.json"), text);
      // Nothing was written, not even the skill.
      assert.ok(!existsSync(join(root, ".claude")), text);
    }
  });

  it("install_outside_root_refused", () => {
    const outside = project();
    const root = project();
    symlinkSync(outside, join(root, ".claude"));
    assert.equal(
      code(() => installHostBuilder({ target: "claude", root })),
      "ERR_PRISM_HOST_BUILDER_INSTALL_ROOT",
    );
    assert.deepEqual(tree(outside), []);

    const mcpRoot = project();
    const target = join(outside, "elsewhere.json");
    symlinkSync(target, join(mcpRoot, ".mcp.json"));
    assert.equal(
      code(() => installHostBuilder({ target: "claude", root: mcpRoot, mcp: true })),
      "ERR_PRISM_HOST_BUILDER_INSTALL_ROOT",
    );
    assert.ok(!existsSync(target));

    assert.equal(
      code(() => installHostBuilder({ target: "claude", root: join(root, "missing") })),
      "ERR_PRISM_HOST_BUILDER_INSTALL_ROOT",
    );
  });

  it("a symlink inside the root is followed, so .claude/skills -> .agents/skills is one copy", () => {
    const root = project();
    mkdirSync(join(root, ".agents/skills"), { recursive: true });
    mkdirSync(join(root, ".claude"));
    symlinkSync(join(root, ".agents/skills"), join(root, ".claude/skills"));
    installHostBuilder({ target: "agents", root });
    const second = installHostBuilder({ target: "claude", root });
    assert.equal(second.skill.status, "unchanged");
    assert.deepEqual(second.notes, []);
    assert.ok(lstatSync(join(root, ".claude/skills")).isSymbolicLink());
  });

  it("two distinct directories warn that Cursor would list the skill twice", () => {
    const root = project();
    installHostBuilder({ target: "agents", root });
    const result = installHostBuilder({ target: "claude", root });
    assert.match(result.notes.join("\n"), /\.agents\/skills\/prism-host-builder also holds a copy/);
  });

  it("install_dry_run_writes_nothing", () => {
    const root = project();
    write(root, ".mcp.json", '{"mcpServers":{}}');
    const result = installHostBuilder({ target: "claude", root, mcp: true, dryRun: true });
    assert.equal(result.dryRun, true);
    assert.equal(result.skill.status, "installed");
    assert.equal(result.mcp?.status, "added");
    assert.deepEqual(tree(root), [".mcp.json"]);
    assert.equal(read(root, ".mcp.json"), '{"mcpServers":{}}');
    assert.match(describeInstall(result)[0] as string, /dry run/);
  });

  it("a conflict in the config stops the install before the skill is written", () => {
    const root = project();
    write(root, ".mcp.json", JSON.stringify({ mcpServers: { prism: { command: "other" } } }));
    assert.equal(
      code(() => installHostBuilder({ target: "claude", root, mcp: true })),
      "ERR_PRISM_HOST_BUILDER_INSTALL_CONFLICT",
    );
    assert.ok(!existsSync(join(root, ".claude")));
  });
});

describe("install targets", () => {
  it("names are a table lookup; anything else is not a target", () => {
    for (const name of INSTALL_TARGET_NAMES) assert.equal(isInstallTargetName(name), true);
    for (const name of ["vim", "", "toString", "__proto__"]) assert.equal(isInstallTargetName(name), false, name);
    assert.throws(() => installHostBuilder({ target: "toString" as never, root: project() }), RangeError);
  });
});

describe("install bin", () => {
  function run(...args: string[]) {
    return spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", timeout: 30_000 });
  }

  it("installs into --root, prints the result and exits 0", () => {
    const root = project();
    const result = run("install", "--target", "claude", "--mcp", "--root", root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /skill installed: \.claude\/skills\/prism-host-builder/);
    assert.match(result.stdout, /mcp added: "prism" in \.mcp\.json/);
    assert.ok(existsSync(join(root, ".mcp.json")));
  });

  it("a missing or unknown target and an unknown option exit 2; a conflict exits 1 with its code", () => {
    assert.equal(run("install").status, 2);
    const unknown = run("install", "--target", "vim");
    assert.equal(unknown.status, 2);
    assert.match(unknown.stderr, /unknown install target "vim"/);
    assert.equal(run("install", "--target", "claude", "--bogus").status, 2);
    assert.equal(run("install", "--target").status, 2);

    const root = project();
    write(root, ".mcp.json", "{ nope");
    const refused = run("install", "--target", "claude", "--mcp", "--root", root);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /ERR_PRISM_HOST_BUILDER_INSTALL_CONFIG/);
  });

  it("--dry-run writes nothing", () => {
    const root = project();
    const result = run("install", "--target", "agents", "--dry-run", "--root", root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /dry run/);
    assert.deepEqual(tree(root), []);
  });
});
