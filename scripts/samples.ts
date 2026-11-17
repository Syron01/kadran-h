import { SteeringEngine } from "../src/engine.js";
import { LocalStore } from "../src/lattice/store.js";

const engine = new SteeringEngine(new LocalStore({ persist: false }));

const samples = [
  {
    domain: "coding_architecture",
    kernelConstraints: ["O(1) rate limiter", "thread-safe"],
    alpha: 0.95,
  },
  {
    domain: "music_composition",
    kernelConstraints: ["80 BPM", "warm bass", "uninterrupted flow"],
    alpha: 0.9,
  },
  {
    domain: "visual_design",
    kernelConstraints: ["high trust", "clear CTA", "readable"],
    alpha: 0.9,
  },
  {
    domain: "creative_writing",
    kernelConstraints: ["first person", "unreliable memory", "short sentences"],
    alpha: 0.85,
  },
  {
    domain: "cultural_discovery",
    kernelConstraints: ["deep loneliness", "inner observation"],
    alpha: 0.9,
  },
];

for (const sample of samples) {
  const result = engine.steer(sample);
  console.log(`${result.domainKey}: ${result.directive}`);
}
