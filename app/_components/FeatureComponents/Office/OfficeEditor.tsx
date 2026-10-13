"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import IconButton from "@/app/_components/GlobalComponents/Buttons/IconButton";

interface OfficeEditorProps {
  title: string;
  onlyOffice?: { serverUrl: string; config: object };
  collabora?: { actionUrl: string; accessToken: string; ttl: number };
}

declare global {
  interface Window {
    DocsAPI?: { DocEditor: new (id: string, config: object) => { destroyEditor: () => void } };
  }
}

const UNREACHABLE = "The office server could not be reached.";

type FrameEvents = { onError: (message: string) => void; onDirty: (dirty: boolean) => void };

function OnlyOfficeFrame({ serverUrl, config, onError, onDirty }: NonNullable<OfficeEditorProps["onlyOffice"]> & FrameEvents) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // DocsAPI swaps its placeholder for an iframe, so React must not own that node.
    const host = hostRef.current;
    const placeholder = document.createElement("div");
    placeholder.id = "onlyoffice-editor";
    host?.appendChild(placeholder);

    let editor: { destroyEditor: () => void } | undefined;
    const script = document.createElement("script");
    script.src = `${serverUrl}/web-apps/apps/api/documents/api.js`;
    script.onerror = () => onError(UNREACHABLE);
    script.onload = () => {
      editor = new window.DocsAPI!.DocEditor(placeholder.id, {
        ...config,
        events: {
          onError: (event: { data?: { errorDescription?: string } }) =>
            onError(event.data?.errorDescription || "The editor reported an error."),
          onDocumentStateChange: (event: { data: boolean }) => onDirty(event.data),
        },
      });
    };
    document.body.appendChild(script);

    return () => {
      editor?.destroyEditor();
      script.remove();
      host?.replaceChildren();
    };
  }, [serverUrl, config, onError, onDirty]);

  return <div ref={hostRef} className="h-full" />;
}

function CollaboraFrame({ actionUrl, accessToken, ttl }: NonNullable<OfficeEditorProps["collabora"]>) {
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => formRef.current?.submit(), []);

  return (
    <>
      <form ref={formRef} action={actionUrl} method="post" target="collabora-frame">
        <input type="hidden" name="access_token" value={accessToken} />
        <input type="hidden" name="access_token_ttl" value={ttl} />
      </form>
      <iframe
        name="collabora-frame"
        title="Collabora Online"
        className="w-full h-full border-0"
        allow="clipboard-read *; clipboard-write *; fullscreen"
      />
    </>
  );
}

export default function OfficeEditor({ title, onlyOffice, collabora }: OfficeEditorProps) {
  const router = useRouter();
  const [error, setError] = useState(onlyOffice || collabora ? "" : UNREACHABLE);

  const dirty = useRef(false);
  const flushed = useRef<() => void>(undefined);
  const onDirty = useCallback((value: boolean) => {
    dirty.current = value;
    if (!value) flushed.current?.();
  }, []);

  const close = async () => {
    // Edits typed in the last second are still on their way to the office server.
    if (dirty.current) {
      await new Promise<void>((resolve) => {
        flushed.current = resolve;
        setTimeout(resolve, 10_000);
      });
    }
    if (window.history.length > 1) router.back();
    else router.push("/files");
  };

  return (
    <div className="h-dvh flex flex-col bg-surface">
      <header className="flex items-center gap-2 px-2 py-1 border-b border-outline-variant">
        <IconButton icon="arrow_back" ariaLabel="Close editor" onClick={close} />
        <h1 className="text-sm text-on-surface truncate">{title}</h1>
      </header>
      <main className="flex-1 min-h-0 relative">
        {onlyOffice && <OnlyOfficeFrame {...onlyOffice} onError={setError} onDirty={onDirty} />}
        {collabora && <CollaboraFrame {...collabora} />}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface/90">
            <p className="text-error">{error}</p>
          </div>
        )}
      </main>
    </div>
  );
}
