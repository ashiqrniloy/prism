import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolExecutionContext } from "@arnilo/prism";
import {
  createWorkComposition,
  DEFAULT_WORK_SANDBOX_ENV,
  WORK_SANDBOX_IMAGE,
  WorkSandboxError,
  type WorkSandbox,
  type WorkSandboxCapabilities,
  type WorkSandboxExecFileRequest,
} from "../index.js";

const isolated: WorkSandboxCapabilities = {
  workspaceCoherent: true,
  filesystemIsolated: true,
  networkIsolated: true,
  processIsolated: true,
  privilegeIsolated: false,
  egressRestricted: true,
};

const context: ToolExecutionContext = { sessionId: "s1", runId: "r1", toolCallId: "tc1" };

function fakeSandbox(overrides: Partial<WorkSandbox> = {}): WorkSandbox & { calls: WorkSandboxExecFileRequest[] } {
  const calls: WorkSandboxExecFileRequest[] = [];
  const sandbox: WorkSandbox & { calls: WorkSandboxExecFileRequest[] } = {
    capabilities: isolated,
    root: "/workspace",
    calls,
    async execFile(request) {
      calls.push(request);
      return { exitCode: 0 };
    },
    async readFile() {
      return new Uint8Array();
    },
    async writeFile() {},
    ...overrides,
  };
  return sandbox;
}

describe("createWorkComposition", () => {
  it("exposes office tools and work_exec without token env keys", async () => {
    const sandbox = fakeSandbox();
    const { tools, composition } = createWorkComposition({ sandbox });
    const names = tools.map((tool) => tool.name);
    assert.ok(names.includes("office_generate"));
    assert.ok(names.includes("work_exec"));
    assert.equal(
      Object.keys(composition.env).some((key) => key.startsWith("M365_") || key.startsWith("GOOGLE_")),
      false,
    );
    assert.deepEqual(DEFAULT_WORK_SANDBOX_ENV, {});
    assert.equal(composition.capabilities.networkIsolated, true);

    const exec = tools.find((tool) => tool.name === "work_exec")!;
    const result = await exec.execute({ file: "python3", args: ["-c", "import docx"] }, context);
    assert.equal((result.value as { exitCode: number }).exitCode, 0);
    assert.equal(sandbox.calls[0]?.file, "python3");
    assert.equal(sandbox.calls[0]?.env?.M365_ACCESSTOKEN, undefined);
  });

  it("copies sandbox capabilities and never invents networkIsolated", () => {
    const open = fakeSandbox({
      capabilities: { ...isolated, networkIsolated: false, egressRestricted: false },
    });
    assert.equal(createWorkComposition({ sandbox: open }).composition.capabilities.networkIsolated, false);
    assert.equal(
      createWorkComposition({ sandbox: fakeSandbox({ capabilities: undefined }) }).composition.capabilities.networkIsolated,
      false,
    );
  });

  it("refuses token env keys on construct and exec", async () => {
    const sandbox = fakeSandbox();
    assert.throws(() => createWorkComposition({ sandbox, env: { M365_ACCESSTOKEN: "secret" } }), WorkSandboxError);
    const { composition } = createWorkComposition({ sandbox });
    await assert.rejects(
      () => composition.execFile({ file: "python3", args: [], env: { GOOGLE_ACCESS_TOKEN: "secret" } }),
      WorkSandboxError,
    );
  });

  it("injects a private LibreOffice profile and refuses sockets", async () => {
    const sandbox = fakeSandbox();
    const { composition } = createWorkComposition({ sandbox });
    await composition.execFile({ file: "/usr/bin/soffice", args: ["--version"] });
    assert.equal(sandbox.calls[0]?.args[0], "-env:UserInstallation=file:///tmp/lo-profile");
    await assert.rejects(() => composition.execFile({ file: "soffice", args: ["--accept=socket,host=0,port=2002;urp"] }), /macro\/socket/);
  });
});

describe("WORK_SANDBOX_IMAGE", () => {
  it("is a digest-pinned name@sha256 fixture", () => {
    assert.match(WORK_SANDBOX_IMAGE, /^[a-z0-9._/-]+@sha256:[a-f0-9]{64}$/);
  });
});
