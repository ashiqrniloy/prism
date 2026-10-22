import { createFault } from "./fixture-agent.js";
export const create = (options: Parameters<typeof createFault>[0]) => createFault(options, "origin");
