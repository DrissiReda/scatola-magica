import { NextRequest } from "next/server";
import { linkedPath } from "@/app/_lib/storage";
import { downloadResponse, pathErrorResponse } from "@/app/_lib/file-response";

export const GET = async (
  request: NextRequest,
  { params }: { params: Promise<{ token: string; path?: string[] }> }
) => {
  try {
    const { token, path = [] } = await params;
    const target = linkedPath(token, path.map(decodeURIComponent).join("/"));
    return await downloadResponse(target.absolute, request.nextUrl.searchParams.get("view") === "true");
  } catch (error) {
    return pathErrorResponse(error, "public-download");
  }
};
