import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/app/_lib/request-auth";
import { Access, scopedPath } from "@/app/_lib/storage";
import { downloadResponse, pathErrorResponse } from "@/app/_lib/file-response";

export const GET = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const user = await validateRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const target = scopedPath(user, decodeURIComponent(id), Access.READ);
    return await downloadResponse(
      target.absolute,
      request.nextUrl.searchParams.get("view") === "true"
    );
  } catch (error) {
    return pathErrorResponse(error, "download");
  }
};
