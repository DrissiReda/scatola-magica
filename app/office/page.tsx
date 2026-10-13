import path from "path";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/app/_lib/current-user";
import { Access, scopedPath, StorageOwner } from "@/app/_lib/storage";
import {
  collaboraActionPath,
  documentKey,
  documentType,
  extensionOf,
  officeConfig,
  OfficeProvider,
  signAccessToken,
  signOnlyOffice,
  tokenTtlMs,
} from "@/app/_lib/office";
import OfficeEditor from "@/app/_components/FeatureComponents/Office/OfficeEditor";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ id?: string }>;
}

const _scoped = (user: StorageOwner, id: string, access: Access) => {
  try {
    return scopedPath(user, id, access);
  } catch {
    return null;
  }
};

// The office server must see one URL per document for every participant.
const _appUrl = async () => {
  const configured = process.env.OFFICE_APP_URL || process.env.APP_URL;
  if (configured) return configured.replace(/\/+$/, "");

  const list = await headers();
  return `${list.get("x-forwarded-proto") || "http"}://${list.get("host")}`;
};

const _discovery = async (internalUrl: string) => {
  try {
    const response = await fetch(`${internalUrl}/hosting/discovery`, { cache: "no-store" });
    return response.ok ? await response.text() : "";
  } catch {
    return "";
  }
};

export default async function OfficePage({ searchParams }: PageProps) {
  const { id = "" } = await searchParams;
  const user = await getCurrentUser();
  const config = officeConfig();
  const target = user && _scoped(user, id, Access.READ);
  const title = target ? path.basename(target.absolute) : "";
  if (!user || !config || !target || !documentType(title)) notFound();

  const canWrite = !!_scoped(user, id, Access.WRITE);
  const key = await documentKey(target.relative);
  const appUrl = await _appUrl();

  if (config.provider === OfficeProvider.ONLYOFFICE) {
    const editorConfig = {
      document: {
        fileType: extensionOf(title),
        key,
        title,
        url: `${appUrl}/api/office/file?key=${key}`,
        permissions: { edit: canWrite },
      },
      documentType: documentType(title),
      editorConfig: {
        callbackUrl: `${appUrl}/api/office/callback?key=${key}`,
        mode: canWrite ? "edit" : "view",
        user: { id: user.username, name: user.username },
      },
      height: "100%",
      width: "100%",
    };
    const token = await signOnlyOffice(editorConfig, config.jwtSecret!);

    return (
      <OfficeEditor
        title={title}
        onlyOffice={{ serverUrl: config.url, config: { ...editorConfig, token } }}
      />
    );
  }

  const actionPath = collaboraActionPath(await _discovery(config.internalUrl), extensionOf(title));
  const wopiSrc = encodeURIComponent(`${appUrl}/api/wopi/files/${key}`);

  return (
    <OfficeEditor
      title={title}
      collabora={
        actionPath
          ? {
              actionUrl: `${config.url}${actionPath}?WOPISrc=${wopiSrc}`,
              accessToken: await signAccessToken({ username: user.username, key, canWrite }),
              ttl: tokenTtlMs(),
            }
          : undefined
      }
    />
  );
}
