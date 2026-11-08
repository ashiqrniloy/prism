# Credentials and redaction

## What it does

Prism resolves credentials from refs, never from literals, and redacts the values it resolves:

- The **credentials slot** (`AgentConfig.slots.credentials`, a `CredentialResolver`) resolves `env:` and `keyring:` refs. The kernel default is `createEnvRefCredentialResolver()`, which answers `env:NAME` refs from `process.env` (or an env-like object you pass); `@arnilo/prism-credentials-keyring` answers `keyring:` refs.
- Packages resolve through `PackageAPI.credentials.resolve(ref)`. Every secret-bearing package config field is an `x-prism-secret` property, so a literal fails with `literal_secret` at load time.
- `SecretSource` (`@arnilo/prism/provider-kit`): `() => Promise<string | undefined>`, the only credential shape a low-level provider factory, discovery helper, or kit client accepts. `refSource(resolve, ref)` and `optionalRefSource(resolve, ref)` build one from a ref; a literal string does not type-check.
- `redactSecrets()`: replaces known secret string values inside strings, arrays, and plain objects.
- `errorToErrorInfo()`: converts unknown errors into `ErrorInfo` and redacts known secret values from error text.

Every value the slot returns joins the agent's secret set and is redacted from everything the agent raises from then on.

## When to use it

Use refs in package config and the manifest, a `SecretSource` when you call a low-level provider factory yourself, and `redactSecrets()` / `errorToErrorInfo()` in host integration code that handles a credential directly.

Do not use these helpers as a general secret scanner, vault, settings loader, or permission system.

## Inputs / request

```ts
interface CredentialResolver {
  resolve(ref: string, ctx: CredentialContext): Promise<Secret | undefined> | Secret | undefined;
  store?(ref: string, secret: Secret, ctx: CredentialContext): Promise<void> | void;
  delete?(ref: string, ctx: CredentialContext): Promise<void> | void;
}
createEnvRefCredentialResolver(env?: Readonly<Record<string, string | undefined>>): CredentialResolver

type SecretSource = () => Promise<string | undefined>; // @arnilo/prism/provider-kit
refSource(resolve: (ref: string) => Promise<Secret | undefined>, ref: string): () => Promise<string>
optionalRefSource(resolve: (ref: string) => Promise<Secret | undefined>, ref: string): () => Promise<string | undefined>

redactSecrets<T>(value: T, secrets: readonly (string | undefined)[]): T
errorToErrorInfo(error: unknown, secrets?: readonly (string | undefined)[]): ErrorInfo
```

`secrets` must be the exact values to redact. Undefined and empty values are ignored.

## Outputs / response / events

- `CredentialResolver.resolve()` returns a `Secret` (`{ type, value, metadata? }`) or `undefined` for a ref it does not know.
- `refSource()` throws `CredentialUnavailableError` (`credential_unavailable`) when the ref resolves to nothing; `optionalRefSource()` returns `undefined`.
- `redactSecrets()` returns the same value shape with known string secrets replaced by `[REDACTED]`.
- `errorToErrorInfo()` returns `{ name?, message, code?, cause? }` with known secret values removed from message/cause text.

## Request/response example

```json
{
  "ref": "env:DEMO_API_KEY",
  "resolved": { "type": "api_key", "value": "<host-owned credential value>" },
  "redactedError": { "message": "bad key [REDACTED]" }
}
```

## Implementation example

```ts
import { createEnvRefCredentialResolver, errorToErrorInfo, redactSecrets } from "@arnilo/prism";
import { refSource, type SecretSource } from "@arnilo/prism/provider-kit";

const credentials = createEnvRefCredentialResolver({ DEMO_API_KEY: "fake-demo-key" });
const apiKey: SecretSource = refSource(async (ref) => credentials.resolve(ref, {}), "env:DEMO_API_KEY");

const key = await apiKey();
const message = redactSecrets(`request failed for ${key}`, [key]);
const error = errorToErrorInfo(new Error(`bad credential ${key}`), [key]);

console.log(message);
console.log(error.message);
```

## Extension and configuration notes

- Assign `AgentConfig.slots.credentials` to replace the default resolver, or install `@arnilo/prism-credentials-keyring`, which provides the slot.
- `createAgent()` / `session.run()` never resolve credentials eagerly. Packages resolve at the provider edge, per request, through `PackageAPI.credentials.resolve(ref)`.
- Package config holds refs only: build secret properties with `secretRefProperty()` from `@arnilo/prism/provider-kit`. `refSource()` bridges the ref to the low-level factory's `SecretSource`.
- Keep resolved credential values local to the request path. Do not put them in registries, model configs, messages, provider events, agent events, session entries, compaction summaries, or logs.
- 0.12's `resolveCredentialValue()` and `CredentialValueSource` (which accepted a literal string) are gone; see [Migrating to 0.13](migrate-to-0.13.md).

### Subscription OAuth eligibility

A package that refreshes tokens at request time persists the rotated record through
`PackageAPI.credentials.store`/`delete`, gated by the `credentials:write` capability. The kernel refuses
`env:` refs (`CredentialRefNotWritableError`, `credential_ref_unsupported`) and a slot with no write support
(`CredentialStoreUnavailableError`, `credential_store_unavailable`), and adds every written value to the
agent's secret set. See [Packages](packages.md).

First-party subscription OAuth is explicit and host-invoked: OpenAI Codex (`createOpenAICodexOAuthProvider()`) and xAI SuperGrok / X Premium (`createXaiOAuthProvider()`). Hosts own login UI and may use `createOAuthCredentialStoreAdapter()` for deliberately selected durable storage. Do not import `~/.grok` or grok-cli auth files.

Anthropic and Google provider packages are API-key-only. Do not scrape or import Claude Code/Gemini CLI credential files, setup tokens, environment values, or browser sessions, and do not route a user's Claude.ai/Gemini subscription through Prism. Anthropic states that developers building products must use Claude Console API keys or a supported cloud provider and may not offer Claude.ai login or route Free/Pro/Max credentials ([legal and compliance](https://docs.anthropic.com/en/docs/claude-code/legal-and-compliance)). Gemini CLI states that third-party software using its OAuth to access backend services violates applicable terms; its FAQ names Vertex AI or Google AI Studio API keys as the supported third-party path ([terms](https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/tos-privacy.md), [FAQ](https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/faq.md)).

A future provider-local OAuth adapter needs published permission for third-party products, documented authorize/token/refresh endpoints and scopes, PKCE/state where required, abort/expiry/bounded-response/redaction/store-round-trip fixtures, and legal review before registration. Until then, absence is intentional.

## Security and performance notes

- Redaction only removes exact known secret values passed to the helper. It is not a general-purpose secret detector.
- Do not pass empty strings as secrets; they are ignored.
- `redactSecrets()` recursively walks arrays and object entries, so avoid using it on huge objects unless needed.
- Cycle and non-JSON value handling: `redactSecrets()` is cycle-safe via an active-path `WeakSet`. Ancestor cycles render `"[Circular]"` at the back-reference instead of throwing; shared diamond references on separate branches stay structured (they are not collapsed to `"[Circular]"`). String object keys and `Map` keys are redacted like values, with deterministic `__2`/`__3`/… suffixes on collisions. `Date` and `RegExp` values are passed through unchanged; `ArrayBuffer` and typed arrays are passed through unchanged; `Map` is normalized to a plain object and `Set` to an array so the output stays JSON-compatible. `errorToErrorInfo()` tolerates a cyclic `error.cause` (rendered via `String()`). Symbols and non-enumerable properties remain outside JSON-shaped redaction.
- Use placeholders in tests and docs. Never commit real tokens.
- Live provider/worker tests are gated behind explicit environment variables and skipped by default: `PRISM_LIVE_PROVIDER_TESTS`, `PRISM_LIVE_COMPACTION_TESTS`, `PRISM_LIVE_OBSERVATIONAL_MEMORY_TESTS`. Default `npm test` is network-free; do not add ungated network calls to default tests.
- Credentials are not eagerly resolved by the core runtime, serialized into provider requests/events/stores, or passed to loops/compaction.
- `refSource()` and the kernel's resolvers do not cache values; a rotated secret is read on the next request. Add caching inside a custom `CredentialResolver` only if a real credential source needs it.


## Related APIs

- [Packages](packages.md): `CredentialResolver`, `CredentialContext`, `Secret`, `OAuthCredentials`, `PackageAPI.credentials`, and `ErrorInfo`.
- [Provider layer](provider-kit.md): `providerError()` uses `errorToErrorInfo()` for redacted provider error events.
- [LLM compaction package](../packages/memory/compaction/README.md): resolves optional summary-provider credentials per compaction call and redacts exact known values.
- OpenAI-compatible provider: resolves API keys per request and redacts known values from adapter errors.

`createSecretRedactor()` builds a runtime redactor over known values. Core has no persistent secret store and reads environment variables only through the `env:` resolver the credentials slot defaults to. For durable storage, use [`@arnilo/prism-credentials-keyring`](../packages/credentials/keyring/README.md) encrypted-file or keychain backends. See [Security/auth/trust](settings-auth-trust-security.md).
