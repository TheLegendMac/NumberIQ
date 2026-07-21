/** Combinatorics and statistical helpers. No dependencies. */

/** n choose k, exact for the ranges lottery matrices use. */
export function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  const kk = Math.min(k, n - k);
  let r = 1;
  for (let i = 0; i < kk; i++) r = (r * (n - i)) / (i + 1);
  return Math.round(r);
}

/** Total distinct combinations for a `choose pick from min..max` game (+ extra ball pool). */
export function totalCombinations(poolSize: number, pick: number, extraPool = 1): number {
  return choose(poolSize, pick) * extraPool;
}

/**
 * Number of ways to match exactly `m` of the drawn `pick` numbers from a pool of `poolSize`.
 * Ways = C(pick, m) * C(poolSize - pick, pick - m)
 */
export function waysToMatch(poolSize: number, pick: number, m: number): number {
  return choose(pick, m) * choose(poolSize - pick, pick - m);
}

export function sum(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

export function mean(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : sum(xs) / xs.length;
}

export function variance(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1);
}

export function stdev(xs: readonly number[]): number {
  return Math.sqrt(variance(xs));
}

export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? a;
  return a + (b - a) * (pos - lo);
}

/**
 * Regularised lower incomplete gamma P(s, x), via series / continued fraction.
 * Used for the chi-square survival function in the randomness audit.
 */
function lnGamma(z: number): number {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  z -= 1;
  let x = 0.99999999999980993;
  for (let i = 0; i < g.length; i++) x += g[i]! / (z + i + 1);
  const t = z + g.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function lowerGammaP(s: number, x: number): number {
  if (x <= 0) return 0;
  if (x < s + 1) {
    // Series expansion
    let ap = s;
    let del = 1 / s;
    let acc = del;
    for (let i = 0; i < 500; i++) {
      ap += 1;
      del *= x / ap;
      acc += del;
      if (Math.abs(del) < Math.abs(acc) * 1e-14) break;
    }
    return acc * Math.exp(-x + s * Math.log(x) - lnGamma(s));
  }
  // Continued fraction for Q, then complement
  let b = x + 1 - s;
  let c = 1e300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 500; i++) {
    const an = -i * (i - s);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  const q = Math.exp(-x + s * Math.log(x) - lnGamma(s)) * h;
  return 1 - q;
}

/** P(X >= chi2) for a chi-square distribution with `df` degrees of freedom. */
export function chiSquarePValue(chi2: number, df: number): number {
  if (df <= 0) return 1;
  if (chi2 <= 0) return 1;
  return 1 - lowerGammaP(df / 2, chi2 / 2);
}

/** Two-tailed p-value for a standard normal z score. */
export function normalTwoTailP(z: number): number {
  return 2 * (1 - normalCdf(Math.abs(z)));
}

export function normalCdf(z: number): number {
  // Abramowitz & Stegun 7.1.26 based erf approximation
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-0.5 * z * z);
  const p =
    d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

/** Deterministic PRNG (mulberry32) so generation and backtests are reproducible. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sample `k` distinct integers from `pool` without replacement, weighted. */
export function weightedSampleDistinct(
  pool: readonly number[],
  weights: readonly number[],
  k: number,
  rng: () => number,
): number[] {
  const items = pool.map((v, i) => ({ v, w: Math.max(weights[i] ?? 0, 1e-9) }));
  const out: number[] = [];
  for (let n = 0; n < k && items.length > 0; n++) {
    const total = items.reduce((s, it) => s + it.w, 0);
    let r = rng() * total;
    let idx = items.length - 1;
    for (let i = 0; i < items.length; i++) {
      r -= items[i]!.w;
      if (r <= 0) { idx = i; break; }
    }
    out.push(items[idx]!.v);
    items.splice(idx, 1);
  }
  return out;
}

/** Percentile rank of `value` within `dist` (0-1). */
export function percentileRank(dist: readonly number[], value: number): number {
  if (dist.length === 0) return 0.5;
  let below = 0;
  for (const d of dist) if (d < value) below++;
  return below / dist.length;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
