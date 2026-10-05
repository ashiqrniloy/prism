import type { CredentialRequest, Secret } from "../contracts.js";

/**
 * A source `resolveCredentialValue` reads a raw key from. Legacy vendor/memory code passes a literal,
 * a callback, or a name-keyed resolver; Part B replaces these call sites with `env:`/`keyring:` refs
 * resolved through the credentials slot.
 */
export type CredentialValueSource =
  | string
  | (() => string | undefined | Promise<string | undefined>)
  | { resolve(request: CredentialRequest): Secret | undefined | Promise<Secret | undefined> };

/** A stored secret with the name/provider keys legacy stores address it by. */
export interface CredentialRecord {
  readonly name: string;
  readonly provider?: string;
  readonly credential: Secret;
}

/**
 * Resolves a raw key value from a legacy `CredentialValueSource`. Not the credentials slot; the slot is
 * `CredentialResolver.resolve(ref, ctx)`. Deleted in Part B when the vendors move to refs.
 */
export async function resolveCredentialValue(
  source: CredentialValueSource | undefined,
  request: CredentialRequest,
): Promise<string | undefined> {
  if (!source) return undefined;
  if (typeof source === "string") return source;
  if (typeof source === "function") return source();
  return (await source.resolve(request))?.value;
}
