import { expect } from "@playwright/test";
import { A, api, B, LB, openShare, pageAs, saveShare, unique, upload, test } from "./helpers";

test.describe.configure({ mode: "serial" });

const folder = unique("Public");
const file = unique("flyer") + ".txt";
let folderLink = "";
let fileLink = "";

const linkFor = async (browser: import("@playwright/test").Browser, item: string) => {
  const alice = await pageAs(browser, A, "alice");
  await alice.goto("/files");
  await openShare(alice, item);
  await alice.getByText("Public link (view only)").click();
  await alice.getByRole("button", { name: "Save" }).click();
  const url = await alice.getByLabel("Public link").inputValue();
  expect(url).toMatch(/\/s\/[\w-]{24}$/);
  return url.split("/s/")[1];
};

test.beforeAll(async () => {
  const alice = await api(A, "alice");
  await upload(alice, folder, "readme.txt", "public hello");
  await upload(alice, `${folder}/inner`, "inner.txt", "inner hello");
  await upload(alice, "", file, "flyer content");
});

test("owner creates a folder link from the dialog", async ({ browser }) => {
  folderLink = await linkFor(browser, folder);
  fileLink = await linkFor(browser, file);
});

test("anonymous visitor browses the folder on any instance", async ({ browser }) => {
  for (const base of [A, B, LB]) {
    const page = await (await browser.newContext({ baseURL: base })).newPage();
    await page.goto(`/s/${folderLink}`);
    await expect(page.getByText("readme.txt")).toBeVisible();
    await page.getByRole("link", { name: /inner/ }).click();
    await expect(page.getByText("inner.txt")).toBeVisible();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByText("inner.txt").click()]);
    expect(dl.suggestedFilename()).toBe("inner.txt");
  }
});

test("file link downloads the file directly", async () => {
  const anonymous = await api(LB);
  expect(await (await anonymous.get(`/api/public/${fileLink}`)).text()).toBe("flyer content");
  const page = await anonymous.get(`/s/${fileLink}`);
  expect(await page.text()).toContain(file);
});

test("links are read-only and confined to the shared item", async () => {
  const anonymous = await api(LB);
  expect((await anonymous.get(`/api/public/${folderLink}/..%2F..%2Fconfig%2Fusers.json`)).status()).toBe(403);
  expect((await anonymous.get(`/api/public/${folderLink}/../${file}`)).ok()).toBeFalsy();
  expect((await anonymous.get(`/api/public/not-a-token/readme.txt`)).status()).toBe(403);
  expect((await anonymous.get(`/s/not-a-token`)).status()).toBe(404);
  expect((await anonymous.post("/api/upload/init", { data: { uploadId: "x", fileName: "x", fileSize: 1, totalChunks: 1, folderPath: "" } })).status()).toBe(401);
});

test("revoking the link kills it on every instance", async ({ browser }) => {
  const alice = await pageAs(browser, A, "alice");
  await alice.goto("/files");
  await openShare(alice, folder);
  await alice.getByText("Public link (view only)").click();
  await saveShare(alice);
  for (const base of [A, B]) {
    const anonymous = await api(base);
    expect((await anonymous.get(`/s/${folderLink}`)).status()).toBe(404);
    expect((await anonymous.get(`/api/public/${folderLink}/readme.txt`)).status()).toBe(403);
  }
});
