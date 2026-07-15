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

Encrypted files use AES-256-GCM with scrypt (default `N=32768`, `r=8`, `p=1`) and atomic rename writes. Credential files default to mode `0600` on Unix.

Keychain entries are namespaced by `service`, optional `namespace`, provider, and account id. There is **no silent fallback** to plaintext file storage when the keychain is unavailable.

## Security

- Wrong passphrase or tampered ciphertext fails closed (`CredentialDecryptError`).
- Passphrase-derived keys are zeroed after use.
- Credential payloads are never written to disk in plaintext.
- Configure restrictive `fileMode` and host-owned passphrase retrieval.

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
