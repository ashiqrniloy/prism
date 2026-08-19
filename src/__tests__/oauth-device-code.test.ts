import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pollDeviceCodeToken, type PollDeviceCodeTokenOptions } from "../oauth-device-code.js";

const DEVICE = "https://example.test/device";
const TOKEN = "https://example.test/token";
const DEVICE_CODE = "dev-secret";
const USER_CODE = "USER-CODE";

const parseTokenCredentials: PollDeviceCodeTokenOptions["parseTokenCredentials"] = (json) => ({
  access: json.access_token ?? "",
});

const payload = (extra: Record<string, unknown> = {}) => ({
  device_code: DEVICE_CODE,
  user_code: USER_CODE,
  verification_uri: "https://example.test/activate",
  interval: 0,
  expires_in: 60,
  ...extra,
});

const recorded = (handler: (url: string, init: RequestInit | undefined) => Response) => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    calls.push({ url: href, init });
    return handler(href, init);
  }) as typeof fetch;
  return { calls, fetchImpl };
};

const poll = (overrides: Partial<PollDeviceCodeTokenOptions> & Pick<PollDeviceCodeTokenOptions, "fetchImpl">) =>
  pollDeviceCodeToken({
    deviceCodeUrl: DEVICE,
    tokenUrl: TOKEN,
    clientId: "prism",
    scope: "openid",
    errorPrefix: "xAI",
    sleep: async () => {},
    parseTokenCredentials,
    ...overrides,
  });

describe("pollDeviceCodeToken", () => {
  it("default JSON still sends application/json with { client_id, scope }", async () => {
    const { calls, fetchImpl } = recorded((url) =>
      Response.json(url.includes("device") ? payload() : { access_token: "tok" }),
    );
    const creds = await poll({ fetchImpl });
    assert.equal(creds.access, "tok");
    assert.equal(calls.length, 2);
    const firstHeaders = calls[0]!.init?.headers as Record<string, string> | undefined;
    assert.equal(firstHeaders?.["content-type"], "application/json");
    assert.equal(calls[0]!.init?.body, JSON.stringify({ client_id: "prism", scope: "openid" }));
    const secondHeaders = calls[1]!.init?.headers as Record<string, string> | undefined;
    assert.equal(secondHeaders?.["content-type"], "application/json");
    assert.equal(
      calls[1]!.init?.body,
      JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: "prism",
        device_code: DEVICE_CODE,
      }),
    );
  });

  it("bodyEncoding form sends urlencoded device + token bodies; referrer only on device POST", async () => {
    const { calls, fetchImpl } = recorded((url) =>
      Response.json(url.includes("device") ? payload() : { access_token: "tok" }),
    );
    await poll({
      fetchImpl,
      bodyEncoding: "form",
      extraDeviceParams: { referrer: "prism" },
      extraTokenParams: { audience: "api" },
    });
    const deviceHeaders = calls[0]!.init?.headers as Record<string, string> | undefined;
    assert.equal(deviceHeaders?.["content-type"], "application/x-www-form-urlencoded");
    const device = new URLSearchParams(String(calls[0]!.init?.body));
    assert.equal(device.get("client_id"), "prism");
    assert.equal(device.get("scope"), "openid");
    assert.equal(device.get("referrer"), "prism");
    const tokenHeaders = calls[1]!.init?.headers as Record<string, string> | undefined;
    assert.equal(tokenHeaders?.["content-type"], "application/x-www-form-urlencoded");
    const token = new URLSearchParams(String(calls[1]!.init?.body));
    assert.equal(token.get("grant_type"), "urn:ietf:params:oauth:grant-type:device_code");
    assert.equal(token.get("device_code"), DEVICE_CODE);
    assert.equal(token.get("audience"), "api");
    assert.equal(token.get("referrer"), null);
  });

  it("verification_uri_complete (https) is what onDeviceCode receives", async () => {
    let seen: string | undefined;
    const { fetchImpl } = recorded((url) =>
      Response.json(
        url.includes("device")
          ? payload({ verification_uri_complete: "https://example.test/activate?user_code=USER-CODE" })
          : { access_token: "tok" },
      ),
    );
    await poll({
      fetchImpl,
      callbacks: { onDeviceCode: ({ verificationUri }) => { seen = verificationUri; } },
    });
    assert.equal(seen, "https://example.test/activate?user_code=USER-CODE");
  });

  it("http / invalid verification URI fails closed, no poll", async () => {
    for (const uri of ["http://example.test/activate", "javascript:alert(1)", "myapp://activate", "not-a-url"]) {
      const { calls, fetchImpl } = recorded(() => Response.json(payload({ verification_uri: uri })));
      await assert.rejects(() => poll({ fetchImpl }), /verification_uri must be https/);
      assert.equal(calls.length, 1, uri);
    }
    const { calls, fetchImpl } = recorded(() =>
      Response.json(payload({ verification_uri_complete: "http://example.test/complete" })),
    );
    await assert.rejects(() => poll({ fetchImpl }), /verification_uri_complete must be https/);
    assert.equal(calls.length, 1);
  });

  it("authorization_pending then success; slow_down adds 5s", async () => {
    const sleeps: number[] = [];
    let tokenCalls = 0;
    const { fetchImpl } = recorded((url) => {
      if (url.includes("device")) return Response.json(payload({ interval: 1 }));
      tokenCalls += 1;
      if (tokenCalls === 1) return Response.json({ error: "authorization_pending" }, { status: 400 });
      if (tokenCalls === 2) return Response.json({ error: "slow_down" }, { status: 400 });
      return Response.json({ access_token: "tok" });
    });
    const creds = await poll({
      fetchImpl,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    assert.equal(creds.access, "tok");
    assert.deepEqual(sleeps, [1000, 1000, 6000]);
  });

  it("expiry / abort / oversized body / missing access_token unchanged", async () => {
    let now = 1_000;
    const { fetchImpl: pending } = recorded((url) =>
      url.includes("device")
        ? Response.json(payload({ interval: 1, expires_in: 3 }))
        : Response.json({ error: "authorization_pending" }, { status: 400 }),
    );
    await assert.rejects(
      () =>
        poll({
          fetchImpl: pending,
          now: () => now,
          sleep: async (ms) => {
            now += ms;
          },
        }),
      /expired before authorization completed/,
    );

    const controller = new AbortController();
    const { fetchImpl: aborting } = recorded((url) =>
      url.includes("device") ? Response.json(payload({ interval: 1 })) : Response.json({ access_token: "tok" }),
    );
    await assert.rejects(
      () =>
        poll({
          fetchImpl: aborting,
          callbacks: { signal: controller.signal },
          sleep: async () => {
            controller.abort();
          },
        }),
      /aborted/i,
    );

    const { fetchImpl: huge } = recorded(
      () => new Response("y".repeat(70_000), { status: 200, headers: { "content-type": "application/json" } }),
    );
    await assert.rejects(() => poll({ fetchImpl: huge }), /65536/);

    const { fetchImpl: shapeless } = recorded((url) =>
      Response.json(url.includes("device") ? payload() : { token_type: "bearer" }),
    );
    await assert.rejects(() => poll({ fetchImpl: shapeless }), /shape|access_token/i);
  });

  it("secrets stay [REDACTED] in thrown errors", async () => {
    const { fetchImpl } = recorded((url) =>
      url.includes("device")
        ? Response.json(payload())
        : Response.json(
            { error: "access_denied", error_description: `rejected device_code=${DEVICE_CODE} user_code=${USER_CODE}` },
            { status: 400 },
          ),
    );
    await assert.rejects(
      () => poll({ fetchImpl }),
      (error: Error) => {
        assert.match(error.message, /access_denied/);
        assert.match(error.message, /\[REDACTED\]/);
        assert.equal(error.message.includes(DEVICE_CODE), false);
        assert.equal(error.message.includes(USER_CODE), false);
        return true;
      },
    );
  });
});
