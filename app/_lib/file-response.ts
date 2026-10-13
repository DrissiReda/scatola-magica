import "server-only";

import { createReadStream } from "fs";
import { stat } from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import { getFileMimeType } from "@/app/_lib/file-utils";
import { PathEscapeError } from "@/app/_lib/storage";
import { logger } from "@/app/_lib/logger";

export const SANDBOX_CSP =
  "sandbox; default-src 'none'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'unsafe-inline'";

const INLINE_PREFIXES = ["image/", "video/", "audio/", "text/"];
const PDF_TYPE = "application/pdf";

const isInlineType = (mimeType: string): boolean =>
  mimeType === PDF_TYPE || INLINE_PREFIXES.some((p) => mimeType.startsWith(p));

export const contentDisposition = (
  type: "inline" | "attachment",
  fileName: string
): string => {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
};

export const streamFile = (absolute: string): ReadableStream<Uint8Array> =>
  Readable.toWeb(createReadStream(absolute)) as ReadableStream<Uint8Array>;

export const downloadResponse = async (
  absolute: string,
  inline: boolean
): Promise<NextResponse> => {
  const stats = await stat(absolute).catch(() => null);
  if (!stats?.isFile()) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const fileName = path.basename(absolute);
  const mimeType = getFileMimeType(fileName);
  const viewInline = inline && isInlineType(mimeType);

  const headers: Record<string, string> = {
    "Content-Type": mimeType,
    "Content-Length": stats.size.toString(),
    "Content-Disposition": contentDisposition(viewInline ? "inline" : "attachment", fileName),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (mimeType !== PDF_TYPE) headers["Content-Security-Policy"] = SANDBOX_CSP;

  return new NextResponse(streamFile(absolute), { headers });
};

export const pathErrorResponse = (
  error: unknown,
  scope: string
): NextResponse => {
  if (error instanceof PathEscapeError) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  logger.error(scope, "Request failed", error);
  return NextResponse.json({ error: "Request failed" }, { status: 500 });
};
