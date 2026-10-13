import "server-only";

import path from "path";
import { readShares, shareByLink } from "@/app/_lib/shares";
import { SHARED_ROOT } from "@/app/_lib/constants";

export { SHARED_ROOT };

export const UPLOAD_DIR = path.resolve(
  process.env.UPLOAD_DIR || "./data/uploads"
);
export const TEMP_DIR_NAME = "temp";
export const TEMP_DIR = path.join(UPLOAD_DIR, TEMP_DIR_NAME);
export const THUMBNAIL_DIR = path.resolve(
  process.env.THUMBNAIL_CACHE_DIR || "./data/thumbnails"
);

export const PATH_ESCAPE_ERROR = "Nice try, Houdini. Path is outside your box";

const MAX_NAME_LENGTH = 255;
const FORBIDDEN_NAME_CHARS = /[/\\\0]/;

export interface StorageOwner {
  username: string;
  isAdmin: boolean;
}

export interface IdBase {
  root: string;
  idPrefix: string;
}

export interface ScopedPath extends IdBase {
  absolute: string;
  relative: string;
}

// MANAGE = delete/rename/move the item itself. Default is the strictest so a
// forgotten call site fails closed on shared items.
export enum Access {
  READ,
  WRITE,
  MANAGE,
}

export class PathEscapeError extends Error {
  constructor() {
    super(PATH_ESCAPE_ERROR);
    this.name = "PathEscapeError";
  }
}

const _toPosix = (value: string): string => value.split(path.sep).join("/");

export const isInside = (base: string, target: string): boolean => {
  const relative = path.relative(base, target);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
};

export const isValidName = (name: unknown): name is string =>
  typeof name === "string" &&
  name.trim().length > 0 &&
  name.length <= MAX_NAME_LENGTH &&
  name !== "." &&
  name !== ".." &&
  name !== SHARED_ROOT &&
  !FORBIDDEN_NAME_CHARS.test(name);

export const userRoot = (owner: StorageOwner): string =>
  owner.isAdmin ? UPLOAD_DIR : path.join(UPLOAD_DIR, owner.username);

export const resolveIn = (base: string, relative = ""): string => {
  const absolute = path.resolve(path.join(base, relative || ""));

  if (!isInside(base, absolute) || isInside(TEMP_DIR, absolute)) {
    throw new PathEscapeError();
  }

  return absolute;
};

const _scoped = (base: IdBase, absolute: string): ScopedPath => ({
  ...base,
  absolute,
  relative: _toPosix(path.relative(UPLOAD_DIR, absolute)),
});

const _sharedPath = (
  owner: StorageOwner,
  relative: string,
  access: Access
): ScopedPath => {
  const [, shareId, ...rest] = relative.split("/");
  const share = readShares().find(
    (s) => s.id === shareId && s.users.includes(owner.username)
  );
  if (!share) throw new PathEscapeError();
  if (access !== Access.READ && !share.canEdit) throw new PathEscapeError();

  const root = resolveIn(UPLOAD_DIR, share.path);
  const absolute = resolveIn(root, rest.join("/"));
  if (access === Access.MANAGE && absolute === root) throw new PathEscapeError();

  return _scoped({ root, idPrefix: `${SHARED_ROOT}/${shareId}` }, absolute);
};

// Public links are read-only and scoped to the shared item.
export const linkedPath = (token: string, relative = ""): ScopedPath => {
  const share = shareByLink(token);
  if (!share) throw new PathEscapeError();

  const root = resolveIn(UPLOAD_DIR, share.path);
  return _scoped({ root, idPrefix: "" }, resolveIn(root, relative));
};

export const isSharedId = (id: string): boolean =>
  id === SHARED_ROOT || id.startsWith(`${SHARED_ROOT}/`);

export const ownBase = (owner: StorageOwner): IdBase => ({
  root: userRoot(owner),
  idPrefix: "",
});

export const scopedPath = (
  owner: StorageOwner,
  relative = "",
  access = Access.MANAGE
): ScopedPath => {
  if (isSharedId(relative)) return _sharedPath(owner, relative, access);
  return _scoped(ownBase(owner), resolveIn(userRoot(owner), relative));
};

export const scopedId = (base: IdBase, absolute: string): string => {
  const relative = _toPosix(path.relative(base.root, absolute));
  if (!base.idPrefix) return relative;
  return relative ? `${base.idPrefix}/${relative}` : base.idPrefix;
};
