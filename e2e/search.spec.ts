import { readFileSync } from "fs";
import { expect } from "@playwright/test";
import { A, api, B, docker, expectHit, pageAs, shareWith, unique, upload, waitUp, test } from "./helpers";

test.describe.configure({ mode: "serial" });

const folder = unique("Library");
const pine = unique("pineapple");
const secret = unique("secretword");

test.beforeAll(async () => {
  const alice = await api(A, "alice");
  await upload(alice, folder, "notes.txt", `remember the ${pine}`);
  await upload(alice, folder, "plan.docx", readFileSync("fixtures/plan.docx"));
  await upload(alice, folder, "manual.pdf", readFileSync("fixtures/manual.pdf"));
  await upload(alice, "", "diary.txt", `my ${secret}`);
  await upload(alice, folder, "budget.xlsx", readFileSync("fixtures/budget.xlsx"));
  await upload(alice, folder, "deck.pptx", readFileSync("fixtures/deck.pptx"));
});

test("content of text, docx, xlsx, pptx and pdf files", async ({ browser }) => {
  const alice = await pageAs(browser, A, "alice");
  await expectHit(alice, pine, "notes.txt");
  await expectHit(alice, "kangaroo", "plan.docx");
  await expectHit(alice, "quokka", "manual.pdf");
  await expectHit(alice, "wallaby", "budget.xlsx");
  await expectHit(alice, "platypus", "deck.pptx");
});

test("metadata: name prefix, folder name, mime type, diacritics-insensitive", async ({ browser }) => {
  const alice = await pageAs(browser, A, "alice");
  await upload(await api(A, "alice"), folder, "Résumé élan.txt", "cv");
  await expectHit(alice, "resu", "Résumé élan.txt");
  await expectHit(alice, folder, "notes.txt");
  await expectHit(alice, "wordprocessingml", "plan.docx");
});

test("index is the same on both instances (writes announced through Valkey)", async ({ browser }) => {
  const word = unique("zebra");
  await upload(await api(A, "alice"), folder, "fresh.txt", `a ${word} appears`);
  await expectHit(await pageAs(browser, B, "alice"), word, "fresh.txt");
  await upload(await api(B, "alice"), folder, "fresh2.txt", `${word}-two`);
  await expectHit(await pageAs(browser, A, "alice"), `${word}-two`, "fresh2.txt");
});

test("deleted files leave the index on every instance", async ({ browser }) => {
  const alice = await pageAs(browser, B, "alice");
  await alice.goto(`/files/${folder}`);
  await alice.locator(`[data-select-id="${folder}/notes.txt"]`).click({ button: "right" });
  await alice.getByText("Delete", { exact: true }).click();
  await alice.getByRole("button", { name: /delete/i }).last().click();
  await expectHit(await pageAs(browser, A, "alice"), pine, "notes.txt", false);
});

test("users only find what they own or what is shared with them", async ({ browser }) => {
  const bob = await pageAs(browser, A, "bob");
  const word = unique("okapi");
  await upload(await api(A, "alice"), folder, "okapi.txt", word);
  await expectHit(await pageAs(browser, A, "alice"), word, "okapi.txt");
  await expectHit(bob, word, "okapi.txt", false);
  await expectHit(bob, secret, "diary.txt", false);

  await shareWith(await pageAs(browser, A, "alice"), folder, ["bob"]);
  await expectHit(bob, word, "okapi.txt");
  await expectHit(bob, secret, "diary.txt", false);
});

test("right after a restart search still answers (name fallback while indexing)", async ({ browser }) => {
  await docker("restart", "scatola2");
  await waitUp(B);
  const started = Date.now();
  const alice = await pageAs(browser, B, "alice");
  await alice.goto("/files?search=diary");
  await expect(alice.getByText("diary.txt", { exact: true })).toBeVisible();
  expect(Date.now() - started).toBeLessThan(60_000);
});
