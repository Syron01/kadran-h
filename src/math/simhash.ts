import { DIM, dot, mulberry32, type Vector } from "./vector.js";

/**
 * 64-bit SimHash with a fixed Rademacher projection matrix.
 *
 * The projection matrix is generated once from a fixed seed. `project` returns
 * a 64-bit signature; similarity is the Hamming distance between signatures.
 * This is a local, privacy-preserving sketch: no raw history leaves the machine.
 */

const HASH_BITS = 64;
const PROJECTION_SEED = 0x4b414452; // "KADR"

const PROJECTION = new Int8Array(HASH_BITS * DIM);
{
  const rand = mulberry32(PROJECTION_SEED);
  for (let i = 0; i < PROJECTION.length; i += 1) {
    PROJECTION[i] = rand() < 0.5 ? -1 : 1;
  }
}

export function project(v: Vector): bigint {
  let signature = 0n;

  for (let bit = 0; bit < HASH_BITS; bit += 1) {
    let sum = 0;
    const offset = bit * DIM;
    for (let axis = 0; axis < DIM; axis += 1) {
      sum += PROJECTION[offset + axis]! * (v[axis] ?? 0);
    }
    if (sum >= 0) signature |= 1n << BigInt(bit);
  }

  return signature;
}

export function simhashHex(v: Vector): string {
  return project(v).toString(16).padStart(16, "0");
}

export function popcount64(value: bigint): number {
  let current = value & 0xffffffffffffffffn;
  let count = 0;
  while (current > 0n) {
    current &= current - 1n;
    count += 1;
  }
  return count;
}

export function hammingDistance(a: bigint, b: bigint): number {
  return popcount64(a ^ b);
}

export function hammingHex(a: string, b: string): number {
  return hammingDistance(BigInt(`0x${a}`), BigInt(`0x${b}`));
}

export function minDistanceHex(hash: string, history: readonly string[]): number {
  if (history.length === 0) return HASH_BITS;
  let minimum = HASH_BITS;
  const candidate = BigInt(`0x${hash}`);

  for (const other of history) {
    const distance = hammingDistance(candidate, BigInt(`0x${other}`));
    if (distance < minimum) minimum = distance;
    if (minimum === 0) break;
  }

  return minimum;
}

export function isNovel(hash: string, history: readonly string[], minimumBits = 6): boolean {
  return minDistanceHex(hash, history) >= minimumBits;
}
