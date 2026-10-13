import { expect, request } from "@playwright/test";
import { A, api, B, docker, download, LB, pageAs, unique, upload, waitUp, test } from "./helpers";

test.describe.configure({ mode: "serial" });

const folder = unique("Ha");

test("a session created on one instance is valid on the other", async () => {
  const viaA = await api(A, "alice");
  const cookie = (await viaA.storageState()).cookies.find((c) => c.name.includes("session"))!;
  const onB = await (await request.newContext({ baseURL: B })).get("/api/auth/check-session", {
    headers: { cookie: `${cookie.name}=${cookie.value}` },
  });
  expect(await onB.json()).toMatchObject({ username: "alice" });
});

for (const [from, to] of [[A, B], [B, A]]) {
  test(`live refresh ${from} -> ${to}`, async ({ browser }) => {
    const name = unique("live") + ".txt";
    const viewer = await pageAs(browser, to, "alice");
    const listening = viewer.waitForResponse((r) => r.url().includes("/api/events"));
    await viewer.goto("/files");
    await listening;
    await upload(await api(from, "alice"), "", name, "x");
    await expect(viewer.getByText(name)).toBeVisible({ timeout: 10_000 });
  });
}

test("cached listings are invalidated on the other instance", async ({ browser }) => {
  const viewer = await pageAs(browser, B, "alice");
  await upload(await api(A, "alice"), folder, "one.txt", "1");
  await viewer.goto(`/files/${folder}`);
  await expect(viewer.getByText("one.txt")).toBeVisible();
  await upload(await api(A, "alice"), folder, "two.txt", "2");
  await viewer.goto(`/files/${folder}`);
  await expect(viewer.getByText("two.txt")).toBeVisible();
});

test("chunks of one upload can land on different instances", async () => {
  const viaA = await api(A, "alice");
  const viaB = await api(B, "alice");
  expect((await upload(viaA, folder, "split.txt", "split upload", viaB)).ok()).toBeTruthy();
  expect(await (await download(viaB, `${folder}/split.txt`)).text()).toBe("split upload");
});

test("load balancer keeps working while one instance is down", async ({ browser }) => {
  await docker("stop", "scatola");
  try {
    const page = await pageAs(browser, LB, "alice");
    await page.goto(`/files/${folder}`);
    await expect(page.getByText("one.txt")).toBeVisible();
    expect((await upload(await api(LB, "alice"), folder, "during-outage.txt", "ok")).ok()).toBeTruthy();
  } finally {
    await docker("start", "scatola");
    await waitUp(A);
  }
  expect(await (await download(await api(A, "alice"), `${folder}/during-outage.txt`)).text()).toBe("ok");
});

test("losing Valkey degrades to local behaviour, then recovers", async ({ browser }) => {
  await docker("stop", "valkey");
  try {
    const alice = await api(A, "alice");
    expect((await upload(alice, folder, "no-valkey.txt", "still works")).ok()).toBeTruthy();
    expect(await (await download(await api(B, "alice"), `${folder}/no-valkey.txt`)).text()).toBe("still works");
  } finally {
    await docker("start", "valkey");
  }
  await expect(async () => {
    const viewer = await pageAs(browser, B, "alice");
    const name = unique("after") + ".txt";
    const listening = viewer.waitForResponse((r) => r.url().includes("/api/events"));
    await viewer.goto("/files");
    await listening;
    await upload(await api(A, "alice"), "", name, "x");
    await expect(viewer.getByText(name)).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 90_000 });
});
