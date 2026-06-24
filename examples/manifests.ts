import { definePrismManifest, parsePrismManifest } from "@arnilo/prism";

// Data-only Prism manifest: declares contributions without executing code.
// The host later resolves declarations through registries and makes explicit
// trust decisions before activating anything.
export function demo() {
  const manifest = definePrismManifest({
    name: "demo-provider-manifest",
    contributions: [
      { kind: "providerPackage", name: "demo-provider" },
      { kind: "authMethod", name: "demo.api-key", metadata: { credentialName: "apiKey" } },
      { kind: "providerRequestPolicy", name: "demo.cache" },
      { kind: "systemPromptContribution", name: "demo.prompt" },
    ],
  });

  // parsePrismManifest validates an arbitrary value; throws on bad shape.
  const reparsed = parsePrismManifest(JSON.parse(JSON.stringify(manifest)));

  return { name: reparsed.name, contributions: reparsed.contributions?.length ?? 0 };
}
