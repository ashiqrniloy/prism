/**
 * Renders the free pool (plan 214 Task 5) into the two files LiteLLM and Compose need.
 *
 * Pure: no filesystem, no clock, no randomness — `up.mjs` supplies the env lookup and the
 * per-volume Postgres password. The output is block YAML from a small structured emitter
 * (`toYaml`), never string templating, so a quoted secret can never break the document shape.
 *
 * Two rules are load-bearing and tested in `render.test.mjs`:
 *  - a deployment is kept only when every env name it references is set, and a group left
 *    with no deployment is dropped (plus any fallback that pointed at it);
 *  - rendered text never contains an env value, only `os.environ/<NAME>` references and
 *    `${NAME}` compose interpolation.
 */
import { FREE_POOL, HEALTH_CHECK_INTERVAL_SECONDS, ZERO_COST } from "./free-pool.mjs";

/**
 * The weights a deployment actually serves: the model's own name, without the LiteLLM provider
 * prefix, an OpenRouter `:free` suffix, or a host's vendor namespace (`@cf/openai/`). Groq's
 * `openai/gpt-oss-120b`, OpenRouter's `openai/gpt-oss-120b:free` and Cloudflare's
 * `@cf/openai/gpt-oss-120b` all resolve to `gpt-oss-120b`, which is what makes a multi-host group
 * identity-stable — and what the served-deployment guard of the bench compares.
 */
export const servedModel = (model, provider) => {
  const withoutPrefix = model.startsWith(`${provider}/`) ? model.slice(provider.length + 1) : model;
  return withoutPrefix
    .replace(/:free$/, "")
    .split("/")
    .at(-1);
};

/** `os.environ/NAME` is LiteLLM's own indirection: the value never enters the config file. */
export const envRef = (name) => `os.environ/${name}`;

/** Compose interpolation, spelled once so no literal `${` sits in a string where lint cannot see it. */
export const composeRef = (name) => ["$", "{", name, "}"].join("");

function deploymentEntry(deployment) {
  const { group, host, model, id, rpm, tpm, price, caps } = deployment;
  return {
    model_name: group,
    litellm_params: {
      model,
      api_key: envRef(host.keyEnv),
      ...(rpm === undefined ? {} : { rpm }),
      ...(tpm === undefined ? {} : { tpm }),
      ...(price ?? {}),
    },
    // `model_info.id` is the deployment id that `x-litellm-model-id` reports and that benches count.
    // Free deployments price at zero so the catalog can never charge the pool.
    model_info: { id, ...(price ?? ZERO_COST), ...(caps ?? {}) },
  };
}

/** A YAML scalar. Strings are always double-quoted, so a `/`, `:` or `@` in a model name is never syntax. */
function scalar(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  return undefined;
}

const isPlain = (value) => typeof value !== "object" || value === null;

/**
 * Emits block YAML from the objects above. This is a structured serialiser, not string templating:
 * every scalar goes through `scalar()`, so no value can break the document, and the shape (maps,
 * lists, list-of-maps) is the only thing it has to know. LiteLLM rejects a JSON body for
 * `config.yaml` ("LLM Model List not loaded in"), which is why this exists.
 */
export function toYaml(value, indent = 0) {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]`;
    return value
      .map((item) => {
        if (isPlain(item)) return `${pad}- ${scalar(item)}`;
        const body = toYaml(item, indent + 2);
        return `${pad}- ${body.slice(indent + 2)}`;
      })
      .join("\n");
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value);
    if (entries.length === 0) return `${pad}{}`;
    return entries
      .map(([key, item]) => {
        if (isPlain(item)) return `${pad}${key}: ${scalar(item)}`;
        if ((Array.isArray(item) && item.length === 0) || (typeof item === "object" && Object.keys(item).length === 0))
          return `${pad}${key}: ${Array.isArray(item) ? "[]" : "{}"}`;
        return `${pad}${key}:\n${toYaml(item, indent + 2)}`;
      })
      .join("\n");
  }
  return `${pad}${scalar(value)}`;
}

/** Renders the pool. `env` returns the value of a name (or undefined); no value is ever copied out. */
export function renderPool({ pool = FREE_POOL, env = (name) => process.env[name], otelEndpoint, dbPassword }) {
  if (!dbPassword) throw new Error("render: a per-run Postgres password is required");
  const missing = new Set();
  const kept = [];
  for (const deployment of pool.deployments) {
    const absent = deployment.host.requireEnv.filter((name) => !env(name));
    if (absent.length === 0) kept.push(deployment);
    else for (const name of absent) missing.add(name);
  }
  if (kept.length === 0) {
    throw new Error(`render: no deployment has credentials (missing: ${[...missing].join(", ") || "none"})`);
  }

  const groups = [...new Set(kept.map((deployment) => deployment.group))];
  // Health checks cost quota on every host that runs them: one per group per interval is fine on a
  // per-minute allowance and fatal on a per-day one, so a deployment opts out with `healthCheck: false`
  // and a group is only checked when all of its deployments are willing.
  const healthGroups = groups.filter((group) =>
    kept.filter((deployment) => deployment.group === group).every((deployment) => deployment.healthCheck !== false),
  );
  const served = new Set(groups);
  // LiteLLM 1.106.6 validates `fallbacks` as a list of single-key dicts (`router.py`
  // `validate_fallbacks`); a dict-of-lists iterates to its string keys and aborts startup with
  // "Item 'prism-free/smoke' is not a dictionary". A pruned-to-empty map passes either way, which is
  // why this only surfaced once a fallback target survived key-gating.
  const fallbacks = Object.entries(pool.routerSettings.fallbacks ?? {})
    .filter(([group]) => served.has(group))
    .map(([group, targets]) => [group, (targets ?? []).filter((target) => served.has(target))])
    .filter(([, targets]) => targets.length > 0)
    .map(([group, targets]) => ({ [group]: targets }));

  const config = {
    model_list: kept.map(deploymentEntry),
    router_settings: {
      ...pool.routerSettings,
      fallbacks,
      ...(healthGroups.length > 0 ? { background_health_check_model_groups: healthGroups } : {}),
    },
    general_settings: {
      database_url: envRef("LITELLM_DATABASE_URL"),
      master_key: envRef("LITELLM_MASTER_KEY"),
      background_health_checks: true,
      health_check_interval: HEALTH_CHECK_INTERVAL_SECONDS,
    },
    litellm_settings: { drop_params: true, callbacks: otelEndpoint ? ["otel"] : [] },
  };

  const forwarded = new Set();
  for (const deployment of kept) for (const name of deployment.host.requireEnv) forwarded.add(name);

  const compose = {
    name: "prism-litellm-pool",
    services: {
      db: {
        image: pool.images.postgres,
        environment: { POSTGRES_USER: "llmproxy", POSTGRES_DB: "litellm", POSTGRES_PASSWORD: dbPassword },
        volumes: ["pgdata:/var/lib/postgresql/data"],
        healthcheck: { test: ["CMD-SHELL", "pg_isready -U llmproxy -d litellm"], interval: "3s", timeout: "3s", retries: 40 },
        networks: ["internal"],
        pids_limit: 512,
        restart: "unless-stopped",
      },
      litellm: {
        image: pool.images.litellm,
        depends_on: { db: { condition: "service_healthy" } },
        // The image's own entrypoint starts the proxy without `--config`, which leaves the router
        // with an empty model list ("LLM Model List not loaded in"); this runs the migration
        // entrypoint and then names the config explicitly.
        entrypoint: ["/bin/sh", "-c"],
        command: ["bash /app/docker/entrypoint.sh && exec litellm --config /app/config.yaml --port 4000"],
        // `${NAME}` is resolved by compose from up.mjs's environment at start time, so the key
        // reaches the container without ever being written into a file.
        environment: {
          DATABASE_URL: `postgresql://llmproxy:${dbPassword}@db:5432/litellm`,
          STORE_MODEL_IN_DB: "False",
          LITELLM_LOG: "INFO",
          LITELLM_MASTER_KEY: composeRef("LITELLM_MASTER_KEY"),
          ...Object.fromEntries([...forwarded].map((name) => [name, composeRef(name)])),
          ...(otelEndpoint ? { OTEL_EXPORTER: "otlp_http", OTEL_EXPORTER_OTLP_ENDPOINT: otelEndpoint } : {}),
        },
        volumes: ["./config.yaml:/app/config.yaml:ro"],
        ports: ["127.0.0.1:4000:4000"],
        healthcheck: {
          test: [
            "CMD-SHELL",
            "/app/.venv/bin/python -c \"import urllib.request;urllib.request.urlopen('http://127.0.0.1:4000/health/liveliness', timeout=3)\"",
          ],
          interval: "5s",
          timeout: "5s",
          retries: 60,
        },
        networks: ["default", "internal"],
        // Rootless podman needs a high pids limit here or LiteLLM cannot fork its workers.
        pids_limit: 8192,
        restart: "unless-stopped",
      },
    },
    networks: { internal: { internal: true } },
    volumes: { pgdata: {} },
  };

  return {
    config,
    compose,
    configText: `${toYaml(config)}\n`,
    composeText: `${toYaml(compose)}\n`,
    groups,
    dbPassword,
    deployments: kept.map((deployment) => ({
      group: deployment.group,
      id: deployment.id,
      model: deployment.model,
      served: servedModel(deployment.model, deployment.host.name),
    })),
    missing: [...missing].sort(),
  };
}
