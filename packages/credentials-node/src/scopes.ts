/** Least-privilege scope bundle for one workload capability: read vs mutation. */
export interface WorkloadScopeBundle {
  readonly read: readonly string[];
  readonly mutation: readonly string[];
}

export type WorkloadScopeAccess = "read" | "mutation";

/**
 * Resolves least-privilege scopes for a set of capabilities. Read access yields only read
 * scopes; mutation adds the mutation scopes on top. Unknown capabilities fail closed so a
 * bundle can never silently broaden consent.
 */
export function resolveWorkloadScopes(
  map: Readonly<Record<string, WorkloadScopeBundle>>,
  base: readonly string[],
  capabilities: readonly string[],
  access: WorkloadScopeAccess,
): string[] {
  const scopes = new Set<string>(base);
  for (const capability of capabilities) {
    const bundle = map[capability];
    if (!bundle) throw new Error(`Unknown workload capability: ${capability}`);
    for (const scope of bundle.read) scopes.add(scope);
    if (access === "mutation") for (const scope of bundle.mutation) scopes.add(scope);
  }
  return [...scopes];
}
