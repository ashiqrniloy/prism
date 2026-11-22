/**
 * Plan 218.3 Task 9: Session-Bench's three template families. A family is vocabulary plus a mix of jobs and the host
 * of its tool-fact dependencies; the session builder (`./build.mjs`) does the rest. Every word list is written for the
 * benchmark from the task specification alone (G2). No list holds a weekday name, a label or a signature token, so the
 * user-only and superseded answers appear in no file (G5 checks it).
 */

export const FAMILIES = Object.freeze([
  {
    id: "service-config",
    short: "sc",
    title: "Service configuration upkeep",
    d1Host: "file",
    jobs: ["count-errors", "fix-rule", "owner-assign", "count-errors", "close-resolved"],
    services: ["gateway", "billing", "search", "ingest", "scheduler", "notifier", "catalog", "ledger"],
    params: ["timeout_ms", "batch_size", "max_retries", "pool_size", "cache_ttl_s", "queue_depth"],
    features: ["dark_mode", "bulk_export", "smart_retry", "audit_trail", "fast_search", "usage_alerts"],
    areas: ["deployment", "observability", "storage", "networking", "access control", "backups"],
    teams: ["platform", "core", "infra"],
  },
  {
    id: "incident-desk",
    short: "id",
    title: "Incident desk follow-through",
    d1Host: "ticket",
    jobs: ["close-resolved", "owner-assign", "count-errors", "close-resolved", "fix-rule"],
    services: ["checkout", "payments", "auth", "profile", "inventory", "shipping", "reports", "webhooks"],
    params: ["timeout_ms", "max_retries", "rate_limit", "pool_size", "circuit_threshold", "backoff_ms"],
    features: ["retry_banner", "guest_checkout", "fraud_hold", "status_page", "soft_delete", "geo_routing"],
    areas: ["on-call", "escalation", "postmortems", "paging", "runbooks", "service levels"],
    teams: ["sre", "payments", "identity"],
  },
  {
    id: "release-train",
    short: "rt",
    title: "Release train preparation",
    d1Host: "message",
    jobs: ["fix-rule", "close-resolved", "count-errors", "owner-assign", "fix-rule"],
    services: ["mobile-api", "web-shell", "sync", "media", "editor", "exporter", "importer", "viewer"],
    params: ["max_upload_mb", "batch_size", "timeout_ms", "worker_count", "cache_ttl_s", "max_retries"],
    features: ["offline_mode", "new_editor", "share_links", "beta_banner", "auto_save", "media_preview"],
    areas: ["release notes", "store listing", "localization", "beta program", "versioning", "rollback"],
    teams: ["release", "mobile", "web"],
  },
]);

/** People and channels shared by every family. */
export const PEOPLE = Object.freeze([
  "Asha Rahman",
  "Bruno Keller",
  "Chen Wei",
  "Dara Okafor",
  "Elif Demir",
  "Farid Haddad",
  "Grace Lindqvist",
  "Hiro Tanaka",
  "Ines Moreau",
  "Jonas Berg",
  "Kavya Iyer",
  "Luis Ortega",
]);

/** Ship days (D4). Filler text never names a weekday. */
export const DAYS = Object.freeze(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);

/** Words that make labels and signatures (D2); none appears in any filler list. */
export const TOKEN_WORDS = Object.freeze(["heron", "quartz", "maple", "comet", "tundra", "ember", "lagoon", "falcon", "cobalt", "saffron"]);

/** Filler vocabulary for logs, chatter and prose. */
export const FILLER = Object.freeze({
  verbs: ["checked", "reviewed", "measured", "deployed", "rolled back", "profiled", "tuned", "migrated", "drained", "restarted"],
  nouns: ["dashboard", "pipeline", "replica", "endpoint", "worker", "index", "bucket", "cron job", "load balancer", "certificate"],
  adjectives: ["slow", "stable", "noisy", "idle", "busy", "flaky", "healthy", "degraded", "warm", "cold"],
  paths: ["orders", "users", "items", "sessions", "events", "assets", "invoices", "reports", "tokens", "feeds"],
  topics: ["capacity", "latency", "cost", "alerts", "dependencies", "rollout", "testing", "documentation", "ownership", "quotas"],
});
