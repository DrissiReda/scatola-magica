import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import path from "path";
import AdmZip from "adm-zip";
import { UPLOAD_DIR } from "@/app/_lib/storage";
import { isSearchReady, queueIndex, searchIndex, startSearchIndex } from "@/app/_lib/search-index";

const file = (relative: string, content: string | Buffer) => {
  mkdirSync(path.dirname(path.join(UPLOAD_DIR, relative)), { recursive: true });
  writeFileSync(path.join(UPLOAD_DIR, relative), content);
};

const zipped = (entry: string, xml: string) => {
  const zip = new AdmZip();
  zip.addFile(entry, Buffer.from(xml));
  return zip.toBuffer();
};

const docx = (text: string) =>
  zipped("word/document.xml", `<w:document><w:p><w:t>${text}</w:t></w:p></w:document>`);

file("alice/notes/todo.txt", "buy unicorn food");
file("alice/Contrat Résumé.docx", docx("quarterly budget for élan project"));
file("bob/secret.md", "unicorn passwords");
file("alice/sheet.xlsx", zipped("xl/worksheets/sheet1.xml", `<worksheet><c t="inlineStr"><is><t>wallaby</t></is></c></worksheet>`));
file("temp/upload/chunk-0", "unicorn chunk");

test("index builds in the background and searches content and metadata", async () => {
  const boot = startSearchIndex();
  assert.equal(isSearchReady(), false);
  await boot;
  assert.equal(isSearchReady(), true);

  assert.deepEqual(searchIndex("unicorn", [""]).sort(), ["alice/notes/todo.txt", "bob/secret.md"]);
  assert.deepEqual(searchIndex("unicorn", ["alice"]), ["alice/notes/todo.txt"]);
  assert.deepEqual(searchIndex("quart budg", ["alice"]), ["alice/Contrat Résumé.docx"]);
  assert.deepEqual(searchIndex("elan", ["alice"]), ["alice/Contrat Résumé.docx"], "diacritics");
  assert.deepEqual(searchIndex("wallaby", ["alice"]), ["alice/sheet.xlsx"], "inline spreadsheet strings");
  assert.deepEqual(searchIndex("resume", ["alice"]), ["alice/Contrat Résumé.docx"], "file name");
  assert.deepEqual(searchIndex("notes", ["alice"]), ["alice/notes/todo.txt"], "folder metadata");
  assert.deepEqual(searchIndex("wordprocessingml", ["alice"]), ["alice/Contrat Résumé.docx"], "mime");
  assert.deepEqual(searchIndex("unicorn", ["alice/notes/todo.txt"]), ["alice/notes/todo.txt"]);
  assert.deepEqual(searchIndex("unicorn", ["ali"]), [], "roots are path segments");
  assert.deepEqual(searchIndex('"); DROP TABLE docs; --', [""]), []);
});

test("changes are picked up incrementally", async () => {
  file("alice/notes/todo.txt", "buy dragon food");
  rmSync(path.join(UPLOAD_DIR, "bob/secret.md"));
  await queueIndex(["alice/notes", "bob/secret.md"]);

  assert.deepEqual(searchIndex("unicorn", [""]), []);
  assert.deepEqual(searchIndex("dragon", [""]), ["alice/notes/todo.txt"]);
});
