import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "bun:test";
import { discoverFreeModels, PROVIDERS, poolMatch, renderMarkdown, stripUpstream } from "./free-models.mjs";
import { DEPLOYMENTS } from "./free-pool.mjs";

const env = {
  OPENROUTER_API_KEY: "sk-or-secret",
  CLOUDFLARE_API_KEY: "cf-secret",
  CLOUDFLARE_ACCOUNT_ID: "account123",
};

const catalogues = {
  "https://openrouter.ai/api/v1/models": {
    data: [
      { id: "nvidia/nemotron:free", pricing: { prompt: "0", completion: "0" } },
      { id: "paid/model", pricing: { prompt: "0.000001", completion: "0.000002" } },
    ],
  },
  "https://api.cloudflare.com/client/v4/accounts/account123/ai/models/search?per_page=100&task=Text%20Generation": {
    result: [{ name: "@cf/openai/gpt-oss-120b" }, { name: "@cf/meta/llama-3.2-3b-instruct" }],
  },
  "https://api.groq.com/openai/v1/models": { data: [{ id: "openai/gpt-oss-20b" }] },
  "https://integrate.api.nvidia.com/v1/models": { data: [{ id: "openai/gpt-oss-120b" }] },
  "https://generativelanguage.googleapis.com/v1beta/models": {
    models: [
      { name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-3.8-pro", supportedGenerationMethods: ["generateContent"] },
    ],
  },
};

const lookup = (url) => Object.entries(catalogues).find(([prefix]) => url.startsWith(prefix))?.[1];

const fakeFetch = async (url) => ({
  ok: lookup(url) !== undefined,
  status: lookup(url) === undefined ? 404 : 200,
  text: async () => JSON.stringify(lookup(url) ?? { error: "not found" }),
});

const deployments = [
  {
    group: "prism-free/gpt-oss-120b",
    host: { id: "groq", name: "groq", requireEnv: ["GROQ_API_KEY"], keyEnv: "GROQ_API_KEY" },
    model: "openai/gpt-oss-120b",
  },
  { group: "prism-free/priced", host: { id: "cloudflare" }, model: "cloudflare/@cf/openai/gpt-oss-120b" },
];

describe("free-model catalogue", () => {
  it("free_models_mark_zero_price_and_skip_family_gating", async () => {
    const report = await discoverFreeModels(env, fakeFetch);
    const openrouter = report.results.find((result) => result.id === "openrouter");
    assert.deepEqual(
      openrouter.rows.map((row) => [row.model, row.free]),
      [
        ["nvidia/nemotron:free", true],
        ["paid/model", false],
      ],
    );
    assert.equal(openrouter.free, 1);
    assert.equal(openrouter.total, 2);

    const gemini = await discoverFreeModels({ ...env, GEMINI_API_KEY: "gem-secret" }, fakeFetch, deployments).then((full) =>
      full.results.find((result) => result.id === "gemini"),
    );
    assert.deepEqual(
      gemini.rows.map((row) => [row.model, row.free]),
      [
        ["gemini-3.8-flash", true],
        ["gemini-3.8-pro", false],
      ],
    );
  });

  it("free_models_skip_unkeyed_providers_instead_of_guessing", async () => {
    const report = await discoverFreeModels(env, fakeFetch, deployments);
    const groq = report.results.find((result) => result.id === "groq");
    const nvidia = report.results.find((result) => result.id === "nvidia");
    assert.equal(groq.status, "skipped");
    assert.equal(groq.reason, "no GROQ_API_KEY");
    assert.equal(nvidia.status, "skipped");
    assert.equal(report.results.filter((result) => result.status === "ok").length, 2);
  });

  it("free_models_report_fetch_failure_as_a_row", async () => {
    const allKeys = { ...env, GROQ_API_KEY: "g", NVIDIA_NIM_API_KEY: "n", GEMINI_API_KEY: "g" };
    const report = await discoverFreeModels(
      allKeys,
      async () => ({ ok: false, status: 401, text: async () => "unauthorized" }),
      deployments,
    );
    assert.equal(
      report.results.every((result) => result.status === "error"),
      true,
    );
    assert.match(report.results[0].reason, /^401 unauthorized$/);
  });

  it("free_models_config_hides_credentials", async () => {
    // The env name travels, never the value: classify() runs on the body, the key stays in the request.
    const seen = [];
    await discoverFreeModels(
      env,
      async (_url, init) => {
        seen.push(init.headers);
        return { ok: true, status: 200, text: async () => JSON.stringify({ data: [] }) };
      },
      [],
    );
    const serialized = JSON.stringify(renderMarkdown(await discoverFreeModels(env, fakeFetch, deployments)));
    for (const secret of ["sk-or-secret", "cf-secret"]) assert.equal(serialized.includes(secret), false);
    for (const headers of seen)
      for (const value of Object.values(headers))
        assert.equal(String(value).includes("sk-or-secret") && !String(value).startsWith("Bearer"), false);
  });

  it("free_models_mark_which_deployments_the_pool_carries", async () => {
    const report = await discoverFreeModels(env, fakeFetch, deployments);
    // Cloudflare is stripped of `cloudflare/` and `@cf/` before matching, so the pool row resolves.
    assert.equal(poolMatch("cloudflare", "cloudflare/@cf/openai/gpt-oss-120b", report)?.free, true);
    assert.equal(poolMatch("groq", "openai/gpt-oss-120b", report), undefined);
    const markdown = renderMarkdown(report);
    assert.match(markdown, /\| `@cf\/openai\/gpt-oss-120b` \| .* \| `prism-free\/priced` \|/);
    assert.match(markdown, /\| `@cf\/meta\/llama-3.2-3b-instruct` \| .* \| — \|/);
    assert.match(markdown, /status: \*\*skipped\*\* — no GROQ_API_KEY/);
  });

  it("free_models_committed_list_covers_every_pool_deployment", () => {
    // The page is generated, so the only thing a test can guarantee is that it is not stale: every
    // group the pool renders has to appear in it next to its upstream model.
    const page = readFileSync(resolve(import.meta.dir, "..", "..", "docs", "free-models.md"), "utf8");
    assert.match(page, /Checked \*\*\d{4}-\d{2}-\d{2}\*\*/);
    const cells = page
      .split("\n")
      .filter((line) => line.startsWith("| `"))
      .map((line) =>
        line
          .split("|")
          .slice(1, -1)
          .map((cell) => cell.trim().replace(/`/g, "")),
      );
    for (const deployment of DEPLOYMENTS) {
      const model = stripUpstream(deployment.model);
      const row = cells.find((cell) => stripUpstream(cell[0]) === model && cell.at(-1).includes(deployment.group));
      assert.ok(row, `${deployment.group} ${deployment.model} is missing from docs/free-models.md — rerun the generator`);
    }
  });

  it("free_models_provider_table_covers_every_source", () => {
    assert.deepEqual(
      PROVIDERS.map((provider) => provider.id),
      ["openrouter", "cloudflare", "groq", "nvidia", "gemini"],
    );
    for (const provider of PROVIDERS) assert.equal(typeof provider.classify, "function", provider.id);
  });
});
