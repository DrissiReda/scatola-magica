import Link from "next/link";
import { lstat } from "fs/promises";
import path from "path";
import { notFound } from "next/navigation";
import { linkedPath } from "@/app/_lib/storage";
import { scanFiles } from "@/app/_lib/file-scan";
import { scanFolders } from "@/app/_lib/folder-scan";
import { formatBytes } from "@/app/_lib/file-utils";
import Icon from "@/app/_components/GlobalComponents/Icons/Icon";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ token: string; path?: string[] }>;
}

const _encode = (relative: string) => relative.split("/").map(encodeURIComponent).join("/");

const _target = (token: string, relative: string) => {
  try {
    return linkedPath(token, relative);
  } catch {
    return null;
  }
};

export default async function PublicSharePage({ params }: PageProps) {
  const { token, path: segments = [] } = await params;
  const relative = segments.map(decodeURIComponent).join("/");
  const target = _target(token, relative);
  const stats = target && (await lstat(target.absolute).catch(() => null));
  if (!target || !stats) notFound();

  const download = (id: string) => `/api/public/${token}/${_encode(id)}`;
  const [folders, files] = stats.isDirectory()
    ? await Promise.all([scanFolders(target, target.absolute, false), scanFiles(target, target.absolute, false)])
    : [[], []];

  return (
    <main className="max-w-3xl mx-auto p-4 space-y-2">
      <h1 className="text-xl text-on-surface flex items-center gap-2">
        <Icon icon="share" />
        {path.basename(target.absolute)}
      </h1>

      {stats.isFile() && (
        <a href={download("")} className="flex items-center gap-2 text-primary hover:underline">
          <Icon icon="download" />
          Download ({formatBytes(stats.size)})
        </a>
      )}

      {relative && (
        <Link href={`/s/${token}/${_encode(path.posix.dirname(relative)).replace(/^\.$/, "")}`} className="flex items-center gap-2 p-2 text-on-surface-variant">
          <Icon icon="arrow_upward" />
          ..
        </Link>
      )}
      {folders.map((folder) => (
        <Link key={folder.id} href={`/s/${token}/${_encode(folder.id)}`} className="flex items-center gap-2 p-2 rounded hover:bg-surface-container">
          <Icon icon="folder" />
          {folder.name}
        </Link>
      ))}
      {files.map((file) => (
        <a key={file.id} href={download(file.id)} className="flex items-center gap-2 p-2 rounded hover:bg-surface-container">
          <Icon icon="description" />
          <span className="flex-1">{file.name}</span>
          <span className="text-sm text-on-surface-variant">{formatBytes(file.size)}</span>
        </a>
      ))}
    </main>
  );
}
