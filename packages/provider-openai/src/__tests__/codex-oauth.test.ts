import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createOpenAICodexOAuthProvider } from "../index.js";

describe("@prism/provider-openai codex oauth", () => {
  it("openai_codex_oauth_browser_and_device_code_are_mocked", async () => {
    let authUrl = "";
    const browser = createOpenAICodexOAuthProvider({ fetch: tokenFetch("browser-access") });
    const browserCredentials = await browser.login({ onAuth: (url) => { authUrl = url; }, onPrompt: () => "fake-code" });
    assert.match(authUrl, /code_challenge=/);
    assert.equal(browserCredentials.access, "browser-access");

    let deviceCode = "";
    const device = createOpenAICodexOAuthProvider({ fetch: deviceFetch });
    const deviceCredentials = await device.login({ onDeviceCode: (code) => { deviceCode = code.userCode; } });
    assert.equal(deviceCode, "FAKE-CODE");
    assert.equal(deviceCredentials.access, "device-access");
  });

  it("openai_codex_refresh_redacts_tokens_from_errors", async () => {
    const provider = createOpenAICodexOAuthProvider({ fetch: (async () => new Response("bad fake-refresh", { status: 400 })) as typeof fetch });
    await assert.rejects(async () => provider.refresh!({ access: "fake-access", refresh: "fake-refresh" }), (error: any) => {
      assert(!String(error.message).includes("fake-refresh"));
      assert(String(error.message).includes("[REDACTED]"));
      return true;
    });
  });
});

function tokenFetch(access: string): typeof fetch {
  return (async () => Response.json({ access_token: access, refresh_token: "fake-refresh", expires_in: 60, account_id: "acct" })) as typeof fetch;
}

const deviceFetch = (async (url: string | URL | Request) => {
  return String(url).includes("device")
    ? Response.json({ device_code: "device", user_code: "FAKE-CODE", verification_uri: "https://example.test/device" })
    : Response.json({ access_token: "device-access" });
}) as typeof fetch;
