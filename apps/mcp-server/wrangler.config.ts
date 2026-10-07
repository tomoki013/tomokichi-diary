import { defineWranglerConfig } from "wrangler/experimental-config";

// The MCP App's single-file HTML (ui-dist/) is imported as text by the Worker.
export default defineWranglerConfig({
  rules: [{ type: "Text", globs: ["**/*.html"], fallthrough: true }],
});
