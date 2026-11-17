import { mkdtempSync, rmSync } from "node:fs";
import { cpus } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { SteeringEngine } from "../src/engine.js";
import { LocalStore } from "../src/lattice/store.js";

const iterations = Number.parseInt(process.env.BENCH_N ?? "1000", 10);
const warmup = 100;

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function run(label: string, store: LocalStore, count: number) {
  const engine = new SteeringEngine(store);
  const times: number[] = [];
  const tokens: number[] = [];
  const anchors = new Set<string>();
  let sample = "";

  for (let index = 0; index < warmup; index += 1) {
    engine.steer({
      domain: "coding_architecture",
      kernelConstraints: ["O(1) rate limiter", "thread-safe"],
      alpha: 0.9,
    });
  }

  for (let index = 0; index < count; index += 1) {
    const started = performance.now();
    const result = engine.steer({
      domain: "coding_architecture",
      kernelConstraints: ["O(1) rate limiter", "thread-safe"],
      alpha: 0.9,
    });
    times.push(performance.now() - started);
    tokens.push(result.tokenCount);
    anchors.add(result.anchor);
    if (index === 0) sample = result.directive;
  }

  const total = times.reduce((sum, value) => sum + value, 0);
  const tokenTotal = tokens.reduce((sum, value) => sum + value, 0);

  return {
    label,
    iterations: count,
    ms: {
      mean: round(total / times.length),
      p50: round(percentile(times, 50)),
      p95: round(percentile(times, 95)),
      max: round(Math.max(...times)),
    },
    tokens: {
      min: Math.min(...tokens),
      max: Math.max(...tokens),
      mean: round(tokenTotal / tokens.length),
    },
    uniqueAnchors: anchors.size,
    sample,
  };
}

const pure = run("in-memory steering", new LocalStore({ persist: false }), iterations);

const directory = mkdtempSync(join(tmpdir(), "kadran-h-bench-"));
let fileBacked: ReturnType<typeof run> | null = null;
try {
  fileBacked = run("file-backed steering", new LocalStore({ homeDir: directory }), Math.min(200, iterations));
} finally {
  rmSync(directory, { recursive: true, force: true });
}

console.log(
  JSON.stringify(
    {
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      cpu: cpus()[0]?.model ?? "unknown",
      pure,
      fileBacked,
    },
    null,
    2,
  ),
);
