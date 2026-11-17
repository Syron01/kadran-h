import { performance } from "node:perf_hooks";
import { orthogonalAxis, orthogonalRejection, modifiedGramSchmidt } from "./math/gram_schmidt.js";
import { geodesicRotate } from "./math/geodesic_so_n.js";
import { simhashHex } from "./math/simhash.js";
import { lowDiscrepancyVector, sobolPermutation } from "./math/sobol.js";
import {
  add,
  clamp,
  DIM,
  embed,
  foldText,
  normalize,
  norm,
  scale,
  shorten,
  uniqueStrings,
  zeros,
  type Vector,
} from "./math/vector.js";
import { allDomains, resolveDomain, type DomainPack } from "./lattice/index.js";
import { LocalStore, type Telemetry } from "./lattice/store.js";

export interface SteerInput {
  domain: string;
  kernelConstraints: string[];
  alpha?: number;
  excludeTags?: string[];
}

export interface SteerResult {
  directive: string;
  domainKey: string;
  domainLabel: string;
  alpha: number;
  kernel: string[];
  banned: string[];
  primaryAnchor: string;
  secondaryAnchor: string;
  anchor: string;
  hash: string;
  tokenCount: number;
  elapsedMs: number;
  counter: number;
  vector: Vector;
}

interface Candidate {
  primary: string;
  secondary: string;
  anchor: string;
  hash: string;
  vector: Vector;
  noveltyDistance: number;
}

const NOVELTY_BITS = 6;
const MAX_KERNEL_TERMS = 6;
const MAX_EXCLUDES = 12;

export function countTokens(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

function matchesExcluded(label: string, exclude: readonly string[]): boolean {
  if (exclude.length === 0) return false;
  const foldedLabel = foldText(label);
  return exclude.some((tag) => {
    const foldedTag = foldText(tag);
    return foldedTag.length > 0 && foldedLabel.includes(foldedTag);
  });
}

interface DirectiveParts {
  alpha: number;
  kernel: readonly string[];
  banned: readonly string[];
  primary: string;
  secondary: string;
  hash: string;
}

/**
 * The only text the model sees. Six progressively tighter layouts guarantee
 * the directive stays at or below 35 whitespace-delimited tokens.
 */
export function buildDirective(parts: DirectiveParts): string {
  const layouts = [
    { kernelCount: 3, kernelLength: 36, banCount: 3, banLength: 30, primary: 36, secondary: 36 },
    { kernelCount: 3, kernelLength: 28, banCount: 3, banLength: 24, primary: 28, secondary: 28 },
    { kernelCount: 2, kernelLength: 24, banCount: 2, banLength: 20, primary: 24, secondary: 24 },
    { kernelCount: 2, kernelLength: 20, banCount: 2, banLength: 16, primary: 18, secondary: 18 },
    { kernelCount: 1, kernelLength: 14, banCount: 2, banLength: 12, primary: 14, secondary: 12 },
    { kernelCount: 1, kernelLength: 10, banCount: 1, banLength: 10, primary: 12, secondary: 10 },
    { kernelCount: 0, kernelLength: 0, banCount: 1, banLength: 8, primary: 10, secondary: 0 },
  ];

  for (const layout of layouts) {
    const kernel =
      layout.kernelCount === 0
        ? "none"
        : parts.kernel
            .slice(0, layout.kernelCount)
            .map((value) => shorten(value, layout.kernelLength))
            .join(",") || "none";
    const banned =
      parts.banned
        .slice(0, layout.banCount)
        .map((value) => shorten(value, layout.banLength))
        .join(",") || "none";
    const primary = shorten(parts.primary, layout.primary);
    const anchor =
      layout.secondary === 0
        ? primary
        : `${primary} × ${shorten(parts.secondary, layout.secondary)}`;
    const directive = `[HQMS α=${parts.alpha.toFixed(2)} | KEEP:${kernel} | BAN:${banned} | ANCHOR:${anchor} | HASH:${parts.hash}]`;

    if (countTokens(directive) <= 35) return directive;
  }

  return `[HQMS α=${parts.alpha.toFixed(2)} | KEEP:none | BAN:none | ANCHOR:${shorten(parts.primary, 8)} | HASH:${parts.hash}]`;
}

export class SteeringEngine {
  constructor(private readonly store: LocalStore) {}

  steer(input: SteerInput): SteerResult {
    const started = performance.now();
    const domain = resolveDomain(input.domain);
    const rawAlpha =
      typeof input.alpha === "number" && Number.isFinite(input.alpha) ? input.alpha : 0.5;
    const alpha = clamp(rawAlpha, 0, 1);
    const kernel = uniqueStrings(input.kernelConstraints ?? []).slice(0, MAX_KERNEL_TERMS);
    const exclude = uniqueStrings(input.excludeTags ?? []).slice(0, MAX_EXCLUDES);
    const counter = this.store.peekCounter();

    const kernelVector = kernel.length > 0 ? embed(kernel.join(" "), `kernel:${domain.key}`) : zeros();
    const kernelUnit = norm(kernelVector) > 1e-9 ? normalize(kernelVector) : null;

    const intent = embed(`${domain.label} ${kernel.join(" ")}`, "intent");
    const clicheTerms = uniqueStrings([
      ...exclude,
      ...this.store.recentPatterns(12),
      ...domain.modeIdeals,
    ]);
    const clicheVectors = clicheTerms.map((term) => embed(term, `cliche:${domain.key}`));
    const basisInput: Vector[] = kernelUnit ? [kernelUnit, ...clicheVectors] : clicheVectors;
    const basis = modifiedGramSchmidt(basisInput);

    let orbit = orthogonalRejection(intent, basis);
    if (norm(orbit) < 1e-7) {
      orbit = orthogonalRejection(lowDiscrepancyVector(counter + 1, DIM), basis);
    }
    if (norm(orbit) < 1e-7) orbit = orthogonalAxis(basis, DIM);

    const orbitUnit = normalize(orbit);
    const anchorBasis = [orbitUnit, ...basis];
    const banned = uniqueStrings([
      ...exclude,
      ...this.store.recentPatterns(6),
      ...domain.modeIdeals,
    ]).slice(0, 3);

    const otherDomains = allDomains().filter((pack) => pack.key !== domain.key);
    const primaryPermutation = sobolPermutation(domain.anchors.length, 0);
    const maxAttempts = Math.min(256, Math.max(64, domain.anchors.length * 8));
    let best: Candidate | null = null;

    const buildCandidate = (primary: string, secondary: string): Candidate | null => {
      if (primary === secondary) return null;
      if (matchesExcluded(primary, exclude) || matchesExcluded(secondary, exclude)) return null;

      const anchor = `${primary} × ${secondary}`;
      if (this.store.hasRecentAnchor(anchor)) return null;

      const anchorVector = normalize(
        add(
          embed(primary, "anchor:primary"),
          scale(embed(secondary, "anchor:secondary"), 0.72),
        ),
      );
      const anchorOrthogonal = orthogonalRejection(anchorVector, anchorBasis);
      if (norm(anchorOrthogonal) < 0.08) return null;

      const rotated = geodesicRotate(kernelVector, orbit, anchorOrthogonal, alpha);
      const hash = simhashHex(rotated.vector);
      if (this.store.isHashUsed(hash)) return null;

      return {
        primary,
        secondary,
        anchor,
        hash,
        vector: rotated.vector,
        noveltyDistance: this.store.noveltyDistance(hash),
      };
    };

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const primaryIndex = primaryPermutation[(counter + attempt) % primaryPermutation.length] ?? 0;
      const primary = domain.anchors[primaryIndex];
      if (!primary) continue;

      const secondaryDomain: DomainPack =
        otherDomains.length > 0
          ? (otherDomains[(counter + attempt) % otherDomains.length] as DomainPack)
          : domain;
      const secondaryPermutation = sobolPermutation(secondaryDomain.anchors.length, 1);
      const secondaryIndex =
        secondaryPermutation[(counter + attempt * 3 + 1) % secondaryPermutation.length] ?? 0;
      const secondary = secondaryDomain.anchors[secondaryIndex];
      if (!secondary) continue;

      const candidate = buildCandidate(primary, secondary);
      if (!candidate) continue;

      if (!best || candidate.noveltyDistance > best.noveltyDistance) best = candidate;
      if (candidate.noveltyDistance >= NOVELTY_BITS) break;
    }

    // Last-resort path: the user excluded or recently consumed every anchor in
    // the domain. Reuse a real concept pair; the 64-bit hash still keeps the
    // concrete steering target distinct.
    if (!best) {
      const primary = domain.anchors[primaryPermutation[counter % primaryPermutation.length] ?? 0];
      const secondaryDomain = otherDomains[0] ?? domain;
      const secondaryPermutation = sobolPermutation(secondaryDomain.anchors.length, 2);
      const secondary =
        secondaryDomain.anchors[secondaryPermutation[counter % secondaryPermutation.length] ?? 0];
      if (!primary || !secondary) {
        throw new Error(`No usable anchors for domain "${input.domain}"`);
      }

      const anchorVector = normalize(embed(`${primary} ${secondary}`, "anchor:fallback"));
      const rotated = geodesicRotate(kernelVector, orbit, anchorVector, alpha);
      const hash = simhashHex(rotated.vector);
      best = {
        primary,
        secondary,
        anchor: `${primary} × ${secondary}`,
        hash,
        vector: rotated.vector,
        noveltyDistance: this.store.noveltyDistance(hash),
      };
    }

    const directive = buildDirective({
      alpha,
      kernel,
      banned,
      primary: best.primary,
      secondary: best.secondary,
      hash: best.hash,
    });

    this.store.recordSteer({
      hash: best.hash,
      anchor: best.anchor,
      alpha,
      domain: domain.key,
    });

    return {
      directive,
      domainKey: domain.key,
      domainLabel: domain.label,
      alpha,
      kernel,
      banned,
      primaryAnchor: best.primary,
      secondaryAnchor: best.secondary,
      anchor: best.anchor,
      hash: best.hash,
      tokenCount: countTokens(directive),
      elapsedMs: Math.round((performance.now() - started) * 1000) / 1000,
      counter,
      vector: best.vector,
    };
  }

  commit(hashId: string, usedPatterns: readonly string[]) {
    return this.store.commit(hashId, usedPatterns);
  }

  telemetry(): Telemetry {
    return this.store.telemetry();
  }
}
