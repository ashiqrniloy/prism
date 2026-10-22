import type { FlushableRunLedger, RunLedger } from "./contracts.js";

export function isFlushableRunLedger(ledger: RunLedger): ledger is FlushableRunLedger {
  return "flush" in ledger && typeof ledger.flush === "function";
}
