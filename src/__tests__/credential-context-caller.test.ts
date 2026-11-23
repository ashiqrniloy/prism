import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { createAgentWith } from "../agent-session/create-agent.js";
import {
  createAgent,
  type CredentialContext,
  type CredentialResolver,
  definePackage,
  type ModelProvider,
  type PackageDefinitionInput,
  type Principal,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
} from "../index.js";
import { optionalRefSource, refSource } from "../provider-kit/index.js";
import { resolveProviderApiKey } from "../provider-kit/routed-provider.js";

type Loose = PackageDefinitionInput<any>;
const pkg = (name: string, setup: Loose["setup"], extra: Partial<Loose> = {}) =>
  definePackage<any>({ name, version: "1.0.0", requires: { api: 2 }, setup, ...extra });

const OWNER: Principal = { kind: "user", id: "u-1" };
const sse = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
const OK = `data: ${JSON.stringify({ choices: [{ delta: { content: "hi" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;

/** A slot that answers every ref and records the context of each call. */
function recording(): { readonly resolver: CredentialResolver; readonly seen: CredentialContext[] } {
  const seen: CredentialContext[] = [];
  return {
    seen,
    resolver: {
      resolve: (_ref, ctx) => {
        seen.push(ctx);
        return { type: "api_key", value: "key" };
      },
      store: (_ref, _secret, ctx) => void seen.push(ctx),
      delete: (_ref, ctx) => void seen.push(ctx),
    },
  };
}

describe("credential context: the call's session and principal", () => {
  it("builtin_provider_run_turn_carries_session_and_principal", async () => {
    const { resolver, seen } = recording();
    const agent = await createAgentWith(
      {
        model: { provider: "openai-compatible", model: "m", baseUrl: "http://one.test/v1", credential: "env:KEY" },
        slots: { credentials: resolver },
        principal: OWNER,
      },
      { fetch: (async () => sse(OK)) as never },
    );
    const session = await agent.session();
    assert.equal((await session.run("a")).status, "completed");
    const other: Principal = { kind: "service", id: "svc" };
    await session.run("b", { principal: other });
    assert.deepEqual(seen, [
      { sessionId: session.id, principal: OWNER },
      { sessionId: session.id, principal: other },
    ]);
  });

  it("package_provider_passing_its_request_or_a_copy_gets_the_caller_and_a_plain_object_does_not", async () => {
    const { resolver, seen } = recording();
    const provider: ModelProvider = {
      id: "acme",
      async *generate(request) {
        await creds.resolve("env:A", request);
        await creds.resolve("env:B", { ...request });
        await creds.resolve("env:C", { ...request, options: { sessionId: "forged" } } as ProviderRequest);
        await creds.resolve("env:D", { model: request.model, messages: [], options: { sessionId: "forged" } } as ProviderRequest);
        await creds.resolve("env:E");
        yield providerTextDelta("ok");
        yield providerDone();
      },
    };
    let creds: { resolve(ref: string, request?: ProviderRequest): Promise<unknown> } = undefined as never;
    const agent = await createAgent({
      model: { provider: "acme", model: "m" },
      slots: { credentials: resolver },
      principal: OWNER,
      packages: [
        pkg(
          "@acme/provider",
          ({ providers, credentials }: any) => {
            creds = credentials;
            providers.register(provider);
          },
          { capabilities: ["credentials"] },
        ),
      ],
    });
    const session = await agent.session();
    assert.equal((await session.run("hi")).status, "completed");
    assert.deepEqual(seen, [
      { package: "@acme/provider", sessionId: session.id, principal: OWNER },
      // A provider's spread copy keeps the kernel's token; a session id it writes into `options` is not read.
      { package: "@acme/provider", sessionId: session.id, principal: OWNER },
      { package: "@acme/provider", sessionId: session.id, principal: OWNER },
      // An object the package built has no token, whatever it says.
      { package: "@acme/provider" },
      { package: "@acme/provider" },
    ]);
  });

  it("store_and_delete_keep_the_package_only", async () => {
    const { resolver, seen } = recording();
    await createAgent({
      model: { provider: "openai-compatible", model: "m", baseUrl: "http://one.test/v1" },
      slots: { credentials: resolver },
      principal: OWNER,
      packages: [
        pkg(
          "@acme/writer",
          async ({ credentials }: any) => {
            await credentials.store("keyring:x", { type: "api_key", value: "v" });
            await credentials.delete("keyring:x");
          },
          { capabilities: ["credentials", "credentials:write"] },
        ),
      ],
    });
    assert.deepEqual(seen, [{ package: "@acme/writer" }, { package: "@acme/writer" }]);
  });

  it("ref_sources_pass_the_request_only_through_the_routed_key_resolution", async () => {
    const requests: (ProviderRequest | undefined)[] = [];
    const resolve = async (_ref: string, request?: ProviderRequest) => {
      requests.push(request);
      return { type: "api_key" as const, value: "k" };
    };
    const request = { model: { provider: "p", model: "m" }, messages: [] } as ProviderRequest;
    assert.equal(await resolveProviderApiKey(refSource(resolve, "env:K"), undefined, request), "k");
    assert.equal(await resolveProviderApiKey(optionalRefSource(resolve, "env:K"), undefined, request), "k");
    // Called as a plain `SecretSource` (discovery, a kit client), it has no request to pass.
    assert.equal(await refSource(resolve, "env:K")(), "k");
    // A hand-written source is called with no argument, as before.
    assert.equal(await resolveProviderApiKey(async (...args: unknown[]) => String(args.length), undefined, request), "0");
    assert.deepEqual(requests, [request, request, undefined]);
  });
});
