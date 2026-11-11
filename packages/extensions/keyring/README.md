# `@arnilo/prism-extensions/keyring`

Credentials slot package for [Prism](https://github.com/ashiqrniloy/prism). Claims the `credentials`
slot with the OS keyring or an encrypted file, resolves `keyring:` refs, stores host-captured
secrets and OAuth tokens, and delegates `env:` refs to the kernel default.

## Install

```sh
bun add @arnilo/prism-extensions
```

## Use

```ts
import keyring from "@arnilo/prism-extensions/keyring";
import hyper from "@arnilo/prism-ai/hyper";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model: "hyper/hyper",
  packages: [
    keyring({ backend: "os", service: "prism" }),
    hyper({ apiKey: "keyring:hyper" }),
  ],
});
```

Without the package, the kernel's default resolver only reads `env:` refs and has no `store`, so a
`secret` host request answers `unavailable`. With it, `keyring:` refs read and write the backend and
the `secret` request persists.

## Config

| key | type | default | meaning |
| --- | --- | --- | --- |
| `backend` | `"os"` \| `"file"` | `"os"` | `os` uses the platform keyring (Secret Service, Keychain, Credential Manager). `file` uses the scrypt/AES-256-GCM vault at `file.path`. |
| `service` | string | `"prism"` | OS keyring service name. |
| `file.path` | string | — | Encrypted vault path, required for `backend: "file"`. Created owner-only (`0600`, parent `0700`) on first write. |
| `file.keyRef` | `env:`/`keyring:` ref | — | Ref holding the vault passphrase, required for `backend: "file"`. A literal passphrase is rejected (`secret_literal`). The ref must resolve to a stable value. |

Set config through the code instance (`keyring({ backend: "file", file: { path, keyRef } })`) or
through `AgentConfig.packageConfig` (which wins). The factory-only `probe` option is a test seam and
cannot come from a manifest.

## Behaviour

- **Claim, never throw.** Setup always calls `prism.slots.credentials.provide(...)`. When the OS
  keyring is unavailable (no Secret Service, CI) or the encrypted file cannot be opened, it records
  `status.note("warn", …)` and still claims the slot, so `agent.models` keeps working and a
  credential problem never turns into an unknown slot.
- **Fail closed, never a plaintext fallback.** With no backend, `keyring:<name>` reads answer
  `undefined` (the asking package then fails with `credential_unavailable`), and `store`/`delete`
  throw `KeyringUnavailableError` (`code: "keyring_unavailable"`). Nothing silently writes a
  plaintext file.
- **Cost.** The OS backend makes one native read per `resolve`; there is no cache. The file backend
  decrypts the vault once at setup and serves reads from memory, so a writer that changes the file
  afterwards is seen on the next agent load.
- **Two claimants fail closed.** Two packages providing `credentials` fail the load with
  `SlotConflictError` until `AgentConfig.slots.credentials` names an owner.
- **Secrets never surface.** A value the kernel stores joins the agent's redaction set, so it is
  masked in events, `inspect()`, status notes, and errors. `inspect()` shows only the backend kind and
  the service name.
- **The native addon is lazy.** `@napi-rs/keyring` is imported only when the OS backend is used, so
  an agent without this package (or with `backend: "file"`) never loads it.

## Named exports

The backends stay public for hosts that manage a store themselves: `createKeychainCredentialStore`,
`probeKeychainAvailability`, `createFileCredentialStore`, `openEncryptedCredentialStore`,
`createEncryptedCredentialStore`, `rotateEncryptedCredentialStorePassphrase`, the KMS envelope
helpers, the credential-store errors (`CredentialStoreError`, `CredentialDecryptError`,
`CredentialStoreUnavailableError`, `KeyringUnavailableError`, …), the OAuth row adapters
(`createOAuthCredentialStoreAdapter`, `createOAuthCredentialSink`, `createStoredCredentialResolver`),
and `createKeyringCredentialResolver` — the slot implementation this package claims, which a host can
build over a store it opened itself to run an OAuth login outside a run.

## License

MIT

## Optional peer

The OS backend requires the optional peer `@napi-rs/keyring` (`bun add @napi-rs/keyring`). The encrypted-file backend needs no native peer.
