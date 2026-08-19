import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createXaiOAuthProvider,
  parseXaiTokenCredentials,
  XAI_DEFAULT_CLIENT_ID,
  XAI_DEFAULT_DEVICE_CODE_URL,
  XAI_DEFAULT_REFERRER,
  XAI_DEFAULT_REVOKE_URL,
  XAI_DEFAULT_SCOPE,
  XAI_DEFAULT_TOKEN_URL,
  XAI_REFRESH_SKEW_MS,
} from "../index.js";

describe("@arnilo/prism-provider-xai oauth", () => {
  it("xai_oauth_device_code_posts_form_with_public_client_scope_and_referrer", async () => {
    let deviceUrl = "";
    let deviceType = "";
    let deviceBody: URLSearchParams | undefined;
    const provider = createXaiOAuthProvider({
      fetch: (async (url, init) => {
        if (String(url).includes("device")) {
          deviceUrl = String(url);
          deviceType = new Headers(init?.headers).get("content-type") ?? "";
          deviceBody = new URLSearchParams(String(init?.body));
          return Response.json({
            device_code: "secret-device",
            user_code: "ABCD-EFGH",
            verification_uri: "https://auth.x.ai/activate",
            verification_uri_complete: "https://auth.x.ai/activate?user_code=ABCD-EFGH",
            interval: 0,
            expires_in: 600,
          });
        }
        return Response.json({ access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600 });
      }) as typeof fetch,
      sleep: async () => {},
    });
    let seen: { userCode: string; verificationUri: string } | undefined;
    const credentials = await provider.login({
      onDeviceCode: (code) => {
        seen = code;
      },
    });
    assert.equal(deviceUrl, XAI_DEFAULT_DEVICE_CODE_URL);
    assert.equal(deviceType, "application/x-www-form-urlencoded");
    assert.equal(deviceBody?.get("client_id"), XAI_DEFAULT_CLIENT_ID);
    assert.equal(deviceBody?.get("scope"), XAI_DEFAULT_SCOPE);
    assert.equal(deviceBody?.get("referrer"), XAI_DEFAULT_REFERRER);
    assert.equal(seen?.userCode, "ABCD-EFGH");
    assert.equal(seen?.verificationUri, "https://auth.x.ai/activate?user_code=ABCD-EFGH");
    assert.equal(credentials.access, "access-1");
    assert.equal((await provider.getCredential?.(credentials))?.value, "access-1");
  });

  it("xai_oauth_requires_on_device_code_and_rejects_http_verification_uri", async () => {
    const provider = createXaiOAuthProvider({
      fetch: (async () =>
        Response.json({
          device_code: "d",
          user_code: "U",
          verification_uri: "http://evil.test/activate",
          interval: 0,
          expires_in: 60,
        })) as typeof fetch,
      sleep: async () => {},
    });
    await assert.rejects(async () => provider.login(), /requires onDeviceCode/);
    await assert.rejects(async () => provider.login({ onDeviceCode: () => {} }), /verification_uri must be https/);
  });

  it("xai_oauth_device_code_pending_slow_down_denied_expired_abort", async () => {
    const denied = createXaiOAuthProvider({
      fetch: deviceThen(() => Response.json({ error: "access_denied" }, { status: 400 })),
      sleep: async () => {},
    });
    await assert.rejects(async () => denied.login({ onDeviceCode: () => {} }), /access_denied/);

    const expired = createXaiOAuthProvider({
      fetch: deviceThen(() => Response.json({ error: "expired_token" }, { status: 400 })),
      sleep: async () => {},
    });
    await assert.rejects(async () => expired.login({ onDeviceCode: () => {} }), /expired_token/);

    let polls = 0;
    const sleeps: number[] = [];
    const pending = createXaiOAuthProvider({
      fetch: deviceThen(() => {
        polls += 1;
        if (polls === 1) return Response.json({ error: "authorization_pending" }, { status: 400 });
        if (polls === 2) return Response.json({ error: "slow_down" }, { status: 400 });
        return Response.json({ access_token: "after-wait" });
      }),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    assert.equal((await pending.login({ onDeviceCode: () => {} })).access, "after-wait");
    assert.ok(sleeps.length >= 2);
    assert.ok(sleeps.some((ms) => ms >= 5_000));

    const controller = new AbortController();
    const aborting = createXaiOAuthProvider({
      fetch: deviceThen(() => Response.json({ error: "authorization_pending" }, { status: 400 })),
      sleep: async () => {
        controller.abort(new Error("stop-login"));
      },
    });
    await assert.rejects(async () => aborting.login({ onDeviceCode: () => {}, signal: controller.signal }), /stop-login/);
  });

  it("xai_oauth_refresh_keeps_previous_refresh_token_and_applies_skew", async () => {
    let tokenType = "";
    let tokenBody: URLSearchParams | undefined;
    let tokenUrl = "";
    const provider = createXaiOAuthProvider({
      fetch: (async (url, init) => {
        tokenUrl = String(url);
        tokenType = new Headers(init?.headers).get("content-type") ?? "";
        tokenBody = new URLSearchParams(String(init?.body));
        return Response.json({ access_token: "new-access", expires_in: 3600 });
      }) as typeof fetch,
      now: () => 1_000_000,
    });
    const refreshed = await provider.refresh!({ access: "old-access", refresh: "keep-me" });
    assert.equal(tokenUrl, XAI_DEFAULT_TOKEN_URL);
    assert.equal(tokenType, "application/x-www-form-urlencoded");
    assert.equal(tokenBody?.get("grant_type"), "refresh_token");
    assert.equal(tokenBody?.get("refresh_token"), "keep-me");
    assert.equal(refreshed.access, "new-access");
    assert.equal(refreshed.refresh, "keep-me");
    assert.equal(refreshed.expires, 1_000_000 + 3600 * 1_000 - XAI_REFRESH_SKEW_MS);
    assert.deepEqual(await provider.refresh!({ access: "only-access" }), { access: "only-access" });
    await assert.rejects(
      async () =>
        createXaiOAuthProvider({
          fetch: (async () => new Response("bad refresh-secret", { status: 400 })) as typeof fetch,
        }).refresh!({ access: "access-secret", refresh: "refresh-secret" }),
      (error: unknown) => {
        const message = String(error);
        assert.equal(message.includes("refresh-secret"), false);
        assert.equal(message.includes("access-secret"), false);
        return true;
      },
    );
  });

  it("xai_oauth_revoke_posts_form_and_missing_token_is_noop", async () => {
    let revokeUrl = "";
    let revokeBody: URLSearchParams | undefined;
    const provider = createXaiOAuthProvider({
      fetch: (async (url, init) => {
        revokeUrl = String(url);
        revokeBody = new URLSearchParams(String(init?.body));
        return new Response("oops", { status: 500 });
      }) as typeof fetch,
    });
    await provider.revoke!({ access: "access-1", refresh: "refresh-1" });
    assert.equal(revokeUrl, XAI_DEFAULT_REVOKE_URL);
    assert.equal(revokeBody?.get("token"), "access-1");
    assert.equal(revokeBody?.get("client_id"), XAI_DEFAULT_CLIENT_ID);
    await provider.revoke!({});
    assert.equal(revokeBody?.get("token"), "access-1");
  });

  it("xai_oauth_parse_applies_default_lifetime_and_skew", () => {
    const parsed = parseXaiTokenCredentials({ access_token: "a", refresh_token: "r" }, undefined, () => 10_000);
    assert.equal(parsed.expires, 10_000 + 3600 * 1_000 - XAI_REFRESH_SKEW_MS);
  });
});

function deviceThen(token: () => Response): typeof fetch {
  return (async (url) => {
    if (String(url).includes("device")) {
      return Response.json({
        device_code: "device",
        user_code: "CODE",
        verification_uri: "https://auth.x.ai/activate",
        interval: 1,
        expires_in: 60,
      });
    }
    return token();
  }) as typeof fetch;
}
