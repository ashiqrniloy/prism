/** The catalog fields the host's model object needs to match the shipped product (see prism-driver.ts). */
const FIELDS = ["limits", "compat", "cache", "capabilities"] as const;

type Model = { model: string } & Record<string, unknown>;

/**
 * Copies `limits`, `compat`, `cache` and `capabilities` from the provider's static catalog into each host config
 * model that lacks them. `compat.route` picks Command Code's wire per model and `cache` makes Messages place its
 * `cache_control` markers; without them a cell would measure a Prism configured differently from the real one.
 */
export function withCatalogFields(hostConfig: { models: Record<string, Model> }, catalog: readonly Model[]): void {
  for (const ref of Object.values(hostConfig.models)) {
    const known = catalog.find((item) => item.model === ref.model);
    if (known === undefined) continue;
    for (const field of FIELDS) {
      if (known[field] !== undefined && ref[field] === undefined) ref[field] = known[field];
    }
  }
}
