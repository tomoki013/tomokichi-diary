import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createOperatorServer } from "../src/operator-server.js";
import { operationCaller } from "../src/tools.js";
import { configFromEnv } from "./config.js";

/**
 * Local operator MCP server: the same tools as the remote one, built from the
 * same operation catalogue. Speaks MCP over stdin/stdout only: it opens no
 * port, so nothing but the MCP client that launched it on this machine can
 * reach it. See docs/OPERATOR_MCP.md.
 */
const config = configFromEnv(process.env);
const call = operationCaller((request) => fetch(request), config.apiUrl, {
  authorization: `Bearer ${config.token}`,
});
const server = createOperatorServer(call, config.allowWrites);
await server.connect(new StdioServerTransport());
// stdout is the protocol channel; diagnostics go to stderr.
console.error(
  `tomokichi-diary operator: ${config.apiUrl} (${config.allowWrites ? "read/write" : "read-only"})`,
);
