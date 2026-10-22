import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { type Agent, createAgent, createSecretRedactor, providerDone, providerTextDelta } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import { DevtoolsError, replayPage, serveDevtools } from "../index.js";
import { hostOriginRejection as devtoolsHostOriginRejection, resolveDevtoolsToken } from "../security.js";
import { hostOriginRejection as remoteHostOriginRejection } from "../../../remote/src/http-gate.js";

const SECRET = "sk-live-devtools-canary";
const TOKEN_ENV = "PRISM_DEVTOOLS_TEST_TOKEN";

async function agentReplying(text: string, options: { redact?: boolean } = {}): Promise<Agent> {
  return createAgent({
    model: { provider: "mock", model: "offline" },
    packages: [mockProvider([[providerTextDelta(text), providerDone()]])],
    ...(options.redact ? { redactor: createSecretRedactor([SECRET]) } : {}),
  });
}

/** Reads an SSE body until `done(text)` is true, or fails after a bounded wait. */
async function readSse(response: Response, done: (text: string) => boolean): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`SSE did not reach the expected frames; got: ${text}`)), 5000);
  });
  try {
    while (!done(text)) {
      const { value, done: ended } = await Promise.race([reader.read(), timeout]);
      if (ended) break;
      text += decoder.decode(value, { stream: true });
    }
    return text;
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => undefined);
  }
}

describe("serveDevtools routes", () => {
  it("devtools_inspect_route_matches_agent_inspect", async () => {
    const agent = await agentReplying("ok");
    const devtools = serveDevtools(agent, { port: 0 });
    try {
      const response = await fetch(`${devtools.url}/api/inspect`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), JSON.parse(JSON.stringify(agent.inspect())));
    } finally {
      await devtools.close();
      await agent.dispose();
    }
  });

  it("devtools_streams_agent_and_session_events: the agent feed carries session.opened; the session feed is wired", async () => {
    const agent = await agentReplying(SECRET, { redact: true });
    const session = await agent.session({ id: "stream-1", create: true });
    // A session with no entries is not stored, so the stream route only follows a stored one.
    await session.run("first");
    const devtools = serveDevtools(agent, { port: 0 });
    try {
      const response = await fetch(`${devtools.url}/api/events?session=stream-1`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
      const received = readSse(response, (text) => text.includes("event: agent"));
      // `session.opened` is the agent-scoped event; the route's own open happened before the feed existed.
      await agent.session({ id: "stream-1" });
      const text = await received;
      assert.match(text, /event: agent\ndata: \{"type":"session\.opened","sessionId":"stream-1"/);
      assert.equal(text.includes(SECRET), false, "the secret must not reach the event stream");
      assert.equal(
        (await fetch(`${devtools.url}/api/events?session=missing`)).status,
        404,
        "an unknown session is refused before streaming",
      );
    } finally {
      await devtools.close();
      await agent.dispose();
    }
  });

  it("devtools_entries_redacted: no route body carries the secret", async () => {
    const agent = await agentReplying(SECRET, { redact: true });
    const session = await agent.session({ id: "redact-1", create: true });
    await session.run("say it");
    const devtools = serveDevtools(agent, { port: 0 });
    try {
      const bodies = await Promise.all([
        fetch(`${devtools.url}/api/inspect`).then((r) => r.text()),
        fetch(`${devtools.url}/api/sessions`).then((r) => r.text()),
        fetch(`${devtools.url}/api/sessions/redact-1`).then((r) => r.text()),
        fetch(`${devtools.url}/api/sessions/redact-1/entries`).then((r) => r.text()),
        fetch(`${devtools.url}/api/replay?session=redact-1`).then((r) => r.text()),
      ]);
      for (const body of bodies) assert.equal(body.includes(SECRET), false);
      const entries = JSON.parse(bodies[3]!) as { entries: unknown[] };
      assert.ok(entries.entries.length > 0, "the session has entries to redact");
    } finally {
      await devtools.close();
      await agent.dispose();
    }
  });

  it("replays stored entries in pages without starting a run", async () => {
    const agent = await agentReplying("reply");
    const session = await agent.session({ id: "replay-1", create: true });
    await session.run("hi");
    const total = (await session.entries()).length;
    const devtools = serveDevtools(agent, { port: 0 });
    try {
      const seen: unknown[] = [];
      let cursor: string | undefined;
      for (;;) {
        const query = new URLSearchParams({ session: "replay-1", limit: "1", ...(cursor === undefined ? {} : { cursor }) });
        const page = (await (await fetch(`${devtools.url}/api/replay?${query}`)).json()) as {
          items: unknown[];
          nextCursor?: string;
          terminal: boolean;
        };
        seen.push(...page.items);
        if (page.terminal) break;
        cursor = page.nextCursor;
      }
      assert.equal(seen.length, total);
      assert.equal((await session.entries()).length, total, "replay starts no run and appends nothing");
    } finally {
      await devtools.close();
      await agent.dispose();
    }
  });

  it("unknown sessions are 404, and bad query values are 400", async () => {
    const agent = await agentReplying("ok");
    await (await agent.session({ id: "known", create: true })).run("stored");
    const devtools = serveDevtools(agent, { port: 0 });
    try {
      const missing = await fetch(`${devtools.url}/api/sessions/nope/entries`);
      assert.equal(missing.status, 404);
      assert.equal(((await missing.json()) as { error: { code: string } }).error.code, "ERR_PRISM_DEVTOOLS_NOT_FOUND");
      assert.equal((await fetch(`${devtools.url}/api/sessions/nope`)).status, 404);
      assert.equal((await fetch(`${devtools.url}/api/replay?session=nope`)).status, 404);
      assert.equal((await fetch(`${devtools.url}/api/replay?session=known&limit=0`)).status, 400);
      assert.equal((await fetch(`${devtools.url}/api/replay?session=known&cursor=-1`)).status, 400);
      assert.equal((await fetch(`${devtools.url}/api/replay`)).status, 400);
      assert.equal((await fetch(`${devtools.url}/api/nothing-here`)).status, 404);
    } finally {
      await devtools.close();
      await agent.dispose();
    }
  });

  it("serves the page and its module with a strict CSP", async () => {
    const agent = await agentReplying("ok");
    const devtools = serveDevtools(agent, { port: 0 });
    try {
      const page = await fetch(`${devtools.url}/`);
      assert.equal(page.status, 200);
      assert.match(page.headers.get("content-security-policy") ?? "", /script-src 'self'/);
      assert.match(await page.text(), /<script type="module" src="\/assets\/inspector\.js">/);
      const script = await fetch(`${devtools.url}/assets/inspector.js`);
      assert.equal(script.status, 200);
      assert.match(script.headers.get("content-type") ?? "", /javascript/);
      const body = await script.text();
      assert.doesNotMatch(body, /^import /m, "the browser module must load nothing");
      assert.match(body, /function mount/);
    } finally {
      await devtools.close();
      await agent.dispose();
    }
  });

  it("close() ends open event streams", async () => {
    const agent = await agentReplying("ok");
    const devtools = serveDevtools(agent, { port: 0 });
    const response = await fetch(`${devtools.url}/api/events`);
    const reader = response.body!.getReader();
    await reader.read();
    await devtools.close();
    // Ending the stream is either a clean `done` or a closed socket; a still-open stream is the failure.
    const ended = reader.read().then(
      () => "ended",
      () => "ended",
    );
    const next = await Promise.race([ended, new Promise((resolve) => setTimeout(() => resolve("open"), 2000))]);
    assert.equal(next, "ended", "the stream must end when the server closes");
    await agent.dispose();
  });
});

describe("serveDevtools binding and token", () => {
  it("binds loopback by default", async () => {
    const agent = await agentReplying("ok");
    const devtools = serveDevtools(agent, { port: 0 });
    try {
      assert.equal(devtools.hostname, "127.0.0.1");
    } finally {
      await devtools.close();
      await agent.dispose();
    }
  });

  it("devtools_non_loopback_requires_token: refuses without a token, and 401s without the bearer", async () => {
    const agent = await agentReplying("ok");
    assert.throws(
      () => serveDevtools(agent, { hostname: "0.0.0.0", port: 0 }),
      (error: unknown) => error instanceof DevtoolsError && error.code === "ERR_PRISM_DEVTOOLS_REMOTE_BIND",
    );
    process.env[TOKEN_ENV] = "devtools-test-token";
    const devtools = serveDevtools(agent, { hostname: "0.0.0.0", port: 0, token: `env:${TOKEN_ENV}` });
    try {
      const url = `http://127.0.0.1:${devtools.port}`;
      assert.equal((await fetch(`${url}/`)).status, 401, "the page is guarded too");
      assert.equal((await fetch(`${url}/api/inspect`)).status, 401);
      assert.equal((await fetch(`${url}/api/inspect`, { headers: { authorization: "Bearer wrong" } })).status, 401);
      const allowed = await fetch(`${url}/api/inspect`, { headers: { authorization: "Bearer devtools-test-token" } });
      assert.equal(allowed.status, 200);
    } finally {
      delete process.env[TOKEN_ENV];
      await devtools.close();
      await agent.dispose();
    }
  });

  it("refuses a literal token and an unset token ref", () => {
    assert.throws(
      () => resolveDevtoolsToken("devtools-literal-value"),
      (error: unknown) => error instanceof DevtoolsError && error.code === "ERR_PRISM_DEVTOOLS_TOKEN_LITERAL",
    );
    assert.throws(
      () => resolveDevtoolsToken("env:PRISM_DEVTOOLS_UNSET_XYZ", {}),
      (error: unknown) => error instanceof DevtoolsError && error.code === "ERR_PRISM_DEVTOOLS_TOKEN_UNSET",
    );
    assert.equal(resolveDevtoolsToken(undefined), undefined);
    assert.equal(resolveDevtoolsToken("env:PRISM_DEVTOOLS_TOKEN", { PRISM_DEVTOOLS_TOKEN: "abc" }), "abc");
  });
});

describe("replayPage", () => {
  const entries = [{ id: "a" }, { id: "b" }, { id: "c" }] as never[];

  it("pages by index and marks the last page terminal", () => {
    const first = replayPage(entries, { limit: 2 });
    assert.equal(first.items.length, 2);
    assert.equal(first.nextCursor, "2");
    assert.equal(first.terminal, false);
    const last = replayPage(entries, { limit: 2, cursor: "2" });
    assert.equal(last.items.length, 1);
    assert.equal(last.nextCursor, undefined);
    assert.equal(last.terminal, true);
  });

  it("rejects a cursor past the end and an out-of-range limit", () => {
    assert.throws(() => replayPage(entries, { cursor: "9" }), DevtoolsError);
    assert.throws(() => replayPage(entries, { limit: 0 }), DevtoolsError);
  });
});

describe("serveDevtools Host and Origin gates", () => {
  it("foreign_host_rejected: rejects unexpected Host header with 403 ERR_PRISM_DEVTOOLS_FORBIDDEN_HOST", async () => {
    const agent = await agentReplying("ok");
    const devtools = serveDevtools(agent, { port: 0 });
    try {
      const response = await fetch(`${devtools.url}/api/inspect`, {
        headers: { host: "evil.example" },
      });
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), {
        error: {
          code: "ERR_PRISM_DEVTOOLS_FORBIDDEN_HOST",
          message: "Forbidden host",
        },
      });

      // Page route is guarded as well
      const pageResponse = await fetch(`${devtools.url}/`, {
        headers: { host: "evil.example" },
      });
      assert.equal(pageResponse.status, 403);
      assert.equal(((await pageResponse.json()) as { error: { code: string } }).error.code, "ERR_PRISM_DEVTOOLS_FORBIDDEN_HOST");
    } finally {
      await devtools.close();
      await agent.dispose();
    }
  });

  it("foreign_origin_rejected: rejects unexpected Origin header with 403 ERR_PRISM_DEVTOOLS_FORBIDDEN_ORIGIN", async () => {
    const agent = await agentReplying("ok");
    const devtools = serveDevtools(agent, { port: 0 });
    try {
      const response = await fetch(`${devtools.url}/api/inspect`, {
        headers: { origin: "http://evil.example" },
      });
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), {
        error: {
          code: "ERR_PRISM_DEVTOOLS_FORBIDDEN_ORIGIN",
          message: "Forbidden origin",
        },
      });

      const sessionsResponse = await fetch(`${devtools.url}/api/sessions`, {
        headers: { origin: "https://attacker.site" },
      });
      assert.equal(sessionsResponse.status, 403);
      assert.equal(
        ((await sessionsResponse.json()) as { error: { code: string } }).error.code,
        "ERR_PRISM_DEVTOOLS_FORBIDDEN_ORIGIN",
      );
    } finally {
      await devtools.close();
      await agent.dispose();
    }
  });

  it("loopback_host_allowed: accepts 127.0.0.1, localhost, [::1], and loopback origins", async () => {
    const agent = await agentReplying("ok");
    const devtools = serveDevtools(agent, { port: 0 });
    try {
      for (const host of [`127.0.0.1:${devtools.port}`, `localhost:${devtools.port}`, `[::1]:${devtools.port}`, `LOCALHOST:${devtools.port}`]) {
        const response = await fetch(`${devtools.url}/api/inspect`, {
          headers: { host },
        });
        assert.equal(response.status, 200, `host ${host} must be allowed`);
      }

      for (const origin of [
        `http://127.0.0.1:${devtools.port}`,
        `http://localhost:${devtools.port}`,
        `http://[::1]:${devtools.port}`,
      ]) {
        const response = await fetch(`${devtools.url}/api/inspect`, {
          headers: { origin },
        });
        assert.equal(response.status, 200, `origin ${origin} must be allowed`);
      }

      // No origin header (e.g. direct curl or navigation) is allowed
      const direct = await fetch(`${devtools.url}/api/inspect`);
      assert.equal(direct.status, 200);
    } finally {
      await devtools.close();
      await agent.dispose();
    }
  });

  it("custom_allowed_hosts: ServeDevtoolsOptions.allowedHosts and allowedOrigins override the defaults", async () => {
    const agent = await agentReplying("ok");
    const devtools = serveDevtools(agent, {
      port: 0,
      allowedHosts: ["inspector.internal:8888"],
      allowedOrigins: ["https://console.internal"],
    });
    try {
      // Configured host and origin are allowed
      const allowed = await fetch(`${devtools.url}/api/inspect`, {
        headers: {
          host: "inspector.internal:8888",
          origin: "https://console.internal",
        },
      });
      assert.equal(allowed.status, 200);

      // Default loopback host is now rejected because allowedHosts overrode it
      const defaultHostRejected = await fetch(`${devtools.url}/api/inspect`, {
        headers: {
          host: `127.0.0.1:${devtools.port}`,
        },
      });
      assert.equal(defaultHostRejected.status, 403);
      assert.equal(
        ((await defaultHostRejected.json()) as { error: { code: string } }).error.code,
        "ERR_PRISM_DEVTOOLS_FORBIDDEN_HOST",
      );

      // Default loopback origin is now rejected because allowedOrigins overrode it
      const defaultOriginRejected = await fetch(`${devtools.url}/api/inspect`, {
        headers: {
          host: "inspector.internal:8888",
          origin: `http://127.0.0.1:${devtools.port}`,
        },
      });
      assert.equal(defaultOriginRejected.status, 403);
      assert.equal(
        ((await defaultOriginRejected.json()) as { error: { code: string } }).error.code,
        "ERR_PRISM_DEVTOOLS_FORBIDDEN_ORIGIN",
      );
    } finally {
      await devtools.close();
      await agent.dispose();
    }
  });

  it("hostOriginRejection matches @arnilo/prism-remote http-gate behavior (parity check)", async () => {
    const options = {
      allowedHosts: ["127.0.0.1:4311", "localhost:4311"],
      allowedOrigins: ["http://127.0.0.1:4311", "http://localhost:4311"],
    };

    const cases: Array<{ name: string; headers: Record<string, string> }> = [
      { name: "valid loopback host, no origin", headers: { host: "127.0.0.1:4311" } },
      { name: "valid uppercase host, no origin", headers: { host: "LOCALHOST:4311" } },
      { name: "valid host and valid origin", headers: { host: "127.0.0.1:4311", origin: "http://127.0.0.1:4311" } },
      { name: "valid host and uppercase origin", headers: { host: "127.0.0.1:4311", origin: "HTTP://LOCALHOST:4311" } },
      { name: "foreign host", headers: { host: "evil.example" } },
      { name: "foreign origin", headers: { host: "127.0.0.1:4311", origin: "http://evil.example" } },
      { name: "missing host", headers: {} },
    ];

    for (const testCase of cases) {
      const request = new Request("http://127.0.0.1:4311/test", { headers: testCase.headers });
      const devtoolsResult = devtoolsHostOriginRejection(request, options);
      const remoteResult = remoteHostOriginRejection(request, options);

      if (remoteResult === undefined) {
        assert.equal(devtoolsResult, undefined, `expected pass for ${testCase.name}`);
      } else {
        assert.ok(devtoolsResult !== undefined, `expected rejection for ${testCase.name}`);
        assert.equal(remoteResult.status, 403);
        assert.equal(devtoolsResult.status, 403);

        const remoteBody = (await remoteResult.json()) as { error: string };
        const devtoolsBody = (await devtoolsResult.json()) as { error: { code: string; message: string } };

        if (remoteBody.error === "forbidden_host") {
          assert.equal(devtoolsBody.error.code, "ERR_PRISM_DEVTOOLS_FORBIDDEN_HOST");
        } else if (remoteBody.error === "forbidden_origin") {
          assert.equal(devtoolsBody.error.code, "ERR_PRISM_DEVTOOLS_FORBIDDEN_ORIGIN");
        } else {
          assert.fail(`unexpected remote error: ${remoteBody.error}`);
        }
      }
    }
  });
});
