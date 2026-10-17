import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { configFromEnv, createOperatorClient } from "./client.js";
import { createOperatorServer } from "./server.js";

/**
 * Local operator MCP server. Speaks MCP over stdin/stdout only: it opens no
 * port, so nothing but the MCP client that launched it on this machine can
 * reach it. See docs/OPERATOR_MCP.md.
 */
const config = configFromEnv(process.env);
const server = createOperatorServer(createOperatorClient(config));
await server.connect(new StdioServerTransport());
// stdout is the protocol channel; diagnostics go to stderr.
console.error(
  `tomokichi-diary operator: ${config.apiUrl} (${config.allowWrites ? "read/write" : "read-only"})`,
);
