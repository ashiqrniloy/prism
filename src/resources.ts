import { parsePrismManifest, type PrismManifest } from "./manifests.js";
import type { JsonObject, ResourceLoader, ResourceLoadContext } from "./contracts.js";
import { assertJsonObject } from "./config.js";
import { assertPermission } from "./security.js";

export async function loadTextResource(
  loader: ResourceLoader,
  uri: string,
  context?: ResourceLoadContext,
): Promise<string> {
  await assertPermission(context?.permission, { kind: "resource", action: "load", target: uri, metadata: context?.metadata });
  const resource = await loader.load(uri, context);
  if (resource.text !== undefined) return resource.text;
  if (resource.data !== undefined) return new TextDecoder().decode(resource.data);
  throw new Error(`Resource ${uri} has no text or data`);
}

export async function loadJsonResource(
  loader: ResourceLoader,
  uri: string,
  context?: ResourceLoadContext,
): Promise<JsonObject> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await loadTextResource(loader, uri, context));
  } catch (error) {
    throw new Error(`Invalid JSON resource ${uri}: ${errorMessage(error)}`);
  }
  assertJsonObject(parsed, `resource ${uri}`);
  return parsed;
}

export async function loadManifestResource(
  loader: ResourceLoader,
  uri: string,
  context?: ResourceLoadContext,
): Promise<PrismManifest> {
  return parsePrismManifest(await loadJsonResource(loader, uri, context));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
