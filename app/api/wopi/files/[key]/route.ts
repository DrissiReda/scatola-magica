import { NextRequest, NextResponse } from "next/server";
import { stat } from "fs/promises";
import path from "path";
import { wopiAccess } from "@/app/_lib/office";

export const dynamic = "force-dynamic";

export const GET = async (
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) => {
  const { key } = await params;
  const access = await wopiAccess(request.nextUrl.searchParams.get("access_token"), key);
  if (!access) return new NextResponse(null, { status: 401 });

  const stats = await stat(access.absolute);
  const { username, canWrite } = access.grant;

  return NextResponse.json({
    BaseFileName: path.basename(access.absolute),
    Size: stats.size,
    Version: String(stats.mtimeMs),
    LastModifiedTime: stats.mtime.toISOString(),
    OwnerId: access.relative.split("/")[0],
    UserId: username,
    UserFriendlyName: username,
    UserCanWrite: canWrite,
    UserCanNotWriteRelative: true,
    SupportsUpdate: true,
  });
};
