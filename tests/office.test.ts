import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, utimesSync, writeFileSync } from "fs";
import path from "path";
import { UPLOAD_DIR } from "@/app/_lib/storage";
import {
  collaboraActionPath,
  documentKey,
  forgetKey,
  officeDownloadUrl,
  OfficeProvider,
  pathForKey,
  saveDocument,
  signAccessToken,
  verifyAccessToken,
  wopiAccess,
} from "@/app/_lib/office";

const relative = "alice/Plan.docx";
const absolute = path.join(UPLOAD_DIR, relative);
mkdirSync(path.dirname(absolute), { recursive: true });
writeFileSync(absolute, "v1");

test("one document key per real file until it changes outside the editor", async () => {
  const key = await documentKey(relative);
  assert.equal(await documentKey(relative), key);
  assert.equal(await pathForKey(key), relative);

  await saveDocument(relative, Buffer.from("v2"));
  assert.equal(await documentKey(relative), key, "editor saves keep the live session");

  utimesSync(absolute, new Date(), new Date(Date.now() + 5000));
  const rotated = await documentKey(relative);
  assert.notEqual(rotated, key, "outside edits start a new session");

  await forgetKey(relative, rotated);
  assert.equal(await pathForKey(rotated), null);
});

test("WOPI access tokens are bound to user, key and write permission", async () => {
  const key = await documentKey(relative);
  const token = await signAccessToken({ username: "bob", key, canWrite: false });

  assert.deepEqual(await verifyAccessToken(token, key), { username: "bob", key, canWrite: false });
  assert.equal(await verifyAccessToken(token, "other-key"), null);
  assert.equal(await verifyAccessToken(`${token}x`, key), null);
  assert.equal((await wopiAccess(token, key))?.relative, relative);
  assert.equal(await wopiAccess(null, key), null);
});

test("saved documents are only downloaded from the office server", () => {
  const config = {
    provider: OfficeProvider.ONLYOFFICE,
    url: "https://office.example.com",
    internalUrl: "http://onlyoffice",
  };

  assert.equal(
    officeDownloadUrl("https://office.example.com/cache/files/x/output.docx?md5=1", config),
    "http://onlyoffice/cache/files/x/output.docx?md5=1"
  );
  assert.equal(officeDownloadUrl("http://169.254.169.254/latest", config), null);
  assert.equal(officeDownloadUrl("not a url", config), null);
});

test("collabora discovery picks the edit action for the extension", () => {
  const xml = `<wopi-discovery><net-zone name="external-http"><app name="writer">
    <action default="true" ext="docx" name="view" urlsrc="http://collabora:9980/browser/abc/cool.html?"/>
    <action ext="docx" name="edit" urlsrc="http://collabora:9980/browser/abc/cool.html?&lt;ui=UI_LLCC&amp;&gt;"/>
  </app></net-zone></wopi-discovery>`;

  assert.equal(collaboraActionPath(xml, "docx"), "/browser/abc/cool.html");
  assert.equal(collaboraActionPath(xml, "xlsx"), null);
});
