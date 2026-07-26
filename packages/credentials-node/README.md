# @arnilo/prism-credentials-node

Optional encrypted-file and system-keychain credential stores for Prism hosts.

## Install

```bash
npm install @arnilo/prism-credentials-node @arnilo/prism
```

## Usage

```ts
import { createExplicitCredentialResolver, refreshOAuthCredential } from "@arnilo/prism";
import {
  createEncryptedCredentialStore,
  createKeychainCredentialStore,
  createOAuthCredentialStoreAdapter,
  createStoredCredentialResolver,
  openEncryptedCredentialStore,
} from "@arnilo/prism-credentials-node";

const fileStore = await openEncryptedCredentialStore({
  path: "./credentials.vault",
  getPassphrase: () => process.env.PRISM_CREDENTIAL_PASSPHRASE!,
  limits: { maxFileBytes: 4 * 1024 * 1024, maxVaultBytes: 3 * 1024 * 1024 },
});

const keychainStore = createKeychainCredentialStore({
  service: "my-app",
  namespace: "production",
});

const resolver = createExplicitCredentialResolver([
  { name: "file", resolver: createStoredCredentialResolver(fileStore) },
]);

const oauthStore = createOAuthCredentialStoreAdapter(fileStore);
await refreshOAuthCredential({
  provider,
  credentials,
  store: oauthStore,
});
```

## Backends

| Backend | When to use |
| --- | --- |
| Encrypted file | CLI tools, local desktop hosts, CI fixtures |
| System keychain | Desktop hosts with OS secret-service integration |

Encrypted files use AES-256-GCM with asynchronous scrypt (default `N=32768`, `r=8`, `p=1`) and bounded atomic rename writes. Envelopes/vaults default to 4 MiB/3 MiB limits (hard 16 MiB/12 MiB). Existing and new Unix files must deny group/other access; default mode is `0600`.

Keychain entries are namespaced by `service`, optional `namespace`, provider, and account id. Abort-aware native async operations default to a 5-second timeout (60-second hard cap), and payloads default to 3 MiB (12 MiB hard). There is **no silent fallback** to plaintext file storage when the keychain is unavailable.

## Workload OAuth providers (0.0.14)

`createMicrosoft365OAuthProvider()` / `createGoogleWorkspaceOAuthProvider()` wrap a shared `createOAuth2Provider()` (PKCE auth-code + device-code + refresh + revoke) over the core `OAuthProvider` seam. Least-privilege scope bundles per capability (`resolveMicrosoft365Scopes` / `resolveGoogleWorkspaceScopes`, read vs mutation; unknown capability fails closed). `createOAuthWorkTokenProvider()` bridges stored credentials to a per-identity connector env var (late-bound single-flight refresh; missing/expired/revoked/cross-identity/wrong-tenant fail closed). Revocation: `revokeOAuthCredential()` does best-effort upstream revoke (GWS RFC 7009; M365 has no public endpoint) then mandatory local store delete. Tokens never go in argv or model context.

## Security

- Wrong passphrase, malformed/tampered envelope, excessive KDF work, oversized payload, or permissive Unix mode fails before unsafe work.
- Passphrase-derived keys and package-owned plaintext buffers are zeroed after use.
- Credential payloads are never written to disk in plaintext.
- `encryptBytes()` / `decryptBytes()` are asynchronous in 0.0.6.

## Tests

```bash
npm run build
npm test
PRISM_TEST_KEYCHAIN=1 npm test
```

Default tests are offline. Live keychain integration is opt-in via `PRISM_TEST_KEYCHAIN=1`.

## Related

- [`docs/credential-storage.md`](../../docs/credential-storage.md)
- [`docs/credentials-and-redaction.md`](../../docs/credentials-and-redaction.md)
