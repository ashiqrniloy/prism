import { assertJsonObject, isJsonObject } from "./config.js";
import type { JsonObject } from "./contracts.js";

export type ManifestContributionKind =
  | "provider"
  | "model"
  | "tool"
  | "contextProvider"
  | "skill"
  | "command"
  | "agent"
  | "inputBuilder"
  | "promptBuilder"
  | "compactionStrategy"
  | "retryPolicy"
  | "storeFactory"
  | "resourceLoader"
  | "settingsProvider"
  | "credentialResolver"
  | "providerPackage"
  | "authMethod"
  | "providerRequestPolicy"
  | "systemPromptContribution";

export interface ManifestContributionDeclaration {
  readonly kind: ManifestContributionKind;
  readonly name: string;
  readonly module?: string;
  readonly exportName?: string;
  readonly configKey?: string;
  readonly resource?: string;
  readonly metadata?: JsonObject;
}

export interface ManifestResourceDeclaration {
  readonly uri: string;
  readonly mediaType?: string;
  readonly purpose?: "manifest" | "prompt" | "skill" | "package" | string;
  readonly metadata?: JsonObject;
}

export interface PrismManifest {
  readonly name: string;
  readonly version?: string;
  readonly description?: string;
  readonly configDefaults?: JsonObject;
  readonly contributions?: readonly ManifestContributionDeclaration[];
  readonly resources?: readonly ManifestResourceDeclaration[];
  readonly metadata?: JsonObject;
}

export function definePrismManifest(manifest: PrismManifest): PrismManifest {
  return parsePrismManifest(manifest);
}

export function parsePrismManifest(value: unknown): PrismManifest {
  if (!isRecord(value)) throw new Error("manifest must be an object");
  const manifest = value;
  const name = readRequiredString(manifest, "name");
  const parsed: PrismManifest = {
    name,
    ...readOptionalString(manifest, "version"),
    ...readOptionalString(manifest, "description"),
    ...readOptionalJsonObject(manifest, "configDefaults"),
    contributions: readContributions(manifest.contributions),
    resources: readResources(manifest.resources),
    ...readOptionalJsonObject(manifest, "metadata"),
  };
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readContributions(value: unknown): readonly ManifestContributionDeclaration[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("manifest.contributions must be an array");
  return value.map((item, index) => {
    assertJsonObject(item, `manifest.contributions[${index}]`);
    const contribution = item as Record<string, unknown>;
    return {
      kind: readKind(contribution.kind, index),
      name: readRequiredString(contribution, "name", `manifest.contributions[${index}].name`),
      ...readOptionalString(contribution, "module", `manifest.contributions[${index}].module`),
      ...readOptionalString(contribution, "exportName", `manifest.contributions[${index}].exportName`),
      ...readOptionalString(contribution, "configKey", `manifest.contributions[${index}].configKey`),
      ...readOptionalString(contribution, "resource", `manifest.contributions[${index}].resource`),
      ...readOptionalJsonObject(contribution, "metadata", `manifest.contributions[${index}].metadata`),
    };
  });
}

function readResources(value: unknown): readonly ManifestResourceDeclaration[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("manifest.resources must be an array");
  return value.map((item, index) => {
    assertJsonObject(item, `manifest.resources[${index}]`);
    const resource = item as Record<string, unknown>;
    return {
      uri: readRequiredString(resource, "uri", `manifest.resources[${index}].uri`),
      ...readOptionalString(resource, "mediaType", `manifest.resources[${index}].mediaType`),
      ...readOptionalString(resource, "purpose", `manifest.resources[${index}].purpose`),
      ...readOptionalJsonObject(resource, "metadata", `manifest.resources[${index}].metadata`),
    };
  });
}

function readKind(value: unknown, index: number): ManifestContributionKind {
  const kinds = new Set<ManifestContributionKind>([
    "provider",
    "model",
    "tool",
    "contextProvider",
    "skill",
    "command",
    "agent",
    "inputBuilder",
    "promptBuilder",
    "compactionStrategy",
    "retryPolicy",
    "storeFactory",
    "resourceLoader",
    "settingsProvider",
    "credentialResolver",
    "providerPackage",
    "authMethod",
    "providerRequestPolicy",
    "systemPromptContribution",
  ]);
  if (typeof value !== "string" || !kinds.has(value as ManifestContributionKind)) {
    throw new Error(`manifest.contributions[${index}].kind must be a known contribution kind`);
  }
  return value as ManifestContributionKind;
}

function readRequiredString(record: Record<string, unknown>, key: string, label = `manifest.${key}`): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function readOptionalString(record: Record<string, unknown>, key: string, label = `manifest.${key}`): Record<string, string> {
  const value = record[key];
  if (value === undefined) return {};
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return { [key]: value };
}

function readOptionalJsonObject(record: Record<string, unknown>, key: string, label = `manifest.${key}`): Record<string, JsonObject> {
  const value = record[key];
  if (value === undefined) return {};
  if (!isJsonObject(value)) throw new Error(`${label} must be a JSON object`);
  return { [key]: value };
}
