// ESLint is used only where Oxlint has no Astro support yet.
// TypeScript / TSX linting is handled by Oxlint (see .oxlintrc.json).
import astro from "eslint-plugin-astro";

export default [
  { ignores: ["**/dist/**", "**/.astro/**", "**/node_modules/**"] },
  ...astro.configs.recommended,
  ...astro.configs["jsx-a11y-recommended"],
  {
    files: ["**/*.astro"],
    rules: {
      "astro/no-set-html-directive": "error",
    },
  },
];
