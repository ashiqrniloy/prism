export { importDefinition, toPackageDefinition } from "./definition.js";
export { type ManifestConfigErrorCode, ManifestError, type ManifestErrorCode, type ManifestErrorOptions } from "./errors.js";
export {
  isInstalledEntry,
  type ManifestEntry,
  type ManifestInstall,
  type ManifestOverride,
  type ManifestRecord,
  type ManifestScope,
  type ParseManifestOptions,
  type PrismManifestV1,
  parseManifest,
} from "./format.js";
export { type InstallLocation, type InstallOptions, install, remove } from "./install.js";
export { hashPackageTree, installedPackageDir, verifyInstalled } from "./integrity.js";
export { type LoadManifestOptions, loadManifest, type ManifestTrustRequest } from "./load.js";
export {
  assignSlot,
  configure,
  type ListedManifest,
  type ListedPackage,
  list,
  type MaintainLocation,
  type MaintainOptions,
  setEnabled,
  type VerifyIssue,
  type VerifyOptions,
  type VerifyResult,
  verify,
} from "./maintain.js";
export { type MergedManifest, type MergeSources, mergeManifestScopes, type ResolvedManifestEntry } from "./merge.js";
export { MANIFEST_V1_SCHEMA, manifestSchemaDocument } from "./schema.js";
export { readManifest, resolveUserHome, type ScopeDirs, type ScopeLocation, scopeDirs, writeManifest } from "./store.js";
