/**
 * Small, dependency-free vector primitives used by the KADRAN-H engine.
 *
 * The engine deliberately works in a fixed R^64 space. Concept vectors are
 * produced by a deterministic hashed bag-of-words projection, not by a remote
 * embedding model. That keeps every operation local and sub-millisecond.
 */

export type Vector = Float64Array;

export const DIM = 64;

export function zeros(dim: number = DIM): Vector {
  return new Float64Array(dim);
}

export function clone(v: Vector): Vector {
  return new Float64Array(v);
}

export function add(a: Vector, b: Vector): Vector {
  const dim = Math.min(a.length, b.length);
  const out = new Float64Array(dim);
  for (let i = 0; i < dim; i += 1) out[i] = a[i]! + b[i]!;
  return out;
}

export function sub(a: Vector, b: Vector): Vector {
  const dim = Math.min(a.length, b.length);
  const out = new Float64Array(dim);
  for (let i = 0; i < dim; i += 1) out[i] = a[i]! - b[i]!;
  return out;
}

export function scale(v: Vector, factor: number): Vector {
  const out = new Float64Array(v.length);
  for (let i = 0; i < v.length; i += 1) out[i] = v[i]! * factor;
  return out;
}

export function dot(a: Vector, b: Vector): number {
  const dim = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < dim; i += 1) sum += a[i]! * b[i]!;
  return sum;
}

export function norm(v: Vector): number {
  return Math.sqrt(dot(v, v));
}

export function normalize(v: Vector): Vector {
  const length = norm(v);
  if (length < 1e-12) return zeros(v.length);
  return scale(v, 1 / length);
}

export function cosine(a: Vector, b: Vector): number {
  const denominator = norm(a) * norm(b);
  if (denominator < 1e-12) return 0;
  return dot(a, b) / denominator;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** FNV-1a over the UTF-16 code units. Stable across V8 versions. */
export function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Deterministic 32-bit PRNG. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function foldText(input: string): string {
  return input
    .toLowerCase()
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function tokenize(input: string): string[] {
  return foldText(input)
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length > 0);
}

/** Deterministic pseudo-random unit vector for a concept label. */
export function hashVector(text: string, salt = "kadran-h"): Vector {
  const rand = mulberry32(hashString(`${salt}|${foldText(text)}`));
  const out = new Float64Array(DIM);
  for (let i = 0; i < DIM; i += 1) out[i] = rand() * 2 - 1;
  return normalize(out);
}

/**
 * Hashed bag-of-words embedding. Token vectors are summed and normalized.
 * Word order is intentionally ignored; this is a cheap local similarity space,
 * not a semantic sentence encoder.
 */
export function embed(text: string, salt = "concept"): Vector {
  const tokens = tokenize(text);
  if (tokens.length === 0) return hashVector(text, salt);

  const out = new Float64Array(DIM);
  for (const token of tokens) {
    const tokenVector = hashVector(token, salt);
    for (let i = 0; i < DIM; i += 1) out[i] = out[i]! + tokenVector[i]!;
  }
  return normalize(out);
}

export function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = foldText(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export function shorten(value: string, maxLength: number): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
