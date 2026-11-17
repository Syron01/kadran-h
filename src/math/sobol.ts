import { normalize, type Vector } from "./vector.js";

/**
 * Low-discrepancy sequences.
 *
 * - `sobol1` is the first dimension of the Sobol sequence (van der Corput in
 *   base 2). It is used to rank anchor lists into a low-discrepancy permutation.
 * - `halton` supplies the multi-dimensional points used by the fallback anchor
 *   generator when the concept lattice anchor collapses into a banned subspace.
 *
 * Both are deterministic and stateless; callers pass a monotonically increasing
 * local query counter.
 */

export function halton(index: number, base: number): number {
  let result = 0;
  let fraction = 1 / base;
  let current = Math.max(0, Math.floor(index));

  while (current > 0) {
    result += fraction * (current % base);
    current = Math.floor(current / base);
    fraction /= base;
  }

  return result;
}

export function sobol1(index: number): number {
  let result = 0;
  let fraction = 0.5;
  let current = Math.max(0, Math.floor(index));

  while (current > 0) {
    if (current & 1) result += fraction;
    current >>>= 1;
    fraction *= 0.5;
  }

  return result;
}

function rankPermutation(length: number, valueAt: (index: number) => number): number[] {
  return Array.from({ length }, (_, index) => ({ index, value: valueAt(index) }))
    .sort((a, b) => a.value - b.value || a.index - b.index)
    .map((entry) => entry.index);
}

const permutationCache = new Map<string, number[]>();

/** A permutation of 0..length-1 ordered by the Sobol sequence. */
export function sobolPermutation(length: number, offset = 0): number[] {
  const key = `s:${length}:${offset}`;
  const cached = permutationCache.get(key);
  if (cached) return cached;

  const permutation = rankPermutation(length, (index) => sobol1(index + offset));
  permutationCache.set(key, permutation);
  return permutation;
}

/** A permutation of 0..length-1 ordered by a Halton sequence in `base`. */
export function haltonPermutation(length: number, base = 3, offset = 0): number[] {
  const key = `h:${length}:${base}:${offset}`;
  const cached = permutationCache.get(key);
  if (cached) return cached;

  const permutation = rankPermutation(length, (index) => halton(index + offset + 1, base));
  permutationCache.set(key, permutation);
  return permutation;
}

const FIRST_PRIMES = [
  2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53,
  59, 61, 67, 71, 73, 79, 83, 89, 97, 101, 103, 107, 109, 113, 127, 131,
  137, 139, 149, 151, 157, 163, 167, 173, 179, 181, 191, 193, 197, 199, 211, 223,
  227, 229, 233, 239, 241, 251, 257, 263, 269, 271, 277, 281, 283, 293, 307, 311,
] as const;

/**
 * A deterministic Halton point in R^dim, mapped to [-1, 1] and normalized.
 * Used only as a fallback exploration vector, never as the primary anchor.
 */
export function lowDiscrepancyVector(index: number, dim = 64): Vector {
  const point = new Float64Array(dim);
  const safeIndex = Math.max(1, Math.floor(index));
  for (let axis = 0; axis < dim; axis += 1) {
    const prime = FIRST_PRIMES[axis % FIRST_PRIMES.length]!;
    point[axis] = halton(safeIndex, prime) * 2 - 1;
  }
  return normalize(point);
}
