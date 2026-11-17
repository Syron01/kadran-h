import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SteeringEngine } from "../src/engine.js";
import { LATTICE_DIM, LATTICE_VERSION, DOMAIN_PACKS, anchorCount, resolveDomain } from "../src/lattice/index.js";
import { LocalStore } from "../src/lattice/store.js";
import { geodesicRotate } from "../src/math/geodesic_so_n.js";
import { isOrthogonal, modifiedGramSchmidt, orthogonalRejection } from "../src/math/gram_schmidt.js";
import { hammingHex, simhashHex } from "../src/math/simhash.js";
import { lowDiscrepancyVector, sobolPermutation } from "../src/math/sobol.js";
import { add, dot, hashVector, norm, normalize, sub } from "../src/math/vector.js";

describe("quotient-space rejection", () => {
  it("orthonormalizes a cliché basis and rejects it to zero", () => {
    const cliches = [
      hashVector("Redis Cache"),
      hashVector("Token Bucket"),
      hashVector("LRU Map"),
      hashVector("Redux Store"),
    ];
    const basis = modifiedGramSchmidt(cliches);

    expect(basis.length).toBe(cliches.length);
    for (const q of basis) expect(Math.abs(norm(q) - 1)).toBeLessThan(1e-9);
    for (let i = 0; i < basis.length; i += 1) {
      for (let j = i + 1; j < basis.length; j += 1) {
        expect(Math.abs(dot(basis[i]!, basis[j]!))).toBeLessThan(1e-9);
      }
    }

    const rejected = orthogonalRejection(cliches[0]!, basis);
    expect(norm(rejected)).toBeLessThan(1e-8);
    for (const q of basis) expect(Math.abs(dot(rejected, q))).toBeLessThan(1e-8);
  });

  it("keeps an unrestricted component orthogonal to the cliché basis", () => {
    const cliches = [hashVector("Redis Cache"), hashVector("Token Bucket")];
    const basis = modifiedGramSchmidt(cliches);
    const intent = hashVector("zamanla soğuyan olasılıksal bellek");
    const rejected = orthogonalRejection(intent, basis);

    expect(norm(rejected)).toBeGreaterThan(0);
    expect(isOrthogonal(rejected, basis)).toBe(true);
  });
});

describe("SO(n) geodesic rotation", () => {
  it("preserves the kernel and the orbit norm", () => {
    const kernel = hashVector("kernel:thread-safe O(1) rate limiter");
    const kernelUnit = normalize(kernel);
    const orbit = orthogonalRejection(hashVector("orbit:cache"), [kernelUnit]);
    const anchor = orthogonalRejection(hashVector("anchor:immune memory"), [kernelUnit, normalize(orbit)]);

    const rotated = geodesicRotate(kernel, orbit, anchor, 1);
    const resultOrbit = orthogonalRejection(rotated.vector, [kernelUnit]);

    expect(norm(resultOrbit)).toBeCloseTo(norm(orbit), 8);
    expect(dot(rotated.vector, kernelUnit)).toBeCloseTo(dot(kernel, kernelUnit), 8);
  });

  it("returns the unrotated orbit at alpha 0", () => {
    const kernel = hashVector("kernel");
    const kernelUnit = normalize(kernel);
    const orbit = orthogonalRejection(hashVector("orbit"), [kernelUnit]);
    const anchor = orthogonalRejection(hashVector("anchor"), [kernelUnit, normalize(orbit)]);

    const rotated = geodesicRotate(kernel, orbit, anchor, 0);
    expect(norm(sub(rotated.vector, add(kernel, orbit)))).toBeLessThan(1e-8);
  });
});

describe("low-discrepancy selection", () => {
  it("produces unique permutations for the lattice sizes", () => {
    for (const length of [5, 16, 36, 180]) {
      const permutation = sobolPermutation(length);
      expect(permutation.length).toBe(length);
      expect(new Set(permutation).size).toBe(length);
      expect(Math.min(...permutation)).toBe(0);
      expect(Math.max(...permutation)).toBe(length - 1);
    }
  });

  it("returns unit-length Halton fallback vectors", () => {
    const point = lowDiscrepancyVector(17, LATTICE_DIM);
    expect(norm(point)).toBeCloseTo(1, 9);
  });
});

describe("SimHash novelty memory", () => {
  it("is deterministic, exact for identical vectors, and far for unrelated ones", () => {
    const a = hashVector("immune memory");
    const b = hashVector("gamelan polyrhythm");

    expect(simhashHex(a)).toBe(simhashHex(a));
    expect(hammingHex(simhashHex(a), simhashHex(a))).toBe(0);
    expect(hammingHex(simhashHex(a), simhashHex(b))).toBeGreaterThan(10);
  });
});

describe("lattice", () => {
  it("loads five packs with at least 36 anchors each", () => {
    expect(LATTICE_VERSION).toBe("0.1.0");
    expect(LATTICE_DIM).toBe(64);
    expect(anchorCount()).toBe(180);
    for (const pack of DOMAIN_PACKS) {
      expect(pack.anchors.length).toBeGreaterThanOrEqual(36);
      expect(pack.modeIdeals.length).toBeGreaterThanOrEqual(16);
    }
  });

  it("resolves English and Turkish aliases", () => {
    expect(resolveDomain("coding").key).toBe("coding_architecture");
    expect(resolveDomain("muzik").key).toBe("music_composition");
    expect(resolveDomain("tasarım").key).toBe("visual_design");
    expect(resolveDomain("film").key).toBe("cultural_discovery");
    expect(resolveDomain("unknown basket weaving").key).toBe("general");
  });
});

describe("steering engine", () => {
  it("returns 30 unique anchors and hashes in under 100 ms", () => {
    const engine = new SteeringEngine(new LocalStore({ persist: false }));
    const anchors = new Set<string>();
    const hashes = new Set<string>();
    const started = performance.now();

    for (let index = 0; index < 30; index += 1) {
      const result = engine.steer({
        domain: "coding_architecture",
        kernelConstraints: ["O(1) rate limiter", "thread-safe"],
        alpha: 0.9,
      });
      anchors.add(result.anchor);
      hashes.add(result.hash);
      expect(result.tokenCount).toBeLessThanOrEqual(35);
      expect(result.directive).toMatch(/^\[HQMS α=0\.90 \| KEEP:/);
    }

    const elapsed = performance.now() - started;
    expect(anchors.size).toBe(30);
    expect(hashes.size).toBe(30);
    expect(elapsed).toBeLessThan(100);
  });

  it("keeps directives under 35 tokens across all domains and dial settings", () => {
    const engine = new SteeringEngine(new LocalStore({ persist: false }));

    for (const pack of DOMAIN_PACKS) {
      for (const alpha of [0, 0.5, 0.9, 1]) {
        const result = engine.steer({
          domain: pack.key,
          kernelConstraints: ["preserve API contract", "O(1) access"],
          alpha,
        });
        expect(result.tokenCount).toBeLessThanOrEqual(35);
        expect(result.directive).toContain("ANCHOR:");
        expect(result.directive).toContain("HASH:");
      }
    }
  });

  it("persists telemetry and committed pattern tags", () => {
    const directory = mkdtempSync(join(tmpdir(), "kadran-h-test-"));
    try {
      const first = new LocalStore({ homeDir: directory });
      const engine = new SteeringEngine(first);
      const result = engine.steer({
        domain: "coding",
        kernelConstraints: ["O(1) access"],
        alpha: 0.9,
      });
      engine.commit(result.hash, ["supervision tree", "petri net"]);

      const reloaded = new LocalStore({ homeDir: directory });
      expect(reloaded.peekCounter()).toBe(1);
      expect(reloaded.telemetry().total).toBe(1);
      expect(reloaded.telemetry().far).toBe(1);
      expect(reloaded.recentPatterns(4)).toEqual(["supervision tree", "petri net"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
