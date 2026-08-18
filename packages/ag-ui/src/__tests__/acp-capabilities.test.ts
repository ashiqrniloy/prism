/**
 * Phase 10 Task 2 — truthful capability negotiation.
 * Every capabilityMatrix cell (scripts/phase10-freeze-manifest.json) is
 * exercised as a pure function of the wired seams; never-cells stay absent;
 * client capabilities read from initialize default closed.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentCapabilities } from "@agentclientprotocol/sdk";
import { type AcpCapabilitiesSource, resolveAcpAgentCapabilities, resolveAcpClientCapabilities } from "../acp/capabilities.js";

const noSeams: AcpCapabilitiesSource = {};

test("baseline advertises only sessionCapabilities.close", () => {
  assert.deepEqual(resolveAcpAgentCapabilities(noSeams), { sessionCapabilities: { close: {} } });
});

test("each session seam advertises exactly its matching capability", () => {
  const sessions = {
    load: () => ({ session: { id: "x" } as never }),
    list: () => [{ sessionId: "a", cwd: "/w" }],
    delete: () => {},
    resume: () => ({ session: { id: "x" } as never }),
    additionalDirectories: (input: { directories: readonly string[] }) => input.directories,
  };
  assert.deepEqual(resolveAcpAgentCapabilities({ sessions }), {
    loadSession: true,
    sessionCapabilities: {
      close: {},
      list: {},
      delete: {},
      resume: {},
      additionalDirectories: {},
    },
  });
  // Partial seam sets omit only what is missing.
  assert.deepEqual(resolveAcpAgentCapabilities({ sessions: { list: sessions.list } }), {
    sessionCapabilities: { close: {}, list: {} },
  });
  assert.deepEqual(resolveAcpAgentCapabilities({ sessions: { load: sessions.load } }), {
    loadSession: true,
    sessionCapabilities: { close: {} },
  });
});

test("prompt policy gates advertise image+audio and embeddedContext independently", () => {
  const signal = new AbortController().signal;
  const media = () => true;
  const embedded = () => true;
  assert.deepEqual(resolveAcpAgentCapabilities({ capabilities: { prompt: { media, embedded } } }), {
    sessionCapabilities: { close: {} },
    promptCapabilities: { image: true, audio: true, embeddedContext: true },
  });
  const onlyEmbedded: AcpCapabilitiesSource = { capabilities: { prompt: { embedded: () => signal.aborted } } };
  assert.deepEqual(resolveAcpAgentCapabilities(onlyEmbedded), {
    sessionCapabilities: { close: {} },
    promptCapabilities: { embeddedContext: true },
  });
});

test("mcp transports are advertised per transport and only with select", () => {
  const select = () => true;
  assert.deepEqual(resolveAcpAgentCapabilities({ mcp: { select, transports: ["http"] } }), {
    sessionCapabilities: { close: {} },
    mcpCapabilities: { http: true },
  });
  assert.deepEqual(resolveAcpAgentCapabilities({ mcp: { select, transports: ["sse"] } }), {
    sessionCapabilities: { close: {} },
    mcpCapabilities: { sse: true },
  });
  assert.deepEqual(resolveAcpAgentCapabilities({ mcp: { select, transports: ["http", "sse"] } }), {
    sessionCapabilities: { close: {} },
    mcpCapabilities: { http: true, sse: true },
  });
  // select without transports, or transports without select: no advertisement.
  assert.deepEqual(resolveAcpAgentCapabilities({ mcp: { select } }), { sessionCapabilities: { close: {} } });
  assert.deepEqual(resolveAcpAgentCapabilities({ mcp: { transports: ["http"] } }), { sessionCapabilities: { close: {} } });
});

test("never-cells stay absent even with every seam wired", () => {
  const caps = resolveAcpAgentCapabilities({
    sessions: {
      load: () => ({ session: { id: "x" } as never }),
      list: () => [],
      delete: () => {},
      resume: () => ({ session: { id: "x" } as never }),
      additionalDirectories: (input) => input.directories,
    },
    mcp: { select: () => true, transports: ["http", "sse"] },
    capabilities: { prompt: { media: () => true, embedded: () => true } },
  }) as AgentCapabilities;
  assert.equal("auth" in caps, false);
  assert.equal("providers" in caps, false);
  assert.equal("nes" in caps, false);
  assert.equal("positionEncoding" in caps, false);
  assert.equal("mcpCapabilities" in caps && "acp" in caps.mcpCapabilities!, false);
  assert.equal("sessionCapabilities" in caps && "fork" in caps.sessionCapabilities!, false);
});

test("client capabilities default closed and read per field", () => {
  assert.deepEqual(resolveAcpClientCapabilities(undefined), {
    fsReadTextFile: false,
    fsWriteTextFile: false,
    terminal: false,
    configOptionBoolean: false,
    elicitation: false,
    plan: false,
  });
  assert.deepEqual(
    resolveAcpClientCapabilities({
      fs: { readTextFile: true, writeTextFile: true },
      terminal: true,
      session: { configOptions: { boolean: {} } },
      elicitation: {},
      plan: {},
    }),
    {
      fsReadTextFile: true,
      fsWriteTextFile: true,
      terminal: true,
      configOptionBoolean: true,
      elicitation: true,
      plan: true,
    },
  );
  assert.deepEqual(resolveAcpClientCapabilities({ fs: { readTextFile: true } }), {
    fsReadTextFile: true,
    fsWriteTextFile: false,
    terminal: false,
    configOptionBoolean: false,
    elicitation: false,
    plan: false,
  });
});
