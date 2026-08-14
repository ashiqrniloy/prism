import assert from "node:assert/strict";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { createServer as createNetServer, connect as netConnect } from "node:net";
import { test } from "node:test";
import {
  assertEgressAttestation,
  assertPinned,
  composeEgressSandboxNetwork,
  createAllowListEgressProxy,
  createEgressPolicy,
  EgressError,
  isMetadataAddress,
  isPrivateAddress,
  resolveEgressLimits,
} from "../index.js";
import { buildDockerCreateArgsForTest } from "../docker-sandbox.js";
import type { EgressAuditRecord } from "../index.js";

const DIGEST = `sha256:${"a".repeat(64)}`;
const IMAGE = `registry.example/prism-code@${DIGEST}`;

async function withHttpUpstream(
  handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void,
  run: (port: number) => Promise<void>,
): Promise<void> {
  const server = createHttpServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  try {
    await run(port);
  } finally {
    (server as unknown as { closeAllConnections: () => void }).closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function withNetUpstream(handler: (socket: import("node:net").Socket) => void, run: (port: number) => Promise<void>): Promise<void> {
  const sockets = new Set<import("node:net").Socket>();
  const server = createNetServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    handler(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  try {
    await run(port);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function proxyGet(proxyPort: number, target: string, hostHeader: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port: proxyPort, path: target, method: "GET", headers: { host: hostHeader }, setHost: false },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function connectTunnel(proxyPort: number, authority: string): Promise<{ socket: import("node:net").Socket; status: string }> {
  return new Promise((resolve, reject) => {
    const socket = netConnect({ host: "127.0.0.1", port: proxyPort });
    let buffer = "";
    socket.on("connect", () => socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("latin1");
      const idx = buffer.indexOf("\r\n\r\n");
      if (idx >= 0) {
        socket.removeAllListeners("data");
        resolve({ socket, status: buffer.slice(0, idx) });
      }
    });
    socket.on("error", reject);
  });
}

// --- policy ---

test("egress policy: deny-all default; exact host/port/protocol match", () => {
  const policy = createEgressPolicy({ allow: [{ host: "api.example.com", port: 443, protocol: "https" }] });
  assert.equal(policy.allows("api.example.com", 443, "https"), true);
  assert.equal(policy.allows("api.example.com", 80, "https"), false); // port mismatch
  assert.equal(policy.allows("api.example.com", 443, "http"), false); // protocol mismatch
  assert.equal(policy.allows("other.example.com", 443, "https"), false); // host mismatch
  assert.equal(policy.allows("API.EXAMPLE.COM", 443, "https"), true); // case-insensitive
});

test("egress policy: presets expand to explicit rules; no wildcards", () => {
  const policy = createEgressPolicy({ presets: ["npm-registry", "github"] });
  assert.equal(policy.allows("registry.npmjs.org", 443, "https"), true);
  assert.equal(policy.allows("api.github.com", 443, "https"), true);
  assert.equal(policy.allows("github.com", 443, "https"), true);
  assert.equal(policy.allows("registry.npmjs.org", 80, "http"), false);
  assert.equal(policy.allows("*.github.com", 443, "https"), false);
  assert.equal(policy.rules.length, 7);
});

test("egress policy: invalid rules fail closed", () => {
  assert.throws(() => createEgressPolicy({ allow: [{ host: "*.example.com", port: 443, protocol: "https" }] }), EgressError);
  assert.throws(() => createEgressPolicy({ allow: [{ host: "example.com", port: 0, protocol: "https" }] }), EgressError);
  assert.throws(() => createEgressPolicy({ allow: [{ host: "example.com", port: 443, protocol: "ftp" as never }] }), EgressError);
  assert.throws(() => createEgressPolicy({ presets: ["unknown" as never] }), EgressError);
  assert.throws(() => createEgressPolicy({ allow: [{ host: "a.com", port: 1, protocol: "http" }], maxRules: 0 }), EgressError);
});

test("egress policy: fingerprint stable and changes with rules; dedupe", () => {
  const a = createEgressPolicy({ allow: [{ host: "a.com", port: 443, protocol: "https" }] });
  const b = createEgressPolicy({ allow: [{ host: "a.com", port: 443, protocol: "https" }] });
  const c = createEgressPolicy({ allow: [{ host: "a.com", port: 80, protocol: "http" }] });
  assert.equal(a.fingerprint, b.fingerprint);
  assert.notEqual(a.fingerprint, c.fingerprint);
  const dup = createEgressPolicy({
    allow: [
      { host: "a.com", port: 443, protocol: "https" },
      { host: "a.com", port: 443, protocol: "https" },
    ],
  });
  assert.equal(dup.rules.length, 1);
});

// --- dns pinning ---

test("dns pin: private/metadata ranges detected", () => {
  for (const ip of [
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "127.0.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fc00::1",
    "fd12::1",
    "fe80::1",
    "::ffff:10.0.0.1",
  ]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700::1111"]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
  assert.equal(isMetadataAddress("169.254.169.254"), true);
  assert.equal(isMetadataAddress("8.8.8.8"), false);
});

test("dns pin: assertPinned rejects rebinding and normalizes mapped addresses", () => {
  assertPinned("example.test", "127.0.0.1", ["127.0.0.1"]);
  assertPinned("example.test", "::ffff:127.0.0.1", ["127.0.0.1"]);
  assert.throws(
    () => assertPinned("example.test", "10.0.0.5", ["93.184.216.34"]),
    (error: unknown) => error instanceof EgressError && error.code === "ERR_PRISM_EGRESS_DNS",
  );
  assert.throws(() => assertPinned("example.test", undefined, ["127.0.0.1"]), EgressError);
});

// --- proxy: http ---

test("egress proxy: allow-list http request succeeds; audit records allow", async () => {
  const records: EgressAuditRecord[] = [];
  await withHttpUpstream(
    (_req, res) => res.end("hello"),
    async (upstreamPort) => {
      const policy = createEgressPolicy({ allow: [{ host: "example.test", port: upstreamPort, protocol: "http", allowPrivate: true }] });
      const proxy = createAllowListEgressProxy({ policy, audit: (r) => records.push(r), resolve: async () => ["127.0.0.1"] });
      const { port } = await proxy.start();
      try {
        const result = await proxyGet(port, `http://example.test:${upstreamPort}/x`, `example.test:${upstreamPort}`);
        assert.equal(result.status, 200);
        assert.equal(result.body, "hello");
        assert.equal(
          records.some((r) => r.decision === "allow" && r.host === "example.test" && r.port === upstreamPort),
          true,
        );
      } finally {
        await proxy.close();
      }
    },
  );
});

test("egress proxy: deny-all returns 403; audit records deny", async () => {
  const records: EgressAuditRecord[] = [];
  const policy = createEgressPolicy();
  const proxy = createAllowListEgressProxy({ policy, audit: (r) => records.push(r), resolve: async () => ["127.0.0.1"] });
  const { port } = await proxy.start();
  try {
    const result = await proxyGet(port, "http://example.test:80/x", "example.test:80");
    assert.equal(result.status, 403);
    assert.equal(
      records.some((r) => r.decision === "deny" && r.reason?.startsWith("ERR_PRISM_EGRESS_DENIED")),
      true,
    );
  } finally {
    await proxy.close();
  }
});

test("egress proxy: private address denied without allowPrivate; metadata IP denied", async () => {
  const policy = createEgressPolicy({ allow: [{ host: "example.test", port: 80, protocol: "http" }] });
  const proxy = createAllowListEgressProxy({ policy, resolve: async () => ["127.0.0.1"] });
  const { port } = await proxy.start();
  try {
    const result = await proxyGet(port, "http://example.test:80/x", "example.test:80");
    assert.equal(result.status, 502);
    assert.match(result.body, /ERR_PRISM_EGRESS_DNS/);
  } finally {
    await proxy.close();
  }
  const metadata = createAllowListEgressProxy({ policy, resolve: async () => ["169.254.169.254"] });
  const mport = (await metadata.start()).port;
  try {
    const result = await proxyGet(mport, "http://example.test:80/x", "example.test:80");
    assert.equal(result.status, 502);
  } finally {
    await metadata.close();
  }
});

test("egress proxy: redirect chain re-validated against policy; unlisted hop denied", async () => {
  let targetPort = 0;
  await withHttpUpstream(
    (_req, res) => {
      res.writeHead(302, { location: `http://example.test:${targetPort}/final` });
      res.end();
    },
    async (portA) => {
      await withHttpUpstream(
        (_req, res) => res.end("final"),
        async (portB) => {
          targetPort = portB;
          const policy = createEgressPolicy({
            allow: [
              { host: "example.test", port: portA, protocol: "http", allowPrivate: true },
              { host: "example.test", port: portB, protocol: "http", allowPrivate: true },
            ],
          });
          const proxy = createAllowListEgressProxy({ policy, resolve: async () => ["127.0.0.1"] });
          const { port } = await proxy.start();
          try {
            const result = await proxyGet(port, `http://example.test:${portA}/start`, `example.test:${portA}`);
            assert.equal(result.status, 200);
            assert.equal(result.body, "final");
          } finally {
            await proxy.close();
          }
        },
      );
    },
  );
});

test("egress proxy: redirect to unlisted host fails closed", async () => {
  await withHttpUpstream(
    (_req, res) => {
      res.writeHead(302, { location: "http://evil.test:80/steal" });
      res.end();
    },
    async (portA) => {
      const policy = createEgressPolicy({ allow: [{ host: "example.test", port: portA, protocol: "http", allowPrivate: true }] });
      const proxy = createAllowListEgressProxy({ policy, resolve: async () => ["127.0.0.1"] });
      const { port } = await proxy.start();
      try {
        const result = await proxyGet(port, `http://example.test:${portA}/start`, `example.test:${portA}`);
        assert.equal(result.status, 403);
      } finally {
        await proxy.close();
      }
    },
  );
});

test("egress proxy: redirect hop cap enforced", async () => {
  let hopPort = 0;
  await withHttpUpstream(
    (_req, res) => {
      res.writeHead(302, { location: `http://example.test:${hopPort}/again` });
      res.end();
    },
    async (portA) => {
      hopPort = portA;
      const policy = createEgressPolicy({ allow: [{ host: "example.test", port: portA, protocol: "http", allowPrivate: true }] });
      const proxy = createAllowListEgressProxy({ policy, limits: { redirectHops: 3 }, resolve: async () => ["127.0.0.1"] });
      const { port } = await proxy.start();
      try {
        const result = await proxyGet(port, `http://example.test:${portA}/start`, `example.test:${portA}`);
        assert.equal(result.status, 502);
        assert.match(result.body, /ERR_PRISM_EGRESS_LIMIT/);
      } finally {
        await proxy.close();
      }
    },
  );
});

test("egress proxy: response byte cap destroys oversized response", async () => {
  await withHttpUpstream(
    (_req, res) => res.end("x".repeat(10_000)),
    async (upstreamPort) => {
      const policy = createEgressPolicy({ allow: [{ host: "example.test", port: upstreamPort, protocol: "http", allowPrivate: true }] });
      const proxy = createAllowListEgressProxy({ policy, limits: { responseBytes: 100 }, resolve: async () => ["127.0.0.1"] });
      const { port } = await proxy.start();
      try {
        await assert.rejects(proxyGet(port, `http://example.test:${upstreamPort}/x`, `example.test:${upstreamPort}`));
      } finally {
        await proxy.close();
      }
    },
  );
});

test("egress proxy: transfer time cap fails slow upstream", async () => {
  await withHttpUpstream(
    (_req, res) => {
      setTimeout(() => res.end("late"), 2_000);
    },
    async (upstreamPort) => {
      const policy = createEgressPolicy({ allow: [{ host: "example.test", port: upstreamPort, protocol: "http", allowPrivate: true }] });
      const proxy = createAllowListEgressProxy({ policy, limits: { transferTimeMs: 150 }, resolve: async () => ["127.0.0.1"] });
      const { port } = await proxy.start();
      try {
        const result = await proxyGet(port, `http://example.test:${upstreamPort}/x`, `example.test:${upstreamPort}`);
        assert.equal(result.status, 504);
      } finally {
        await proxy.close();
      }
    },
  );
});

// --- proxy: connect ---

test("egress proxy: CONNECT tunnel passes bytes through; unlisted port fails closed", async () => {
  await withNetUpstream(
    (socket) => {
      socket.on("data", (chunk) => socket.write(chunk));
    },
    async (upstreamPort) => {
      const policy = createEgressPolicy({ allow: [{ host: "example.test", port: upstreamPort, protocol: "https", allowPrivate: true }] });
      const proxy = createAllowListEgressProxy({ policy, resolve: async () => ["127.0.0.1"] });
      const { port } = await proxy.start();
      try {
        const { socket, status } = await connectTunnel(port, `example.test:${upstreamPort}`);
        assert.match(status, /200 Connection Established/);
        const echoed = await new Promise<string>((resolve, reject) => {
          socket.on("data", (chunk) => resolve(chunk.toString()));
          socket.write("ping");
          setTimeout(() => reject(new Error("no echo")), 2_000);
        });
        assert.equal(echoed, "ping");
        socket.destroy();
      } finally {
        await proxy.close();
      }
    },
  );
});

test("egress proxy: CONNECT to unlisted port fails closed", async () => {
  const policy = createEgressPolicy({ allow: [{ host: "example.test", port: 443, protocol: "https" }] });
  const proxy = createAllowListEgressProxy({ policy, resolve: async () => ["127.0.0.1"] });
  const { port } = await proxy.start();
  try {
    const { socket, status } = await connectTunnel(port, "example.test:8080");
    assert.match(status, /403/);
    socket.destroy();
  } finally {
    await proxy.close();
  }
});

test("egress proxy: CONNECT private address without allowPrivate denied", async () => {
  const policy = createEgressPolicy({ allow: [{ host: "example.test", port: 443, protocol: "https" }] });
  const proxy = createAllowListEgressProxy({ policy, resolve: async () => ["127.0.0.1"] });
  const { port } = await proxy.start();
  try {
    const { socket, status } = await connectTunnel(port, "example.test:443");
    assert.match(status, /502/);
    socket.destroy();
  } finally {
    await proxy.close();
  }
});

// --- lifecycle ---

test("egress proxy: inert until start; attestation fails closed before start", async () => {
  const policy = createEgressPolicy();
  const proxy = createAllowListEgressProxy({ policy });
  assert.throws(
    () => proxy.endpoint(),
    (error: unknown) => error instanceof EgressError && error.code === "ERR_PRISM_EGRESS_ATTESTATION",
  );
  assert.throws(
    () => proxy.attestation(),
    (error: unknown) => error instanceof EgressError && error.code === "ERR_PRISM_EGRESS_ATTESTATION",
  );
  const { port } = await proxy.start();
  const attestation = proxy.attestation();
  assert.equal(attestation.denyDirectEgress, true);
  assert.match(attestation.proxyEndpoint, new RegExp(`:${port}$`));
  assert.match(attestation.policyFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(attestation.policyVersion, 0);
  await proxy.close();
});

test("egress proxy: reloadPolicy is explicit and bumps policyVersion", async () => {
  const allow = createEgressPolicy({ allow: [{ host: "example.test", port: 80, protocol: "http", allowPrivate: true }] });
  const deny = createEgressPolicy();
  const proxy = createAllowListEgressProxy({ policy: allow, resolve: async () => ["127.0.0.1"] });
  const { port } = await proxy.start();
  try {
    const before = await proxyGet(port, "http://example.test:80/x", "example.test:80");
    assert.equal(before.status, 502); // no upstream, but policy allows → upstream connect failure
    proxy.reloadPolicy(deny);
    const after = await proxyGet(port, "http://example.test:80/x", "example.test:80");
    assert.equal(after.status, 403);
    assert.equal(proxy.attestation().policyVersion, 1);
  } finally {
    await proxy.close();
  }
});

test("egress proxy: concurrency cap bounds active connections", async () => {
  await withHttpUpstream(
    (_req, res) => {
      setTimeout(() => res.end("done"), 150);
    },
    async (upstreamPort) => {
      const policy = createEgressPolicy({ allow: [{ host: "example.test", port: upstreamPort, protocol: "http", allowPrivate: true }] });
      const proxy = createAllowListEgressProxy({ policy, limits: { concurrentConnections: 1 }, resolve: async () => ["127.0.0.1"] });
      const { port } = await proxy.start();
      try {
        const order: string[] = [];
        const first = proxyGet(port, `http://example.test:${upstreamPort}/a`, `example.test:${upstreamPort}`).then((r) => {
          order.push("first");
          return r;
        });
        const second = proxyGet(port, `http://example.test:${upstreamPort}/b`, `example.test:${upstreamPort}`).then((r) => {
          order.push("second");
          return r;
        });
        const [a, b] = await Promise.all([first, second]);
        assert.equal(a.status, 200);
        assert.equal(b.status, 200);
        assert.deepEqual(order, ["first", "second"]);
        assert.ok(proxy.stats().totalConnections >= 2);
      } finally {
        await proxy.close();
      }
    },
  );
});

// --- limits ---

test("egress limits: frozen defaults and hard caps", () => {
  const limits = resolveEgressLimits();
  assert.equal(limits.concurrentConnections, 32);
  assert.equal(limits.redirectHops, 5);
  assert.throws(() => resolveEgressLimits({ concurrentConnections: 0 }), RangeError);
  assert.throws(() => resolveEgressLimits({ concurrentConnections: 10_000 }), RangeError);
  assert.equal(resolveEgressLimits({ redirectHops: 7 }).redirectHops, 7);
});

// --- sandbox composition ---

test("egress attestation: validated; malformed fails closed", () => {
  const valid = {
    proxyEndpoint: "http://127.0.0.1:8080",
    denyDirectEgress: true as const,
    policyFingerprint: "a".repeat(64),
    policyVersion: 0,
    startedAt: new Date().toISOString(),
  };
  const bad = (patch: object) => ({ ...valid, ...patch }) as unknown as Parameters<typeof assertEgressAttestation>[0];
  assertEgressAttestation(valid);
  assert.throws(
    () => assertEgressAttestation(bad({ denyDirectEgress: false })),
    (error: unknown) => error instanceof EgressError && error.code === "ERR_PRISM_EGRESS_ATTESTATION",
  );
  assert.throws(() => assertEgressAttestation(bad({ policyFingerprint: "zz" })), EgressError);
  assert.throws(() => assertEgressAttestation(bad({ proxyEndpoint: "ftp://x" })), EgressError);
  assert.throws(() => assertEgressAttestation(bad({ startedAt: "not-a-date" })), EgressError);
});

test("egress sandbox composition: network config carries attestation; labels recorded", () => {
  const attestation = {
    proxyEndpoint: "http://127.0.0.1:8080",
    denyDirectEgress: true as const,
    policyFingerprint: "b".repeat(64),
    policyVersion: 2,
    startedAt: new Date().toISOString(),
  };
  const network = composeEgressSandboxNetwork(attestation, "egress-net");
  assert.equal(network.mode, "custom");
  assert.equal(network.name, "egress-net");
  assert.equal(network.egress?.policyVersion, 2);
  const args = buildDockerCreateArgsForTest({
    image: IMAGE,
    sourceRoot: "/tmp/source",
    user: "1000:1000",
    network,
  });
  assert.ok(args.includes("--network=egress-net"));
  assert.ok(args.includes("--label"));
  assert.ok(args.includes("prism.egress.endpoint=http://127.0.0.1:8080"));
  assert.ok(args.includes(`prism.egress.fingerprint=${"b".repeat(64)}`));
  assert.ok(args.includes("prism.egress.policyVersion=2"));
  assert.ok(args.includes("prism.egress.denyDirect=1"));
  assert.throws(
    () =>
      composeEgressSandboxNetwork(
        { ...attestation, denyDirectEgress: false } as unknown as Parameters<typeof composeEgressSandboxNetwork>[0],
        "egress-net",
      ),
    EgressError,
  );
});
