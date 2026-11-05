/** Shared wire-usage checks for the public and lifecycle harnesses (plan 188.7 Task 2). */
export function missingUsageCount(rows) {
  return rows.filter((row) => row.status >= 200 && row.status < 300 && !row.rawUsage?.input_tokens && !row.rawUsage?.prompt_tokens).length;
}

export function sumUsage(rows) {
  return {
    inputTokens: rows.reduce((n, row) => n + (row.inputTokens ?? 0), 0),
    cacheReadTokens: rows.reduce((n, row) => n + (row.cacheReadTokens ?? 0), 0),
    cacheWriteTokens: rows.reduce((n, row) => n + (row.cacheWriteTokens ?? 0), 0),
    outputTokens: rows.reduce((n, row) => n + (row.outputTokens ?? 0), 0),
  };
}

/** Longest model-prefix match, so a dated model id resolves without a per-build edit. */
export function resolveRate(rates, ref) {
  if (!rates?.models || typeof ref !== "string") return null;
  if (rates.models[ref]) return rates.models[ref];
  const keys = Object.keys(rates.models)
    .filter((key) => ref === key || ref.startsWith(`${key}-`) || ref.startsWith(`${key}.`) || ref.startsWith(`${key}@`))
    .sort((a, b) => b.length - a.length);
  return keys.length ? rates.models[keys[0]] : null;
}

function priced(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
// `cacheWrite` is optional when the route reports no cache writes: providers that bill only implicit
// reads publish no write rate, and a zero token count must not make the whole cost unknown.
function usable(rate, { cacheRead = false, cacheWrite = false } = {}) {
  return (
    rate && priced(rate.input) && priced(rate.output) && (!cacheRead || priced(rate.cacheRead)) && (!cacheWrite || priced(rate.cacheWrite))
  );
}

/**
 * Cost of the usage the route actually reported. Cache reads and writes are priced at their own
 * rates; the remainder of `inputTokens` is uncached input. A missing rate yields null, never zero.
 */
export function cacheAdjustedCost({ inputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0, outputTokens = 0 } = {}, rate) {
  if (!usable(rate, { cacheRead: cacheReadTokens > 0, cacheWrite: cacheWriteTokens > 0 })) return null;
  // Providers differ on whether inputTokens includes cache tokens; the bench normalizes before this.
  const cacheRead = Math.min(Math.max(0, cacheReadTokens), inputTokens);
  const cacheWrite = Math.min(Math.max(0, cacheWriteTokens), inputTokens - cacheRead);
  const uncached = Math.max(0, inputTokens - cacheRead - cacheWrite);
  return round(
    (uncached * rate.input +
      (cacheRead ? cacheRead * rate.cacheRead : 0) +
      (cacheWrite ? cacheWrite * rate.cacheWrite : 0) +
      outputTokens * rate.output) /
      1_000_000,
  );
}

/**
 * R11: the realistic full-context comparator. Every input token is a cached prefix, so a multi-turn
 * full arm pays the cache-read rate for history instead of the input rate. Assuming *all* input is
 * cached is the most favourable case for full, which makes the memory arm's cost claim conservative.
 */
export function cachedPrefixCost({ inputTokens = 0, outputTokens = 0 } = {}, rate) {
  if (!usable(rate, { cacheRead: inputTokens > 0 })) return null;
  return round((inputTokens * rate.cacheRead + outputTokens * rate.output) / 1_000_000);
}

export function costReport(usage, rate, { config } = {}) {
  const status = usable(rate) ? "priced" : "unpriced";
  return {
    currency: "USD",
    unit: "per_million_tokens",
    rates: rate ?? null,
    pricingStatus: status,
    measured: cacheAdjustedCost(usage, rate),
    // Only the full arm simulates a cached history; a memory arm reports what it actually paid.
    cachedPrefixSimulation: config === "full" ? cachedPrefixCost(usage, rate) : null,
    simulationAssumption: config === "full" ? "all input tokens are a cached prefix; history pays cacheRead, output pays output" : null,
  };
}

const round = (value) => Math.round(value * 1e6) / 1e6;

/** The fact extractor's stable cache key base (`consolidation/extract.ts`); the wire proxy logs it per exchange. */
export const EXTRACT_CACHE_KEY = "prism-fabric-extract";

/** The ontology curator's stable cache key (`packages/memory/wiki/src/consolidate/prompt.ts`); the wire proxy logs it per exchange. */
export const ONTOLOGY_CACHE_KEY = "prism-wiki-consolidate";

/**
 * Plan 202 Task 4.15 and plan 208 Task 3: product exchanges made by a background worker are accounted apart from
 * answers. The write-side extractor is `product-extract`; the ontology curator's concept pass is `product-ontology`.
 */
export function usageRole(row) {
  const role = row.role ?? "unknown";
  const key = row.cacheKey;
  if (role !== "product" || typeof key !== "string") return role;
  if (key === EXTRACT_CACHE_KEY || key.startsWith(`${EXTRACT_CACHE_KEY}:`)) return "product-extract";
  if (key === ONTOLOGY_CACHE_KEY || key.startsWith(`${ONTOLOGY_CACHE_KEY}:`)) return "product-ontology";
  return role;
}

/** Price each isolated model route before summing; evaluation may use different rates. */
export function roleUsage(rows, prior) {
  const result = {};
  // The ontology role appears only on an ontology arm, so every other arm's report keeps its shape.
  const ontology = rows.some((row) => usageRole(row) === "product-ontology") || prior?.["product-ontology"] !== undefined;
  for (const role of ["product", "product-extract", ...(ontology ? ["product-ontology"] : []), "evaluation", "unknown"]) {
    const selected = rows.filter((row) => usageRole(row) === role);
    const previous = prior?.[role];
    const usage = sumUsage([...selected, ...(previous ? [previous] : [])]);
    const complete = selected.every((row) => missingUsageCount([row]) === 0) && previous?.complete !== false;
    const costs = (kind) => {
      const values = selected.map((source) => {
        const row = ["inputWarm", "inputCold"].includes(kind) ? { ...source, outputTokens: 0 } : source;
        return ["cold", "inputCold"].includes(kind)
          ? cacheAdjustedCost({ ...row, cacheReadTokens: 0, cacheWriteTokens: 0 }, row.rate)
          : ["warm", "inputWarm"].includes(kind) && row.cachedPrefix
            ? cachedPrefixCost(row, row.rate)
            : cacheAdjustedCost(row, row.rate);
      });
      if (previous) values.push(previous[kind]);
      return complete && values.every((value) => typeof value === "number") ? round(values.reduce((a, b) => a + b, 0)) : null;
    };
    result[role] = {
      ...usage,
      exchanges: selected.length + (previous?.exchanges ?? 0),
      complete,
      measured: costs("measured"),
      cold: costs("cold"),
      warm: costs("warm"),
      inputWarm: costs("inputWarm"),
      inputCold: costs("inputCold"),
    };
  }
  const groups = Object.values(result);
  result.total = {
    ...sumUsage(groups),
    exchanges: groups.reduce((n, group) => n + group.exchanges, 0),
    measured: groups.every((group) => group.measured !== null) ? round(groups.reduce((n, group) => n + group.measured, 0)) : null,
  };
  return result;
}

/** Registered plan-202 gates take product measurements only; zero denominators prove no reduction. */
export function productMeasurementVerdict(candidate, comparator, { costRatio = 0.5, latencyRatio = 2 } = {}) {
  // The registered cost criterion covers every product-side call, extractor included.
  const productWarm = (report) => {
    const answer = report.roleUsage?.product?.inputWarm;
    const extractRole = report.roleUsage?.["product-extract"];
    // An absent role (older reports) adds nothing; a present role with unknown cost makes the whole cost unknown.
    const extract = extractRole === undefined ? 0 : extractRole.inputWarm;
    return typeof answer === "number" && typeof extract === "number" ? answer + extract : null;
  };
  const a = productWarm(candidate);
  const b = productWarm(comparator);
  const candidateN = candidate.results?.filter((row) => row.phaseTiming?.answer !== undefined).length ?? 0;
  const comparatorN = comparator.results?.filter((row) => row.phaseTiming?.answer !== undefined).length ?? 0;
  const sameQuestions =
    candidateN > 0 &&
    candidateN === candidate.results?.length &&
    comparatorN === comparator.results?.length &&
    candidateN === comparatorN &&
    candidate.results?.every((row) => comparator.results?.some((other) => other.id === row.id));
  const eligible =
    comparator.config !== "full" ||
    comparator.results?.every(
      (row) => row.contextEligibility?.eligible === true && row.contextEligibility?.completeHistory === true && row.truncated !== true,
    );
  const priced =
    sameQuestions &&
    eligible &&
    !candidate.measurementPolicy?.seedSnapshot &&
    !comparator.measurementPolicy?.seedSnapshot &&
    candidateN > 0 &&
    comparatorN > 0 &&
    !(candidate.roleUsage?.unknown?.exchanges > 0) &&
    !(comparator.roleUsage?.unknown?.exchanges > 0) &&
    candidate.usageComplete === true &&
    comparator.usageComplete === true &&
    Number.isFinite(a) &&
    a >= 0 &&
    Number.isFinite(b) &&
    b > 0;
  const x = candidate.timing?.phases?.answer;
  const y = comparator.timing?.phases?.answer;
  const timed =
    sameQuestions && eligible && x?.n > 0 && y?.n > 0 && Number.isFinite(x.wallMs.p95) && Number.isFinite(y.wallMs.p95) && y.wallMs.p95 > 0;
  return {
    cost: {
      ratio: priced ? a / candidateN / (b / comparatorN) : null,
      met: Boolean(priced && a / candidateN / (b / comparatorN) <= costRatio),
      basis: "product warm-cache-adjusted input USD per question",
    },
    latency: {
      ratio: timed ? x.wallMs.p95 / y.wallMs.p95 : null,
      met: Boolean(timed && x.wallMs.p95 / y.wallMs.p95 <= latencyRatio),
      basis: "product answer p95",
    },
  };
}

/** Charge an unreported attempt at its model window/output cap; never call it recovered billing. */
export function boundedWireUsage(rows, requests) {
  const usage = sumUsage(rows);
  let input = 0,
    output = 0,
    missing = 0;
  for (const request of requests) {
    const row = rows.find((r) => (r.route ?? r.provider) === (request.route ?? request.provider) && r.exchange === request.exchange);
    const reported = Number.isFinite(row?.rawUsage?.input_tokens ?? row?.rawUsage?.prompt_tokens);
    const refused = row && row.status >= 400 && row.status < 500;
    if (reported || refused) {
      input += row.inputTokens ?? 0;
      output += row.outputTokens ?? 0;
    } else {
      input += request.inputBound;
      output += request.outputBound;
      missing++;
    }
  }
  return {
    ...usage,
    accountedInputTokens: input,
    accountedOutputTokens: output,
    usageMissingExchanges: missing,
    usageComplete: missing === 0,
    wireAttempts: requests.length,
  };
}
