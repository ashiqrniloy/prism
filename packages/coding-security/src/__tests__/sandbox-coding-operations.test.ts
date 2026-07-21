import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolExecutionContext } from "@arnilo/prism";
import type {
  EditOperations,
  ReadOperations,
  RepositoryOperations,
  WriteOperations,
} from "@arnilo/prism-coding-agent";
import {
  createSandboxBashOperations,
  createSandboxCodingComposition,
  createSandboxCodingTools,
  createSandboxReadOnlyComposition,
  createSandboxReadOnlyTools,
  SandboxCodingCompositionError,
  type DisposableSandbox,
  type SandboxAdapter,
} from "../index.js";

let counter = 0;
function ctx(): ToolExecutionContext {
  return { sessionId: "s", runId: "r", toolCallId: `tc-${counter++}` };
}

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "sandbox-coding-"));
}

function fakeSandbox(): SandboxAdapter {
  return {
    exec: async (request) => {
      request.onData?.(Buffer.from("sandboxed\n"));
      return { exitCode: 0 };
    },
  };
}

function fakeDisposable(): DisposableSandbox {
  return {
    id: "sb-test",
    exec: async () => ({ exitCode: 0 }),
    execFile: async () => ({ exitCode: 0 }),
    status: async () => ({
      id: "sb-test",
      state: "running",
      image: "test@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      startedAt: 0,
      lastActivityAt: 0,
      commandCount: 0,
    }),
    stop: async () => undefined,
    kill: async () => undefined,
    close: async () => undefined,
  };
}

/** Minimal stubs — composition only checks that operations objects are present. */
function stubTreeOps(): {
  read: ReadOperations;
  write: WriteOperations;
  edit: EditOperations;
  repository: RepositoryOperations;
} {
  const boom = async () => {
    throw new Error("stub ops not for execution");
  };
  return {
    read: {
      readFile: boom as ReadOperations["readFile"],
      readText: boom as ReadOperations["readText"],
      access: boom,
      statFile: boom as ReadOperations["statFile"],
    },
    write: {
      writeFile: boom,
      mkdir: boom,
    },
    edit: {
      readFile: boom as EditOperations["readFile"],
      writeFile: boom,
      access: boom,
      statFile: boom as EditOperations["statFile"],
    },
    repository: {
      list: boom as RepositoryOperations["list"],
      search: boom as RepositoryOperations["search"],
    },
  };
}

test("missing workspaceMode throws", () => {
  assert.throws(
    () =>
      createSandboxCodingTools("/tmp", {
        sandbox: fakeSandbox(),
      } as never),
    (err: unknown) =>
      err instanceof SandboxCodingCompositionError && /workspaceMode is required/.test(err.message),
  );
});

test("host mode uses local FS and does not claim containment", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "note.txt"), "host-local\n");
    const { tools, composition } = createSandboxCodingComposition(cwd, {
      workspaceMode: "host",
    });
    assert.equal(composition.workspaceMode, "host");
    assert.equal(composition.containmentClaim, false);
    assert.equal(composition.warnings.length, 0);
    assert.equal(composition.workspaceRoot, cwd);
    assert.deepEqual(
      tools.map((t) => t.name),
      ["shell", "read", "write", "edit", "repo_list", "repo_search"],
    );
    const read = tools.find((t) => t.name === "read")!;
    const result = await read.execute({ path: "note.txt" }, ctx());
    assert.equal(result.error, undefined);
    assert.match(
      String(result.content?.[0] && result.content[0].type === "text" ? result.content[0].text : ""),
      /host-local/,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("host mode with sandbox shell throws without escape hatch", () => {
  assert.throws(
    () =>
      createSandboxCodingTools("/tmp", {
        workspaceMode: "host",
        sandbox: fakeSandbox(),
      }),
    (err: unknown) =>
      err instanceof SandboxCodingCompositionError && /mixed wiring/.test(err.message),
  );
});

test("host mode with sandbox shell + escape hatch warns and does not claim containment", () => {
  const { tools, composition } = createSandboxCodingComposition("/tmp", {
    workspaceMode: "host",
    sandbox: fakeSandbox(),
    allowMixedWorkspaceWiring: true,
  });
  assert.equal(composition.containmentClaim, false);
  assert.equal(composition.mixedWiringAllowed, true);
  assert.ok(composition.warnings.some((w) => /mixed workspace wiring/.test(w)));
  assert.ok(tools.some((t) => t.name === "shell"));
});

test("sandbox mode without backends or DisposableSandbox throws", () => {
  assert.throws(
    () =>
      createSandboxCodingTools("/tmp", {
        workspaceMode: "sandbox",
        sandbox: fakeSandbox(),
      }),
    (err: unknown) =>
      err instanceof SandboxCodingCompositionError &&
      /DisposableSandbox|custom read\/write\/edit|allowMixedWorkspaceWiring/.test(err.message),
  );
});

test("sandbox mode with DisposableSandbox auto-wires FS backends and claims containment", () => {
  const sandbox: DisposableSandbox = {
    id: "sb-test",
    exec: async () => ({ exitCode: 0 }),
    execFile: async () => ({ exitCode: 0 }),
    status: async () => ({
      id: "sb-test",
      state: "running",
      image: "test@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      startedAt: 0,
      lastActivityAt: 0,
      commandCount: 0,
    }),
    stop: async () => undefined,
    kill: async () => undefined,
    close: async () => undefined,
  };
  const { composition } = createSandboxCodingComposition("/tmp", {
    workspaceMode: "sandbox",
    sandbox,
  });
  assert.equal(composition.containmentClaim, true);
  assert.equal(composition.workspaceRoot, "/workspace");
  assert.equal(composition.warnings.length, 0);
});

test("sandbox mode without backends allowed via escape hatch with warnings", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "note.txt"), "hello from workspace\n");
    await writeFile(join(cwd, "hit.ts"), "findMe\n");

    let shellCommands = 0;
    const sandbox: SandboxAdapter = {
      exec: async (request) => {
        shellCommands++;
        assert.equal(request.cwd, cwd);
        request.onData?.(Buffer.from("sandboxed\n"));
        return { exitCode: 0 };
      },
    };

    const { tools, composition } = createSandboxCodingComposition(cwd, {
      workspaceMode: "sandbox",
      sandbox,
      allowMixedWorkspaceWiring: true,
      repository: { maxResults: 50, exclude: [".git"] },
    });
    assert.equal(composition.containmentClaim, false);
    assert.ok(composition.warnings.some((w) => /mixed workspace wiring/.test(w)));

    const shell = tools.find((t) => t.name === "shell")!;
    const list = tools.find((t) => t.name === "repo_list")!;
    const search = tools.find((t) => t.name === "repo_search")!;
    const read = tools.find((t) => t.name === "read")!;

    assert.equal((await shell.execute({ command: "echo hi" }, ctx())).error, undefined);
    assert.equal(shellCommands, 1);

    const listResult = await list.execute({}, ctx());
    assert.equal(listResult.error, undefined);
    assert.match(
      String(
        listResult.content?.[0] && listResult.content[0].type === "text"
          ? listResult.content[0].text
          : "",
      ),
      /hit\.ts/,
    );

    const searchResult = await search.execute({ query: "findMe" }, ctx());
    assert.equal(searchResult.error, undefined);
    assert.equal(searchResult.metadata?.matchCount, 1);

    const readResult = await read.execute({ path: "note.txt" }, ctx());
    assert.equal(readResult.error, undefined);
    assert.match(
      String(
        readResult.content?.[0] && readResult.content[0].type === "text"
          ? readResult.content[0].text
          : "",
      ),
      /hello from workspace/,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("sandbox mode with custom tree operations claims containment", () => {
  const ops = stubTreeOps();
  const { composition } = createSandboxCodingComposition("/tmp", {
    workspaceMode: "sandbox",
    sandbox: fakeSandbox(),
    workspaceRoot: "/workspace",
    read: { operations: ops.read },
    write: { operations: ops.write },
    edit: { operations: ops.edit },
    repository: { operations: ops.repository },
  });
  assert.equal(composition.workspaceMode, "sandbox");
  assert.equal(composition.containmentClaim, true);
  assert.equal(composition.warnings.length, 0);
  assert.equal(composition.workspaceRoot, "/workspace");
});

test("createSandboxReadOnlyTools host mode excludes mutating tools", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "a.ts"), "marker\n");
    const { tools, composition } = createSandboxReadOnlyComposition(cwd, {
      workspaceMode: "host",
    });
    assert.equal(composition.containmentClaim, false);
    assert.deepEqual(
      tools.map((t) => t.name),
      ["read", "repo_list", "repo_search"],
    );
    const search = tools.find((t) => t.name === "repo_search")!;
    const result = await search.execute({ query: "marker" }, ctx());
    assert.equal(result.error, undefined);
    assert.equal(result.metadata?.matchCount, 1);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("createSandboxReadOnlyTools sandbox mode without backends throws", () => {
  assert.throws(
    () =>
      createSandboxReadOnlyTools("/tmp", {
        workspaceMode: "sandbox",
        sandbox: fakeSandbox(),
      }),
    SandboxCodingCompositionError,
  );
});

test("compat wrappers return tools only", () => {
  const tools = createSandboxCodingTools("/tmp", { workspaceMode: "host" });
  assert.ok(Array.isArray(tools));
  assert.ok(tools.every((t) => typeof t.name === "string" && typeof t.execute === "function"));
});

test("createSandboxBashOperations remains compatible with explicit shell wiring", async () => {
  const calls: string[] = [];
  const adapter: SandboxAdapter = {
    exec: async ({ command }) => {
      calls.push(command);
      return { exitCode: 0 };
    },
  };
  const ops = createSandboxBashOperations(adapter);
  await ops.exec("true", "/workspace", { onData: () => undefined });
  assert.deepEqual(calls, ["true"]);
});
