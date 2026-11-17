import { orthogonalAxis, orthogonalRejection } from "./gram_schmidt.js";
import { add, clamp, dot, norm, normalize, scale, type Vector } from "./vector.js";

export interface RotationResult {
  vector: Vector;
  theta: number;
  orbitNorm: number;
  anchorUnit: Vector;
}

/**
 * Structure-preserving geodesic rotation in the orbit space.
 *
 *   theta = alpha * PI / 2
 *   v*(alpha) = v_kernel + ||v_orbit|| * (cos(theta) * u_orbit + sin(theta) * u_anchor)
 *
 * `u_anchor` is projected so it is orthogonal to the kernel and to the orbit
 * direction. The kernel component is copied through unchanged. The orbit norm
 * is conserved for every alpha.
 */
export function geodesicRotate(
  kernel: Vector,
  orbit: Vector,
  anchor: Vector,
  alpha: number,
): RotationResult {
  const theta = clamp(alpha, 0, 1) * (Math.PI / 2);
  const orbitNorm = norm(orbit);

  if (orbitNorm < 1e-12) {
    return { vector: new Float64Array(kernel), theta, orbitNorm, anchorUnit: normalize(anchor) };
  }

  const orbitUnit = scale(orbit, 1 / orbitNorm);
  const kernelNorm = norm(kernel);
  const constraintBasis: Vector[] = [orbitUnit];
  if (kernelNorm > 1e-12) constraintBasis.push(scale(kernel, 1 / kernelNorm));

  let anchorUnit = normalize(orthogonalRejection(anchor, constraintBasis));
  if (norm(anchorUnit) < 1e-8) {
    anchorUnit = orthogonalAxis(constraintBasis, Math.max(orbit.length, 64));
  }

  // Keep the anchor direction orthogonal to the orbit direction after
  // normalization. The second rejection is cheap insurance.
  anchorUnit = normalize(orthogonalRejection(anchorUnit, [orbitUnit]));
  if (norm(anchorUnit) < 1e-8) {
    anchorUnit = orthogonalAxis([orbitUnit], Math.max(orbit.length, 64));
  }

  const rotatedOrbit = scale(
    add(scale(orbitUnit, Math.cos(theta)), scale(anchorUnit, Math.sin(theta))),
    orbitNorm,
  );

  return {
    vector: add(kernel, rotatedOrbit),
    theta,
    orbitNorm,
    anchorUnit,
  };
}

/** Dot product of the orbit component of `result` with the original kernel. */
export function kernelLeakage(result: Vector, kernel: Vector): number {
  const kernelNorm = norm(kernel);
  if (kernelNorm < 1e-12) return 0;
  return dot(orthogonalRejection(result, [scale(kernel, 1 / kernelNorm)]), scale(kernel, 1 / kernelNorm));
}
