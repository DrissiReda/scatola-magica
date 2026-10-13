"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { useRouter } from "next/navigation";

interface FileViewerContextValue {
  openFile: (fileId: string, fileName: string, fileUrl: string) => void;
  closeViewer: () => void;
  isOpen: boolean;
  currentFile: {
    id: string;
    name: string;
    url: string;
  } | null;
}

const FileViewerContext = createContext<FileViewerContextValue | null>(null);

export const useFileViewer = () => {
  const context = useContext(FileViewerContext);
  if (!context) {
    throw new Error("useFileViewer must be used within FileViewerProvider");
  }
  return context;
};

export default function FileViewerProvider({
  children,
  officeExtensions = [],
}: {
  children: ReactNode;
  officeExtensions?: string[];
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [currentFile, setCurrentFile] = useState<{
    id: string;
    name: string;
    url: string;
  } | null>(null);

  const openFile = useCallback((fileId: string, fileName: string, fileUrl: string) => {
    const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
    if (officeExtensions.includes(extension)) {
      router.push(`/office?id=${encodeURIComponent(fileId)}`);
      return;
    }

    setCurrentFile({ id: fileId, name: fileName, url: fileUrl });
    setIsOpen(true);
  }, [officeExtensions, router]);

  const closeViewer = useCallback(() => {
    setIsOpen(false);
    setTimeout(() => setCurrentFile(null), 200);
  }, []);

  return (
    <FileViewerContext.Provider value={{ openFile, closeViewer, isOpen, currentFile }}>
      {children}
    </FileViewerContext.Provider>
  );
}
