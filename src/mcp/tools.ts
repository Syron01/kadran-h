import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SteeringEngine } from "../engine.js";

const HASH_PATTERN = /^[0-9a-f]{16}$/i;

const serverInstructions = [
  "KADRAN-H breaks mode collapse before creative, architectural, musical, visual, or cultural tasks.",
  "Call steer_intent first. Treat KEEP as immutable, never use anything in BAN, and synthesize the answer through the ANCHOR lens.",
  "Deliver the result in one pass. Do not mention the tool unless the user asks.",
  "After producing the result, call commit_output with the directive HASH and 3-6 concrete pattern tags.",
].join(" ");

export function createKadranServer(engine: SteeringEngine): McpServer {
  const server = new McpServer(
    {
      name: "kadran-h",
      title: "KADRAN-H",
      version: "0.1.0",
    },
    { instructions: serverInstructions },
  );

  server.registerTool(
    "steer_intent",
    {
      title: "Steer intent",
      description:
        "Compute a local quotient-manifold steering directive (<=35 tokens) that preserves the kernel and replaces average clichés with a cross-domain anchor.",
      inputSchema: {
        domain: z
          .string()
          .min(1)
          .describe(
            "coding_architecture, music_composition, visual_design, creative_writing, cultural_discovery, or a short alias such as coding, music, design, writing, film, book.",
          ),
        kernel_constraints: z
          .array(z.string().min(1))
          .min(1)
          .max(6)
          .describe("Immutable functional requirements that must survive the steering."),
        alpha: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe("0.0 = same, 0.5 = near, 1.0 = far. Default 0.5."),
        exclude_tags: z
          .array(z.string().min(1))
          .max(12)
          .optional()
          .describe("Patterns that must be banned in addition to the domain's mode ideals."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ domain, kernel_constraints, alpha, exclude_tags }) => {
      try {
        const result = engine.steer({
          domain,
          kernelConstraints: kernel_constraints,
          ...(alpha === undefined ? {} : { alpha }),
          ...(exclude_tags === undefined ? {} : { excludeTags: exclude_tags }),
        });
        return { content: [{ type: "text", text: result.directive }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        return {
          content: [{ type: "text", text: `KADRAN-H error: ${message}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "commit_output",
    {
      title: "Commit output",
      description:
        "Record a used steering hash and concrete pattern tags in the local anti-repeat memory. Call after delivering the result.",
      inputSchema: {
        hash_id: z
          .string()
          .regex(HASH_PATTERN)
          .describe("The 16-hex HASH value from a steer_intent directive."),
        used_patterns: z
          .array(z.string().min(1))
          .max(12)
          .describe("Concrete patterns used in the result, e.g. 'supervision tree', 'gamelan polyrhythm'."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ hash_id, used_patterns }) => {
      const result = engine.commit(hash_id, used_patterns);
      if (!result.committed) {
        return {
          content: [{ type: "text", text: "KADRAN-H error: invalid hash id" }],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: "text",
            text: `committed ${result.hash} | patterns:${result.patterns}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "diversity_telemetry",
    {
      title: "Diversity telemetry",
      description:
        "Return local same/near/far counts, total steers, and a normalized entropy score for the current anti-repeat memory.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const telemetry = engine.telemetry();
      return {
        content: [{ type: "text", text: JSON.stringify(telemetry) }],
      };
    },
  );

  return server;
}
