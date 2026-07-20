# Credential storage

## What it does

The optional `@arnilo/prism-credentials-node` package ships host-owned credential persistence for Node.js CLI and desktop apps:

- **Encrypted file store** — AES-256-GCM envelope with scrypt KDF, atomic rename writes, versioned on-disk format
- **System keychain store** — cross-platform secret service via `@napi-rs/keyring@^1.3.0`
- **Stored credential resolver** — `createStoredCredentialResolver(store)` for explicit resolver chains
- **OAuth adapter** — extends the core `OAuthCredentialStore` seam with `get`/`delete` for refresh flows

Factories:

- `openEncryptedCredentialStore(options)` / `createEncryptedCredentialStore(options)`
- `createKeychainCredentialStore(options)`
- `createStoredCredentialResolver(store)`
- `createOAuthCredentialStoreAdapter(store)`
- `rotateEncryptedCredentialStorePassphrase(options)`

Core `@arnilo/prism` remains storage-free. Hosts choose a backend explicitly at startup; there is no global credential singleton and no silent fallback from keychain to plaintext file storage.

## When to use it

Use this package when a host needs durable credentials beyond `createMemoryCredentialStore()`:

- local CLI tools storing API keys or OAuth tokens between runs
- desktop hosts integrating with macOS Keychain, Windows Credential Manager, or Linux Secret Service
- integration tests that need encrypted reopen semantics without a live keychain

Do **not** use it when credentials should live in a remote vault, HSM, or cloud secret manager — implement `CredentialResolver` against that service instead.

## Inputs / request

```ts
import {
  openEncryptedCredentialStore,
  createKeychainCredentialStore,
} from "@arnilo/prism-credentials-node";
```

### Encrypted file

| Field | Type | Purpose |
| --- | --- | --- |
| `path` | `string` | Vault file path. Parent directories are created as needed. |
| `getPassphrase` | `() => string \| Promise<string>` | Host-owned passphrase retrieval. Never logged by the adapter. |
| `scrypt` | `{ N?, r?, p?, keyLength? }` | Optional KDF tuning. Defaults: `N=32768`, `r=8`, `p=1`, `keyLength=32`; limits are listed below. |
| `fileMode` | `number` | Unix mode for files. Defaults to `0o600`; group/other permissions are rejected. |
| `limits.maxFileBytes` | `number` | Encrypted envelope file: 4 MiB default, 16 MiB hard cap. |
| `limits.maxVaultBytes` | `number` | Decrypted vault/plaintext: 3 MiB default, 12 MiB hard cap. |
| `limits.maxScryptMemoryBytes` | `number` | `128*N*r` memory estimate: 256 MiB default and hard cap. |

### System keychain

| Field | Type | Purpose |
| --- | --- | --- |
| `service` | `string` | Keychain service name (application identifier). |
| `namespace` | `string` | Optional prefix separating environments or tenants within one service. |
| `timeoutMs` | `number` | Operation timeout. Defaults to 5,000 ms; hard cap 60,000 ms. |
| `maxPayloadBytes` | `number` | Decrypted keychain payload: 3 MiB default, 12 MiB hard cap. |

## Outputs / response / events

Both backends implement `StoredCredentialStore`:

| Method | Behavior |
| --- | --- |
| `set(record)` / `get(request)` / `delete(request)` | Namespaced by `(provider, name)` for API keys and bearer tokens. |
| `setOAuth(provider, credentials, accountId?)` | Stores OAuth tokens per provider/account. |
| `getOAuth(provider, accountId?)` / `deleteOAuth(...)` | Reads or removes OAuth rows. |
| `resolve(request)` | `CredentialResolver` compatibility via `createStoredCredentialResolver`. |

Encrypted file stores also expose:

- `reload()` — re-read and decrypt from disk
- `flush()` — force rewrite of the encrypted envelope

`encryptBytes()` and `decryptBytes()` are Promise-based because they use asynchronous `node:crypto.scrypt`.

Errors are explicit and fail closed:

| Error | Code | When |
| --- | --- | --- |
| `CredentialDecryptError` | `credential_decrypt_failed` | Wrong passphrase or tampered ciphertext |
| `CredentialStoreLockedError` | `credential_store_locked` | Keychain denied or locked |
| `CredentialStoreUnavailableError` | `credential_store_unavailable` | No OS secret service |
| `CredentialStoreTimeoutError` | `credential_store_timeout` | Keychain call exceeded `timeoutMs` |
| `WeakKdfParametersError` | `weak_kdf_parameters` | scrypt work factor below minimum |

## Request/response example

```json
{
  "path": "./credentials.vault",
  "fileMode": 384,
  "keychain": {
    "service": "my-app",
    "namespace": "production",
    "timeoutMs": 5000
  }
}
```

On-disk envelope (illustrative — ciphertext is base64, secrets are not plaintext):

```json
{
  "version": 1,
  "kdf": { "algorithm": "scrypt", "N": 32768, "r": 8, "p": 1, "salt": "...", "keyLength": 32 },
  "cipher": { "algorithm": "aes-256-gcm", "iv": "..." },
  "ciphertext": "..."
}
```

## Implementation example

```ts
import {
  createExplicitCredentialResolver,
  refreshOAuthCredential,
  resolveCredentialValue,
} from "@arnilo/prism";
import {
  createOAuthCredentialStoreAdapter,
  createStoredCredentialResolver,
  openEncryptedCredentialStore,
} from "@arnilo/prism-credentials-node";

const store = await openEncryptedCredentialStore({
  path: "./credentials.vault",
  getPassphrase: () => process.env.MY_APP_CREDENTIAL_PASSPHRASE!,
  limits: { maxFileBytes: 4 * 1024 * 1024, maxVaultBytes: 3 * 1024 * 1024 },
});

const resolver = createExplicitCredentialResolver([
  { name: "stored", resolver: createStoredCredentialResolver(store) },
]);

const apiKey = await resolveCredentialValue(resolver, { name: "apiKey", provider: "demo" });

const oauthStore = createOAuthCredentialStoreAdapter(store);
await refreshOAuthCredential({
  provider: myOAuthProvider,
  credentials: existing,
  store: oauthStore,
});
```

Passphrase rotation:

```ts
import { rotateEncryptedCredentialStorePassphrase } from "@arnilo/prism-credentials-node";

await rotateEncryptedCredentialStorePassphrase({
  path: "./credentials.vault",
  getCurrentPassphrase: () => oldPassphrase,
  getNewPassphrase: () => newPassphrase,
});
```

### Desktop keychain and explicit overrides

```ts
import {
  createEnvCredentialResolver,
  createExplicitCredentialResolver,
  createMemoryCredentialStore,
} from "@arnilo/prism";
import {
  createKeychainCredentialStore,
  createStoredCredentialResolver,
} from "@arnilo/prism-credentials-node";
import { createOpenAIProviderPackage } from "@arnilo/prism-provider-openai";

const keychain = createKeychainCredentialStore({
  service: "com.example.my-app",
  namespace: "production",
});
await keychain.set({
  name: "apiKey",
  provider: "openai",
  credential: { type: "api_key", value: userSuppliedKey },
});

const runtimeOverrides = createMemoryCredentialStore();
// Set only for this user/agent instance; it wins over stored and env values.
runtimeOverrides.set({
  name: "apiKey",
  provider: "openai",
  credential: { type: "api_key", value: temporaryOverride },
});

const apiKey = createExplicitCredentialResolver([
  { name: "runtime", resolver: runtimeOverrides },
  { name: "keychain", resolver: createStoredCredentialResolver(keychain) },
  { name: "env", resolver: createEnvCredentialResolver(process.env, { openai: "OPENAI_API_KEY" }) },
]);

const providers = createOpenAIProviderPackage({ apiKey });
```

## Extension and configuration notes

- Passphrase retrieval, TLS, and OS permission prompts remain host-owned.
- Use distinct `namespace` or vault paths per tenant/environment.
- Keychain `list()` / `listOAuth()` are intentionally unsupported — enumerate credentials through host configuration instead of scanning the OS store.
- Combine with `createExplicitCredentialResolver()` so runtime overrides still win over stored values.
- Wire `createOAuthCredentialStoreAdapter(store)` into `refreshOAuthCredential()` so refreshed tokens persist durably.

## Security and performance notes

- Authenticated encryption uses Node built-in `aes-256-gcm` and asynchronous `scrypt`; no extra crypto dependency is added for the file backend.
- Envelope parsing rejects unknown shape, non-canonical/oversized base64, wrong salt/IV/tag size, unsupported algorithms/version, and excessive KDF work before scrypt. `N` must be a power of two from 16,384–262,144; `r≤32`, `p≤16`, `keyLength=32`, `N*r*p≤2,097,152`, and `128*N*r` must fit `maxScryptMemoryBytes`.
- Existing Unix vaults are checked before content read and must deny group/other access. Atomic writes create a random exclusive temp file at the requested restrictive mode, then rename; Windows skips Unix mode checks.
- Derived keys and package-owned plaintext buffers are zeroed after use. JavaScript passphrase strings and returned credentials remain host-owned.
- Keychain operations use `@napi-rs/keyring`'s abort-aware `AsyncEntry`, so native work runs outside the JavaScript event loop. A main-loop timer aborts and rejects at `timeoutMs`; native cancellation remains OS/backend-dependent and may briefly retain one libuv worker after rejection.
- Keychain payloads are bytes rather than password strings and are zeroed after parse/write. Unknown native errors are mapped to sanitized typed errors; no native message or secret value is echoed.
- Never log passphrases, derived keys, or decrypted credential payloads.
- Live keychain tests are opt-in (`PRISM_TEST_KEYCHAIN=1`); default `npm test` stays offline.

## MCP authentication boundary

MCP credentials remain host inputs: resolve them before constructing client `requestInit` or inside server `resolveAuthInfo`. Stateful server `resolveIdentity` receives validated SDK auth metadata only to derive a stable non-secret principal ID. Never copy access/refresh tokens into MCP resource/prompt/sampling/elicitation payloads, telemetry, errors, or session bindings; Prism does not refresh or persist MCP OAuth automatically.

## Web adapter credential boundary

`@arnilo/prism-web-tools` accepts explicit callbacks or `CredentialResolver`. Brave resolves `subscription_token`; Exa and Firecrawl resolve `api_key` immediately before each fixed-origin request. Keys never enter tool arguments/results, URLs, provider metadata, errors, telemetry, or prompts. Use separate least-privilege credentials and do not forward MCP/provider tokens between adapters.

## Related APIs

- [Credentials and redaction](credentials-and-redaction.md): core resolver helpers and `refreshOAuthCredential()`
- [Web search, fetch, and extraction](web-tools.md): late-bound Brave/Exa/Firecrawl credentials
- [Security/auth/trust](settings-auth-trust-security.md): host-owned settings/credentials boundaries
- [Persistence, credentials, and multimodality primitives](persistence-credentials-multimodality-primitives.md): Plan 056 threat model and conformance matrix rows 7–10
- `@arnilo/prism`: `CredentialResolver`, `OAuthCredentialStore`, `createMemoryCredentialStore()`
