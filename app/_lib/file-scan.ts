import "server-only";

import { lstat, readdir } from "fs/promises";
import type { Stats } from "fs";
import path from "path";
import type { FileMetadata } from "@/app/_types";
import { getFileMimeType } from "@/app/_lib/file-utils";
import { IdBase, scopedId, TEMP_DIR, UPLOAD_DIR } from "@/app/_lib/storage";
import { isShared } from "@/app/_lib/shares";
import { logger } from "@/app/_lib/logger";

const SCOPE = "file-scan";

const _posix = (value: string): string => value.split(path.sep).join("/");

const _folderOf = (scanRoot: string, fileAbs: string): string | undefined => {
  const parent = _posix(path.relative(scanRoot, path.dirname(fileAbs)));
  return parent || undefined;
};

export const listEntries = async (dirAbs: string): Promise<string[]> => {
  try {
    const entries = await readdir(dirAbs);
    return entries.filter((entry) => path.join(dirAbs, entry) !== TEMP_DIR);
  } catch (error) {
    logger.warn(SCOPE, `Cannot read directory ${dirAbs}`, error);
    return [];
  }
};

export const describeFile = (
  base: IdBase,
  fullPath: string,
  stats: Stats,
  folderPath?: string
): FileMetadata => {
  const relative = _posix(path.relative(UPLOAD_DIR, fullPath));
  const name = path.basename(fullPath);

  return {
    id: scopedId(base, fullPath),
    name,
    originalName: name,
    size: stats.size,
    mimeType: getFileMimeType(name),
    uploadedAt: stats.mtime.getTime(),
    lastModified: stats.mtime.getTime(),
    path: `/uploads/${relative}`,
    folderPath,
    shared: isShared(relative) || undefined,
  };
};

export const scanFiles = async (
  base: IdBase,
  scanRoot: string,
  recursive: boolean,
  dirAbs: string = scanRoot
): Promise<FileMetadata[]> => {
  const files: FileMetadata[] = [];

  for (const entry of await listEntries(dirAbs)) {
    const fullPath = path.join(dirAbs, entry);

    try {
      const stats = await lstat(fullPath);

      if (stats.isFile()) {
        files.push(
          describeFile(
            base,
            fullPath,
            stats,
            recursive ? _folderOf(scanRoot, fullPath) : undefined
          )
        );
      } else if (stats.isDirectory() && recursive) {
        files.push(...(await scanFiles(base, scanRoot, true, fullPath)));
      }
    } catch (error) {
      logger.warn(SCOPE, `Cannot stat ${fullPath}`, error);
    }
  }

  return files;
};

export const countEntries = async (
  dirAbs: string
): Promise<{ fileCount: number; folderCount: number }> => {
  let fileCount = 0;
  let folderCount = 0;

  for (const entry of await listEntries(dirAbs)) {
    try {
      const stats = await lstat(path.join(dirAbs, entry));
      if (stats.isFile()) fileCount++;
      if (stats.isDirectory()) folderCount++;
    } catch (error) {
      logger.warn(SCOPE, `Cannot stat ${entry} in ${dirAbs}`, error);
    }
  }

  return { fileCount, folderCount };
};
