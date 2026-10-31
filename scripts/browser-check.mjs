const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
const artifactRoot = path.resolve("artifacts");
await mkdir(artifactRoot, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
await page.goto(process.env.TEST_BASE_URL || "http://127.0.0.1:3000/", {
  waitUntil: "networkidle",
});
await page.screenshot({
  path: artifactRoot + "/home-desktop.png",
  fullPage: true,
});
await page.getByRole("button", { name: "まずはサンプルで体験する" }).click();
await page
  .getByRole("heading", { name: "こもれび設計室の、今とこれから。" })
  .waitFor();
await page.getByRole("button", { name: "好みを選びにいく" }).click();
await page.locator("#reference-preview iframe").waitFor();
await page.waitForTimeout(200);
await page.screenshot({
  path: artifactRoot + "/rating-desktop.png",
  fullPage: true,
});
for (let i = 0; i < 10; i++) {
  await page.locator(`[data-score="${i === 1 ? 5 : i < 5 ? 1 : 3}"]`).click();
  if (i < 9)
    await page.waitForFunction(
      (n) =>
        document
          .querySelector(".counter")
          ?.textContent.trim()
          .startsWith(String(n).padStart(2, "0")),
      i + 2,
    );
}
await page.getByRole("button", { name: "この好みで、新しいHPを見る" }).click();
await page
  .getByRole("heading", { name: "こもれび設計室の、新しい見せ方。" })
  .waitFor();
await page
  .frameLocator("#proposal-frame")
  .getByRole("heading", { name: "暮らしに、余白を。" })
  .waitFor();
await page.screenshot({
  path: artifactRoot + "/proposal-desktop.png",
  fullPage: true,
});
await page
  .frameLocator("#proposal-frame")
  .getByRole("link", { name: "私たちの仕事", exact: true })
  .first()
  .click();
await page
  .frameLocator("#proposal-frame")
  .getByRole("heading", { name: "生活に寄り添う、空間づくり。" })
  .waitFor();

await page.getByRole("button", { name: "引き継ぎチェック" }).click();
await page.getByText("取得した本文の保持を確認", { exact: false }).waitFor();
await page.getByRole("button", { name: "新しいHP", exact: true }).click();
await page.getByLabel("プレビューするページ").selectOption("1");
await page
  .frameLocator("#proposal-frame")
  .getByRole("heading", { name: "生活に寄り添う、空間づくり。" })
  .waitFor();
const download = page.waitForEvent("download");
await page.getByRole("link", { name: "提案をダウンロード" }).click();
await (await download).saveAs(artifactRoot + "/demo-proposal.zip");
await page
  .getByLabel("提案へのコメント")
  .fill("余白は好き。文字をもう少し大きくしたい。");
await page.getByRole("button", { name: "調整したい", exact: true }).click();
await page
  .getByRole("status")
  .filter({ hasText: "コメントを保存しました。" })
  .waitFor();
await page.reload();
await page.getByRole("button", { name: "つづきから" }).click();
await page
  .getByRole("heading", { name: "こもれび設計室の、新しい見せ方。" })
  .waitFor();
await page.setViewportSize({ width: 390, height: 844 });
await page.locator(".brand").click();
await page.screenshot({
  path: artifactRoot + "/home-mobile.png",
  fullPage: true,
});
let overflow = await page.evaluate(() => ({
  width: innerWidth,
  scroll: document.documentElement.scrollWidth,
}));
await page.getByRole("button", { name: "つづきから" }).click();
await page.getByRole("button", { name: "好みを見直す" }).click();
await page.locator('[data-edit="0"]').click();
await page.waitForTimeout(150);
await page.screenshot({
  path: artifactRoot + "/rating-mobile.png",
  fullPage: true,
});
const mobileOverflow = await page.evaluate(() => ({
  width: innerWidth,
  scroll: document.documentElement.scrollWidth,
}));
await writeFile(
  artifactRoot + "/browser-check.json",
  JSON.stringify(
    {
      errors,
      homeMobile: overflow,
      ratingMobile: mobileOverflow,
      checked: [
        "sample",
        "ten_ratings",
        "proposal",
        "audit",
        "page_selection",
        "zip_download",
        "feedback",
        "reload_resume",
        "mobile",
      ],
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    errors,
    homeMobile: overflow,
    ratingMobile: mobileOverflow,
  }),
);
await browser.close();
if (
  errors.length ||
  overflow.scroll > overflow.width ||
  mobileOverflow.scroll > mobileOverflow.width
)
  process.exitCode = 1;
