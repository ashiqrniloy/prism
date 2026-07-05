export type DuplicateRegistrationPolicy = "replace" | "error";

export interface DuplicateRegistrationOptions {
  readonly duplicate?: DuplicateRegistrationPolicy;
}

export function assertCanRegister<K>(
  map: ReadonlyMap<K, unknown>,
  key: K,
  label: string,
  displayKey = String(key),
  duplicate: DuplicateRegistrationPolicy = "replace",
): void {
  if (duplicate === "error" && map.has(key)) throw new Error(`Duplicate ${label}: ${displayKey}`);
}
