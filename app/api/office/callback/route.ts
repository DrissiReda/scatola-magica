import { NextRequest, NextResponse } from "next/server";
import {
  absoluteFor,
  forgetKey,
  officeConfig,
  OfficeProvider,
  officeDownloadUrl,
  pathForKey,
  saveDocument,
  verifyOnlyOffice,
} from "@/app/_lib/office";
import { bustFileCache } from "@/app/_lib/cache/bust";
import { logger } from "@/app/_lib/logger";

export const dynamic = "force-dynamic";

const SCOPE = "onlyoffice-callback";

enum Status {
  SAVE = 2,
  CLOSED = 4,
  FORCE_SAVE = 6,
}

const _fail = (reason: string, status = 400) => {
  logger.warn(SCOPE, reason);
  return NextResponse.json({ error: 1 }, { status });
};

export const POST = async (request: NextRequest) => {
  const config = officeConfig();
  const key = request.nextUrl.searchParams.get("key") ?? "";
  const relative = config ? await pathForKey(key) : null;
  if (config?.provider !== OfficeProvider.ONLYOFFICE || !config.jwtSecret || !relative) return _fail("Unknown document key", 404);

  const body = await request.json().catch(() => ({}));
  const header = request.headers.get("authorization")?.replace(/^Bearer /, "");
  const signed = body.token
    ? await verifyOnlyOffice(body.token, config.jwtSecret)
    : header
      ? (await verifyOnlyOffice(header, config.jwtSecret))?.payload
      : null;

  const data = signed as { key?: string; status?: number; url?: string } | null;
  if (!data || data.key !== key) return _fail("Invalid callback signature", 403);

  if (data.status === Status.SAVE || data.status === Status.FORCE_SAVE) {
    const url = data.url && officeDownloadUrl(data.url, config);
    if (!url) return _fail("Refusing download from untrusted host");

    const response = await fetch(url);
    if (!response.ok) return _fail(`Download failed (${response.status})`, 502);
    await saveDocument(relative, Buffer.from(await response.arrayBuffer()));
    await bustFileCache(absoluteFor(relative));
    logger.info(SCOPE, `Saved ${relative}`);
  }

  // DocService caches documents per key; a closed session must get a new one.
  if (data.status === Status.SAVE || data.status === Status.CLOSED) {
    await forgetKey(relative, key);
  }

  return NextResponse.json({ error: 0 });
};
