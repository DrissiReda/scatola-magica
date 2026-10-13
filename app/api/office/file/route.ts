import { NextRequest, NextResponse } from "next/server";
import { absoluteFor, officeConfig, OfficeProvider, pathForKey, verifyOnlyOffice } from "@/app/_lib/office";
import { streamFile } from "@/app/_lib/file-response";

export const dynamic = "force-dynamic";

export const GET = async (request: NextRequest) => {
  const config = officeConfig();
  const relative = config ? await pathForKey(request.nextUrl.searchParams.get("key") ?? "") : null;
  if (config?.provider !== OfficeProvider.ONLYOFFICE || !config.jwtSecret || !relative) return new NextResponse(null, { status: 404 });

  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token || !(await verifyOnlyOffice(token, config.jwtSecret))) {
    return new NextResponse(null, { status: 403 });
  }

  return new NextResponse(streamFile(absoluteFor(relative)));
};
