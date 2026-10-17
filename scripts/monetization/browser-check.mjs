/* oxlint-disable eslint/no-shadow -- Browser evaluate callbacks are serialized into a separate JavaScript realm. */
/** Requires the isolated web build and browser-server.ts. All ads/analytics are intercepted. */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const puppeteer = createRequire(require.resolve("@lhci/cli/package.json"))("puppeteer-core");
const browser = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--no-sandbox"],
});
const output = ".artifacts/monetization";
mkdirSync(output, { recursive: true });
const findings = [];
async function textButton(page, text) {
  await page.evaluate((text) => {
    const element = [...document.querySelectorAll("button,a,summary")].find(
      (e) => e.textContent.trim() === text,
    );
    if (!element) throw new Error(`missing control ${text}`);
    element.click();
  }, text);
}
async function field(page, label, value) {
  await page.evaluate(
    (label, value) => {
      const wrapper = [...document.querySelectorAll("label")].find(
        (e) => e.querySelector("span")?.textContent.trim() === label,
      );
      const element = wrapper?.querySelector("input,textarea,select");
      if (!element) throw new Error(`missing field ${label}`);
      const prototype =
        element instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : element instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
      element.dispatchEvent(
        new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
      );
    },
    label,
    value,
  );
}
try {
  if (!process.argv.includes("--public-only")) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("dialog", (d) => d.accept());
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto("http://127.0.0.1:4178/#/monetization", { waitUntil: "networkidle0" });
    await page.waitForFunction(() =>
      document.body.textContent.includes("アフィリエイト配置予定数"),
    );
    assert.ok((await page.locator("body").waitHandle()).asElement());
    await page.screenshot({ path: `${output}/admin-overview-desktop.png`, fullPage: true });
    await textButton(page, "アフィリエイト案件");
    await textButton(page, "案件を新規作成");
    await field(page, "案件名", "ブラウザ検証用案件");
    await field(page, "見出し", "使ったサービスの予約情報");
    await field(page, "説明文", "管理画面だけの紹介カードです。");
    await textButton(page, "案件を保存");
    await page.waitForFunction(() => document.body.textContent.includes("案件を保存しました"));
    const offer = await page.evaluate(async () => {
      const d = await (await fetch("/api/v1/admin/monetization")).json();
      return d.offers[0];
    });
    assert.ok(offer.id !== "new");
    assert.equal(offer.name, "ブラウザ検証用案件");
    await page.screenshot({ path: `${output}/admin-offer-desktop.png`, fullPage: true });
    await page.goto("http://127.0.0.1:4178/#/articles/52b1cb6d-eb74-85a3-b6a1-392f83313051", {
      waitUntil: "networkidle0",
    });
    await page.waitForFunction(() => document.body.textContent.includes("収益化スロットを挿入"));
    await textButton(page, "収益化スロットを挿入");
    const choices = await page.$$(".monetization-picker button");
    await choices[2].focus();
    await page.keyboard.press("Enter");
    // A body edit invalidates the old byte offset before a marker can split another block.
    await page.evaluate(() => {
      const textarea = document.querySelector(".editor__body");
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(
        textarea,
        textarea.value + "\n\n確認用の追記。",
      );
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("button")].find(
          (b) => b.textContent.trim() === "広告配置を追加",
        )?.disabled,
    );
    const freshChoices = await page.$$(".monetization-picker button");
    await freshChoices[2].focus();
    await page.keyboard.press("Enter");
    await textButton(page, "広告配置を追加");
    const marker = await page.evaluate(
      () => document.querySelector(".editor__body").value.match(/\{\{monetization:([^}]+)\}\}/)[1],
    );
    assert.ok(marker.startsWith("slot-"));
    await field(page, "案件", offer.id);
    await textButton(page, "収益化設定を保存");
    await page.waitForFunction(
      async (marker) => {
        const d = await (
          await fetch("/api/v1/admin/monetization/articles/52b1cb6d-eb74-85a3-b6a1-392f83313051")
        ).json();
        return d.draft.placements.some((p) => p.key === marker && p.offerId);
      },
      {},
      marker,
    );
    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForFunction(() => document.body.textContent.includes("収益化スロットを挿入"));
    assert.ok(
      await page.evaluate(
        (marker) => document.querySelector(".editor__body").value.includes(marker),
        marker,
      ),
    );
    await page.setViewport({ width: 390, height: 844 });
    await page.screenshot({ path: `${output}/admin-editor-mobile.png`, fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    // Prepare flags via the same authenticated API, then use the actual controls to start and stop.
    await page.evaluate(async () => {
      const d = await (await fetch("/api/v1/admin/monetization")).json();
      await fetch("/api/v1/admin/monetization/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...d.settings, placementsEnabled: true, experimentsEnabled: true }),
      });
    });
    await page.goto("http://127.0.0.1:4178/#/monetization", { waitUntil: "networkidle0" });
    await textButton(page, "配置テスト");
    await field(page, "Bの本文配置キー", marker);
    await textButton(page, "実験の下書きを保存");
    await page.waitForFunction(() => document.body.textContent.includes("実験を保存しました"));
    await page.evaluate(async () => {
      const d = await (
        await fetch("/api/v1/admin/monetization/articles/52b1cb6d-eb74-85a3-b6a1-392f83313051")
      ).json();
      const r = await fetch(
        "/api/v1/admin/monetization/articles/52b1cb6d-eb74-85a3-b6a1-392f83313051",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...d.draft, experimentId: "chagee-placement-v1" }),
        },
      );
      if (!r.ok) throw new Error(await r.text());
    });
    await textButton(page, "開始を予約");
    await page.waitForFunction(() => document.body.textContent.includes("現在: running"));
    await textButton(page, "停止を予約");
    await page.waitForFunction(() => document.body.textContent.includes("現在: stopped"));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `${output}/admin-experiment-mobile.png`, fullPage: true });
    assert.deepEqual(errors, []);
    findings.push({
      test: "admin",
      result: "passed",
      offerCreated: true,
      markerPersisted: true,
      assignmentPersisted: true,
      startStop: true,
      mobileOverflow: false,
    });
    await page.close();
  }
  for (const width of [1440, 390, 320])
    for (const variant of ["A", "B"])
      for (const mode of ["filled", "consent-pending", "adblock"]) {
        const p = await browser.newPage();
        await p.setViewport({ width, height: 900 });
        await p.setBypassServiceWorker(true);
        await p.setCacheEnabled(false);
        const pageErrors = [];
        p.on("pageerror", (e) => pageErrors.push(String(e)));
        await p.evaluateOnNewDocument((variant) => {
          Math.random = () => (variant === "B" ? 0.1 : 0.9);
          window.monetizationMeasurements = [];
          window.monetizationShifts = [];
          window.monetizationAdPushes = 0;
          addEventListener("tomokichi:analytics", (e) =>
            window.monetizationMeasurements.push(e.detail),
          );
          new PerformanceObserver((list) =>
            window.monetizationShifts.push(
              ...list
                .getEntries()
                .filter((e) => !e.hadRecentInput)
                .map((e) => e.value),
            ),
          ).observe({ type: "layout-shift", buffered: true });
        }, variant);
        await p.setRequestInterception(true);
        let loaderRequests = 0;
        p.on("request", async (request) => {
          const u = new URL(request.url());
          if (u.hostname === "tomokichidiary.com" && u.pathname === "/sw.js") {
            await request.respond({ status: 200, contentType: "text/javascript", body: "" });
          } else if (u.hostname === "tomokichidiary.com") {
            const response = await fetch(`http://127.0.0.1:4178/web${u.pathname}${u.search}`);
            await request.respond({
              status: response.status,
              headers: { "content-type": response.headers.get("content-type") ?? "text/html" },
              body: Buffer.from(await response.arrayBuffer()),
            });
          } else if (u.hostname === "pagead2.googlesyndication.com") {
            loaderRequests++;
            if (mode === "adblock") await request.abort("blockedbyclient");
            else
              await request.respond({
                status: 200,
                contentType: "text/javascript",
                headers: { "access-control-allow-origin": "*" },
                body: `window.adsbygoogle={push(){window.monetizationAdPushes++;${mode === "filled" ? 'document.querySelector(".adsbygoogle").dataset.adStatus="filled";' : ""}}};`,
              });
          } else if (
            u.hostname.includes("google") ||
            u.hostname.includes("doubleclick") ||
            u.hostname.includes("fundingchoices")
          )
            await request.respond({ status: 200, contentType: "text/javascript", body: "" });
          else if (request.resourceType() === "image")
            await request.respond({
              status: 200,
              contentType: "image/svg+xml",
              body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#e6e9de"/></svg>',
            });
          else await request.abort();
        });
        await p.goto("https://tomokichidiary.com/posts/shanghai-chagee-menu", {
          waitUntil: "networkidle0",
        });
        await p.waitForFunction(() => document.querySelectorAll("[data-article-ad]").length === 1);
        await p.evaluate(() =>
          document.querySelector("[data-article-ad]").scrollIntoView({ block: "center" }),
        );
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const result = await p.evaluate(() => ({
          variant: document.documentElement.dataset.adVariant,
          slots: document.querySelectorAll("[data-article-ad]").length,
          selected: document.querySelector("[data-article-ad]").dataset.variant,
          pushes: window.monetizationAdPushes,
          measurements: window.monetizationMeasurements,
          cls: window.monetizationShifts.reduce((s, n) => s + n, 0),
          overflow: document.documentElement.scrollWidth > innerWidth,
          text: document.querySelector(".article-content").textContent,
          privacy: !!document.querySelector("[data-ad-privacy]"),
        }));
        writeFileSync(
          `${output}/browser-debug.json`,
          JSON.stringify({ width, variant, mode, loaderRequests, result, pageErrors }, null, 2),
        );
        assert.equal(result.variant, variant);
        assert.equal(result.selected, variant);
        assert.equal(result.slots, 1);
        assert.equal(result.overflow, false);
        assert.ok(result.privacy);
        assert.ok(!result.text.includes("{{monetization:"));
        assert.ok(!result.text.includes("private-affiliate"));
        assert.equal(
          result.measurements.filter((e) => e.measurement === "experiment_assignment").length,
          1,
        );
        assert.equal(result.measurements.filter((e) => e.measurement === "ad_eligible").length, 1);
        assert.equal(loaderRequests, width === 320 ? 0 : 1);
        assert.equal(result.pushes, width === 320 || mode === "adblock" ? 0 : 1);
        assert.ok(result.cls < 0.1, `CLS ${width}/${variant}/${mode}: ${result.cls}`);
        assert.deepEqual(pageErrors, []);
        if (mode === "filled" && width !== 320)
          await p.screenshot({ path: `${output}/public-${width}-${variant}.png`, fullPage: false });
        findings.push({
          test: "public",
          width,
          variant,
          mode,
          loaderRequests,
          pushes: result.pushes,
          cls: result.cls,
          result: "passed",
        });
        await p.close();
      }
  writeFileSync(`${output}/browser-results.json`, JSON.stringify(findings, null, 2));
  process.stdout.write(JSON.stringify(findings, null, 2) + "\n");
} finally {
  await browser.close();
}
