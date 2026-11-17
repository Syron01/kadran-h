import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const home = mkdtempSync(join(tmpdir(), "kadran-h-smoke-"));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/mcp/server.js"],
  env: { ...process.env, KADRAN_H_HOME: home },
});

const client = new Client({ name: "kadran-h-smoke", version: "1.0.0" });

try {
  await client.connect(transport);

  const tools = await client.listTools();
  console.log("tools:", tools.tools.map((tool) => tool.name).join(", "));

  const steer = await client.callTool({
    name: "steer_intent",
    arguments: {
      domain: "coding_architecture",
      kernel_constraints: ["O(1) rate limiter", "thread-safe"],
      alpha: 0.95,
    },
  });
  const directive = steer.content?.[0]?.text ?? "";
  console.log("directive:", directive);

  const hash = /HASH:([0-9a-f]{16})/i.exec(directive)?.[1];
  if (!hash) throw new Error("No HASH in directive");

  const commit = await client.callTool({
    name: "commit_output",
    arguments: {
      hash_id: hash,
      used_patterns: ["supervision tree", "immune memory"],
    },
  });
  console.log("commit:", commit.content?.[0]?.text ?? "");

  const telemetry = await client.callTool({ name: "diversity_telemetry", arguments: {} });
  console.log("telemetry:", telemetry.content?.[0]?.text ?? "");
} finally {
  await client.close();
  rmSync(home, { recursive: true, force: true });
}
