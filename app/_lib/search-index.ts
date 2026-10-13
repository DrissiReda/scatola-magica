import "server-only";

import { mkdirSync, rmSync, Stats } from "fs";
import { lstat, readdir, readFile } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import os from "os";
import path from "path";
import AdmZip from "adm-zip";
import type { DatabaseSync } from "node:sqlite";
import { TEMP_DIR, UPLOAD_DIR } from "@/app/_lib/storage";
import { getFileMimeType } from "@/app/_lib/file-utils";
import { previewKind } from "@/app/_lib/preview-kind";
import { PreviewKind } from "@/app/_types/enums";
import { cacheBackend } from "@/app/_lib/cache";
import { isWatching } from "@/app/_lib/disk-watch";
import { logger } from "@/app/_lib/logger";

const SCOPE = "search-index";
const INDEX_DIR = path.resolve(
  process.env.SEARCH_INDEX_DIR || path.join(os.tmpdir(), "scatola-index")
);
const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_EXTRACT_BYTES = 50 * 1024 * 1024;
const RESULT_LIMIT = 500;
const OFFICE_XML = /^(word\/document|xl\/sharedStrings|xl\/worksheets\/sheet\d+|ppt\/slides\/slide\d+|content)\.xml$/;

interface IndexState {
  db: DatabaseSync;
  ready: boolean;
  queue: Set<string>;
  running: Promise<void> | null;
}

const globalStore = globalThis as typeof globalThis & { __searchIndex?: IndexState };

const _posix = (value: string) => value.split(path.sep).join("/");

const _xmlText = (xml: string) => xml.replace(/<[^>]+>/g, " ");

const _extract = async (absolute: string, size: number): Promise<string> => {
  if (size > MAX_EXTRACT_BYTES) return "";
  const kind = previewKind(absolute);

  if (kind === PreviewKind.TEXT || kind === PreviewKind.CSV) {
    return (await readFile(absolute)).subarray(0, MAX_TEXT_BYTES).toString("utf-8");
  }

  if (kind === PreviewKind.DOCUMENT || kind === PreviewKind.SHEET || kind === PreviewKind.SLIDES) {
    return new AdmZip(absolute)
      .getEntries()
      .filter((entry) => OFFICE_XML.test(entry.entryName))
      .map((entry) => _xmlText(entry.getData().toString("utf-8")))
      .join(" ");
  }

  if (kind === PreviewKind.PDF) {
    const run = promisify(execFile);
    const { stdout } = await run("pdftotext", ["-q", absolute, "-"], {
      maxBuffer: MAX_TEXT_BYTES * 4,
    });
    return stdout;
  }

  return "";
};

const _open = async (): Promise<DatabaseSync> => {
  // Rebuilt on every boot: the index is a local cache, never shared storage.
  rmSync(INDEX_DIR, { recursive: true, force: true });
  mkdirSync(INDEX_DIR, { recursive: true });

  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path.join(INDEX_DIR, "index.db"));
  db.exec(`CREATE VIRTUAL TABLE docs USING fts5(
    path UNINDEXED, stamp UNINDEXED, name, meta, body,
    tokenize = 'unicode61 remove_diacritics 2'
  )`);
  return db;
};

const _remove = (db: DatabaseSync, relative: string) =>
  db
    .prepare("DELETE FROM docs WHERE path = ? OR substr(path, 1, ?) = ?")
    .run(relative, relative.length + 1, `${relative}/`);

const _fields = async (absolute: string, relative: string, size: number) => {
  const name = path.basename(absolute);
  const meta = [path.dirname(relative), path.extname(name).slice(1), getFileMimeType(name)].join(" ");

  let body = "";
  try {
    body = await _extract(absolute, size);
  } catch (error) {
    logger.debug(SCOPE, `No content for ${relative}`, error);
  }

  return [name, meta, body];
};

const _visit = async (
  db: DatabaseSync,
  absolute: string,
  stats: Stats,
  known: Map<string, string>
) => {
  const relative = _posix(path.relative(UPLOAD_DIR, absolute));
  const stamp = `${stats.mtimeMs}:${stats.size}`;
  const previous = known.get(relative);
  known.delete(relative);
  if (previous === stamp) return;

  const fields = await _fields(absolute, relative, stats.size);
  _remove(db, relative);
  db.prepare("INSERT INTO docs (path, stamp, name, meta, body) VALUES (?, ?, ?, ?, ?)")
    .run(relative, stamp, ...fields);
};

const _walk = async (db: DatabaseSync, absolute: string, known: Map<string, string>) => {
  if (absolute === TEMP_DIR) return;
  const stats = await lstat(absolute).catch(() => null);

  if (stats?.isFile()) return _visit(db, absolute, stats, known);
  if (!stats?.isDirectory()) return;

  for (const entry of await readdir(absolute).catch(() => [])) {
    await _walk(db, path.join(absolute, entry), known);
  }
};

const _sync = async (db: DatabaseSync, relatives: string[]) => {
  for (const relative of relatives) {
    const rows = relative
      ? db.prepare("SELECT path, stamp FROM docs WHERE path = ? OR substr(path, 1, ?) = ?")
          .all(relative, relative.length + 1, `${relative}/`)
      : db.prepare("SELECT path, stamp FROM docs").all();
    const known = new Map(rows.map((row) => [String(row.path), String(row.stamp)]));

    await _walk(db, path.join(UPLOAD_DIR, relative), known);
    for (const missing of known.keys()) _remove(db, missing);
  }
};

const _drain = (state: IndexState) => {
  state.running ??= (async () => {
    while (state.queue.size > 0) {
      const batch = [...state.queue];
      state.queue.clear();
      await _sync(state.db, batch.includes("") ? [""] : batch).catch((error) =>
        logger.error(SCOPE, "Index sync failed", error)
      );
    }
    state.running = null;
  })();
};

export const queueIndex = async (relatives: string[]): Promise<void> => {
  const state = globalStore.__searchIndex;
  if (!state) return;

  for (const relative of relatives) state.queue.add(relative);
  _drain(state);
  await state.running;
};

// Not awaited by boot: search just falls back to name matching until ready.
export const startSearchIndex = async () => {
  if (globalStore.__searchIndex) return;

  const state: IndexState = { db: await _open(), ready: false, queue: new Set(), running: null };
  globalStore.__searchIndex = state;

  cacheBackend().listen((change) => queueIndex(change.paths.length > 0 ? change.paths : [""]));
  isWatching();

  const started = Date.now();
  await queueIndex([""]);
  state.ready = true;
  logger.info(SCOPE, `Search index built in ${Math.round((Date.now() - started) / 1000)}s`);
};

export const isSearchReady = () => !!globalStore.__searchIndex?.ready;

const _matchQuery = (query: string) =>
  query
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replace(/"/g, '""')}"*`)
    .join(" ");

// Returns upload-relative paths of matching files under any of the given roots.
export const searchIndex = (query: string, roots: string[]): string[] => {
  const state = globalStore.__searchIndex;
  const match = _matchQuery(query);
  if (!state || !match || roots.length === 0) return [];

  const within = roots.map(() => "(? = '' OR path = ? OR substr(path, 1, length(?) + 1) = ? || '/')");
  const params = roots.flatMap((root) => [root, root, root, root]);

  return state.db
    .prepare(`SELECT path FROM docs WHERE docs MATCH ? AND (${within.join(" OR ")}) ORDER BY rank LIMIT ${RESULT_LIMIT}`)
    .all(match, ...params)
    .map((row) => String(row.path));
};
