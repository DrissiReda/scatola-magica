import "server-only";

import { readFileSync, statSync } from "fs";
import path from "path";
import crypto from "crypto";
import { CONFIG_DIR } from "@/app/_lib/auth-utils";
import { updateJson } from "@/app/_lib/json-store";

export interface Share {
  id: string;
  owner: string;
  path: string;
  users: string[];
  canEdit: boolean;
  createdAt: string;
}

const SHARES_FILE = path.join(CONFIG_DIR, "shares.json");

let _cache: { stamp: string; shares: Share[] } | null = null;

// Sync so path scoping can stay sync. Re-read whenever the file changes
// (writes are atomic renames, so ino changes even with coarse mtimes).
export const readShares = (): Share[] => {
  let stamp: string;
  try {
    const stats = statSync(SHARES_FILE);
    stamp = `${stats.ino}:${stats.mtimeMs}`;
  } catch {
    return [];
  }

  if (_cache?.stamp !== stamp) {
    _cache = { stamp, shares: JSON.parse(readFileSync(SHARES_FILE, "utf-8")) };
  }
  return _cache.shares;
};

const _update = <R>(mutate: (shares: Share[]) => R) =>
  updateJson<Share[], R>(SHARES_FILE, [], mutate);

export const sharesFor = (username: string): Share[] =>
  readShares().filter((s) => s.users.includes(username));

export const shareAt = (relative: string): Share | null =>
  readShares().find((s) => s.path === relative) ?? null;

export const isShared = (relative: string): boolean => !!shareAt(relative);

export const saveShare = (
  owner: string,
  relative: string,
  users: string[],
  canEdit: boolean
): Promise<void> =>
  _update((shares) => {
    const index = shares.findIndex((s) => s.path === relative);

    if (users.length === 0) {
      if (index >= 0) shares.splice(index, 1);
      return;
    }

    if (index >= 0) {
      Object.assign(shares[index], { users, canEdit });
      return;
    }

    shares.push({
      id: crypto.randomBytes(9).toString("base64url"),
      owner,
      path: relative,
      users,
      canEdit,
      createdAt: new Date().toISOString(),
    });
  });

const _isWithin = (relative: string, base: string): boolean =>
  relative === base || relative.startsWith(`${base}/`);

const _touches = (relative: string): boolean =>
  readShares().some((s) => _isWithin(s.path, relative));

export const moveShares = async (from: string, to: string): Promise<void> => {
  if (!_touches(from)) return;

  await _update((shares) => {
    for (const share of shares) {
      if (_isWithin(share.path, from)) share.path = to + share.path.slice(from.length);
    }
  });
};

export const dropShares = async (relative: string): Promise<void> => {
  if (!_touches(relative)) return;

  await _update((shares) => {
    const kept = shares.filter((s) => !_isWithin(s.path, relative));
    shares.splice(0, shares.length, ...kept);
  });
};
