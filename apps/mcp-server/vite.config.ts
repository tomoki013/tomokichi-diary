import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  root: "ui",
  plugins: [viteSingleFile()],
  build: { outDir: "../ui-dist", emptyOutDir: true, rollupOptions: { input: "ui/index.html" } },
});
