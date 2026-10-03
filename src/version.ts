/**
 * The kernel version a package's `requires.prism` range is checked against. Kept in step with
 * `package.json` by a test and by the lockstep bump in `scripts/release.mjs`. The kernel does not
 * read `package.json` at runtime: it imports no `node:fs`.
 */
export const KERNEL_VERSION = "0.12.1";
