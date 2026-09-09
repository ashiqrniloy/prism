import assert from "node:assert/strict";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { after, before, describe, it } from "node:test";
import { parseCliArgs, runCli } from "../cli-runner.js";
import { createAgent, createMockProvider, providerDone, providerTextDelta } from "../index.js";

const TEST_DIR = join(process.cwd(), "dist/__tests__/scratch-cli-extension-test");
const FIXTURE_REL = "./dist/__tests__/scratch-cli-extension-test/fixture.js";

class MemoryWritable extends Writable {
  chunks: string[] = [];
  _write(chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(String(chunk));
    callback();
  }
  text(): string {
    return this.chunks.join("");
  }
}

function streams(input = "") {
  return { stdin: Readable.from(input), stdout: new MemoryWritable(), stderr: new MemoryWritable() };
}

function session(text = "Hello") {
  return createAgent({
    model: { provider: "mock", model: "demo" },
    provider: createMockProvider([providerTextDelta(text), providerDone()]),
  }).createSession();
}

describe("cli --extension", () => {
  before(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    await writeFile(
      join(TEST_DIR, "fixture.js"),
      `export function createExtension() {
  return {
    name: "fixture-ext",
    setup(api) {
      api.registerTool({
        name: "echo_ext",
        execute: (_args, ctx) => ({ toolCallId: ctx.toolCallId, name: "echo_ext", value: "ok" }),
      });
    },
  };
}
`,
      "utf8",
    );
    await writeFile(join(TEST_DIR, "no-export.js"), `export const notAnExtension = true;\n`, "utf8");
  });

  after(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    delete process.env.PRISM_EXTENSION_ALLOWLIST;
  });

  it("cli_extension_relative_path_activates_tool", async () => {
    const parsed = parseCliArgs(["--extension", FIXTURE_REL, "--extension", FIXTURE_REL]);
    assert.deepEqual(parsed.extensions, [FIXTURE_REL, FIXTURE_REL]);

    const io = streams();
    let sawActivated = false;
    const code = await runCli(["--provider", "mock", "-p", "hi", "--extension", FIXTURE_REL], {
      ...io,
      createSession: (options) => {
        sawActivated = options.activatedExtensions?.tools.some((tool) => tool.name === "echo_ext") ?? false;
        return session();
      },
    });

    assert.equal(code, 0);
    assert.equal(sawActivated, true);
  });

  it("cli_extension_relative_escape_rejected", async () => {
    // Existing file that realpaths OUTSIDE the working directory: a symlink
    // from the scratch dir to a tmpdir file. realpath containment must reject
    // it even though the path text stays inside the workspace.
    const outside = join(tmpdir(), "prism-cli-ext-escape.js");
    await writeFile(outside, `export const notAnExtension = true;\n`, "utf8");
    const link = join(TEST_DIR, "escape.js");
    await symlink(outside, link);

    const io = streams();
    const code = await runCli(
      ["--provider", "mock", "-p", "hi", "--extension", `./dist/__tests__/scratch-cli-extension-test/escape.js`],
      io,
    );

    await rm(link, { force: true });
    await rm(outside, { force: true });
    assert.equal(code, 2);
    assert.match(io.stderr.text(), /escapes the working directory/);
  });

  it("cli_extension_bare_package_without_allowlist_rejected", async () => {
    delete process.env.PRISM_EXTENSION_ALLOWLIST;
    const io = streams();
    const code = await runCli(["--provider", "mock", "-p", "hi", "--extension", "@acme/prism-foo"], io);

    assert.equal(code, 2);
    assert.match(io.stderr.text(), /PRISM_EXTENSION_ALLOWLIST/);
  });

  it("cli_extension_bare_package_with_allowlist_imports", async () => {
    process.env.PRISM_EXTENSION_ALLOWLIST = "@arnilo/prism";
    const io = streams();
    // @arnilo/prism resolves and imports; it has no extension export, so the
    // failure is the export-shape error — proving the allow-list gate passed.
    const code = await runCli(["--provider", "mock", "-p", "hi", "--extension", "@arnilo/prism"], io);

    assert.equal(code, 2);
    assert.match(io.stderr.text(), /must export createExtension/);
  });

  it("cli_extension_bad_export_usage_error", async () => {
    const io = streams();
    const code = await runCli(
      ["--provider", "mock", "-p", "hi", "--extension", "./dist/__tests__/scratch-cli-extension-test/no-export.js"],
      io,
    );

    assert.equal(code, 2);
    assert.match(io.stderr.text(), /must export createExtension/);
  });

  it("cli_extension_missing_file_usage_error", async () => {
    const io = streams();
    const code = await runCli(["--provider", "mock", "-p", "hi", "--extension", "./does-not-exist.js"], io);

    assert.equal(code, 2);
    assert.match(io.stderr.text(), /does not exist/);
  });

  it("cli_config_resource_tool_still_unsupported", async () => {
    for (const flag of ["--config", "--resource", "--tool"]) {
      const io = streams();
      const code = await runCli([flag, "x", "--provider", "mock", "-p", "hi"], io);
      assert.equal(code, 2, flag);
      assert.match(io.stderr.text(), /not supported in this build/);
    }
  });

  it("cli_help_lists_extension", async () => {
    const io = streams();
    const code = await runCli(["--help"], io);

    assert.equal(code, 0);
    assert.match(io.stdout.text(), /--extension <specifier>/);
    assert.match(io.stdout.text(), /PRISM_EXTENSION_ALLOWLIST/);
  });
});
