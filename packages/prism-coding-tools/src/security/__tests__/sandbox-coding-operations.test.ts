import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ToolExecutionContext } from "@arnilo/prism";
import type {
  DeleteOperations,
  EditOperations,
  MoveOperations,
  ReadOperations,
  RepositoryOperations,
  WriteOperations,
} from "../../agent/index.js";
import {
  createSandboxBashOperations,
  createSandboxCodingComposition,
  createSandboxCodingTools,
  createSandboxReadOnlyComposition,
  createSandboxReadOnlyTools,
  type DisposableSandbox,
  resolveSandboxCapabilities,
  type SandboxAdapter,
  SandboxCodingCompositionError,
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

/** Minimal stubs — composition only checks that operations objects are present. */
function stubTreeOps(): {
  read: ReadOperations;
  write: WriteOperations;
  edit: EditOperations;
  delete: DeleteOperations;
  move: MoveOperations;
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
    delete: {
      lstat: boom as DeleteOperations["lstat"],
      unlink: boom,
      rmdir: boom,
      readdir: boom as DeleteOperations["readdir"],
    },
    move: {
      lstat: boom as MoveOperations["lstat"],
      rename: boom,
      unlink: boom,
      access: boom,
    },
    repository: {
      list: boom as RepositoryOperations["list"],
      search: boom as RepositoryOperations["search"],
      glob: boom as RepositoryOperations["glob"],
    },
  };
}

test("missing workspaceMode throws", () => {
  assert.throws(
    () =>
      createSandboxCodingTools("/tmp", {
        sandbox: fakeSandbox(),
      } as never),
    (err: unknown) => err instanceof SandboxCodingCompositionError && /workspaceMode is required/.test(err.message),
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
      ["shell", "read", "write", "edit", "repo_list", "repo_search", "glob", "delete", "move"],
    );
    const read = tools.find((t) => t.name === "read")!;
    const result = await read.execute({ path: "note.txt" }, ctx());
    assert.equal(result.error, undefined);
    assert.match(String(result.content?.[0] && result.content[0].type === "text" ? result.content[0].text : ""), /host-local/);
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
    (err: unknown) => err instanceof SandboxCodingCompositionError && /mixed wiring/.test(err.message),
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

test("sandbox mode with un-attested DisposableSandbox auto-wires FS backends but claims no isolation", () => {
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
  // Disposable shape (execFile/close) proves capability to call, not OS isolation.
  assert.equal(composition.capabilities.workspaceCoherent, true);
  assert.equal(composition.capabilities.filesystemIsolated, false);
  assert.equal(composition.capabilities.networkIsolated, false);
  assert.equal(composition.capabilities.processIsolated, false);
  assert.equal(composition.capabilities.privilegeIsolated, false);
  assert.equal(composition.capabilities.egressRestricted, false);
  assert.equal(composition.containmentClaim, false);
  assert.equal(composition.workspaceRoot, "/workspace");
  assert.equal(composition.warnings.length, 0);
});

test("sandbox mode with attested DisposableSandbox claims containment conservatively", () => {
  const sandbox: DisposableSandbox = {
    id: "sb-test",
    capabilities: {
      workspaceCoherent: true,
      filesystemIsolated: true,
      networkIsolated: true,
      processIsolated: true,
      privilegeIsolated: false,
      egressRestricted: true,
    },
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
  assert.deepEqual(composition.capabilities, {
    workspaceCoherent: true,
    filesystemIsolated: true,
    networkIsolated: true,
    processIsolated: true,
    privilegeIsolated: false,
    egressRestricted: true,
  });
  assert.equal(composition.containmentClaim, true);
});

test("explicit custom attestation is copied, validated, and frozen; malformed metadata fails closed", () => {
  const valid: DisposableSandbox = {
    id: "sb-attested",
    capabilities: {
      workspaceCoherent: true,
      filesystemIsolated: true,
      networkIsolated: false,
      processIsolated: true,
      privilegeIsolated: false,
      egressRestricted: true,
    },
    exec: async () => ({ exitCode: 0 }),
    execFile: async () => ({ exitCode: 0 }),
    status: async () => ({
      id: "sb-attested",
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
  const { composition } = createSandboxCodingComposition("/tmp", { workspaceMode: "sandbox", sandbox: valid });
  assert.deepEqual(composition.capabilities, valid.capabilities);
  assert.ok(Object.isFrozen(composition.capabilities));
  // Caller mutation after composition cannot change the returned evidence.
  (valid.capabilities as { filesystemIsolated: boolean }).filesystemIsolated = false;
  assert.equal(composition.capabilities.filesystemIsolated, true);

  const malformed: Array<Record<string, unknown> | undefined> = [
    undefined,
    null as unknown as Record<string, unknown>,
    {},
    {
      workspaceCoherent: true,
      filesystemIsolated: true,
      networkIsolated: true,
      processIsolated: true,
      privilegeIsolated: false,
      egressRestricted: true,
      extra: true,
    },
    {
      workspaceCoherent: "yes" as unknown as boolean,
      filesystemIsolated: true,
      networkIsolated: true,
      processIsolated: true,
      privilegeIsolated: false,
      egressRestricted: true,
    },
    {
      workspaceCoherent: true,
      filesystemIsolated: 1 as unknown as boolean,
      networkIsolated: true,
      processIsolated: true,
      privilegeIsolated: false,
      egressRestricted: true,
    },
  ];
  for (const capabilities of malformed) {
    const adapter: SandboxAdapter = {
      capabilities: capabilities as SandboxAdapter["capabilities"],
      exec: async () => ({ exitCode: 0 }),
    };
    assert.deepEqual(
      resolveSandboxCapabilities(adapter),
      {
        workspaceCoherent: false,
        filesystemIsolated: false,
        networkIsolated: false,
        processIsolated: false,
        privilegeIsolated: false,
        egressRestricted: false,
      },
      `metadata ${JSON.stringify(capabilities)} must resolve every capability false`,
    );
  }
});

test("host and mixed modes report no isolation capability; deprecated projection stays false", () => {
  const host = createSandboxCodingComposition("/tmp", { workspaceMode: "host" });
  assert.equal(host.composition.capabilities.workspaceCoherent, true);
  assert.equal(host.composition.capabilities.filesystemIsolated, false);
  assert.equal(host.composition.capabilities.networkIsolated, false);
  assert.equal(host.composition.capabilities.processIsolated, false);
  assert.equal(host.composition.capabilities.privilegeIsolated, false);
  assert.equal(host.composition.capabilities.egressRestricted, false);
  assert.equal(host.composition.containmentClaim, false);

  const mixed = createSandboxCodingComposition("/tmp", {
    workspaceMode: "host",
    sandbox: fakeSandbox(),
    allowMixedWorkspaceWiring: true,
  });
  assert.deepEqual(mixed.composition.capabilities, {
    workspaceCoherent: false,
    filesystemIsolated: false,
    networkIsolated: false,
    processIsolated: false,
    privilegeIsolated: false,
    egressRestricted: false,
  });
  assert.equal(mixed.composition.containmentClaim, false);
  assert.ok(mixed.composition.warnings.some((w) => /mixed workspace wiring/.test(w)));
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
    assert.match(String(listResult.content?.[0] && listResult.content[0].type === "text" ? listResult.content[0].text : ""), /hit\.ts/);

    const searchResult = await search.execute({ query: "findMe" }, ctx());
    assert.equal(searchResult.error, undefined);
    assert.equal(searchResult.metadata?.matchCount, 1);

    const readResult = await read.execute({ path: "note.txt" }, ctx());
    assert.equal(readResult.error, undefined);
    assert.match(
      String(readResult.content?.[0] && readResult.content[0].type === "text" ? readResult.content[0].text : ""),
      /hello from workspace/,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("sandbox mode with custom tree operations claims workspace coherence but no OS isolation", () => {
  const ops = stubTreeOps();
  const { composition } = createSandboxCodingComposition("/tmp", {
    workspaceMode: "sandbox",
    sandbox: fakeSandbox(),
    workspaceRoot: "/workspace",
    read: { operations: ops.read },
    write: { operations: ops.write },
    edit: { operations: ops.edit },
    delete: { operations: ops.delete },
    move: { operations: ops.move },
    repository: { operations: ops.repository },
  });
  assert.equal(composition.workspaceMode, "sandbox");
  assert.equal(composition.capabilities.workspaceCoherent, true);
  assert.equal(composition.capabilities.filesystemIsolated, false);
  assert.equal(composition.capabilities.networkIsolated, false);
  assert.equal(composition.capabilities.processIsolated, false);
  assert.equal(composition.capabilities.privilegeIsolated, false);
  assert.equal(composition.capabilities.egressRestricted, false);
  assert.equal(composition.containmentClaim, false);
  assert.equal(composition.warnings.length, 0);
  assert.equal(composition.workspaceRoot, "/workspace");
});

test("sandbox mode custom ops without delete/move fall through (not claimed custom)", () => {
  const ops = stubTreeOps();
  assert.throws(
    () =>
      createSandboxCodingTools("/tmp", {
        workspaceMode: "sandbox",
        sandbox: fakeSandbox(),
        read: { operations: ops.read },
        write: { operations: ops.write },
        edit: { operations: ops.edit },
        repository: { operations: ops.repository },
      }),
    SandboxCodingCompositionError,
  );
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
      ["read", "repo_list", "repo_search", "glob"],
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
