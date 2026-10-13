import "server-only";

import { lstat, rename } from "fs/promises";
import type { Stats } from "fs";
import type { FileMetadata } from "@/app/_types";
import { describeFile } from "@/app/_lib/file-scan";
import { describeFolder, FolderMetadata } from "@/app/_lib/folder-scan";
import { moveShares, sharesFor } from "@/app/_lib/shares";
import {
  Access,
  SHARED_ROOT,
  ScopedPath,
  scopedPath,
  StorageOwner,
} from "@/app/_lib/storage";

export const sharedBases = (owner: StorageOwner): ScopedPath[] =>
  sharesFor(owner.username).map((share) =>
    scopedPath(owner, `${SHARED_ROOT}/${share.id}`, Access.READ)
  );

const _roots = async (owner: StorageOwner) => {
  const roots: { scoped: ScopedPath; stats: Stats }[] = [];

  for (const scoped of sharedBases(owner)) {
    const stats = await lstat(scoped.absolute).catch(() => null);
    if (stats) roots.push({ scoped, stats });
  }

  return roots;
};

export const relocate = async (from: ScopedPath, to: ScopedPath): Promise<void> => {
  await rename(from.absolute, to.absolute);
  await moveShares(from.relative, to.relative);
};

export const sharedRootFiles = async (
  owner: StorageOwner
): Promise<FileMetadata[]> =>
  (await _roots(owner))
    .filter(({ stats }) => stats.isFile())
    .map(({ scoped, stats }) => describeFile(scoped, scoped.absolute, stats));

export const sharedRootFolders = async (
  owner: StorageOwner
): Promise<FolderMetadata[]> =>
  Promise.all(
    (await _roots(owner))
      .filter(({ stats }) => stats.isDirectory())
      .map(({ scoped }) => describeFolder(scoped, scoped.absolute))
  );
