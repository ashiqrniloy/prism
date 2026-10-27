import type { SlotAssignments } from "../slots/index.js";
import type { PackageDefinition, PackageDefinitionInput, PackageInput, PackageInstance, PackageSource } from "./api.js";
/**
 * Defines a package (roadmap §2.6). The result is callable: `coding({ root })` returns a
 * {@link PackageInstance}, and listing the bare definition uses the schema defaults. The definition is
 * validated eagerly, so a malformed one throws `PackageLoadError` `definition_invalid` here.
 */
export declare function definePackage<C = Readonly<Record<string, never>>>(input: PackageDefinitionInput<C>): PackageDefinition<C>;
/**
 * Binds a definition to manifest config and provenance. Only `@arnilo/prism/manifest` calls it; the public
 * `PackageInstanceOptions` has no `source`, so a package cannot claim to come from a manifest.
 */
export declare function bindManifestInstance(definition: PackageDefinition<any>, config: Readonly<Record<string, unknown>> | undefined, options: {
    readonly optional: boolean;
    readonly source: PackageSource;
}): PackageInstance;
/** `AgentConfig.slots` merged over the slots the listed manifest instances assign to their packages. */
export declare function mergeManifestSlots(inputs: readonly PackageInput[], direct: SlotAssignments | undefined): SlotAssignments | undefined;
/** A `packages` entry as the loader sees it. */
export interface NormalizedPackage {
    readonly definition: PackageDefinition<any>;
    readonly config: Readonly<Record<string, unknown>> | undefined;
    readonly optional: boolean;
    readonly source?: PackageSource;
}
/** Accepts a definition (defaults) or an instance, and rejects anything `definePackage` did not make. */
export declare function normalizePackageInput(input: PackageInput): NormalizedPackage;
