import type { Pool } from "pg";
import type { ModelRouterStateStore } from "../../../governance/model-router/index.js";
import { qualifyTable } from "../identifiers.js";
import { addUsage, consumeRate, readBudget } from "./capacity.js";
import { claimCircuitProbe, recordCircuitOutcome } from "./circuit.js";
import { cleanup } from "./expiry.js";
import { commitBudget, releaseBudget, reserveBudget } from "./reservations.js";
import type { RouterTables } from "./util.js";

/** Durable PostgreSQL implementation of the model-router atomic state contract. */
export function createPostgresModelRouterStateStore(pool: Pool, schema: string): ModelRouterStateStore {
  const tables: RouterTables = {
    rates: qualifyTable(schema, "prism_model_router_rates"),
    budgets: qualifyTable(schema, "prism_model_router_budgets"),
    circuits: qualifyTable(schema, "prism_model_router_circuits"),
  };

  return {
    consumeRate: (input) => consumeRate(pool, tables.rates, input),
    readBudget: (input) => readBudget(pool, tables.budgets, input),
    addUsage: (input) => addUsage(pool, tables.budgets, input),
    reserveBudget: (input) => reserveBudget(pool, tables.budgets, input),
    commitBudget: (input) => commitBudget(pool, tables.budgets, input),
    releaseBudget: (input) => releaseBudget(pool, tables.budgets, input),
    claimCircuitProbe: (input) => claimCircuitProbe(pool, tables.circuits, input),
    recordCircuitOutcome: (input) => recordCircuitOutcome(pool, tables.circuits, input),
    cleanup: (input) => cleanup(pool, tables, input),
  };
}
