// ESLint is used only where Oxlint has no Astro support yet.
// TypeScript / TSX linting is handled by Oxlint (see .oxlintrc.json).
import astro from "eslint-plugin-astro";
import typescriptParser from "@typescript-eslint/parser";

export default [
  { ignores: ["**/dist/**", "**/.astro/**", "**/node_modules/**"] },
  ...astro.configs.recommended,
  ...astro.configs["jsx-a11y-recommended"],
  {
    files: ["**/*.astro"],
    languageOptions: {
      parserOptions: {
        // The component frontmatter is TypeScript.
        parser: typescriptParser,
        extraFileExtensions: [".astro"],
      },
    },
    rules: {
      // The only `set:html` is our own rendered Markdown, coming from the
      // committed export rather than from user input.
      "astro/no-set-html-directive": "off",
    },
  },
];
