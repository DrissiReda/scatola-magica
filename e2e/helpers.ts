import http from "http";
import { APIRequestContext, Browser, expect, Page, request, test as base } from "@playwright/test";

// Every test closes the browser contexts it opened, so editors and live connections don't pile up.
export const test = base.extend<{ cleanup: void }>({
  cleanup: [
    async ({ browser }, use) => {
      await use();
      await Promise.all(browser.contexts().map((context) => context.close()));
    },
    { auto: true },
  ],
});

export const A = "http://scatola:3000";
export const B = "http://scatola2:3000";
export const LB = "http://lb";
export const PASSWORD = "password123";
export const PROVIDER = process.env.OFFICE_PROVIDER || "onlyoffice";

export const unique = (name: string) => `${name}-${Date.now().toString(36)}`;

export const api = async (base: string, username?: string) => {
  const context = await request.newContext({ baseURL: base });
  if (username) {
    const response = await context.post("/api/auth/login", { data: { username, password: PASSWORD } });
    expect(response.ok(), `login ${username} on ${base}`).toBeTruthy();
  }
  return context;
};

export const pageAs = async (browser: Browser, base: string, username: string): Promise<Page> => {
  const context = await browser.newContext({ baseURL: base });
  const response = await context.request.post("/api/auth/login", { data: { username, password: PASSWORD } });
  expect(response.ok()).toBeTruthy();
  return context.newPage();
};

// One-chunk upload through the real chunked upload API.
export const upload = async (ctx: APIRequestContext, folderPath: string, name: string, content: Buffer | string, viaB?: APIRequestContext) => {
  const buffer = Buffer.from(content);
  const uploadId = unique("up");
  const init = await ctx.post("/api/upload/init", {
    data: { uploadId, fileName: name, fileSize: buffer.length, totalChunks: 1, folderPath },
  });
  if (!init.ok()) return init;
  await (viaB ?? ctx).post("/api/upload/chunk", {
    multipart: { uploadId, chunkIndex: "0", chunk: { name, mimeType: "application/octet-stream", buffer } },
  });
  return ctx.post("/api/upload/finalize", { data: { uploadId } });
};

export const download = (ctx: APIRequestContext, id: string) =>
  ctx.get(`/api/download/${encodeURIComponent(id)}`);

export const openShare = async (page: Page, itemId: string) => {
  await page.locator(`[data-select-id="${itemId}"]`).first().click({ button: "right" });
  await page.getByText("Share", { exact: true }).click();
  await expect(page.getByRole("heading", { name: /^Share "/ })).toBeVisible();
};

export const saveShare = async (page: Page, button: "Save" | "Stop sharing" = "Save") => {
  await page.getByRole("button", { name: button }).click();
  await expect(page.getByRole("heading", { name: /^Share "/ })).toBeHidden();
};

export const shareWith = async (page: Page, itemId: string, users: string[], canEdit = false) => {
  await page.goto("/files");
  await openShare(page, itemId);
  for (const user of users) {
    await page.getByPlaceholder("Username").fill(user);
    await page.getByPlaceholder("Username").press("Enter");
  }
  if (canEdit) await page.getByText("Can edit").click();
  await saveShare(page);
};

export const sharedId = async (page: Page, name: string) => {
  await page.goto("/files");
  const item = page.locator('[data-select-id^="~shared/"]', { hasText: name }).first();
  await expect(item).toBeVisible();
  return (await item.getAttribute("data-select-id"))!;
};

export const expectHit = async (page: Page, query: string, name: string, present = true, timeout = 60_000) => {
  await expect(async () => {
    await page.goto(`/files?search=${encodeURIComponent(query)}`);
    // Results render after a loader; only count once the list (or empty state) is there.
    await expect(page.getByText(/^\d+ files?\b|No files or folders/).first()).toBeVisible({ timeout: 30_000 });
    const hits = page.getByText(name, { exact: true });
    if (present) await expect(hits.first()).toBeVisible({ timeout: 1000 });
    else await expect(hits).toHaveCount(0, { timeout: 1000 });
  }).toPass({ timeout });
};

// Drives the stack's containers through the Docker socket mounted by run.sh.
export const docker = (action: "stop" | "start" | "restart", service: string) =>
  new Promise<void>((resolve, reject) => {
    const req = http.request(
      { socketPath: "/var/run/docker.sock", method: "POST", path: `/containers/scatola-e2e-${service}-1/${action}` },
      (res) => (res.statusCode! < 300 ? resolve() : reject(new Error(`${action} ${service}: ${res.statusCode}`)))
    );
    req.on("error", reject);
    req.end();
  });

export const waitUp = async (base: string) => {
  const ctx = await api(base);
  await expect(async () => expect((await ctx.get("/auth/login")).ok()).toBeTruthy()).toPass({ timeout: 120_000 });
};
