import { chromium, devices } from "../.tmp-verify/node_modules/playwright/index.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:4173";

async function run() {
  const browser = await chromium.launch();
  const errors = [];

  async function check(label, fn) {
    try {
      await fn();
      console.log(`OK ${label}`);
    } catch (e) {
      errors.push(`${label}: ${e.message}`);
      console.error(`FAIL ${label}: ${e.message}`);
    }
  }

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

  await page.goto(BASE, { waitUntil: "networkidle" });

  await check("visitor hero", async () => {
    await page.waitForSelector("text=为日常所写");
    const mode = await page.locator("body").getAttribute("data-mode");
    if (mode !== "visitor") throw new Error(`mode=${mode}`);
    if (await page.locator("#guitartool").isHidden()) throw new Error("project hidden");
  });

  await check("toggle engineering", async () => {
    await page.locator("#mode-toggle").click();
    await page.waitForFunction(() => document.body.dataset.mode === "engineering");
    if (!page.url().includes("#engineering")) throw new Error("hash missing");
    await page.waitForSelector("text=美在");
    if (await page.locator("#eng-fft").isHidden()) throw new Error("fft lab hidden");
  });

  await check("fft slider", async () => {
    await page.locator("#fft-f2").fill("60");
    await page.waitForFunction(() => document.getElementById("fft-f2-out")?.textContent === "60");
    const formula = await page.locator("#fft-formula").textContent();
    if (!formula.includes("60")) throw new Error(formula);
  });

  await check("reorder lab", async () => {
    const count = await page.locator(".reorder-item").count();
    if (count !== 3) throw new Error(`items=${count}`);
    await page.locator("#reorder-reset").click();
    await page.waitForSelector('#reorder-status[data-state="ok"]');
    await page.locator("#reorder-shuffle").click();
    await page.waitForFunction(
      () => document.getElementById("reorder-status")?.dataset.state !== "ok"
    );
  });

  await check("eng section hash keeps mode", async () => {
    await page.locator('[data-nav="projects"]').click();
    await page.waitForFunction(() => location.hash === "#eng-fft");
    const mode = await page.locator("body").getAttribute("data-mode");
    if (mode !== "engineering") throw new Error(`mode=${mode} after #eng-fft`);
  });

  await check("back to visitor", async () => {
    await page.locator("#back-to-visitor").click();
    await page.waitForFunction(() => document.body.dataset.mode === "visitor");
    await page.waitForSelector("text=吉他兔");
  });

  const mobile = await browser.newPage({
    ...devices["iPhone 12"],
  });
  await mobile.goto(`${BASE}/#engineering`, { waitUntil: "networkidle" });
  await check("mobile engineering", async () => {
    await mobile.waitForFunction(() => document.body.dataset.mode === "engineering");
    const box = await mobile.locator("#mode-toggle").boundingBox();
    if (!box || box.width < 20) throw new Error("toggle not visible");
    await mobile.locator("#fft-f3").fill("80");
    await mobile.waitForFunction(() => document.getElementById("fft-f3-out")?.textContent === "80");
  });

  await browser.close();
  if (errors.length) {
    console.error("\nVerification failed:");
    for (const e of errors) console.error("-", e);
    process.exit(1);
  }
  console.log("\nAll checks passed.");
}

run();
