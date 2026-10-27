import type { JsonObject } from "@arnilo/prism";
import type { WorkingMemoryStore } from "@arnilo/prism-memory-core";
export interface MemoryWorkingStoreOptions {
    readonly maxWorkingMemoryBytes?: number;
}
export declare function createMemoryWorkingStore(options?: MemoryWorkingStoreOptions): WorkingMemoryStore;
export declare function validateWorkingValue(value: JsonObject, options: {
    readonly schema?: JsonObject;
    readonly validateWorkingMemory?: (value: JsonObject) => undefined | string | Error | Promise<undefined | string | Error>;
    readonly validateAgainstJsonSchema: (value: unknown, schema: JsonObject) => void;
}): Promise<void>;
