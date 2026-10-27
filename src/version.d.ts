/**
 * The kernel version a package's `requires.prism` range is checked against. Kept in step with
 * `package.json` by a test and by the lockstep bump in `scripts/release.mjs`. The kernel does not
 * read `package.json` at runtime: it imports no `node:fs`.
 */
export declare const KERNEL_VERSION = "0.13.0";
/**
 * The kernel API level a package's `requires.api` is checked against. Bumped only for a breaking
 * change to a contract packages implement or call; additive changes keep the level (docs/compatibility.md).
 */
export declare const KERNEL_API_LEVEL = 1;
/** API levels this kernel can load. More than one only during a transition. */
export declare const SUPPORTED_API_LEVELS: readonly number[];
