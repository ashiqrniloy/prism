/**
 * `@arnilo/prism-extensions/keyring` — the `credentials` slot backed by the OS keyring or an
 * encrypted file.
 *
 * ```ts
 * import keyring from "@arnilo/prism-extensions/keyring";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model: "anthropic/claude-sonnet-4-5",
 *   packages: [keyring({ backend: "os", service: "prism" })],
 * });
 * ```
 *
 * The package claims the slot with `prism.slots.credentials.provide`. `keyring:<name>` refs read the
 * backend; every other ref (`env:NAME`, …) delegates to `prism.slots.credentials.default`, so the
 * kernel's `env:` resolver keeps working. `store`/`delete` write the backend, which is what the
 * kernel's `secret` host request and a provider's OAuth login persist through.
 *
 * Fail closed: when the OS keyring is unavailable, or the encrypted file cannot be opened, setup
 * records a `warn` status note, still claims the slot, and every `keyring:` read answers `undefined`
 * while `store`/`delete` throw `KeyringUnavailableError`. There is never a plaintext fallback.
 *
 * Cost: one backend read per `resolve` for the OS backend (no cache); the file backend decrypts once
 * at setup and serves reads from memory.
 */

import {
  type CredentialContext,
  type CredentialResolver,
  createEnvRefCredentialResolver,
  definePackage,
  type JsonSchema,
  type PackageInstance,
  type Secret,
} from "@arnilo/prism";
import manifest from "../../package.json" with { type: "json" };

import { openEncryptedCredentialStore, type StoredCredentialStore } from "./encrypted-store.js";
import { CredentialStoreError, KeyringUnavailableError } from "./errors.js";
import {
  createKeychainCredentialStore,
  type KeychainProbeOptions,
  type KeychainProbeResult,
  probeKeychainAvailability,
} from "./keychain-store.js";

export type { EncryptedCredentialStore, StoredCredentialStore } from "./encrypted-store.js";
export {
  createEncryptedCredentialStore,
  openEncryptedCredentialStore,
  rotateEncryptedCredentialStorePassphrase,
} from "./encrypted-store.js";
export { assertScryptParameters, decryptBytes, encryptBytes, resolveScryptParameters } from "./envelope.js";
export {
  CredentialDecryptError,
  CredentialStoreError,
  CredentialStoreLockedError,
  CredentialStoreTimeoutError,
  CredentialStoreUnavailableError,
  isCredentialDecryptError,
  isCredentialStoreError,
  isCredentialStoreUnavailableError,
  KeyringUnavailableError,
  WeakKdfParametersError,
} from "./errors.js";
export type { FileCredentialStore, FileCredentialStoreLimits, FileCredentialStoreOptions } from "./file-store.js";
export { createFileCredentialStore } from "./file-store.js";
export type { KeychainCredentialStore, KeychainProbeOptions, KeychainProbeResult } from "./keychain-store.js";
export {
  createKeychainCredentialStore,
  KEYCHAIN_PROBE_ACCOUNT,
  probeKeychainAvailability,
  runKeychainOperation,
} from "./keychain-store.js";
export type { HostKms, HostKmsCryptoOptions, KmsEnvelope } from "./kms.js";
export { createMemoryHostKms, decryptWithHostKms, encryptWithHostKms, KMS_ENVELOPE_VERSION, kmsBuffersEqual } from "./kms.js";
export {
  DEFAULT_MAX_ENVELOPE_FILE_BYTES,
  DEFAULT_MAX_KEYCHAIN_PAYLOAD_BYTES,
  DEFAULT_MAX_SCRYPT_MEMORY_BYTES,
  DEFAULT_MAX_VAULT_BYTES,
  HARD_KEYCHAIN_TIMEOUT_MS,
  HARD_MAX_ENVELOPE_FILE_BYTES,
  HARD_MAX_KEYCHAIN_PAYLOAD_BYTES,
  HARD_MAX_SCRYPT_MEMORY_BYTES,
  HARD_MAX_VAULT_BYTES,
} from "./limits.js";
export type { ExtendedOAuthCredentialStore } from "./resolver.js";
export { createOAuthCredentialSink, createOAuthCredentialStoreAdapter, createStoredCredentialResolver } from "./resolver.js";
export type {
  EncryptedCredentialStoreLimits,
  EncryptedCredentialStoreOptions,
  EncryptedEnvelope,
  KeychainCredentialStoreOptions,
  RotateEncryptedCredentialStoreOptions,
  ScryptParameters,
} from "./types.js";
export {
  DEFAULT_FILE_MODE,
  DEFAULT_KEYCHAIN_TIMEOUT_MS,
  DEFAULT_SCRYPT_KEY_LENGTH,
  DEFAULT_SCRYPT_N,
  DEFAULT_SCRYPT_P,
  DEFAULT_SCRYPT_R,
  ENVELOPE_VERSION,
  MIN_SCRYPT_N,
  VAULT_VERSION,
} from "./types.js";

/** The ref prefix this package owns; everything else delegates to the kernel default. */
export const KEYRING_REF_PREFIX = "keyring:";
/** The default OS keyring service name. */
export const KEYRING_DEFAULT_SERVICE = "prism";

/** What a host (or a code instance) may set. Every credential field is a ref, never a value. */
export interface KeyringConfig {
  /** `os` uses the platform keyring; `file` uses the scrypt/AES-GCM vault at `file.path`. */
  readonly backend?: "os" | "file";
  /** OS keyring service name; defaults to {@link KEYRING_DEFAULT_SERVICE}. */
  readonly service?: string;
  /** The `file` backend's vault path and passphrase ref. Both are required when `backend` is `file`. */
  readonly file?: {
    readonly path?: string;
    readonly keyRef?: string;
  };
}

export interface KeyringPackageOptions {
  /** Test seam: the OS-keyring availability probe. Defaults to {@link probeKeychainAvailability}. */
  readonly probe?: (options: KeychainProbeOptions) => Promise<KeychainProbeResult>;
}

const configSchema: JsonSchema = {
  type: "object",
  properties: {
    backend: {
      type: "string",
      enum: ["os", "file"],
      default: "os",
      description: "`os` uses the platform keyring; `file` uses the scrypt/AES-GCM vault at `file.path`.",
    },
    service: {
      type: "string",
      default: KEYRING_DEFAULT_SERVICE,
      description: "OS keyring service name.",
    },
    file: {
      type: "object",
      properties: {
        path: { type: "string", description: "Encrypted vault path. Created owner-only on first write." },
        keyRef: {
          type: "string",
          "x-prism-secret": true,
          description: "An `env:` ref holding the vault passphrase. A literal passphrase is rejected.",
        },
      },
      additionalProperties: false,
      description: "The `file` backend's vault path and passphrase ref; both are checked in setup.",
    },
  },
  additionalProperties: false,
};

const refName = (ref: string): string => ref.slice(KEYRING_REF_PREFIX.length);

function requireKeyringRef(ref: string): string {
  if (!ref.startsWith(KEYRING_REF_PREFIX) || ref.length === KEYRING_REF_PREFIX.length) {
    throw new CredentialStoreError(
      "credential_ref_unsupported",
      `credentials-keyring can only write "keyring:<name>" refs, not "${ref.slice(0, 64)}".`,
    );
  }
  return refName(ref);
}

export interface KeyringResolverOptions {
  /** The backend. Absent means "no backend": reads answer `undefined`, writes throw. */
  readonly store?: StoredCredentialStore;
  /** Delegates every non-`keyring:` ref; defaults to the kernel `env:` resolver. */
  readonly delegate?: CredentialResolver;
}

/**
 * The credentials-slot implementation this package claims: `keyring:<name>` refs read/write the
 * backend, every other ref delegates. A host that runs an OAuth login outside a run can build the
 * same resolver over a store it opened itself and pass it as the `AuthContext` credentials handle.
 */
export function createKeyringCredentialResolver(options: KeyringResolverOptions = {}): CredentialResolver {
  const store = options.store;
  const delegate = options.delegate ?? createEnvRefCredentialResolver();
  return {
    resolve(ref: string, ctx: CredentialContext) {
      if (!ref.startsWith(KEYRING_REF_PREFIX)) return delegate.resolve(ref, ctx);
      const name = refName(ref);
      if (name.length === 0) return undefined;
      return store ? store.get({ name }) : undefined;
    },
    async store(ref: string, secret: Secret): Promise<void> {
      const name = requireKeyringRef(ref);
      if (!store) throw new KeyringUnavailableError("credentials-keyring: no backend is available to store a secret");
      await store.set({ name, credential: secret });
    },
    async delete(ref: string): Promise<void> {
      const name = requireKeyringRef(ref);
      if (!store) throw new KeyringUnavailableError("credentials-keyring: no backend is available to delete a secret");
      await store.delete({ name });
    },
  };
}

interface BackendContext {
  readonly probe?: (options: KeychainProbeOptions) => Promise<KeychainProbeResult>;
  readonly delegate: CredentialResolver;
  readonly owner: string;
  readonly note: (message: string) => void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function openOsBackend(service: string, ctx: BackendContext): Promise<StoredCredentialStore | undefined> {
  const probe = ctx.probe ?? probeKeychainAvailability;
  try {
    const result = await probe({ service });
    if (result.status === "available") return createKeychainCredentialStore({ service });
    ctx.note(`credentials-keyring: OS keyring service "${service}" is unavailable (${result.message}); keyring: refs answer undefined`);
  } catch (error) {
    ctx.note(`credentials-keyring: OS keyring probe for "${service}" failed (${messageOf(error)}); keyring: refs answer undefined`);
  }
  return undefined;
}

async function openFileBackend(file: KeyringConfig["file"], ctx: BackendContext): Promise<StoredCredentialStore | undefined> {
  if (!file?.path || !file.keyRef) {
    ctx.note('credentials-keyring: backend "file" needs file.path and file.keyRef; keyring: refs answer undefined');
    return undefined;
  }
  const keyRef = file.keyRef;
  try {
    return await openEncryptedCredentialStore({
      path: file.path,
      getPassphrase: async () => {
        const secret = await ctx.delegate.resolve(keyRef, { package: ctx.owner });
        if (secret === undefined || secret.value === "") {
          throw new CredentialStoreError("credential_passphrase_missing", `credentials-keyring: no passphrase at ${keyRef}`);
        }
        return secret.value;
      },
    });
  } catch (error) {
    ctx.note(`credentials-keyring: encrypted file backend unavailable (${messageOf(error)}); keyring: refs answer undefined`);
    return undefined;
  }
}

function definitionFor(options: KeyringPackageOptions) {
  return definePackage<KeyringConfig>({
    name: "@arnilo/prism-extensions/keyring",
    version: manifest.version,
    description: "OS keyring and encrypted-file backends for the Prism credentials slot.",
    requires: { api: 1 },
    capabilities: ["slot:credentials"],
    config: configSchema,
    setup: async (prism) => {
      const delegate = prism.slots.credentials.default;
      const ctx: BackendContext = {
        ...(options.probe !== undefined ? { probe: options.probe } : {}),
        delegate,
        owner: prism.name,
        note: (message) => prism.status.note("warn", message),
      };
      const store =
        prism.config.backend === "file"
          ? await openFileBackend(prism.config.file, ctx)
          : await openOsBackend(prism.config.service ?? KEYRING_DEFAULT_SERVICE, ctx);
      // Claim the slot even without a backend: `agent.models` keeps the catalog and the asking
      // package fails closed on a `keyring:` read instead of seeing an unknown slot.
      prism.slots.credentials.provide(createKeyringCredentialResolver({ ...(store ? { store } : {}), delegate }));
    },
  });
}

const definition = definitionFor({});

/** Default package. Pass config through `packageConfig` or `keyring({ ... })`. */
export default definition;

/** Instance with factory-only options; `backend`/`service`/`file` are validated config. */
export function keyring(options: KeyringPackageOptions & KeyringConfig = {}): PackageInstance {
  const { probe, ...config } = options;
  const target = probe === undefined ? definition : definitionFor({ probe });
  return target(config);
}
