import { createAgent, type PackageInstance } from "@arnilo/prism";

/** Load a vendor package the way a host does. Setup must not fetch. */
export async function loadProviderPackage(instance: PackageInstance): Promise<void> {
  const agent = await createAgent({
    model: { provider: "probe", model: "probe" },
    packages: [instance],
  });
  await agent.dispose();
}
