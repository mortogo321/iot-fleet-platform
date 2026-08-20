/** Deterministic PRNG (mulberry32) for tests; production code defaults to Math.random. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal sample via Box-Muller, driven by a [0,1) rng source. */
export function gaussian(rng: () => number, stdDev = 1, mean = 0): number {
  const u1 = Math.max(rng(), Number.EPSILON);
  const u2 = rng();
  return mean + stdDev * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
