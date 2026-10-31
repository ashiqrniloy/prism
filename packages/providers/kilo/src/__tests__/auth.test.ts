import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import type { AuthContext, HostUiRequest, HostUiResponse, Secret } from "@arnilo/prism";
import { KILO_AUTH_ID, KiloAuthError, kiloAuth, kiloLogout } from "../index.js";

const TOKEN = "kilo-device-token-canary-never-show";
const EMAIL = "owner@example.test";
const URL_OK = "https://app.kilo.ai/device-auth?code=ABCD-1234";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function jwt(expSeconds: number): string {
  const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${enc({ alg: "none" })}.${enc({ sub: "owner", exp: expSeconds })}.signature`;
}

interface FakeUi {
  readonly ui: NonNullable<AuthContext["host"]["ui"]>;
  readonly calls: HostUiRequest[];
}

function fakeUi(answer: (request: HostUiRequest) => HostUiResponse = () => ({ status: "answered", value: undefined }) as never): FakeUi {
  const calls: HostUiRequest[] = [];
  return {
    calls,
    ui: {
      async request(request: HostUiRequest): Promise<HostUiResponse> {
        calls.push(request);
        return answer(request);
      },
    } as NonNullable<AuthContext["host"]["ui"]>,
  };
}

function fakeContext(ui: FakeUi | undefined): {
  readonly ctx: AuthContext;
  readonly stored: [string, Secret][];
  readonly deleted: string[];
} {
  const stored: [string, Secret][] = [];
  const deleted: string[] = [];
  return {
    stored,
    deleted,
    ctx: {
      host: ui ? { ui: ui.ui } : {},
      credentials: {
        async store(ref, secret) {
          stored.push([ref, secret]);
        },
        async delete(ref) {
          deleted.push(ref);
        },
      },
    },
  };
}

function fetchQueue(responses: Response[]): { readonly fetch: typeof fetch; readonly urls: string[]; readonly bodies: string[] } {
  const urls: string[] = [];
  const bodies: string[] = [];
  return {
    urls,
    bodies,
    fetch: (async (input, init) => {
      urls.push(String(input));
      bodies.push(String(init?.body ?? ""));
      const response = responses.shift();
      if (!response) throw new Error(`unexpected fetch ${String(input)}`);
      return response;
    }) as typeof fetch,
  };
}

describe("Kilo device login", () => {
  it("kilo_login_happy_path", async () => {
    const exp = 1_900_000_000;
    const token = jwt(exp);
    const ui = fakeUi((request) =>
      request.kind === "open-url" ? { status: "answered", value: undefined } : { status: "answered", value: "" },
    );
    const { ctx, stored } = fakeContext(ui);
    const http = fetchQueue([
      json({ code: "device-code", verificationUrl: URL_OK, expiresIn: 600 }),
      new Response("", { status: 202 }),
      json({ status: "pending" }),
      json({ status: "approved", token, userEmail: EMAIL }),
      json({ user: { email: EMAIL }, hasPersonalAccount: true }),
    ]);
    await kiloAuth({ credential: "keyring:kilo", fetch: http.fetch, sleep: async () => {}, now: () => 1_800_000_000_000 }).login(ctx);

    assert.equal(stored.length, 1);
    assert.equal(stored[0]![0], "keyring:kilo");
    assert.equal(stored[0]![1].type, "bearer");
    assert.equal(stored[0]![1].value, token);
    assert.deepEqual(stored[0]![1].metadata, {
      v: 1,
      email: EMAIL,
      obtainedAt: new Date(1_800_000_000_000).toISOString(),
      expires: exp * 1_000,
    });
    assert.equal(ui.calls.length, 1);
    assert.equal(ui.calls[0]!.kind, "open-url");
    assert.equal((ui.calls[0] as { url: string }).url, URL_OK);
    assert.match((ui.calls[0] as { title: string }).title, /device-code/);
    assert.deepEqual(http.bodies[0], "{}");
    assert.equal(http.urls[0], "https://api.kilo.ai/api/device-auth/codes");
    assert.ok(http.urls.at(-1)?.endsWith("/api/profile"));
    assert.equal(JSON.stringify(ui.calls).includes(token), false);
    assert.equal(JSON.stringify(ui.calls).includes(EMAIL), false);
  });

  it("kilo_login_uses_one_year_when_the_token_is_not_a_jwt", async () => {
    const ui = fakeUi();
    const { ctx, stored } = fakeContext(ui);
    const now = 1_800_000_000_000;
    const http = fetchQueue([
      json({ code: "c", verificationUrl: URL_OK, expiresIn: 600 }),
      json({ status: "approved", token: TOKEN }),
      json({ hasPersonalAccount: false }),
    ]);
    await kiloAuth({ fetch: http.fetch, sleep: async () => {}, now: () => now }).login(ctx);
    assert.equal(stored[0]![1].metadata?.expires, now + 365 * 24 * 60 * 60 * 1_000);
  });

  it("kilo_login_denied_expired_busy", async () => {
    const cases: readonly [Response, string][] = [
      [json({}, 403), "ERR_KILO_AUTH_DENIED"],
      [json({}, 410), "ERR_KILO_AUTH_EXPIRED"],
    ];
    for (const [poll, code] of cases) {
      const ui = fakeUi();
      const { ctx, stored } = fakeContext(ui);
      const http = fetchQueue([json({ code: "c", verificationUrl: URL_OK, expiresIn: 600 }), poll]);
      await assert.rejects(
        () => kiloAuth({ fetch: http.fetch, sleep: async () => {} }).login(ctx),
        (error: KiloAuthError) => error.code === code,
      );
      assert.equal(stored.length, 0);
    }

    const ui = fakeUi();
    const { ctx, stored } = fakeContext(ui);
    const http = fetchQueue([json({}, 429)]);
    await assert.rejects(
      () => kiloAuth({ fetch: http.fetch }).login(ctx),
      (error: KiloAuthError) => error.code === "ERR_KILO_AUTH_BUSY",
    );
    assert.equal(ui.calls.length, 0);
    assert.equal(stored.length, 0);
  });

  it("kilo_login_rejects_foreign_verification_url", async () => {
    for (const url of ["http://app.kilo.ai/device-auth", "https://evil.example/device-auth", "https://app.kilo.ai.evil.example/x"]) {
      const ui = fakeUi();
      const { ctx, stored } = fakeContext(ui);
      const http = fetchQueue([json({ code: "c", verificationUrl: url, expiresIn: 600 })]);
      await assert.rejects(
        () => kiloAuth({ fetch: http.fetch }).login(ctx),
        (error: KiloAuthError) => error.code === "ERR_KILO_AUTH_ORIGIN",
      );
      assert.equal(ui.calls.length, 0);
      assert.equal(stored.length, 0);
    }
  });

  it("kilo_login_org_choice", async () => {
    const ui = fakeUi((request) =>
      request.kind === "input" ? { status: "answered", value: "org-b" } : { status: "answered", value: undefined },
    );
    const { ctx, stored } = fakeContext(ui);
    const http = fetchQueue([
      json({ code: "c", verificationUrl: URL_OK, expiresIn: 600 }),
      json({ status: "approved", token: TOKEN, userEmail: EMAIL }),
      json({
        user: { email: EMAIL },
        hasPersonalAccount: true,
        selectedOrganizationId: "org-a",
        organizations: [
          { id: "org-a", name: "Alpha" },
          { id: "org-b", name: "Beta" },
        ],
      }),
    ]);
    await kiloAuth({ fetch: http.fetch, sleep: async () => {} }).login(ctx);
    const input = ui.calls.find((call) => call.kind === "input") as { value?: string; detail?: string };
    assert.equal(input.value, "org-a", "the CLI's selected organization is the default");
    assert.match(input.detail ?? "", /org-b \(Beta\)/);
    assert.equal(stored[0]![1].metadata?.organizationId, "org-b");
    assert.equal(JSON.stringify(ui.calls).includes(TOKEN), false);
  });

  it("kilo_login_single_choice_asks_nothing", async () => {
    const ui = fakeUi();
    const { ctx, stored } = fakeContext(ui);
    const http = fetchQueue([
      json({ code: "c", verificationUrl: URL_OK, expiresIn: 600 }),
      json({ status: "approved", token: TOKEN }),
      json({ hasPersonalAccount: false, organizations: [{ id: "only-org", name: "Only" }] }),
    ]);
    await kiloAuth({ fetch: http.fetch, sleep: async () => {} }).login(ctx);
    assert.equal(
      ui.calls.some((call) => call.kind === "input"),
      false,
    );
    assert.equal(stored[0]![1].metadata?.organizationId, "only-org");
  });

  it("kilo_login_personal_default_leaves_organization_unset", async () => {
    const ui = fakeUi((request) =>
      request.kind === "input" ? { status: "answered", value: "personal" } : { status: "answered", value: undefined },
    );
    const { ctx, stored } = fakeContext(ui);
    const http = fetchQueue([
      json({ code: "c", verificationUrl: URL_OK, expiresIn: 600 }),
      json({ status: "approved", token: TOKEN }),
      json({ hasPersonalAccount: true, organizations: [{ id: "org-a", name: "Alpha" }] }),
    ]);
    await kiloAuth({ fetch: http.fetch, sleep: async () => {} }).login(ctx);
    assert.equal((ui.calls.find((call) => call.kind === "input") as { value?: string }).value, "personal");
    assert.equal("organizationId" in (stored[0]![1].metadata ?? {}), false);
  });

  it("kilo_login_ui_unavailable", async () => {
    const ui = fakeUi(() => ({ status: "unavailable" }));
    const { ctx, stored } = fakeContext(ui);
    const http = fetchQueue([json({ code: "c", verificationUrl: URL_OK, expiresIn: 600 })]);
    await assert.rejects(
      () => kiloAuth({ fetch: http.fetch }).login(ctx),
      (error: KiloAuthError) => error.code === "ERR_KILO_AUTH_UI",
    );
    assert.equal(stored.length, 0);
  });

  it("kilo_login_abort_stops_polling", async () => {
    const controller = new AbortController();
    const ui = fakeUi();
    const { ctx, stored } = fakeContext(ui);
    const http = fetchQueue([json({ code: "c", verificationUrl: URL_OK, expiresIn: 600 })]);
    await assert.rejects(
      () =>
        kiloAuth({
          fetch: http.fetch,
          signal: controller.signal,
          sleep: async () => {
            controller.abort();
          },
        }).login(ctx),
      (error: KiloAuthError) => error.code === "ERR_KILO_AUTH_ABORTED",
    );
    assert.equal(http.urls.length, 1, "only the initiate request ran");
    assert.equal(stored.length, 0);
  });

  it("kilo_login_malformed_responses_fail_closed_without_leaking", async () => {
    // Malformed initiate body and a bad auth base both fail before any UI call.
    const ui = fakeUi();
    const { ctx, stored } = fakeContext(ui);
    const malformed = fetchQueue([new Response("{ not json", { headers: { "content-type": "application/json" } })]);
    await assert.rejects(
      () => kiloAuth({ fetch: malformed.fetch }).login(ctx),
      (error: KiloAuthError) => error.code === "ERR_KILO_AUTH_RESPONSE",
    );
    const badBase = fetchQueue([json({ code: "c", verificationUrl: URL_OK, expiresIn: 600 })]);
    await assert.rejects(
      () => kiloAuth({ authBase: "not-a-url", fetch: badBase.fetch }).login(ctx),
      (error: KiloAuthError) => error.code === "ERR_KILO_AUTH_ORIGIN",
    );
    const invalidUrl = fetchQueue([json({ code: "c", verificationUrl: "not a url", expiresIn: 600 })]);
    await assert.rejects(
      () => kiloAuth({ fetch: invalidUrl.fetch }).login(ctx),
      (error: KiloAuthError) => error.code === "ERR_KILO_AUTH_ORIGIN",
    );
    assert.equal(ui.calls.length, 0);
    assert.equal(stored.length, 0);
  });

  it("kilo_login_bad_jwt_expiry_falls_back", async () => {
    const ui = fakeUi();
    const { ctx, stored } = fakeContext(ui);
    const http = fetchQueue([
      json({ code: "c", verificationUrl: URL_OK, expiresIn: 600 }),
      json({ status: "approved", token: "a.%%%.c" }),
      json({ hasPersonalAccount: true }),
    ]);
    const now = 1_800_000_000_000;
    await kiloAuth({ fetch: http.fetch, sleep: async () => {}, now: () => now }).login(ctx);
    assert.equal(stored[0]![1].metadata?.expires, now + 365 * 24 * 60 * 60 * 1_000);
  });

  it("kilo_login_rejects_an_unknown_organization", async () => {
    const ui = fakeUi((request) =>
      request.kind === "input" ? { status: "answered", value: "not-an-org" } : { status: "answered", value: undefined },
    );
    const { ctx, stored } = fakeContext(ui);
    const http = fetchQueue([
      json({ code: "c", verificationUrl: URL_OK, expiresIn: 600 }),
      json({ status: "approved", token: TOKEN }),
      json({
        hasPersonalAccount: true,
        organizations: [
          { id: "org-a", name: "Alpha" },
          { id: "org-b", name: "Beta" },
        ],
      }),
    ]);
    await assert.rejects(
      () => kiloAuth({ fetch: http.fetch, sleep: async () => {} }).login(ctx),
      (error: KiloAuthError) => error.code === "ERR_KILO_AUTH_ORG",
    );
    assert.equal(stored.length, 0);
  });

  it("kilo_login_input_dismissal_stops_the_login", async () => {
    const ui = fakeUi((request) => (request.kind === "input" ? { status: "dismissed" } : { status: "answered", value: undefined }));
    const { ctx, stored } = fakeContext(ui);
    const http = fetchQueue([
      json({ code: "c", verificationUrl: URL_OK, expiresIn: 600 }),
      json({ status: "approved", token: TOKEN }),
      json({ hasPersonalAccount: true, organizations: [{ id: "org-a" }, { id: "org-b" }] }),
    ]);
    await assert.rejects(
      () => kiloAuth({ fetch: http.fetch, sleep: async () => {} }).login(ctx),
      (error: KiloAuthError) => error.code === "ERR_KILO_AUTH_UI",
    );
    assert.equal(stored.length, 0);
  });

  it("kilo_login_pre_aborted_signal_makes_no_request", async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;
    const { ctx } = fakeContext(fakeUi());
    await assert.rejects(
      () =>
        kiloAuth({
          signal: controller.signal,
          fetch: (async () => {
            called = true;
            return json({});
          }) as typeof fetch,
        }).login(ctx),
      (error: KiloAuthError) => error.code === "ERR_KILO_AUTH_ABORTED",
    );
    assert.equal(called, false);
  });

  it("kilo_login_default_sleep_stops_on_abort", async () => {
    const controller = new AbortController();
    const ui = fakeUi();
    const { ctx, stored } = fakeContext(ui);
    const http = fetchQueue([json({ code: "c", verificationUrl: URL_OK, expiresIn: 600 })]);
    setTimeout(() => controller.abort(), 10);
    await assert.rejects(
      () => kiloAuth({ fetch: http.fetch, signal: controller.signal }).login(ctx),
      (error: KiloAuthError) => error.code === "ERR_KILO_AUTH_ABORTED",
    );
    assert.equal(http.urls.length, 1);
    assert.equal(stored.length, 0);
  });

  it("kilo_login_default_sleep_completes_a_poll", async () => {
    const ui = fakeUi();
    const { ctx } = fakeContext(ui);
    const http = fetchQueue([json({ code: "c", verificationUrl: URL_OK, expiresIn: 600 }), json({}, 403)]);
    await assert.rejects(
      () => kiloAuth({ fetch: http.fetch }).login(ctx),
      (error: KiloAuthError) => error.code === "ERR_KILO_AUTH_DENIED",
    );
    assert.equal(http.urls.length, 2);
  }, 10_000);

  it("kilo_login_refuses_read_only_ref_before_any_request", async () => {
    let called = false;
    const http = {
      fetch: (async () => {
        called = true;
        return json({});
      }) as typeof fetch,
    };
    const { ctx } = fakeContext(fakeUi());
    await assert.rejects(
      () => kiloAuth({ credential: "env:KILO_KEY", fetch: http.fetch }).login(ctx),
      (error: KiloAuthError) => error.code === "ERR_KILO_AUTH_REF",
    );
    assert.equal(called, false);
  });

  it("kilo_login_poll_that_never_approves_expires", async () => {
    let now = 0;
    const ui = fakeUi();
    const { ctx, stored } = fakeContext(ui);
    const http = fetchQueue([
      json({ code: "c", verificationUrl: URL_OK, expiresIn: 1 }),
      json({ status: "pending" }),
      json({ status: "pending" }),
    ]);
    await assert.rejects(
      () =>
        kiloAuth({
          fetch: http.fetch,
          now: () => now,
          sleep: async () => {
            now += 1_000;
          },
        }).login(ctx),
      (error: KiloAuthError) => error.code === "ERR_KILO_AUTH_EXPIRED",
    );
    assert.equal(stored.length, 0);
  });

  it("kilo_login_never_leaks_token", async () => {
    const ui = fakeUi();
    const { ctx } = fakeContext(ui);
    const http = fetchQueue([
      json({ code: "c", verificationUrl: URL_OK, expiresIn: 600 }),
      json({ status: "approved", token: TOKEN, userEmail: EMAIL }),
      json({ user: { email: EMAIL }, hasPersonalAccount: true }),
    ]);
    await kiloAuth({ fetch: http.fetch, sleep: async () => {} }).login(ctx);
    const rendered = JSON.stringify(ui.calls);
    assert.equal(rendered.includes(TOKEN), false);
    assert.equal(rendered.includes(EMAIL), false);
  });

  it("kilo_logout_deletes_ref", async () => {
    const { ctx, deleted } = fakeContext(undefined);
    await kiloLogout({ credential: "keyring:kilo" })(ctx);
    assert.deepEqual(deleted, ["keyring:kilo"]);
    assert.equal(KILO_AUTH_ID, "kilo");
  });
});
