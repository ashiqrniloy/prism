import type { PackageInstance } from "@arnilo/prism";
import { type ContextEngineeringConfig } from "./config.js";
declare const definition: import("@arnilo/prism").PackageDefinition<ContextEngineeringConfig>;
export declare function contextEngineering(config?: ContextEngineeringConfig): PackageInstance;
export default definition;
export * from "./exports.js";
