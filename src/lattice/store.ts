import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { minDistanceHex } from "../math/simhash.js";
import { uniqueStrings } from "../math/vector.js";

export type AlphaBand = "same" | "near" | "far";

export interface SteerRecord {
  hash: string;
  anchor: string;
  alpha: number;
  domain: string;
}

export interface CommitResult {
  committed: boolean;
  hash: string;
  patterns: number;
}

export interface Telemetry {
  same: number;
  near: number;
  far: number;
  total: number;
  diversityScore: number;
  lastUpdated: string | null;
}

interface PendingEntry {
  alpha: number;
  anchor: string;
  domain: string;
  createdAt: string;
}

interface StoreState {
  version: 1;
  queryCounter: number;
  history: string[];
  issuedHashes: string[];
  recentAnchors: string[];
  usedPatterns: string[];
  telemetry: {
    same: number;
    near: number;
    far: number;
    lastUpdated: string | null;
  };
  pending: Record<string, PendingEntry>;
}

const HASH_PATTERN = /^[0-9a-f]{16}$/i;
const HISTORY_LIMIT = 512;
const ISSUED_LIMIT = 256;
const ANCHOR_LIMIT = 128;
const PATTERN_LIMIT = 256;
const PENDING_LIMIT = 256;
const NOVELTY_WINDOW = 128;

function defaultState(): StoreState {
  return {
    version: 1,
    queryCounter: 0,
    history: [],
    issuedHashes: [],
    recentAnchors: [],
    usedPatterns: [],
    telemetry: { same: 0, near: 0, far: 0, lastUpdated: null },
    pending: {},
  };
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && HASH_PATTERN.test(value);
}

function safeNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function mergeState(input: unknown): StoreState {
  const base = defaultState();
  if (!input || typeof input !== "object") return base;
  const parsed = input as Partial<StoreState>;

  return {
    version: 1,
    queryCounter: Math.max(0, Math.floor(safeNumber(parsed.queryCounter))),
    history: Array.isArray(parsed.history) ? parsed.history.filter(isHash).slice(-HISTORY_LIMIT) : [],
    issuedHashes: Array.isArray(parsed.issuedHashes)
      ? parsed.issuedHashes.filter(isHash).slice(-ISSUED_LIMIT)
      : [],
    recentAnchors: Array.isArray(parsed.recentAnchors)
      ? parsed.recentAnchors.filter((item): item is string => typeof item === "string").slice(-ANCHOR_LIMIT)
      : [],
    usedPatterns: Array.isArray(parsed.usedPatterns)
      ? parsed.usedPatterns.filter((item): item is string => typeof item === "string").slice(-PATTERN_LIMIT)
      : [],
    telemetry: {
      same: Math.max(0, Math.floor(safeNumber(parsed.telemetry?.same))),
      near: Math.max(0, Math.floor(safeNumber(parsed.telemetry?.near))),
      far: Math.max(0, Math.floor(safeNumber(parsed.telemetry?.far))),
      lastUpdated: typeof parsed.telemetry?.lastUpdated === "string" ? parsed.telemetry.lastUpdated : null,
    },
    pending:
      parsed.pending && typeof parsed.pending === "object" && !Array.isArray(parsed.pending)
        ? parsed.pending
        : {},
  };
}

function pushCapped<T>(values: T[], value: T, limit: number): void {
  values.push(value);
  if (values.length > limit) values.splice(0, values.length - limit);
}

export function alphaBand(alpha: number): AlphaBand {
  if (alpha < 1 / 3) return "same";
  if (alpha < 2 / 3) return "near";
  return "far";
}

export interface LocalStoreOptions {
  homeDir?: string;
  persist?: boolean;
}

export class LocalStore {
  readonly filePath: string;
  private readonly persist: boolean;
  private state: StoreState;

  constructor(options: LocalStoreOptions = {}) {
    const homeDir =
      options.homeDir ?? process.env.KADRAN_H_HOME ?? join(homedir(), ".kadran-h");
    this.filePath = join(homeDir, "history.json");
    this.persist = options.persist ?? true;
    this.state = this.load();
  }

  private load(): StoreState {
    if (!this.persist || !existsSync(this.filePath)) return defaultState();
    try {
      return mergeState(JSON.parse(readFileSync(this.filePath, "utf8")));
    } catch {
      // A corrupt local cache should never take the steering engine down.
      return defaultState();
    }
  }

  private save(): void {
    if (!this.persist) return;
    const serialized = JSON.stringify(this.state, null, 2);
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.${process.pid}.tmp`;
      writeFileSync(temporary, serialized, "utf8");
      renameSync(temporary, this.filePath);
    } catch {
      try {
        writeFileSync(this.filePath, serialized, "utf8");
      } catch {
        // Read-only home directories still get in-memory steering.
      }
    }
  }

  peekCounter(): number {
    return this.state.queryCounter;
  }

  recordSteer(record: SteerRecord): void {
    this.state.queryCounter += 1;
    pushCapped(this.state.issuedHashes, record.hash, ISSUED_LIMIT);
    pushCapped(this.state.recentAnchors, record.anchor, ANCHOR_LIMIT);

    const band = alphaBand(record.alpha);
    this.state.telemetry[band] += 1;
    this.state.telemetry.lastUpdated = new Date().toISOString();

    this.state.pending[record.hash] = {
      alpha: record.alpha,
      anchor: record.anchor,
      domain: record.domain,
      createdAt: new Date().toISOString(),
    };

    const pendingKeys = Object.keys(this.state.pending);
    for (const key of pendingKeys.slice(0, Math.max(0, pendingKeys.length - PENDING_LIMIT))) {
      delete this.state.pending[key];
    }

    this.save();
  }

  commit(hashId: string, usedPatterns: readonly string[]): CommitResult {
    const hash = hashId.trim().toLowerCase();
    if (!HASH_PATTERN.test(hash)) {
      return { committed: false, hash, patterns: 0 };
    }

    if (!this.state.history.includes(hash)) {
      pushCapped(this.state.history, hash, HISTORY_LIMIT);
    }

    const patterns = uniqueStrings(usedPatterns).slice(0, 12);
    for (const pattern of patterns) pushCapped(this.state.usedPatterns, pattern, PATTERN_LIMIT);

    delete this.state.pending[hash];
    this.save();
    return { committed: true, hash, patterns: patterns.length };
  }

  hasRecentAnchor(anchor: string): boolean {
    return this.state.recentAnchors.includes(anchor);
  }

  isHashUsed(hash: string): boolean {
    return (
      this.state.issuedHashes.includes(hash) ||
      this.state.history.includes(hash) ||
      hash in this.state.pending
    );
  }

  noveltyDistance(hash: string): number {
    const window = [
      ...this.state.history.slice(-NOVELTY_WINDOW),
      ...this.state.issuedHashes.slice(-NOVELTY_WINDOW),
    ];
    return minDistanceHex(hash, window);
  }

  historyCount(): number {
    return this.state.history.length;
  }

  recentPatterns(count = 8): string[] {
    return this.state.usedPatterns.slice(-count);
  }

  telemetry(): Telemetry {
    const { same, near, far, lastUpdated } = this.state.telemetry;
    const total = same + near + far;
    let score = 0;

    if (total > 0) {
      const probabilities = [same, near, far]
        .filter((value) => value > 0)
        .map((value) => value / total);
      const entropy = -probabilities.reduce((sum, p) => sum + p * Math.log2(p), 0);
      score = entropy / Math.log2(3);
    }

    return {
      same,
      near,
      far,
      total,
      diversityScore: Math.round(score * 1000) / 1000,
      lastUpdated,
    };
  }

  reset(): void {
    this.state = defaultState();
    this.save();
  }
}
