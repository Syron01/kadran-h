import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SteeringEngine } from "../engine.js";
import { LocalStore } from "../lattice/store.js";
import { createKadranServer } from "./tools.js";

async function main(): Promise<void> {
  const store = new LocalStore();
  const engine = new SteeringEngine(store);
  const server = createKadranServer(engine);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stdout is reserved for JSON-RPC. Diagnostics go to stderr.
  console.error(`kadran-h MCP server ready | store=${store.filePath}`);
}

main().catch((error: unknown) => {
  console.error("kadran-h server failed:", error);
  process.exit(1);
});
