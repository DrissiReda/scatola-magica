import "server-only";

import { lstat } from "fs/promises";
import path from "path";
import { countEntries, listEntries } from "@/app/_lib/file-scan";
import { IdBase, scopedId, UPLOAD_DIR } from "@/app/_lib/storage";
import { isShared } from "@/app/_lib/shares";
import { logger } from "@/app/_lib/logger";

const SCOPE = "folder-scan";

export interface FolderMetadata {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
  updatedAt: number;
  fileCount?: number;
  folderCount?: number;
  shared?: boolean;
}

const _posix = (value: string): string => value.split(path.sep).join("/");

export const describeFolder = async (
  base: IdBase,
  absolute: string
): Promise<FolderMetadata> => {
  const stats = await lstat(absolute);
  const isRoot = absolute === base.root;
  const parentId = isRoot ? "" : scopedId(base, path.dirname(absolute));
  const counts = await countEntries(absolute);

  return {
    id: scopedId(base, absolute),
    name: path.basename(absolute),
    parentId: parentId && !parentId.startsWith("..") ? parentId : null,
    createdAt: stats.mtime.getTime(),
    updatedAt: stats.mtime.getTime(),
    shared: isShared(_posix(path.relative(UPLOAD_DIR, absolute))) || undefined,
    ...counts,
  };
};

export const scanFolders = async (
  base: IdBase,
  dirAbs: string,
  recursive: boolean
): Promise<FolderMetadata[]> => {
  const folders: FolderMetadata[] = [];

  for (const entry of await listEntries(dirAbs)) {
    const fullPath = path.join(dirAbs, entry);

    try {
      const stats = await lstat(fullPath);
      if (!stats.isDirectory()) continue;

      folders.push(await describeFolder(base, fullPath));

      if (recursive) {
        folders.push(...(await scanFolders(base, fullPath, true)));
      }
    } catch (error) {
      logger.warn(SCOPE, `Cannot read folder ${fullPath}`, error);
    }
  }

  return folders;
};

export const sortFolderTree = (folders: FolderMetadata[]): FolderMetadata[] =>
  [...folders].sort((a, b) =>
    a.parentId === b.parentId
      ? a.name.localeCompare(b.name)
      : (a.parentId || "").localeCompare(b.parentId || "")
  );
