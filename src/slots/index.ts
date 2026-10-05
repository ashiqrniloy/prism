export { createEnvRefCredentialResolver } from "../credentials/index.js";
export { createSlotDefaults } from "./defaults.js";
export { createSlotRegistry, SLOT_NAMES } from "./registry.js";
export {
  SlotConflictError,
  UnknownSlotError,
  UnknownSlotOwnerError,
  type Compactor,
  type SlotAssignments,
  type SlotContracts,
  type SlotName,
  type SlotProvider,
  type SlotRegistry,
} from "./types.js";
