/**
 * Deterministic JSON Schema clone for tool/function parameters.
 * Sorts object keys and unordered `required` names. Leaves semantic arrays
 * (`prefixItems`, `examples`, `enum`, tuple `items`) in caller order.
 * Does not resolve `$ref`, mutate input, or enforce schema bounds.
 */
export declare function canonicalizeJsonSchema(value: unknown): unknown;
