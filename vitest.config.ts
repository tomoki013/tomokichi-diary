import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["{packages,apps,infrastructure,scripts}/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    reporters: process.env.CI_JSON ? ["json"] : ["dot"],
    passWithNoTests: true,
  },
});
