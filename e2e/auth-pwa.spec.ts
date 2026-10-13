import { expect } from "@playwright/test";
import { docker, LB, pageAs, waitUp, test } from "./helpers";

test("OIDC login through Dex provisions the user", async ({ page }) => {
  await page.goto(`${LB}/auth/login`);
  await page.getByRole("button", { name: /sso/i }).click();
  await page.locator("#login").fill("carol@example.com");
  await page.locator("#password").fill("password");
  await page.locator("#submit-login").click();
  await page.waitForURL(`${LB}/**`);
  expect(await (await page.request.get(`${LB}/api/auth/check-session`)).json()).toMatchObject({ username: "carol" });
});

test("OIDC logout goes through the provider back to login", async ({ page }) => {
  await page.goto(`${LB}/api/oidc/logout`);
  await expect(page).toHaveURL(/dex|auth\/login/);
});

test("PWA: manifest, service worker and offline fallback", async ({ browser }) => {
  const page = await pageAs(browser, LB, "alice");
  const manifest = await page.request.get("/manifest.json");
  expect(manifest.headers()["content-type"]).toContain("manifest");
  expect((await manifest.json()).display).toBe("standalone");

  await page.goto("/files");
  expect(await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))).toBe(true);
  await page.reload();
  // setOffline() does not reach service worker fetches, so take the server away instead.
  await docker("stop", "lb");
  try {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "You're Offline" })).toBeVisible();
  } finally {
    await docker("start", "lb");
    await waitUp(LB);
  }
});
