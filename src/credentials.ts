import type { CredentialResolver, CredentialRequest } from "./contracts.js";

export type CredentialValueSource =
  | string
  | (() => string | undefined | Promise<string | undefined>)
  | CredentialResolver;

export async function resolveCredentialValue(
  source: CredentialValueSource | undefined,
  request: CredentialRequest,
): Promise<string | undefined> {
  if (!source) return undefined;
  if (typeof source === "string") return source;
  if (typeof source === "function") return source();
  return (await source.resolve(request))?.value;
}
