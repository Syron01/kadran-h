import rawLattice from "./domains.json" with { type: "json" };
import { foldText, uniqueStrings } from "../math/vector.js";

interface RawDomain {
  label: string;
  modeIdeals: string[];
  anchors: string[];
}

interface RawLattice {
  version: string;
  dim: number;
  aliases: Record<string, string>;
  domains: Record<string, RawDomain>;
}

export interface DomainPack {
  key: string;
  label: string;
  modeIdeals: string[];
  anchors: string[];
  isFallback: boolean;
}

const lattice = rawLattice as RawLattice;

function normalizeKey(input: string): string {
  return foldText(input)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const aliasMap = new Map<string, string>();
for (const [alias, target] of Object.entries(lattice.aliases)) {
  aliasMap.set(normalizeKey(alias), target);
}

export const LATTICE_VERSION = lattice.version;
export const LATTICE_DIM = lattice.dim;

export const DOMAIN_PACKS: readonly DomainPack[] = Object.entries(lattice.domains).map(
  ([key, domain]) => ({
    key,
    label: domain.label,
    modeIdeals: [...domain.modeIdeals],
    anchors: [...domain.anchors],
    isFallback: false,
  }),
);

const generalPack: DomainPack = {
  key: "general",
  label: "General Cross-Domain",
  modeIdeals: uniqueStrings(DOMAIN_PACKS.flatMap((domain) => domain.modeIdeals)),
  anchors: uniqueStrings(DOMAIN_PACKS.flatMap((domain) => domain.anchors)),
  isFallback: true,
};

export const DOMAIN_KEYS = DOMAIN_PACKS.map((domain) => domain.key);

export function allDomains(): readonly DomainPack[] {
  return DOMAIN_PACKS;
}

export function resolveDomain(input: string): DomainPack {
  const key = normalizeKey(input);
  const direct = DOMAIN_PACKS.find((domain) => domain.key === key);
  if (direct) return direct;

  const aliasTarget = aliasMap.get(key);
  if (aliasTarget) {
    const aliased = DOMAIN_PACKS.find((domain) => domain.key === aliasTarget);
    if (aliased) return aliased;
  }

  // Tolerate partial names such as "coding" or "film/book" without inventing a
  // domain-specific pack. The general fallback keeps the tool usable.
  const partial = DOMAIN_PACKS.find(
    (domain) => domain.key.includes(key) || key.includes(domain.key),
  );
  if (partial && key.length >= 3) return partial;

  return generalPack;
}

export function anchorCount(): number {
  return DOMAIN_PACKS.reduce((total, domain) => total + domain.anchors.length, 0);
}
