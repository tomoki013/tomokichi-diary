import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
declare const document: { documentElement: { scrollWidth: number } };
declare const window: { innerWidth: number };

const playwrightPath = process.env.PLAYWRIGHT_MODULE ?? "playwright";
const { chromium } = await import(playwrightPath);
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE } : {},
);
const artifacts = resolve(".artifacts/media-ui");
await mkdir(artifacts, { recursive: true });
const apiBase = process.env.MEDIA_UI_API ?? "http://127.0.0.1:8787";
const uiBase = process.env.MEDIA_UI_URL ?? "http://127.0.0.1:5173";
const token = "media-preview";
const headers = { authorization: `Bearer ${token}` };
const getMedia = async () =>
  (await (await fetch(`${apiBase}/v1/admin/media`, { headers })).json()) as {
    items: { id: string; url: string; slugUrl: string | null }[];
  };
const initial = await getMedia();
assert.equal(initial.items.length, 1, "Restart the isolated media-ui-preview before each run");
const first = initial.items[0]!;
const original = Buffer.from(await (await fetch(first.url)).arrayBuffer());
const generated = await sharp({
  create: {
    width: 300,
    height: 200,
    channels: 4,
    background: { r: 220, g: 40, b: 110, alpha: 0.4 },
  },
})
  .png()
  .toBuffer();
const next = await sharp({ create: { width: 10, height: 10, channels: 3, background: "green" } })
  .png()
  .toBuffer();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors: string[] = [];
page.on("pageerror", (error: Error) => errors.push(error.message));
await page.addInitScript(
  (value: string) => localStorage.setItem("tomokichi.admin.token", value),
  token,
);
try {
  await page.goto(`${uiBase}/#/media`);
  await page.getByRole("heading", { name: "画像", exact: true }).waitFor();
  await page.locator("input[type=file]").setInputFiles([
    { name: "renamed.png", mimeType: "image/png", buffer: original },
    { name: "invalid.png", mimeType: "image/png", buffer: Buffer.from("not-an-image") },
    { name: "new-photo.png", mimeType: "image/png", buffer: generated },
  ]);
  await page.getByLabel("new-photo.pngのSlug").fill("new-photo");
  await page.getByRole("button", { name: "アップロード", exact: true }).click();
  await page.getByText("この画像はすでにアップロードされています", { exact: true }).waitFor();
  await page.getByText("保存しました", { exact: true }).waitFor();
  assert.equal(await page.locator(".upload-results li").count(), 3);
  assert.equal(await page.getByRole("button", { name: "再試行", exact: true }).count(), 1);
  assert.equal((await getMedia()).items.length, 2);
  await page.screenshot({ path: `${artifacts}/desktop-mixed.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    false,
  );
  await page.screenshot({ path: `${artifacts}/mobile-mixed.png`, fullPage: true });
  await page.getByRole("button", { name: "既存画像を使用", exact: true }).click();
  assert.equal((await getMedia()).items.length, 2);
  await page.getByRole("button", { name: "詳細・形式変換", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await dialog.getByLabel("公開画像Slug", { exact: true }).fill("renamed-photo");
  await dialog.getByRole("button", { name: "Slugを保存", exact: true }).click();
  await dialog.getByRole("link").filter({ hasText: "renamed-photo.png" }).waitFor();
  await dialog.getByLabel("最大幅（px・任意）").fill("100");
  const source = (await getMedia()).items.find((item) => item.slugUrl?.includes("renamed-photo"))!;
  for (const format of ["webp", "jpeg", "png"]) {
    await dialog.getByLabel("出力形式").selectOption(format);
    const ready = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "ダウンロード", exact: true }).click();
    const download = await ready;
    const extension = format === "jpeg" ? "jpg" : format;
    assert.equal(download.suggestedFilename(), `renamed-photo.${extension}`);
    const target = `${artifacts}/output.${extension}`;
    await download.saveAs(target);
    const metadata = await sharp(await readFile(target)).metadata();
    assert.equal(metadata.format, format);
    assert.equal(metadata.width, 100);
    assert.equal(metadata.height, 67);
    if (format === "jpeg") {
      const { data } = await sharp(target).raw().toBuffer({ resolveWithObject: true });
      assert.ok(
        data[0]! > 220 && data[1]! > 150 && data[2]! > 170,
        "JPEG transparency must be composited on white",
      );
    }
    assert.equal((await getMedia()).items.length, 2, "conversion must not upload another original");
  }
  assert.deepEqual(Buffer.from(await (await fetch(source.url)).arrayBuffer()), generated);
  await page.screenshot({ path: `${artifacts}/mobile-conversion.png`, fullPage: true });
  await dialog.getByRole("button", { name: "閉じる", exact: true }).click();

  let failOnce = true;
  await page.route(
    `${apiBase}/v1/admin/media`,
    async (route: {
      request: () => { method: () => string };
      abort: () => Promise<void>;
      continue: () => Promise<void>;
    }) => {
      if (failOnce && route.request().method() === "POST") {
        failOnce = false;
        await route.abort();
      } else await route.continue();
    },
  );
  await page
    .locator("input[type=file]")
    .setInputFiles({ name: "network.png", mimeType: "image/png", buffer: next });
  await page.getByRole("button", { name: "アップロード", exact: true }).click();
  const failed = page.locator(".upload-results li").filter({ hasText: "network.png" });
  await failed.getByRole("button", { name: "再試行", exact: true }).waitFor();
  assert.equal((await getMedia()).items.length, 2);
  await failed.getByRole("button", { name: "再試行", exact: true }).click();
  await failed.getByText("保存しました", { exact: true }).waitFor();
  assert.equal((await getMedia()).items.length, 3);
  await page.unroute(`${apiBase}/v1/admin/media`);

  const articles = (await (await fetch(`${apiBase}/v1/admin/articles`, { headers })).json()) as {
    items: { id: string }[];
  };
  await page.goto(`${uiBase}/#/articles/${articles.items[0]!.id}`);
  await page.locator("input[type=file]").waitFor({ state: "attached" });
  await page
    .locator("input[type=file]")
    .setInputFiles({ name: "reuse.png", mimeType: "image/png", buffer: original });
  await page.getByRole("button", { name: "アップロード", exact: true }).click();
  await page.getByRole("button", { name: "キャンセル", exact: true }).click();
  assert.equal(await page.locator(".media-usages li").count(), 0);
  await page
    .locator("input[type=file]")
    .setInputFiles({ name: "reuse-again.png", mimeType: "image/png", buffer: original });
  await page.getByRole("button", { name: "アップロード", exact: true }).click();
  await page.getByRole("button", { name: "既存画像を使用", exact: true }).click();
  assert.equal(await page.locator(".media-usages li").count(), 1);
  await page.getByLabel("代替テキスト", { exact: true }).fill("旅の写真");
  await page.getByRole("button", { name: "画像を保存", exact: true }).click();
  await page.getByRole("button", { name: "画像を保存", exact: true }).waitFor({ state: "visible" });
  for (let attempt = 0; attempt < 50; attempt++) {
    const stored = (await (
      await fetch(`${apiBase}/v1/admin/articles/${articles.items[0]!.id}`, { headers })
    ).json()) as { media: unknown[] };
    if (stored.media.length === 1) break;
    await page.waitForTimeout(100);
  }
  const detail = (await (
    await fetch(`${apiBase}/v1/admin/articles/${articles.items[0]!.id}`, { headers })
  ).json()) as { media: { mediaId: string }[] };
  assert.equal(detail.media.length, 1);
  await page.getByRole("button", { name: "本文に挿入", exact: true }).click();
  const inserted = await page.locator("textarea.editor__body").inputValue();
  assert.ok(inserted.includes("trip-photo.png"));
  await page.getByRole("button", { name: "外す", exact: true }).click();
  await page.getByRole("button", { name: "画像を保存", exact: true }).click();
  for (let attempt = 0; attempt < 50; attempt++) {
    const stored = (await (
      await fetch(`${apiBase}/v1/admin/articles/${articles.items[0]!.id}`, { headers })
    ).json()) as { media: unknown[] };
    if (stored.media.length === 0) break;
    await page.waitForTimeout(100);
  }
  const detached = (await (
    await fetch(`${apiBase}/v1/admin/articles/${articles.items[0]!.id}`, { headers })
  ).json()) as { media: unknown[] };
  assert.equal(detached.media.length, 0);
  assert.equal((await getMedia()).items.length, 3);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    false,
  );
  await page.screenshot({ path: `${artifacts}/mobile-editor.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: `${artifacts}/desktop-editor.png`, fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    "Media UI passed: mixed batch, duplicate use/cancel, retry, public Slug, WebP/JPEG/PNG export, original preservation, article save/insert/detach, desktop/mobile layout.",
  );
} catch (failure) {
  await page.screenshot({ path: `${artifacts}/failure.png`, fullPage: true });
  console.error(await page.locator("body").innerText());
  throw failure;
} finally {
  await browser.close();
}
