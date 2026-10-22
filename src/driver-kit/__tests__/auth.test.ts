import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import * as realFs from "node:fs/promises";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostUi, HostUiRequest } from "../../host/types.js";
import { createPolicyGuard, createProfiles, defineDriver, type AuthMode, type DriverDescriptor, type ProfileFs } from "../index.js";

const SECRET = "sk-vendor-secret-value";
const account: AuthMode = {
  name: "account",
  kind: "account",
  deployments: ["local"],
  protected: { paths: [".vendor/creds"], env: ["VENDOR_TOKEN"] },
  login: [process.execPath, "-e", "0"],
  status: [process.execPath, "-e", 'process.exit(require("fs").existsSync(process.env.VENDOR_HOME+"/signed-in")?0:1)'],
  homeEnv: "VENDOR_HOME",
};
const hostedAccount: AuthMode = { ...account, name: "hosted", deployments: ["local", "hosted"], hostedAcknowledgements: ["terms-v1"] };
const apiKey: AuthMode = { name: "key", kind: "api-key", deployments: ["local", "hosted"], protected: { paths: [], env: [] } };

const descriptor = (modes: AuthMode[]): DriverDescriptor => ({
  vendor: "example",
  usesModel: false,
  models: "passthrough",
  controls: {
    systemPrompt: ["append"],
    builtinTools: "partial",
    clientTools: "mcp",
    skills: true,
    subagents: false,
    permissionCallback: true,
    rewrite: false,
    continueOnStop: true,
    steer: "next-turn",
    resume: "store",
    isolation: "flags",
  },
  capture: {
    textDeltas: true,
    thinking: "final",
    skillActivation: "tool",
    toolCalls: true,
    fileDiffs: false,
    subagents: "none",
    usage: "tokens",
  },
  auth: { modes },
});

const driver = (modes: AuthMode[]) =>
  defineDriver({
    name: "@scope/example-driver",
    vendor: "example",
    revision: "1",
    descriptor: descriptor(modes),
    parseStatus: ({ exitCode }) => ({ signedIn: exitCode === 0, method: "account" }),
    start: { probe: async () => ({ path: "/bin/example", version: "1.0.0" }), run: async () => {} },
  });

const root = () => mkdtempSync(join(tmpdir(), "prism-auth-"));

function setup(modes: AuthMode[], extra: { ui?: HostUi; fs?: ProfileFs } = {}) {
  const dir = root();
  const d = driver(modes);
  const profiles = createProfiles({
    root: dir,
    driver: d,
    ...(extra.ui ? { host: { ui: extra.ui } } : {}),
    ...(extra.fs ? { fs: extra.fs } : {}),
  });
  const guard = (options: Partial<Parameters<typeof createPolicyGuard>[0]> = {}) =>
    createPolicyGuard({ vendor: "example", modes, profiles, ...options });
  return { dir, d, profiles, guard };
}

const signIn = (home: string) => writeFileSync(join(home, "signed-in"), "");
const code = (promise: Promise<unknown>, expected: string) =>
  assert.rejects(promise, (e: Error) => e.message.startsWith(`${expected}:`) || e.message.includes(expected));

describe("driver auth policy", () => {
  it("define_driver_validates_modes", () => {
    const bare: AuthMode = { ...account, protected: { paths: [], env: [] } };
    assert.throws(() => driver([bare]), /protected paths or env/);
    assert.throws(() => driver([{ ...account, deployments: ["local", "hosted"] }]), /hostedAcknowledgements/);
    driver([hostedAccount, apiKey]);
  });

  it("account_mode_hosted_not_permitted", async () => {
    const { profiles, guard } = setup([account]);
    await profiles.create("me");
    await code(guard({ deployment: "hosted" }).acquire({ profile: "me" }), "plan_login_not_permitted");
  });

  it("hosted_requires_acknowledgements", async () => {
    const { profiles, guard } = setup([hostedAccount]);
    await profiles.create("me");
    signIn(profiles.homeOf("me"));
    await code(guard({ deployment: "hosted" }).acquire({ profile: "me" }), "terms-v1");
    const lease = await guard({ deployment: "hosted", acknowledgements: ["terms-v1"] }).acquire({ profile: "me" });
    lease.release();
  });

  it("profile_principal_mismatch", async () => {
    const { profiles, guard } = setup([apiKey]);
    await profiles.create("me", { principal: "u1" });
    await code(guard({ principal: "u2" }).acquire({ profile: "me" }), "profile_principal_mismatch");
    await code(guard().acquire({ profile: "me" }), "profile_principal_mismatch");
    (await guard({ principal: "u1" }).acquire({ profile: "me" })).release();
    await code(profiles.bind("me", "u2"), "profile_principal_mismatch");
  });

  it("profile_busy_over_cap", async () => {
    const { profiles, guard } = setup([apiKey]);
    await profiles.create("me", { maxConcurrentRuns: 1 });
    const g = guard();
    const first = await g.acquire({ profile: "me" });
    await code(g.acquire({ profile: "me" }), "profile_busy");
    first.release();
    first.release();
    (await g.acquire({ profile: "me" })).release();
  });

  it("two_agents_share_profile_cap", async () => {
    const { profiles, guard } = setup([apiKey]);
    await profiles.create("me", { maxConcurrentRuns: 1 });
    const first = await guard().acquire({ profile: "me" });
    await assert.rejects(
      guard().acquire({ profile: "me" }),
      (e: Error & { code?: string; profile?: string }) => e.code === "profile_busy" && e.profile === "me",
    );
    first.release();
    (await guard().acquire({ profile: "me" })).release();
  });

  it("auth_required_names_login", async () => {
    const { profiles, guard } = setup([account]);
    await profiles.create("me");
    await assert.rejects(
      guard().acquire({ profile: "me" }),
      (e: Error) => /auth_required/.test(e.message) && e.message.includes(account.login!.join(" ")),
    );
    signIn(profiles.homeOf("me"));
    const lease = await guard().acquire({ profile: "me" });
    assert.equal(lease.record.auth?.signedIn, true);
    lease.release();
  });

  it("protected_env_ref_is_credential_required", async () => {
    const { profiles, guard } = setup([account]);
    await profiles.create("me");
    signIn(profiles.homeOf("me"));
    const g = guard();
    await code(g.acquire({ profile: "me", config: { vendor: { key: "env:VENDOR_TOKEN" } } }), "credential_required");
    await code(g.acquire({ profile: "me", config: { file: join(profiles.homeOf("me"), ".vendor/creds/token") } }), "credential_required");
    (await g.acquire({ profile: "me", config: { key: "env:OTHER_KEY" } })).release();
  });

  it("login_uses_terminal_and_notify_fallback", async () => {
    const seen: HostUiRequest[] = [];
    const terminalUi: HostUi = {
      async request(request: HostUiRequest) {
        seen.push(request);
        if (request.kind === "terminal") signIn(request.env!.VENDOR_HOME!);
        return { status: "answered", value: request.kind === "terminal" ? { exitCode: 0 } : undefined } as never;
      },
    };
    const a = setup([account], { ui: terminalUi });
    const record = await a.profiles.ensure("me");
    assert.equal(record.auth?.signedIn, true);
    assert.equal(seen[0]?.kind, "terminal");

    const notices: HostUiRequest[] = [];
    const none: HostUi = {
      async request(request: HostUiRequest) {
        notices.push(request);
        return { status: "unavailable" } as never;
      },
    };
    const b = setup([account], { ui: none });
    await assert.rejects(b.profiles.ensure("me"), (e: Error) => e.message.includes(account.login!.join(" ")));
    assert.equal(notices.at(-1)?.kind, "notify");
  });

  it("rate_limit_notice_stops_without_retry", async () => {
    const { profiles, guard } = setup([apiKey]);
    await profiles.create("me");
    const g = guard();
    (await g.acquire({ profile: "me" })).release();
    assert.deepEqual(g.noteLimit("me", { code: "quota" }), { action: "stop" });
    assert.deepEqual(g.noteLimit("me", { code: "rate_limit", deferUntil: "2030-01-01T00:00:00Z" }), {
      action: "defer",
      deferUntil: "2030-01-01T00:00:00Z",
    });
    assert.equal(g.inspect()[0]?.activeRuns, 0);
  });

  it("credential_canary_never_opened", async () => {
    const touched: string[] = [];
    const spy =
      (name: keyof ProfileFs) =>
      (...args: unknown[]) => {
        touched.push(String(args[0]));
        // biome-ignore lint/performance/noDynamicNamespaceImportAccess: the spy mirrors every fs method by key, so the access cannot be static.
        return (realFs[name] as (...a: unknown[]) => unknown)(...args);
      };
    const fs = {
      mkdir: spy("mkdir"),
      readFile: spy("readFile"),
      writeFile: spy("writeFile"),
      rm: spy("rm"),
      readdir: spy("readdir"),
    } as unknown as ProfileFs;
    const ui: HostUi = {
      async request(request: HostUiRequest) {
        if (request.kind === "terminal") signIn(request.env!.VENDOR_HOME!);
        return { status: "answered", value: { exitCode: 0 } } as never;
      },
    };
    const { profiles, guard } = setup([account], { ui, fs });
    await profiles.create("me");
    const canary = join(profiles.homeOf("me"), ".vendor/creds");
    mkdirSync(canary, { recursive: true });
    writeFileSync(join(canary, "token"), SECRET);
    process.env.VENDOR_TOKEN = SECRET;
    try {
      await profiles.ensure("me");
      await profiles.status("me");
      (await guard().acquire({ profile: "me" })).release();
    } finally {
      delete process.env.VENDOR_TOKEN;
    }
    assert.ok(touched.length > 0);
    assert.deepEqual(
      touched.filter((path) => path.includes(".vendor")),
      [],
    );
  });

  it("profile_paths_cannot_escape_or_enter_protected", async () => {
    const { profiles } = setup([account]);
    await code(profiles.create("../evil"), "profile_invalid");
    await code(profiles.create("a/b"), "profile_invalid");
  });

  it("inspect_shows_profile_without_secret", async () => {
    const { profiles, guard } = setup([account]);
    await profiles.create("me", { principal: "u1" });
    signIn(profiles.homeOf("me"));
    process.env.VENDOR_TOKEN = SECRET;
    try {
      const g = guard({ principal: "u1", binary: { path: "/bin/example", version: "1.0.0" } });
      const lease = await g.acquire({ profile: "me" });
      const view = g.inspect();
      assert.deepEqual(view[0], {
        profile: "me",
        binary: { path: "/bin/example", version: "1.0.0" },
        authMethod: "account",
        signedIn: true,
        principal: "u1",
        deployment: "local",
        acknowledgements: [],
        maxConcurrentRuns: 2,
        activeRuns: 1,
      });
      assert.ok(!JSON.stringify(view).includes(SECRET));
      lease.release();
    } finally {
      delete process.env.VENDOR_TOKEN;
    }
  });
});
