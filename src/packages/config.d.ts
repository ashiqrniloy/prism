import type { JsonObject } from "../contracts.js";
import { type JsonSchema } from "./schema.js";
/** What config resolution needs from a package definition. */
export interface PackageConfigDefinition {
    readonly name: string;
    readonly config?: JsonSchema;
}
/** The config layers for one package, lowest precedence first (defaults come from the schema). */
export interface PackageConfigLayers {
    /** The manifest layer: the config of an instance `loadManifest` built. */
    readonly manifest?: unknown;
    /** The config a code instance carries (`coding({ root })`). */
    readonly code?: unknown;
    /** `AgentConfig.packageConfig[name]`. */
    readonly host?: unknown;
    /** Per-key scope provenance for manifest keys ("user" | "project"). */
    readonly manifestScopes?: Readonly<Record<string, "user" | "project">>;
    /** Default scope for manifest keys if not in manifestScopes (defaults to "project"). */
    readonly manifestScope?: "user" | "project";
}
export type PackageConfigSource = "default" | "user" | "project" | "code" | "host";
export interface ResolvedPackageConfig {
    /** The merged, validated config with defaults applied. */
    readonly config: JsonObject;
    /** Where each top-level key's value came from. Key names and sources only, never values. */
    readonly sources: Readonly<Record<string, PackageConfigSource>>;
}
/** Deep-merges objects and replaces arrays and scalars, returning a fresh value. */
export declare function merge(base: JsonObject, over: JsonObject): JsonObject;
/**
 * Resolves one package's config: schema defaults, then the manifest layer, then `packageConfig`,
 * deep-merging objects and replacing arrays, then validates the result. Fails closed with a
 * `PackageLoadError` whose message names the path and rule, never the value.
 *
 * A package with no `config` schema accepts no config: any supplied key is `config_unknown_key`.
 */
export declare function resolvePackageConfig(definition: PackageConfigDefinition, layers?: PackageConfigLayers): ResolvedPackageConfig;
