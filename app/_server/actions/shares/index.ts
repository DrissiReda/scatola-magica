"use server";

import { ServerActionResponse } from "@/app/_types";
import { getCurrentUser } from "@/app/_lib/current-user";
import { readUsers } from "@/app/_lib/auth-utils";
import { auditLog } from "@/app/_lib/audit-log";
import { saveShare, shareAt } from "@/app/_lib/shares";
import { isSharedId, scopedPath } from "@/app/_lib/storage";
import { bustFileCache } from "@/app/_lib/cache/bust";
import { logger } from "@/app/_lib/logger";

const SCOPE = "share-actions";
const UNAUTHORIZED = { success: false, error: "Unauthorized" };

export interface ShareSettings {
  users: string[];
  canEdit: boolean;
  link?: string;
}

const _ownTarget = async (itemId: string) => {
  const user = await getCurrentUser();
  if (!user || isSharedId(String(itemId))) return null;
  return { user, target: scopedPath(user, itemId) };
};

export const getShare = async (
  itemId: string
): Promise<ServerActionResponse<ShareSettings>> => {
  try {
    const own = await _ownTarget(itemId);
    if (!own) return UNAUTHORIZED;

    const share = shareAt(own.target.relative);
    return {
      success: true,
      data: {
        users: share?.users ?? [],
        canEdit: share?.canEdit ?? false,
        link: share?.link,
      },
    };
  } catch (error) {
    logger.warn(SCOPE, `Cannot read share for ${itemId}`, error);
    return { success: false, error: "Failed to read share" };
  }
};

export const updateShare = async (
  itemId: string,
  settings: { users: string[]; canEdit: boolean; withLink: boolean }
): Promise<ServerActionResponse> => {
  try {
    const own = await _ownTarget(itemId);
    if (!own) return UNAUTHORIZED;

    const known = new Set((await readUsers()).map((u) => u.username));
    const users = [...new Set(settings.users)].filter((name) => name !== own.user.username);
    const unknown = users.filter((name) => !known.has(name));
    if (unknown.length > 0) {
      return { success: false, error: `Unknown user: ${unknown.join(", ")}` };
    }

    await saveShare(
      own.user.username,
      own.target.relative,
      users,
      !!settings.canEdit,
      !!settings.withLink
    );
    await auditLog("share:update", {
      resource: own.target.relative,
      details: { users, canEdit: !!settings.canEdit, link: !!settings.withLink },
      success: true,
    });
    await bustFileCache(own.target.absolute);

    return { success: true };
  } catch (error) {
    logger.error(SCOPE, `Failed to share ${itemId}`, error);
    return { success: false, error: "Failed to update share" };
  }
};

export const listUsernames = async (): Promise<string[]> => {
  const user = await getCurrentUser();
  if (!user) return [];

  return (await readUsers())
    .map((u) => u.username)
    .filter((name) => name !== user.username);
};
