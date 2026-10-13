import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { Access, linkedPath, scopedPath, UPLOAD_DIR } from "@/app/_lib/storage";
import { dropShares, moveShares, readShares, saveShare } from "@/app/_lib/shares";
import { sharedRootFiles, sharedRootFolders } from "@/app/_lib/shared-items";
import { scanFiles } from "@/app/_lib/file-scan";

const bob = { username: "bob", isAdmin: false };
const carol = { username: "carol", isAdmin: false };

mkdirSync(path.join(UPLOAD_DIR, "alice/Docs/sub"), { recursive: true });
writeFileSync(path.join(UPLOAD_DIR, "alice/Docs/a.txt"), "hello");
writeFileSync(path.join(UPLOAD_DIR, "alice/report.txt"), "report");

const shareId = (relative: string) => readShares().find((s) => s.path === relative)!.id;

test("read-only folder share", async () => {
  await saveShare("alice", "alice/Docs", ["bob"], false, false);
  const id = `~shared/${shareId("alice/Docs")}`;

  assert.equal(scopedPath(bob, id, Access.READ).absolute, path.join(UPLOAD_DIR, "alice/Docs"));
  assert.equal(scopedPath(bob, `${id}/a.txt`, Access.READ).relative, "alice/Docs/a.txt");
  assert.throws(() => scopedPath(bob, `${id}/a.txt`, Access.WRITE));
  assert.throws(() => scopedPath(bob, `${id}/a.txt`));
  assert.throws(() => scopedPath(carol, id, Access.READ));
  assert.throws(() => scopedPath(bob, `${id}/../../bob`, Access.READ));
  assert.throws(() => scopedPath(bob, "~shared/nope", Access.READ));
});

test("editable share protects its root", async () => {
  await saveShare("alice", "alice/Docs", ["bob"], true, false);
  const id = `~shared/${shareId("alice/Docs")}`;

  assert.ok(scopedPath(bob, id, Access.WRITE));
  assert.ok(scopedPath(bob, `${id}/a.txt`));
  assert.throws(() => scopedPath(bob, id));
});

test("shared items show up in the recipient root with prefixed ids", async () => {
  await saveShare("alice", "alice/report.txt", ["bob"], false, false);
  const folders = await sharedRootFolders(bob);
  const files = await sharedRootFiles(bob);

  assert.deepEqual(folders.map((f) => [f.name, f.shared, f.parentId]), [["Docs", true, null]]);
  assert.deepEqual(files.map((f) => [f.name, f.shared]), [["report.txt", true]]);
  assert.equal(files[0].id, `~shared/${shareId("alice/report.txt")}`);

  const inside = scopedPath(bob, folders[0].id, Access.READ);
  const listed = await scanFiles(inside, inside.absolute, false);
  assert.deepEqual(listed.map((f) => f.id), [`${folders[0].id}/a.txt`]);
  assert.deepEqual(await sharedRootFiles(carol), []);
});

test("shares follow renames and disappear on delete", async () => {
  await moveShares("alice/Docs", "alice/Papers");
  assert.ok(readShares().some((s) => s.path === "alice/Papers"));

  await dropShares("alice/Papers");
  await saveShare("alice", "alice/report.txt", [], false, false);
  assert.deepEqual(readShares(), []);
});

test("public links are read-only views of one item and can be revoked", async () => {
  await saveShare("alice", "alice/Docs", [], false, true);
  const link = readShares()[0].link!;

  assert.equal(linkedPath(link, "a.txt").relative, "alice/Docs/a.txt");
  assert.throws(() => linkedPath(link, "../report.txt"));
  assert.throws(() => linkedPath("nope"));
  assert.throws(() => linkedPath(""));
  assert.deepEqual(await sharedRootFolders(bob), [], "link-only shares stay out of user roots");

  await saveShare("alice", "alice/Docs", ["bob"], false, true);
  assert.equal(readShares()[0].link, link, "editing users keeps the link");

  await saveShare("alice", "alice/Docs", ["bob"], false, false);
  assert.throws(() => linkedPath(link));

  await saveShare("alice", "alice/Docs", [], false, false);
  assert.deepEqual(readShares(), []);
});
