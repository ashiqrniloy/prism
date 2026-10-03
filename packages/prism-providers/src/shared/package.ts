import { definePackage, type AIProvider, type PackageInstance } from "@arnilo/prism";

/** Build a vendor package. Credentials stay factory options, never config. */
export function vendorPackage(name: string, description: string, create: () => readonly AIProvider[]): PackageInstance {
  return definePackage({
    name,
    version: "0.12.1",
    requires: { prism: "^0.12.1 || ^0.13.0-0" },
    description,
    setup(prism) {
      for (const provider of create()) prism.providers.register(provider);
    },
  })();
}
