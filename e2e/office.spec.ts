import { readFileSync } from "fs";
import { Browser, expect, Page } from "@playwright/test";
import {
  A, api, B, docker, expectHit, LB, pageAs, PROVIDER, sharedId, shareWith, unique, upload, waitUp, test,
} from "./helpers";

test.describe.configure({ mode: "serial" });

const ONLYOFFICE = PROVIDER === "onlyoffice";
const FRAME = ONLYOFFICE ? "frameEditor" : "collabora-frame";
const CANVAS = ONLYOFFICE ? "#editor_sdk" : "#document-container";
const LOAD = { timeout: 180_000 };

const folder = unique("Office");
const readOnlyFolder = unique("OfficeRO");
let editable = "";
let readOnly = "";

const frameOf = (page: Page) => page.frame({ name: FRAME })!;

const openDoc = async (browser: Browser, base: string, user: string, id: string) => {
  const page = await pageAs(browser, base, user);
  await page.goto(`/office?id=${encodeURIComponent(id)}`);
  await expect(page.frameLocator(`iframe[name="${FRAME}"]`).locator(CANVAS)).toBeVisible(LOAD);
  return page;
};

// Whether that user's editor currently shows the word, asked through the editor itself.
const contains = async (page: Page, word: string): Promise<boolean> =>
  ONLYOFFICE
    ? frameOf(page).evaluate((w) => {
        const editor = (window as unknown as { editor: { asc_EditSelectAll(): void; asc_GetSelectedText(): string } }).editor;
        editor.asc_EditSelectAll();
        return editor.asc_GetSelectedText().includes(w);
      }, word)
    : // Collabora: its find works in view mode too ("searchnotfound" when absent).
      frameOf(page).evaluate(
        (w) =>
          new Promise<boolean>((resolve) => {
            const { app } = window as unknown as { app: { socket: { socket: WebSocket; sendMessage(m: string): void } } };
            const ws = app.socket.socket;
            const onMessage = (event: MessageEvent) => {
              if (typeof event.data !== "string") return;
              if (event.data.startsWith("searchnotfound:")) resolve(false);
              else if (/^textselection: \S/.test(event.data)) resolve(true);
            };
            ws.addEventListener("message", onMessage);
            app.socket.sendMessage(
              "uno .uno:ExecuteSearch " +
                JSON.stringify({
                  "SearchItem.SearchString": { type: "string", value: w },
                  "SearchItem.Backward": { type: "boolean", value: false },
                  "SearchItem.Command": { type: "long", value: 0 },
                })
            );
            setTimeout(() => resolve(false), 5000);
          }),
        word
      );

// Under load the editors can drop a keystroke, so text is retyped until the typer's editor has it.
const typeIn = async (page: Page, text: string, verify = true) => {
  await expect(async () => {
    // Collabora CODE shows a welcome dialog over the document.
    await frameOf(page).evaluate(() => document.querySelector(".iframe-welcome-wrap")?.remove());
    await page.frameLocator(`iframe[name="${FRAME}"]`).locator(CANVAS).click({ timeout: 2000 });
    await page.keyboard.press("Control+End");
    await page.keyboard.type(text, { delay: 20 });
    if (verify) expect(await contains(page, text.trim())).toBe(true);
  }).toPass({ timeout: 120_000 });
};

const expectLive = async (page: Page, word: string, present = true) =>
  expect(async () => {
    expect(await contains(page, word)).toBe(present);
  }).toPass({ timeout: 60_000 });

const close = async (...pages: Page[]) => {
  for (const page of pages) await page.getByLabel("Close editor").click();
};

const expectSaved = async (browser: Browser, word: string, name: string) =>
  expectHit(await pageAs(browser, A, "alice"), word, name, true, 180_000);

test.beforeAll(async ({ browser }) => {
  const alice = await api(A, "alice");
  for (const [dir, name, fixture] of [
    [folder, "plan.docx", "plan.docx"],
    [folder, "budget.xlsx", "budget.xlsx"],
    [folder, "deck.pptx", "deck.pptx"],
    [readOnlyFolder, "memo.docx", "plan.docx"],
  ]) {
    expect((await upload(alice, dir, name, readFileSync(`fixtures/${fixture}`))).ok()).toBeTruthy();
  }
  const owner = await pageAs(browser, A, "alice");
  await shareWith(owner, folder, ["bob"], true);
  await shareWith(owner, readOnlyFolder, ["bob"]);
  const bob = await pageAs(browser, B, "bob");
  editable = await sharedId(bob, folder);
  readOnly = await sharedId(bob, readOnlyFolder);
});

test("owner (instance A) and recipient (instance B) co-edit live, both edits saved", async ({ browser }) => {
  const [mine, theirs] = [unique("wombat"), unique("koala")];
  const alice = await openDoc(browser, A, "alice", `${folder}/plan.docx`);
  const bob = await openDoc(browser, B, "bob", `${editable}/plan.docx`);

  await typeIn(alice, ` ${mine} `);
  await expectLive(bob, mine);
  await typeIn(bob, ` ${theirs} `);
  await expectLive(alice, theirs);

  await close(alice, bob);
  await expectSaved(browser, mine, "plan.docx");
  await expectSaved(browser, theirs, "plan.docx");
});

test("reopening after the save shows the saved text", async ({ browser }) => {
  const word = unique("emu");
  const alice = await openDoc(browser, A, "alice", `${folder}/plan.docx`);
  await typeIn(alice, ` ${word} `);
  await close(alice);
  await expectSaved(browser, word, "plan.docx");

  const again = await openDoc(browser, B, "alice", `${folder}/plan.docx`);
  await expectLive(again, word);
  await close(again);
});

test("same user in two tabs through the load balancer shares one session", async ({ browser }) => {
  const word = unique("dingo");
  const tab1 = await openDoc(browser, LB, "alice", `${folder}/plan.docx`);
  const tab2 = await openDoc(browser, LB, "alice", `${folder}/plan.docx`);
  await typeIn(tab1, ` ${word} `);
  await expectLive(tab2, word);
  await close(tab1, tab2);
  await expectSaved(browser, word, "plan.docx");
});

test("admin path and owner path join the same session", async ({ browser }) => {
  const word = unique("numbat");
  const alice = await openDoc(browser, A, "alice", `${folder}/plan.docx`);
  const admin = await openDoc(browser, B, "admin", `alice/${folder}/plan.docx`);
  await typeIn(alice, ` ${word} `);
  await expectLive(admin, word);
  await close(alice, admin);
});

test("read-only recipient follows live but cannot change the document", async ({ browser }) => {
  const [word, attempt] = [unique("bilby"), unique("nope")];
  const alice = await openDoc(browser, A, "alice", `${readOnlyFolder}/memo.docx`);
  const bob = await openDoc(browser, B, "bob", `${readOnly}/memo.docx`);
  await typeIn(alice, ` ${word} `);
  await expectLive(bob, word);

  await typeIn(bob, ` ${attempt} `, false).catch(() => {});
  await expectLive(alice, attempt, false);
  await close(alice, bob);
  await expectSaved(browser, word, "memo.docx");
  await expectHit(await pageAs(browser, A, "alice"), attempt, "memo.docx", false);
});

test("spreadsheet: co-editing saves the typed cell", async ({ browser }) => {
  const word = unique("quoll");
  const alice = await openDoc(browser, A, "alice", `${folder}/budget.xlsx`);
  const bob = await openDoc(browser, B, "bob", `${editable}/budget.xlsx`);
  await typeIn(bob, `${word}\n`, false);
  await close(bob, alice);
  // Calc may swallow or autocorrect the first keystrokes of a cell; the unique suffix is enough.
  await expectSaved(browser, word.split("-")[1], "budget.xlsx");
});

test("presentation opens for owner and recipient", async ({ browser }) => {
  const alice = await openDoc(browser, A, "alice", `${folder}/deck.pptx`);
  const bob = await openDoc(browser, B, "bob", `${editable}/deck.pptx`);
  if (ONLYOFFICE) {
    for (const page of [alice, bob]) {
      await expect(page.frameLocator(`iframe[name="${FRAME}"]`).locator("#tlb-box-users, .btn-users").first()).toContainText("2");
    }
  }
  await close(alice, bob);
});

test("a file changed outside the editor opens fresh (new session key)", async ({ browser }) => {
  const docx = unique("ext") + ".docx";
  const alice = await api(A, "alice");
  await upload(alice, folder, docx, readFileSync("fixtures/plan.docx"));
  const first = await openDoc(browser, A, "alice", `${folder}/${docx}`);
  await close(first);

  const memo = readFileSync("fixtures/plan.docx");
  await upload(alice, folder, docx, memo);
  const second = await openDoc(browser, B, "alice", `${folder}/${docx}`);
  await expectLive(second, "kangaroo");
  await close(second);
});

test("an app instance dying mid-session does not lose edits", async ({ browser }) => {
  const word = unique("possum");
  const alice = await openDoc(browser, A, "alice", `${folder}/plan.docx`);
  const bob = await openDoc(browser, B, "bob", `${editable}/plan.docx`);
  await docker("stop", "scatola");
  try {
    await typeIn(bob, ` ${word} `);
    await expectLive(alice, word);
    await close(bob);
    await alice.close();
    await expectHit(await pageAs(browser, B, "alice"), word, "plan.docx", true, 180_000);
  } finally {
    await docker("start", "scatola");
    await waitUp(A);
  }
});

test("office server down shows a clear error", async ({ browser }) => {
  await docker("stop", PROVIDER);
  try {
    const page = await pageAs(browser, A, "alice");
    await page.goto(`/office?id=${encodeURIComponent(`${folder}/plan.docx`)}`);
    await expect(page.getByText("The office server could not be reached.")).toBeVisible(LOAD);
  } finally {
    await docker("start", PROVIDER);
  }
  await expect(async () => {
    const page = await openDoc(browser, A, "alice", `${folder}/plan.docx`);
    await close(page);
  }).toPass({ timeout: 300_000 });
});

test("callbacks and WOPI calls without valid signatures are refused", async () => {
  const alice = await api(A, "alice");
  const html = await (await alice.get(`/office?id=${encodeURIComponent(`${folder}/plan.docx`)}`)).text();
  const key = html.match(/(?:key=|files(?:\/|%2F))([\w-]{32})/)![1];
  const anonymous = await api(LB);

  const forged = { key, status: 2, url: "http://onlyoffice/evil.docx" };
  expect((await anonymous.post(`/api/office/callback?key=${key}`, { data: forged })).status()).toBe(ONLYOFFICE ? 403 : 404);
  expect((await anonymous.post(`/api/office/callback?key=${key}`, { data: { token: "e30.e30.c2ln" } })).status()).toBe(ONLYOFFICE ? 403 : 404);
  expect((await anonymous.get(`/api/office/file?key=${key}`)).status()).toBe(ONLYOFFICE ? 403 : 404);
  expect((await anonymous.get(`/api/wopi/files/${key}`)).status()).toBe(401);
  expect((await anonymous.get(`/api/wopi/files/${key}?access_token=forged`)).status()).toBe(401);
  expect((await anonymous.post(`/api/wopi/files/${key}/contents?access_token=forged`, { data: "x" })).status()).toBe(401);
});
