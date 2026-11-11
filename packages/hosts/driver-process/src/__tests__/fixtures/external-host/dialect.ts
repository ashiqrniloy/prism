import { jsonlStreamDialect } from "@arnilo/prism/testing";

/**
 * The host's own wire dialect. A real host maps its vendor's frames here; this one renames the neutral JSONL
 * stream so the example stays vendor-free. `adapterConformance` serializes these functions into its binary.
 */
export const dialect = { ...jsonlStreamDialect, name: "external-host-jsonl" };
