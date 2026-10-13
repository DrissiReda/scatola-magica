import { NextRequest, NextResponse } from "next/server";
import { saveDocument, wopiAccess } from "@/app/_lib/office";
import { streamFile } from "@/app/_lib/file-response";
import { bustFileCache } from "@/app/_lib/cache/bust";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ key: string }> };

const _access = async (request: NextRequest, { params }: Context) =>
  wopiAccess(request.nextUrl.searchParams.get("access_token"), (await params).key);

export const GET = async (request: NextRequest, context: Context) => {
  const access = await _access(request, context);
  if (!access) return new NextResponse(null, { status: 401 });
  return new NextResponse(streamFile(access.absolute));
};

export const POST = async (request: NextRequest, context: Context) => {
  const access = await _access(request, context);
  if (!access) return new NextResponse(null, { status: 401 });
  if (!access.grant.canWrite) return new NextResponse(null, { status: 403 });

  const mtimeMs = await saveDocument(
    access.relative,
    Buffer.from(await request.arrayBuffer())
  );
  await bustFileCache(access.absolute);
  return NextResponse.json({ LastModifiedTime: new Date(mtimeMs).toISOString() });
};
