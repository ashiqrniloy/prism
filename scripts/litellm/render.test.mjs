import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { DEPLOYMENTS, FREE_POOL } from "./free-pool.mjs";
import { composeRef, renderPool, servedModel, toYaml } from "./render.mjs";

const ROOT = join(import.meta.dir, "../..");
const ALL_KEYS = [
  "GROQ_API_KEY",
  "NVIDIA_NIM_API_KEY",
  "GEMINI_API_KEY",
  "CLOUDFLARE_API_KEY",
  "CLOUDFLARE_ACCOUNT_ID",
  "OPENROUTER_API_KEY",
  "LITELLM_MASTER_KEY",
];
const SECRET = "sk-pool-secret-value-0123456789";
const envWith = (names) => (name) => (names.includes(name) ? SECRET : undefined);

const render = (names, extra = {}) => renderPool({ env: envWith(names), dbPassword: "db-pass", ...extra });

describe("render_free_pool", () => {
  it("render_keeps_only_deployments_with_keys", () => {
    const onlyGroq = render(["GROQ_API_KEY"]);
    assert.ok(onlyGroq.deployments.length > 0);
    assert.equal(
      onlyGroq.deployments.every(
        (deployment) => ["prism-free/gpt-oss-120b", "prism-free/smoke"].includes(deployment.group) || deployment.group.endsWith("@groq"),
      ),
      true,
    );
    // Groups whose every deployment lost its key are dropped, and the ids follow.
    assert.deepEqual(onlyGroq.groups.sort(), [
      "prism-free/gpt-oss-120b",
      "prism-free/gpt-oss-120b@groq",
      "prism-free/gpt-oss-20b@groq",
      "prism-free/smoke",
    ]);
    assert.equal(
      onlyGroq.config.model_list.some((entry) => entry.model_name === "prism-free/gpt-oss-120b@nvidia"),
      false,
    );
    assert.ok(onlyGroq.missing.includes("NVIDIA_NIM_API_KEY"));

    // A fallback whose target survived stays; one whose target was dropped goes with it.
    assert.deepEqual(onlyGroq.config.router_settings.fallbacks, [{ "prism-free/smoke": ["prism-free/gpt-oss-20b@groq"] }]);
    const geminiOnly = render(["GEMINI_API_KEY"]);
    assert.deepEqual(geminiOnly.groups.sort(), ["prism-free/gemini-3.8-flash@gemini", "prism-free/smoke"]);
    assert.deepEqual(geminiOnly.config.router_settings.fallbacks, []);

    // One host that needs two names stays whole only when both are present: a half-keyed host
    // contributes nothing rather than a deployment that would fail at call time.
    assert.throws(() => render(["CLOUDFLARE_API_KEY"]), /no deployment has credentials/);
    const withAccount = render(["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_KEY"]);
    assert.equal(
      withAccount.deployments.every(
        (deployment) =>
          deployment.group.endsWith("@cloudflare") ||
          ["prism-free/gpt-oss-120b", "prism-free/smoke", "prism-free/priced"].includes(deployment.group),
      ),
      true,
    );

    assert.throws(() => render([]), /no deployment has credentials/);
    assert.throws(() => renderPool({ env: () => undefined, dbPassword: undefined }), /Postgres password/);
  });

  it("render_same_model_groups_have_no_cross_model_fallback", () => {
    const rendered = render(ALL_KEYS);
    const modelOf = new Map();
    for (const entry of rendered.config.model_list) {
      const models = modelOf.get(entry.model_name) ?? new Set();
      models.add(
        servedModel(entry.litellm_params.model, FREE_POOL.deployments.find((d) => d.model === entry.litellm_params.model)?.host.name ?? ""),
      );
      modelOf.set(entry.model_name, models);
    }
    // Two hosts, one model: the multi-host group is identity-stable although the model strings differ.
    assert.deepEqual(
      rendered.deployments.filter((deployment) => deployment.group === "prism-free/gpt-oss-120b").map((deployment) => deployment.served),
      ["gpt-oss-120b", "gpt-oss-120b", "gpt-oss-120b"],
    );
    // Every host's spelling of the same weights collapses to one name.
    assert.equal(servedModel("cloudflare/@cf/openai/gpt-oss-20b", "cloudflare"), "gpt-oss-20b");
    assert.equal(servedModel("openai/gpt-oss-20b:free", "openrouter"), "gpt-oss-20b");
    assert.equal(servedModel("groq/openai/gpt-oss-120b", "groq"), "gpt-oss-120b");
    // Groq's vendor id is `openai/…`, so the LiteLLM string needs the `groq/` provider prefix or the
    // router sends the Groq key to api.openai.com (measured: 401 "Incorrect API key provided: gsk_…").
    assert.equal(servedModel("groq/openai/gpt-oss-20b", "groq"), "gpt-oss-20b");
    // Groups are identity-stable by construction: one model string per group, smoke excepted.
    for (const [group, models] of modelOf) if (group !== "prism-free/smoke") assert.equal(models.size, 1, `${group} mixes models`);

    // Shape matters as much as content: LiteLLM 1.106.6 wants a list of single-key dicts, and a
    // dict-of-lists aborts startup.
    for (const entry of rendered.config.router_settings.fallbacks) assert.equal(Object.keys(entry).length, 1);
    const fallbackPairs = () => rendered.config.router_settings.fallbacks.flatMap((entry) => Object.entries(entry));
    for (const [group, targets] of fallbackPairs()) {
      if (group === "prism-free/smoke") continue;
      for (const target of targets)
        assert.deepEqual(modelOf.get(target), modelOf.get(group), `${group} falls back to a different model (${target})`);
    }
    // The smoke exemption is real, not vacuous: at least one fallback exists to check.
    assert.ok(rendered.config.router_settings.fallbacks.length > 0);
    // And the assertion has teeth: a planted cross-model fallback is caught.
    const planted = structuredClone(rendered.config);
    planted.router_settings.fallbacks.push({ "prism-free/gpt-oss-20b@groq": ["prism-free/gemini-3.8-flash@gemini"] });
    const violations = planted.router_settings.fallbacks
      .flatMap((entry) => Object.entries(entry))
      .filter(([group]) => group !== "prism-free/smoke")
      .flatMap(([group, targets]) =>
        targets.filter((target) => [...(modelOf.get(target) ?? [])].some((model) => !modelOf.get(group)?.has(model))),
      );
    assert.deepEqual(violations, ["prism-free/gemini-3.8-flash@gemini"]);
  });

  it("render_free_pool_costs_are_zero", () => {
    const rendered = render(ALL_KEYS);
    for (const entry of rendered.config.model_list) {
      const { model_info: info, litellm_params: params } = entry;
      if (info.id === "priced-oss20b") {
        // The one deliberate exception: a fabricated price, in `litellm_params` where it registers.
        assert.equal(params.input_cost_per_token, 0.000002);
        assert.equal(info.input_cost_per_token, 0.000002);
        continue;
      }
      assert.equal(info.input_cost_per_token, 0, entry.model_name);
      assert.equal(info.output_cost_per_token, 0, entry.model_name);
      assert.equal(params.input_cost_per_token, undefined, `${entry.model_name} must not carry a price`);
      assert.equal(params.output_cost_per_token, undefined);
    }
    assert.equal(DEPLOYMENTS.filter((deployment) => deployment.price).length, 1);
  });

  it("render_emits_no_secret", () => {
    const rendered = render(ALL_KEYS, { otelEndpoint: "http://127.0.0.1:4318/v1/traces" });
    for (const text of [rendered.configText, rendered.composeText]) {
      assert.equal(text.includes(SECRET), false, "a credential value reached the rendered files");
      assert.equal(/sk-[A-Za-z0-9]{16,}/.test(text), false);
    }
    // Keys travel as `os.environ/NAME` in the config and `${NAME}` in compose.
    for (const entry of rendered.config.model_list) assert.match(entry.litellm_params.api_key, /^os\.environ\/[A-Z0-9_]+$/);
    assert.deepEqual(rendered.compose.services.litellm.environment.GROQ_API_KEY, composeRef("GROQ_API_KEY"));
    assert.deepEqual(rendered.compose.services.litellm.environment.LITELLM_MASTER_KEY, composeRef("LITELLM_MASTER_KEY"));
    // Block YAML, one `model_name:` per deployment, and every string quoted.
    assert.equal(
      rendered.configText.split("\n").filter((line) => line.trimStart().startsWith("- model_name:")).length,
      rendered.deployments.length,
    );
    assert.match(rendered.configText, /^model_list:$/m);
    assert.match(rendered.configText, /^ {2}- model_name: "prism-free\/smoke"$/m);
  });

  it("render_binds_loopback_and_pins_digest", () => {
    const rendered = render(ALL_KEYS);
    const { compose } = rendered;
    assert.deepEqual(compose.services.litellm.ports, ["127.0.0.1:4000:4000"]);
    assert.equal(compose.services.db.ports, undefined, "Postgres must not publish a port");
    for (const service of Object.values(compose.services)) assert.match(service.image, /@sha256:[0-9a-f]{64}$/);
    assert.equal(compose.services.litellm.image, FREE_POOL.images.litellm);
  });

  it("render_enables_otel_only_on_request", () => {
    assert.deepEqual(render(ALL_KEYS).config.litellm_settings.callbacks, []);
    const otel = render(ALL_KEYS, { otelEndpoint: "http://127.0.0.1:4318/v1/traces" });
    assert.deepEqual(otel.config.litellm_settings.callbacks, ["otel"]);
    assert.equal(otel.compose.services.litellm.environment.OTEL_EXPORTER_OTLP_ENDPOINT, "http://127.0.0.1:4318/v1/traces");
  });

  it("litellm_scripts_not_published", () => {
    const files = ["package.json", ...workspaceManifests()];
    for (const manifest of files) {
      const pkg = JSON.parse(readFileSync(join(ROOT, manifest), "utf8"));
      for (const entry of pkg.files ?? []) assert.equal(entry.includes("scripts/litellm"), false, `${manifest} publishes scripts/litellm`);
    }
    // The whole point: nothing under scripts/ is a workspace, so nothing packs it.
    assert.equal(
      workspaceManifests().some((manifest) => manifest.includes("scripts")),
      false,
    );
  });

  it("render_yaml_emitter_quotes_every_scalar", () => {
    // The emitter is the only thing standing between a model name and a broken document.
    assert.equal(toYaml({ a: "x: y", b: 1, c: false, d: null }), 'a: "x: y"\nb: 1\nc: false\nd: null');
    assert.equal(toYaml({ list: [{ k: "v" }, "plain"], empty: [], none: {} }), 'list:\n  - k: "v"\n  - "plain"\nempty: []\nnone: {}');
    assert.equal(toYaml({ nested: { deep: [{ k: 1, j: 2 }] } }), "nested:\n  deep:\n    - k: 1\n      j: 2");
    assert.equal(toYaml({ s: `quote " and ${composeRef("VAR")}` }), `s: "quote \\" and ${composeRef("VAR")}"`);
  });

  it("render_quota_is_per_deployment_and_dated", () => {
    const rendered = render(ALL_KEYS);
    for (const entry of rendered.config.model_list) {
      assert.equal(typeof entry.litellm_params.rpm, "number", `${entry.model_name} needs an rpm`);
      assert.ok(entry.litellm_params.rpm > 0 && entry.litellm_params.rpm <= 30);
    }
    // Health checks run at most once per 5 minutes, over pool groups only, and never over a group
    // that opted out: a per-day quota (OpenRouter, Gemini) or the priced tripwire would be eaten.
    assert.equal(rendered.config.general_settings.health_check_interval, 300);
    const healthGroups = rendered.config.router_settings.background_health_check_model_groups;
    assert.ok(healthGroups.length > 0 && healthGroups.length < rendered.groups.length);
    for (const group of healthGroups) assert.equal(rendered.groups.includes(group), true, group);
    for (const group of ["prism-free/priced", "prism-free/gemini-3.8-flash@gemini", "prism-free/gemma-4-26b@openrouter"]) {
      assert.equal(healthGroups.includes(group), false, `${group} must not be health-checked`);
    }
    for (const group of ["prism-free/gpt-oss-20b@groq", "prism-free/gpt-oss-20b@cloudflare"]) {
      assert.equal(healthGroups.includes(group), true, group);
    }
    assert.equal(rendered.config.router_settings.num_retries, 0);
  });
});

/** Every workspace manifest (the same set `bun install` links). */
function workspaceManifests() {
  const manifests = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const path = join(dir, entry.name);
      if (existsSync(join(path, "package.json"))) manifests.push(relative(ROOT, join(path, "package.json")));
      walk(path);
    }
  };
  for (const root of ["packages", "apps"]) if (existsSync(join(ROOT, root))) walk(join(ROOT, root));
  return manifests;
}
