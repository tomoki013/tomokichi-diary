import { expect, it } from "vitest";
import { marked } from "marked";
import { insertMarkdownImage } from "./markdown-image";

it("inserts an image paragraph at the cursor without losing surrounding prose", () => {
  const result = insertMarkdownImage(
    "前の文章\n後の文章",
    4,
    5,
    "https://media.example/originals/photo(1).jpg",
    "景色 [夕陽]",
  );
  expect(result.body).toContain("前の文章\n\n![");
  expect(result.body).toContain("\n\n後の文章");
  const html = marked.parse(result.body) as string;
  expect(html).toContain('alt="景色 [夕陽]"');
  expect(html).toContain('src="https://media.example/originals/photo(1).jpg"');
});

it("replaces only the selection and safely handles a multiline alt and a spaced URL", () => {
  const result = insertMarkdownImage(
    "abcSELECTxyz",
    3,
    9,
    "https://media.example/my photo.jpg",
    "one\ntwo",
  );
  expect(result.body).toBe("abc\n\n![one two](<https://media.example/my%20photo.jpg>)\n\nxyz");
  expect(result.cursor).toBe(result.body.indexOf("\n\nxyz"));
});
