import "server-only";

import crypto from "crypto";
import { readFile, rename, stat, writeFile } from "fs/promises";
import path from "path";
import { jwtVerify, SignJWT } from "jose";
import { CONFIG_DIR } from "@/app/_lib/auth-utils";
import { readJson, updateJson } from "@/app/_lib/json-store";
import { envOrFile } from "@/app/_lib/env";
import { resolveIn, UPLOAD_DIR } from "@/app/_lib/storage";

export enum OfficeProvider {
  ONLYOFFICE = "onlyoffice",
  COLLABORA = "collabora",
}

const DOCUMENT_TYPES: Record<string, string> = {
  doc: "word",
  docx: "word",
  odt: "word",
  rtf: "word",
  xls: "cell",
  xlsx: "cell",
  ods: "cell",
  ppt: "slide",
  pptx: "slide",
  odp: "slide",
};

export const OFFICE_EXTENSIONS = Object.keys(DOCUMENT_TYPES);

const KEYS_FILE = path.join(CONFIG_DIR, "office-keys.json");
const SECRET_FILE = path.join(CONFIG_DIR, "office-secret");
const TOKEN_TTL_SECONDS = 10 * 60 * 60;

export interface OfficeConfig {
  provider: OfficeProvider;
  url: string;
  internalUrl: string;
  jwtSecret?: string;
}

const _trim = (url: string) => url.replace(/\/+$/, "");

export const officeConfig = (): OfficeConfig | null => {
  const provider = process.env.OFFICE_PROVIDER as OfficeProvider;
  const url = process.env.OFFICE_URL;
  const jwtSecret = envOrFile("OFFICE_JWT_SECRET");

  if (!url || !Object.values(OfficeProvider).includes(provider)) return null;
  // OnlyOffice callbacks write files, so they must be signed.
  if (provider === OfficeProvider.ONLYOFFICE && !jwtSecret) return null;

  return {
    provider,
    url: _trim(url),
    internalUrl: _trim(process.env.OFFICE_INTERNAL_URL || url),
    jwtSecret,
  };
};

export const extensionOf = (name: string) => path.extname(name).slice(1).toLowerCase();

export const documentType = (name: string) => DOCUMENT_TYPES[extensionOf(name)];

interface DocKey {
  key: string;
  mtimeMs: number;
}

export const absoluteFor = (relative: string) => resolveIn(UPLOAD_DIR, relative);

// One key per real file: owner, admins and share recipients all join the same
// live session. A file changed outside the editor gets a fresh key.
export const documentKey = async (relative: string): Promise<string> => {
  const { mtimeMs } = await stat(absoluteFor(relative));

  return updateJson<Record<string, DocKey>, string>(KEYS_FILE, {}, (keys) => {
    if (keys[relative]?.mtimeMs !== mtimeMs) {
      keys[relative] = { key: crypto.randomBytes(24).toString("base64url"), mtimeMs };
    }
    return keys[relative].key;
  });
};

export const pathForKey = async (key: string): Promise<string | null> => {
  const keys = await readJson<Record<string, DocKey>>(KEYS_FILE, {});
  return Object.keys(keys).find((relative) => keys[relative].key === key) ?? null;
};

export const forgetKey = (relative: string, key: string): Promise<void> =>
  updateJson<Record<string, DocKey>>(KEYS_FILE, {}, (keys) => {
    if (keys[relative]?.key === key) delete keys[relative];
  });

export const saveDocument = async (relative: string, content: Buffer): Promise<number> => {
  const absolute = absoluteFor(relative);
  const temp = `${absolute}.${crypto.randomBytes(4).toString("hex")}.office`;

  await writeFile(temp, content);
  await rename(temp, absolute);

  const { mtimeMs } = await stat(absolute);
  await updateJson<Record<string, DocKey>>(KEYS_FILE, {}, (keys) => {
    if (keys[relative]) keys[relative].mtimeMs = mtimeMs;
  });
  return mtimeMs;
};

const _appSecret = async (): Promise<Uint8Array> => {
  try {
    await writeFile(SECRET_FILE, crypto.randomBytes(32).toString("hex"), { flag: "wx" });
  } catch {
    // Already created, possibly by another instance.
  }
  return new TextEncoder().encode(await readFile(SECRET_FILE, "utf-8"));
};

export interface AccessGrant {
  username: string;
  key: string;
  canWrite: boolean;
}

export const signAccessToken = async (grant: AccessGrant) =>
  new SignJWT({ key: grant.key, canWrite: grant.canWrite })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(grant.username)
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(await _appSecret());

export const verifyAccessToken = async (token: string, key: string): Promise<AccessGrant | null> => {
  try {
    const { payload } = await jwtVerify(token, await _appSecret());
    if (payload.key !== key || !payload.sub) return null;
    return { username: payload.sub, key, canWrite: payload.canWrite === true };
  } catch {
    return null;
  }
};

export const tokenTtlMs = () => Date.now() + TOKEN_TTL_SECONDS * 1000;

export const signOnlyOffice = async (payload: object, secret: string) =>
  new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .sign(new TextEncoder().encode(secret));

export const verifyOnlyOffice = async (token: string, secret: string) => {
  try {
    return (await jwtVerify(token, new TextEncoder().encode(secret))).payload;
  } catch {
    return null;
  }
};

// Only fetch saved documents from the office server itself (no SSRF), and
// reach it through the internal URL when the public one isn't routable.
export const officeDownloadUrl = (raw: string, config: OfficeConfig): string | null => {
  try {
    const target = new URL(raw);
    const publicUrl = new URL(config.url);
    const internalUrl = new URL(config.internalUrl);
    if (![publicUrl.host, internalUrl.host].includes(target.host)) return null;

    target.protocol = internalUrl.protocol;
    target.host = internalUrl.host;
    return target.toString();
  } catch {
    return null;
  }
};

const _attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

export const collaboraActionPath = (discoveryXml: string, extension: string): string | null => {
  const actions = (discoveryXml.match(/<action\b[^>]*>/g) ?? []).filter(
    (tag) => _attr(tag, "ext") === extension
  );
  const action = actions.find((tag) => _attr(tag, "name") === "edit") ?? actions[0];
  const urlsrc = action && _attr(action, "urlsrc");
  return urlsrc ? new URL(urlsrc).pathname : null;
};

export const wopiAccess = async (token: string | null, key: string) => {
  const grant = token ? await verifyAccessToken(token, key) : null;
  const relative = grant ? await pathForKey(key) : null;
  return grant && relative ? { grant, relative, absolute: absoluteFor(relative) } : null;
};

