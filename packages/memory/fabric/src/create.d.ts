import { type CreateMemoryFabricOptions, type MemoryFabric } from "./types.js";
/**
 * Opt-in notes over the host's existing stores: `fact`/`procedure`/`file` are tagged vector
 * records, `working` is a labeled block in the working-memory value, and `episode` is a view
 * over an observational-memory id (nothing is written for it).
 *
 * Creating a fabric starts nothing: no workers, no timers, no tools.
 */
export declare function createMemoryFabric(options: CreateMemoryFabricOptions): MemoryFabric;
