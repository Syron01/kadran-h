import { add, dot, norm, normalize, scale, sub, zeros, type Vector } from "./vector.js";

/**
 * Modified Gram-Schmidt. Vectors that are already in the span of the current
 * basis collapse to zero and are dropped. Two re-orthogonalization passes keep
 * the basis numerically orthogonal even for nearly dependent cliché vectors.
 */
export function modifiedGramSchmidt(vectors: readonly Vector[], tolerance = 1e-9): Vector[] {
  const basis: Vector[] = [];

  for (const input of vectors) {
    let candidate: Vector = new Float64Array(input);

    for (let pass = 0; pass < 2; pass += 1) {
      for (const q of basis) {
        const projection = dot(candidate, q);
        candidate = sub(candidate, scale(q, projection));
      }
    }

    const length = norm(candidate);
    if (length > tolerance) basis.push(scale(candidate, 1 / length));
  }

  return basis;
}

/** Orthogonal projection of `v` onto the span of an orthonormal basis. */
export function projectOnto(v: Vector, basis: readonly Vector[]): Vector {
  let projection = zeros(v.length);
  for (const q of basis) projection = add(projection, scale(q, dot(v, q)));
  return projection;
}

/**
 * Quotient-space representative: v - proj_span(basis)(v).
 * Re-running the rejection twice is cheap and removes accumulated round-off.
 */
export function orthogonalRejection(v: Vector, basis: readonly Vector[]): Vector {
  let candidate: Vector = new Float64Array(v);
  for (let pass = 0; pass < 2; pass += 1) {
    for (const q of basis) {
      const projection = dot(candidate, q);
      candidate = sub(candidate, scale(q, projection));
    }
  }
  return candidate;
}

/**
 * Deterministic orthogonal escape hatch. If every supplied anchor collapses
 * into the banned/kernel subspace, walk the standard basis until one survives.
 */
export function orthogonalAxis(basis: readonly Vector[], dim = 64): Vector {
  for (let axis = 0; axis < dim; axis += 1) {
    const candidate = zeros(dim);
    candidate[axis] = 1;
    const rejected = orthogonalRejection(candidate, basis);
    if (norm(rejected) > 0.1) return normalize(rejected);
  }
  throw new Error("Could not construct an orthogonal axis");
}

export function isOrthogonal(v: Vector, basis: readonly Vector[], epsilon = 1e-8): boolean {
  return basis.every((q) => Math.abs(dot(v, q)) <= epsilon);
}
