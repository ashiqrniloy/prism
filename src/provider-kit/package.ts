import { definePackage } from "../packages/define.js";
import type { PackageInstance } from "../packages/index.js";
import type { ModelProvider } from "../contracts.js";
import { KERNEL_API_LEVEL, KERNEL_VERSION } from "../version.js";

/**
 * A package that registers `providers` in order and nothing else. Credentials stay factory options or
 * `ModelSpec.credential` refs, never package config.
 */
export function providerPackage(
  name: string,
  providers: readonly ModelProvider[],
  description = `${name} model providers`,
): PackageInstance {
  return definePackage({
    name,
    version: KERNEL_VERSION,
    requires: { api: KERNEL_API_LEVEL },
    description,
    setup(prism) {
      for (const provider of providers) prism.providers.register(provider);
    },
  })();
}
