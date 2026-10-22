/**
 * Barrel for the agent runtime split at 0.1.4 (compat-preserving internal reorg).
 * `createAgent` stays reachable through this barrel; RuntimeAgentSession,
 * EventSubscriber, and the shared helpers live in agent-session.ts; the
 * approval/pending-decision helpers in agent-approval.ts; the tool-dispatch
 * helpers in agent-tool-dispatch.ts; the fingerprint helpers in agent-run-state.ts.
 *
 * Deliberately NOT `export *`: star re-exports would surface the split modules'
 * internal helpers (RuntimeAgentSession, pendingDecisionsOf, …) through
 * agents.d.ts and change the declared surface — the 0.1.4 promise is an
 * identical surface.
 */

export { createAgent } from "./agent-session.js";
