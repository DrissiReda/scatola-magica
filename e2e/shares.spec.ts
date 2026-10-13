import { expect } from "@playwright/test";
import { A, api, B, download, openShare, pageAs, saveShare, sharedId, shareWith, unique, upload, test } from "./helpers";

test.describe.configure({ mode: "serial" });

const folder = unique("Team");
const file = unique("solo") + ".txt";
let shareFolder = "";

test.beforeAll(async () => {
  const alice = await api(A, "alice");
  expect((await upload(alice, folder, "notes.txt", "pineapple notes")).ok()).toBeTruthy();
  expect((await upload(alice, `${folder}/sub`, "deep.txt", "deep")).ok()).toBeTruthy();
  expect((await upload(alice, "", file, "solo file")).ok()).toBeTruthy();
});

test("owner shares a folder read-only and sees the badge", async ({ browser }) => {
  const alice = await pageAs(browser, A, "alice");
  await shareWith(alice, folder, ["bob"]);
  await expect(alice.locator(`[data-select-id="${folder}"] [title="Shared"]`)).toBeVisible();
});

test("recipient sees it in the root like an own folder, with the badge", async ({ browser }) => {
  const bob = await pageAs(browser, B, "bob");
  shareFolder = await sharedId(bob, folder);
  await expect(bob.locator(`[data-select-id="${shareFolder}"] [title="Shared"]`)).toBeVisible();
  await bob.locator(`[data-select-id="${shareFolder}"]`).getByRole("link", { name: folder }).first().click();
  await expect(bob.getByText("notes.txt")).toBeVisible();
  await bob.getByRole("link", { name: "sub" }).first().click();
  await expect(bob.getByText("deep.txt")).toBeVisible();
});

test("read-only: download works, writes are refused", async () => {
  const bob = await api(B, "bob");
  expect(await (await download(bob, `${shareFolder}/notes.txt`)).text()).toBe("pineapple notes");
  expect((await upload(bob, shareFolder, "x.txt", "x")).ok()).toBeFalsy();
  expect((await upload(bob, `${shareFolder}/sub`, "x.txt", "x")).ok()).toBeFalsy();
});

test("recipient cannot re-share", async ({ browser }) => {
  const bob = await pageAs(browser, B, "bob");
  await bob.goto("/files");
  await bob.locator(`[data-select-id="${shareFolder}"]`).click({ button: "right" });
  await expect(bob.getByText("Share", { exact: true })).toHaveCount(0);
});

test("outsiders and traversal get 403", async () => {
  const eve = await api(A, "eve");
  expect((await download(eve, `${shareFolder}/notes.txt`)).status()).toBe(403);
  const bob = await api(A, "bob");
  expect((await download(bob, `${shareFolder}/../../../config/users.json`)).status()).toBe(403);
  expect((await download(bob, "~shared/nope/notes.txt")).status()).toBe(403);
});

test("unknown user is rejected in the dialog", async ({ browser }) => {
  const alice = await pageAs(browser, A, "alice");
  await alice.goto("/files");
  await openShare(alice, folder);
  await alice.getByPlaceholder("Username").fill("ghost");
  await alice.getByPlaceholder("Username").press("Enter");
  await alice.getByRole("button", { name: "Save" }).click();
  await expect(alice.getByText("Unknown user: ghost")).toBeVisible();
});

test("editable: recipient uploads and deletes inside, never the root", async ({ browser }) => {
  const alice = await pageAs(browser, A, "alice");
  await alice.goto("/files");
  await openShare(alice, folder);
  await alice.getByText("Can edit").click();
  await saveShare(alice);

  const bob = await api(B, "bob");
  expect((await upload(bob, shareFolder, "bob.txt", "from bob")).ok()).toBeTruthy();
  expect((await upload(bob, `${shareFolder}/sub`, "bob2.txt", "deep bob")).ok()).toBeTruthy();
  const ownerView = await api(A, "alice");
  expect(await (await download(ownerView, `${folder}/bob.txt`)).text()).toBe("from bob");

  const bobPage = await pageAs(browser, B, "bob");
  bobPage.on("dialog", (dialog) => dialog.accept("ignored"));
  await bobPage.goto("/files");
  await bobPage.locator(`[data-select-id="${shareFolder}"]`).click({ button: "right" });
  await bobPage.getByText("Delete Folder").click();
  await bobPage.getByRole("button", { name: /delete/i }).last().click().catch(() => {});
  expect((await download(ownerView, `${folder}/notes.txt`)).ok(), "root survives delete").toBeTruthy();

  await bobPage.goto(`/files/${shareFolder}`);
  await bobPage.locator(`[data-select-id="${shareFolder}/bob.txt"]`).click({ button: "right" });
  await bobPage.getByText("Delete", { exact: true }).click();
  await bobPage.getByRole("button", { name: /delete/i }).last().click();
  await expect(async () => expect((await download(ownerView, `${folder}/bob.txt`)).status()).toBe(404)).toPass();
});

test("recipient listing refreshes live when the owner writes on the other instance", async ({ browser }) => {
  const bob = await pageAs(browser, B, "bob");
  const listening = bob.waitForResponse((r) => r.url().includes("/api/events"));
  await bob.goto(`/files/${shareFolder}`);
  await listening;
  await upload(await api(A, "alice"), folder, "live.txt", "live");
  await expect(bob.getByText("live.txt")).toBeVisible({ timeout: 15_000 });
});

test("single file share shows as a file in the recipient root", async ({ browser }) => {
  const alice = await pageAs(browser, A, "alice");
  await shareWith(alice, file, ["bob"]);
  const bob = await pageAs(browser, B, "bob");
  const id = await sharedId(bob, file);
  expect(await (await download(await api(B, "bob"), id)).text()).toBe("solo file");
});

test("share follows a rename of the shared folder", async ({ browser }) => {
  const alice = await pageAs(browser, A, "alice");
  await alice.goto("/files");
  alice.once("dialog", (dialog) => dialog.accept("x"));
  await alice.locator(`[data-select-id="${folder}"]`).click({ button: "right" });
  await alice.getByText("Rename Folder").click();
  await alice.locator(`[data-select-id="${folder}"] input`).fill(`${folder}-renamed`);
  await alice.locator(`[data-select-id="${folder}"] input`).press("Enter");
  await expect(alice.locator(`[data-select-id="${folder}-renamed"]`)).toBeVisible();
  expect((await download(await api(B, "bob"), `${shareFolder}/notes.txt`)).ok()).toBeTruthy();
});

test("stop sharing removes access everywhere", async ({ browser }) => {
  const alice = await pageAs(browser, A, "alice");
  await alice.goto("/files");
  await openShare(alice, `${folder}-renamed`);
  await saveShare(alice, "Stop sharing");
  const bob = await api(B, "bob");
  expect((await download(bob, `${shareFolder}/notes.txt`)).status()).toBe(403);
  const bobPage = await pageAs(browser, B, "bob");
  await bobPage.goto("/files");
  await expect(bobPage.locator(`[data-select-id="${shareFolder}"]`)).toHaveCount(0);
});
