#!/usr/bin/env bun
/**
 * Paired-design power check (plan 210 Task 3.1). A development screen that compares two arms on the same questions
 * can only see a difference larger than its noise. For `n` question pairs of which a share `discordance` are answered
 * differently by the two arms, the smallest true difference in accuracy seen with the given power at the two-sided
 * level `alpha` is (normal approximation to the paired difference, the McNemar variance `(d - delta^2) / n`):
 *
 *   delta = (z(1 - alpha / 2) + z(power)) * sqrt(d / (n + (z(1 - alpha / 2) + z(power))^2))
 *
 * Offline; prints numbers only.   bun scripts/memory-bench/power.mjs --n 60 --discordance 0.1
 */
import { parseArgs } from "node:util";

/** Inverse of the standard normal CDF (Acklam's rational approximation, relative error below 1.2e-9). */
export function normalQuantile(p) {
  if (!(p > 0 && p < 1)) throw new RangeError("normalQuantile: p must be in (0, 1)");
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - low) return -normalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** The smallest difference in accuracy (a fraction) a paired design of `n` pairs can show. */
export function minDetectableDifference({ n, discordance, alpha = 0.05, power = 0.8 }) {
  if (!Number.isSafeInteger(n) || n < 2) throw new RangeError("power: n must be an integer of at least 2");
  if (!(discordance > 0 && discordance <= 1)) throw new RangeError("power: discordance is a share in (0, 1]");
  if (!(alpha > 0 && alpha < 1) || !(power > 0 && power < 1)) throw new RangeError("power: alpha and power are in (0, 1)");
  const z = normalQuantile(1 - alpha / 2) + normalQuantile(power);
  return z * Math.sqrt(discordance / (n + z * z));
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({ options: { n: { type: "string" }, discordance: { type: "string" }, alpha: { type: "string" }, power: { type: "string" } }, strict: true });
    const design = { n: Number(values.n), discordance: Number(values.discordance), ...(values.alpha ? { alpha: Number(values.alpha) } : {}), ...(values.power ? { power: Number(values.power) } : {}) };
    const delta = minDetectableDifference(design);
    console.log(JSON.stringify({ ...design, minDetectablePoints: Math.round(delta * 1000) / 10 }));
  } catch (error) {
    console.error(`${error.name}: ${error.message}`);
    process.exitCode = 1;
  }
}
