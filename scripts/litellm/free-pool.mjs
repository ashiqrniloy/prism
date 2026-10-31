/**
 * The repo's free test pool — one JS object, rendered to LiteLLM's YAML shape by `render.mjs`
 * (plan 214 Task 5). YAML is never string-templated here: `render.mjs` serialises this object, so
 * quoting, escaping and the zero-cost invariant are enforced in one place.
 *
 * Quotas are the dated free-tier numbers from plan 214 Task 1 (e) (`console.groq.com/docs/rate-limits`,
 * `ai.google.dev/gemini-api/docs/rate-limits`, and NVIDIA's community-reported ~40 RPM, read 2026-10-31). They are per deployment on purpose: LiteLLM's router
 * needs one `rpm`/`tpm` per deployment to stop a group from fanning out past a single host's quota.
 * Cloudflare Workers AI publishes a neuron budget, not an RPM, so its deployments carry a
 * conservative 20 RPM / 10 000 TPM instead — see the quota table in `README.md` before raising them.
 *
 * A deployment is only rendered when every name in `requireEnv` is set, so a machine with one
 * backend key still gets a working pool from the groups that backend serves.
 */

/** Deployment images, pinned by digest (plan 214 Task 1 (c)); the age waiver for 1.106.6 is recorded there. */
export const IMAGES = {
  litellm: "ghcr.io/berriai/litellm-database:v1.106.6@sha256:7ef0e78fe00ad5ea7ea45666cc1d1f02cb7076aee69091543bf397de52db33ce",
  postgres: "postgres:17.11-alpine@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b",
};

/** Zero cost is the point of the pool: every deployment in a `prism-free/` group prices at 0. */
export const ZERO_COST = { input_cost_per_token: 0, output_cost_per_token: 0 };

const cloudflare = { name: "cloudflare", requireEnv: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_KEY"], keyEnv: "CLOUDFLARE_API_KEY" };
const groq = { name: "groq", requireEnv: ["GROQ_API_KEY"], keyEnv: "GROQ_API_KEY" };
const nvidia = { name: "nvidia_nim", requireEnv: ["NVIDIA_NIM_API_KEY"], keyEnv: "NVIDIA_NIM_API_KEY" };
const gemini = { name: "gemini", requireEnv: ["GEMINI_API_KEY"], keyEnv: "GEMINI_API_KEY" };
const openrouter = { name: "openrouter", requireEnv: ["OPENROUTER_API_KEY"], keyEnv: "OPENROUTER_API_KEY" };

/**
 * One entry per deployment. `model` is the LiteLLM model string: `<provider>/<vendor id>`, where the
 * provider is `host.name` when that provider takes a prefix (Cloudflare does, Groq does not),
 * `id` becomes `model_info.id` and is what `x-litellm-model-id` reports — keep it stable, benches
 * count served deployments by it. `caps` maps to `model_info.supports_*`; only declare what the host
 * documents, because Prism's discovery reads those flags back.
 */
export const DEPLOYMENTS = [
  // ── smoke: mixed models, wire and integration tests only (never memory-bench content) ──────────
  {
    group: "prism-free/smoke",
    host: groq,
    model: "groq/openai/gpt-oss-20b",
    id: "smoke-groq-oss20",
    rpm: 30,
    tpm: 8000,
    caps: { supports_function_calling: true },
  },
  {
    group: "prism-free/smoke",
    host: gemini,
    model: "gemini/gemini-3.8-flash",
    id: "smoke-google-flash",
    rpm: 5,
    tpm: 250_000,
    caps: { supports_function_calling: true },
    healthCheck: false,
  },
  // OpenRouter `:free` is 20 RPM / 50 RPD per account, so nothing here joins the health-check rotation.
  {
    group: "prism-free/smoke",
    host: openrouter,
    model: "openrouter/google/gemma-4-26b-a4b-it:free",
    id: "smoke-or-gemma4",
    rpm: 20,
    tpm: 20_000,
    healthCheck: false,
  },
  // Cloudflare's gpt-oss deployments answer on the free plan (verified 2026-10-31) but reject a
  // tool-result pair on replay, so they declare no capability of their own.
  {
    group: "prism-free/smoke",
    host: cloudflare,
    model: "cloudflare/@cf/openai/gpt-oss-20b",
    id: "smoke-cloudflare-oss20",
    rpm: 20,
    tpm: 10_000,
  },

  // ── the identity-stable group: one open-weights model on several free hosts ───────────────────
  // OpenRouter's free catalogue no longer carries gpt-oss-120b (checked 2026-10-31, plan 214 Task 1 (e)
  // listed it as an optional third host), so the group is Groq + NVIDIA NIM + Cloudflare.
  {
    group: "prism-free/gpt-oss-120b",
    host: groq,
    model: "groq/openai/gpt-oss-120b",
    id: "oss120b-groq",
    rpm: 30,
    tpm: 8000,
    caps: { supports_function_calling: true },
  },
  { group: "prism-free/gpt-oss-120b", host: nvidia, model: "openai/gpt-oss-120b", id: "oss120b-nvidia", rpm: 20, tpm: 8000 },
  {
    group: "prism-free/gpt-oss-120b",
    host: cloudflare,
    model: "cloudflare/@cf/openai/gpt-oss-120b",
    id: "oss120b-cloudflare",
    rpm: 20,
    tpm: 10_000,
  },

  // ── single-deployment groups, pinned: the only groups a scored arm may use ────────────────────
  {
    group: "prism-free/gpt-oss-120b@groq",
    host: groq,
    model: "groq/openai/gpt-oss-120b",
    id: "pin-oss120b-groq",
    rpm: 30,
    tpm: 8000,
    caps: { supports_function_calling: true },
  },
  { group: "prism-free/gpt-oss-120b@nvidia", host: nvidia, model: "openai/gpt-oss-120b", id: "pin-oss120b-nvidia", rpm: 20, tpm: 8000 },
  {
    group: "prism-free/gpt-oss-20b@groq",
    host: groq,
    model: "groq/openai/gpt-oss-20b",
    id: "pin-oss20b-groq",
    rpm: 30,
    tpm: 8000,
    caps: { supports_function_calling: true },
  },
  {
    group: "prism-free/gpt-oss-120b@cloudflare",
    host: cloudflare,
    model: "cloudflare/@cf/openai/gpt-oss-120b",
    id: "pin-oss120b-cloudflare",
    rpm: 20,
    tpm: 10_000,
  },
  {
    group: "prism-free/gpt-oss-20b@cloudflare",
    host: cloudflare,
    model: "cloudflare/@cf/openai/gpt-oss-20b",
    id: "pin-oss20b-cloudflare",
    rpm: 20,
    tpm: 10_000,
  },
  {
    group: "prism-free/gemini-3.8-flash@gemini",
    host: gemini,
    model: "gemini/gemini-3.8-flash",
    id: "pin-flash-google",
    rpm: 5,
    tpm: 250_000,
    caps: { supports_function_calling: true },
    // Free-tier RPD is measured in dozens; a 5-minute background check would be ~288 calls a day.
    healthCheck: false,
  },
  {
    group: "prism-free/gemma-4-26b@openrouter",
    host: openrouter,
    model: "openrouter/google/gemma-4-26b-a4b-it:free",
    id: "pin-gemma4-or",
    rpm: 20,
    tpm: 20_000,
    caps: { supports_function_calling: true },
    healthCheck: false,
  },
  {
    group: "prism-free/nemotron-3.5-lightning@openrouter",
    host: openrouter,
    model: "openrouter/nvidia/nemotron-3.5-lightning:free",
    id: "pin-nemotron-lightning-or",
    rpm: 20,
    tpm: 20_000,
    caps: { supports_function_calling: true },
    healthCheck: false,
  },

  // ── paid-call tripwire: real free deployment, fabricated non-zero price in `litellm_params` ───
  // Pricing belongs in `litellm_params` (Task 1b measured `model_info` pricing as inert), and any
  // call here accrues spend, so the pool key's `max_budget` refuses it a flush later (422).
  {
    group: "prism-free/priced",
    host: cloudflare,
    model: "cloudflare/@cf/openai/gpt-oss-20b",
    id: "priced-oss20b",
    rpm: 20,
    tpm: 10_000,
    price: { input_cost_per_token: 0.000002, output_cost_per_token: 0.000002 },
    // A background check here would accrue ~288 priced calls a day and blow the key's budget itself.
    healthCheck: false,
  },
];

/**
 * Router settings. `simple-shuffle` rather than usage-based routing: the pool's quotas are per host,
 * and Task 1b measured the mixed set as non-sticky under simple-shuffle anyway, so usage-based
 * routing would add state without holding a quota better.
 *
 * `num_retries: 0` — the bench owns retries (`scripts/memory-bench/run.mjs`), and a proxy retry would
 * hide a served-deployment count from the arms.
 *
 * `fallbacks` is the one place a group may name another: only `prism-free/smoke` may fall back, and
 * only to a same-model pin. Every other group maps to nothing; `render_same_model_groups_have_no_cross_model_fallback`
 * fails if a cross-model target appears.
 */
export const ROUTER_SETTINGS = {
  routing_strategy: "simple-shuffle",
  num_retries: 0,
  cooldown_time: 60,
  allowed_fails: 3,
  // A bad key is not retried at all, and a rate limit is a quota signal, not a transient fault.
  allowed_fails_policy: { AuthenticationError: 0, RateLimitError: 0 },
  fallbacks: { "prism-free/smoke": ["prism-free/gpt-oss-20b@groq"] },
  enable_health_check_routing: true,
};

/** Health checks are what keep a dead free deployment out of rotation — and what eats quota. */
export const HEALTH_CHECK_INTERVAL_SECONDS = 300;

export const FREE_POOL = { deployments: DEPLOYMENTS, routerSettings: ROUTER_SETTINGS, images: IMAGES };
