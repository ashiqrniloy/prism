# Credentials and redaction

## What it does

Prism provides small helpers for host-owned credentials and known-secret redaction:

- `resolveCredentialValue()`: resolves a credential from a direct string, callback, or `CredentialResolver`.
- `createExplicitCredentialResolver()`: tries named resolver sources in caller-provided order, such as runtime override → stored → env object → fallback.
- `createEnvCredentialResolver()`: reads only a caller-supplied env-like object and map.
- `refreshOAuthCredential()`: calls a provider OAuth refresh function and writes the result to a caller-owned store when supplied.
- `CredentialValueSource`: the accepted source type for `resolveCredentialValue()`.
- `redactSecrets()`: replaces known secret string values inside strings, arrays, and plain objects.
- `errorToErrorInfo()`: converts unknown errors into `ErrorInfo` and redacts known secret values from error text.

These helpers do not persist credentials, scan environment variables, execute commands, or load settings.

## When to use it

Use these helpers inside provider adapters or host integration code that needs to resolve a credential at request time and prevent known secret values from appearing in emitted errors or logs.

Do not use them as a credential manager, general secret scanner, vault, settings loader, or permission system.

## Inputs / request

```ts
resolveCredentialValue(
  source: CredentialValueSource | undefined,
  request: CredentialRequest,
): Promise<string | undefined>
```

`CredentialValueSource` can be:

| Source | Behavior |
| --- | --- |
| `string` | Returned directly. |
| `() => string | undefined | Promise<string | undefined>` | Called when a credential is needed. |
| `CredentialResolver` | `resolve(request)` is called and `.value` is returned. |

```ts
createExplicitCredentialResolver(sources: readonly CredentialResolverSource[]): CredentialResolver
createEnvCredentialResolver(env: Readonly<Record<string, string | undefined>>, map: Readonly<Record<string, string>>): CredentialResolver
refreshOAuthCredential(options: { provider: OAuthProvider; credentials: OAuthCredentials; store?: OAuthCredentialStore }): Promise<OAuthCredentials>
redactSecrets<T>(value: T, secrets: readonly (string | undefined)[]): T
errorToErrorInfo(error: unknown, secrets?: readonly (string | undefined)[]): ErrorInfo
```

`secrets` must be the exact values to redact. Undefined and empty values are ignored.

## Outputs / response / events

- `resolveCredentialValue()` returns a credential string or `undefined`.
- `redactSecrets()` returns the same value shape with known string secrets replaced by `[REDACTED]`.
- `errorToErrorInfo()` returns `{ name?, message, code?, cause? }` with known secret values removed from message/cause text.

## Request/response example

```json
{
  "request": { "name": "apiKey", "provider": "demo" },
  "resolved": "<host-owned credential value>",
  "redactedError": { "message": "bad key [REDACTED]" }
}
```

## Implementation example

```ts
import {
  createEnvCredentialResolver,
  createExplicitCredentialResolver,
  errorToErrorInfo,
  redactSecrets,
  resolveCredentialValue,
} from "prism";

const runtime = { resolve: () => undefined };
const stored = { resolve: () => undefined };
const env = createEnvCredentialResolver({ DEMO_API_KEY: "fake-demo-key" }, { demo: "DEMO_API_KEY" });
const resolver = createExplicitCredentialResolver([
  { name: "runtime", resolver: runtime },
  { name: "stored", resolver: stored },
  { name: "env", resolver: env },
]);

const apiKey = await resolveCredentialValue(resolver, { name: "apiKey", provider: "demo" });

const message = redactSecrets(`request failed for ${apiKey}`, [apiKey]);
const error = errorToErrorInfo(new Error(`bad credential ${apiKey}`), [apiKey]);

console.log(message);
console.log(error.message);
```

## Extension and configuration notes

- Hosts and extension packages can implement `CredentialResolver` and pass it explicitly to code that needs credentials.
- Use `createExplicitCredentialResolver()` when documenting a fixed order such as runtime override, stored credential, caller-provided env object, then fallback resolver.
- Use `createEnvCredentialResolver()` only with an object supplied by the host; Prism does not read `process.env` for you.
- Provider adapters should resolve credentials as late as possible, per request.
- Keep resolved credential values local to the request path. Do not put them in registries, model configs, messages, provider events, agent events, session entries, compaction summaries, or logs.
- Future settings/config loaders may provide credential resolver instances, but core helpers remain storage-free.

## Security and performance notes

- Redaction only removes exact known secret values passed to the helper. It is not a general-purpose secret detector.
- Do not pass empty strings as secrets; they are ignored.
- `redactSecrets()` recursively walks arrays and object entries, so avoid using it on huge objects unless needed.
- Use placeholders in tests and docs. Never commit real tokens.
- `resolveCredentialValue()` and `createExplicitCredentialResolver()` do not cache values. Add host-side caching only if a real credential source needs it.
- `refreshOAuthCredential()` only calls the supplied OAuth provider and optional store; it has no built-in persistence or retry loop.

## Related APIs

- [Public contracts](public-contracts.md): `CredentialRequest`, `Credential`, `CredentialResolver`, `CredentialResolverSource`, `OAuthLoginCallbacks`, `OAuthCredentials`, `OAuthProvider`, and `ErrorInfo`.
- [Provider layer](provider-layer.md): `providerError()` uses `errorToErrorInfo()` for redacted provider error events.
- [OpenAI-compatible provider](providers/openai-compatible.md): resolves API keys per request and redacts known values from adapter errors.

Phase 10 added `createMemoryCredentialStore()`, `createChainedCredentialResolver()`, and `createSecretRedactor()` for opt-in in-memory auth and runtime redaction. Phase 11 adds OAuth/API-key contracts plus explicit resolver order helpers. Core still has no persistent secret store and does not read environment variables or files for credentials. See [Security/auth/trust](settings-auth-trust-security.md).
