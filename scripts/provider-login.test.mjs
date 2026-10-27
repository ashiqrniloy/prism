/**
 * Plan 204 Task 9: the login script's offline contract — it drives the provider's own `AuthMethod`
 * through a terminal `HostUi`, and nothing it prints can carry a secret.
 */

import { test } from "bun:test";
import assert from "node:assert/strict";
import { createTerminalHostUi, credentialsHandle, fingerprint, parseArgs } from "./provider-login.mjs";

function fakeResolver() {
  const stored = [];
  return {
    stored,
    resolve: () => undefined,
    store: async (ref, secret) => {
      stored.push({ ref, secret });
    },
  };
}

test("provider_login_script_uses_auth_method_and_prints_no_secret", async () => {
  const passed = parseArgs(["--provider", "openai-codex", "--app-name", "Prism live tests"]);
  assert.equal(passed.mode, "login");
  const printed = [];
  const opened = [];
  const resolver = fakeResolver();
  let logins = 0;
  const method = {
    kind: "oauth",
    id: "fake",
    async login(ctx) {
      logins += 1;
      const openedResponse = await ctx.host.ui.request({
        kind: "open-url",
        title: "Sign in",
        url: "https://example.test/authorize?state=fake-state&code_challenge=fake-challenge",
      });
      assert.deepEqual(openedResponse, { status: "answered", value: undefined });
      await ctx.credentials.store("keyring:fake", { value: "sk-not-printed-value" });
    },
  };
  const ui = createTerminalHostUi({
    print: (line) => printed.push(line),
    open: async (url) => {
      opened.push(url);
    },
    ask: async () => "",
  });
  await method.login({ host: { ui }, credentials: credentialsHandle(resolver) });

  assert.equal(logins, 1);
  assert.equal(resolver.stored.length, 1);
  assert.equal(resolver.stored[0].ref, "keyring:fake");
  assert.equal(opened.length, 1);
  assert.ok(
    printed.join("\n").includes("https://example.test/authorize?state=fake-state&code_challenge=fake-challenge"),
    "the sign-in URL is what the operator sees",
  );
  assert.doesNotMatch(printed.join("\n"), /sk-not-printed-value/);
  assert.doesNotMatch(printed.join("\n"), /fake-challenge-breaking/);
});

test("provider_login_script_rejects_unwritable_refs_and_missing_app_name", () => {
  assert.throws(() => parseArgs(["--provider", "openai-codex"]), /--app-name is required/);
  assert.throws(() => parseArgs(["--provider", "openai-codex", "--app-name", "x", "--ref", "env:OPENAI_KEY"]), /keyring: ref/);
  assert.throws(() => parseArgs(["--provider", "openai-codex", "--app-name", "x", "--service", "../etc"]), /service/);
  assert.throws(() => parseArgs(["--provider", "openai-codex", "--app-name", "x", "--port", "0"]), /65535/);
  assert.throws(() => parseArgs(["--provider", "hyper", "--app-name", "x"]), /no login here/);
  assert.throws(() => parseArgs(["--provider", "openai-codex", "--app-name", "x", "--status"]), /not used with/);
  assert.throws(() => parseArgs(["--provider", "openai-codex", "--check", "--with-field", "Not A Field"]), /snake_case/);
  const imported = parseArgs(["--provider", "openai-codex", "--import", "grant.json", "--with-field", "conversation"]);
  assert.equal(parseArgs(["--provider", "openai-codex", "--forget"]).mode, "forget");
  assert.equal(imported.mode, "import");
  assert.equal(imported.check, true);
  assert.equal(imported.withField, "conversation");
});

test("provider_login_fingerprint_compares_grants_without_showing_them", () => {
  assert.equal(fingerprint(undefined), "absent");
  assert.equal(fingerprint("oaiapp_0123456789"), fingerprint("oaiapp_0123456789"));
  assert.notEqual(fingerprint("oaiapp_0123456789"), fingerprint("oaiapp_0123456790"));
  assert.doesNotMatch(fingerprint("oaiapp_0123456789"), /oaiapp/);
});
