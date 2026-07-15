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
| `scrypt` | `{ N?, r?, p?, keyLength? }` | Optional KDF tuning. Defaults: `N=32768`, `r=8`, `p=1`, `keyLength=32`. Minimum `N=16384`. |
| `fileMode` | `number` | Unix mode for newly written files. Defaults to `0o600`. |

### System keychain

| Field | Type | Purpose |
| --- | --- | --- |
| `service` | `string` | Keychain service name (application identifier). |
| `namespace` | `string` | Optional prefix separating environments or tenants within one service. |
| `timeoutMs` | `number` | Operation timeout. Defaults to `5000`. |

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

## Extension and configuration notes

- Passphrase retrieval, TLS, and OS permission prompts remain host-owned.
- Use distinct `namespace` or vault paths per tenant/environment.
- Keychain `list()` / `listOAuth()` are intentionally unsupported — enumerate credentials through host configuration instead of scanning the OS store.
- Combine with `createExplicitCredentialResolver()` so runtime overrides still win over stored values.
- Wire `createOAuthCredentialStoreAdapter(store)` into `refreshOAuthCredential()` so refreshed tokens persist durably.

## Security and performance notes

- Authenticated encryption uses Node built-in `aes-256-gcm` and `scrypt`; no extra crypto dependencies for the file backend.
- Atomic writes use temp file + rename; partial writes cannot replace a valid vault.
- Derived keys are zeroed after encrypt/decrypt operations where practical.
- Default scrypt `N=32768` targets interactive CLI unlock; raise `N` for higher security at the cost of unlock latency.
- Keychain operations honor `timeoutMs` and surface `CredentialStoreTimeoutError` instead of blocking indefinitely.
- Never log passphrases, derived keys, or decrypted credential payloads. Error messages do not echo secret values.
- Live keychain tests are opt-in (`PRISM_TEST_KEYCHAIN=1`); default `npm test` stays offline.

## Related APIs

- [Credentials and redaction](credentials-and-redaction.md): core resolver helpers and `refreshOAuthCredential()`
- [Security/auth/trust](settings-auth-trust-security.md): host-owned settings/credentials boundaries
- [Persistence, credentials, and multimodality primitives](persistence-credentials-multimodality-primitives.md): Plan 056 threat model and conformance matrix rows 7–10
- `@arnilo/prism`: `CredentialResolver`, `OAuthCredentialStore`, `createMemoryCredentialStore()`
