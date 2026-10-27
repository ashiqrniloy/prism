import type { HookBus, HookBusOptions } from "./types.js";
/**
 * Kernel-internal hook bus. Registrations go through `registrar(owner)`: the owner is a property of
 * the registrar the kernel hands out, never of a registration option, so a package cannot claim
 * another owner's name (plan 146 Task 3).
 */
export declare function createHookBus(options?: HookBusOptions): HookBus;
