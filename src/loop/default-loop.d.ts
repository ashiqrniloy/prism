import type { LoopStrategy } from "./types.js";
/**
 * The kernel default loop (roadmap §2.5): provider turns until the model stops calling tools, then
 * a natural `run.end`. A `turn.before` stop or a tool-round ceiling ends the run without `run.end`.
 */
export declare const defaultLoop: LoopStrategy;
