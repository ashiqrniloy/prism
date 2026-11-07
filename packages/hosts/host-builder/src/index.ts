/**
 * `@arnilo/prism-host-builder`: version-exact reference indexes for building a Prism host.
 *
 * The indexes in `data/` are generated at release time from the same declaration model the compat gate uses
 * (`bun scripts/host-builder-index.mjs`), so they describe exactly the `@arnilo/prism` version this package
 * ships with. They load lazily, on the first call that needs them, and never at import time.
 */

export { HostBuilderError } from "./errors.js";
export {
  type ApiEntry,
  type ApiExport,
  type ApiIndex,
  type ApiPackage,
  type ErrorCodeRecord,
  type ErrorsIndex,
  type ExampleRecord,
  type ExamplesIndex,
  type HostBuilderIndexes,
  type HostBuilderIndexHeader,
  type HostBuilderIndexName,
  type LoadHostBuilderIndexOptions,
  loadHostBuilderIndex,
  readExampleSource,
} from "./indexes.js";
