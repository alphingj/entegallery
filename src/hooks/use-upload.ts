"use client";

import { useCallback, useRef, useState } from "react";
import { detectFaces } from "@/lib/face/client";
import { putFileToDrive, uploadConfirm, uploadInit } from "@/lib/api-client";

export type UploadStatus = "queued" | "detecting" | "uploading" | "done" | "error";

export interface UploadItem {
  id: string;
  file: File;
  status: UploadStatus;
  progress: number; // 0..100 for the Drive PUT phase
  error?: string;
  tagged?: { name: string }[];
}

/**
 * Orchestrates the full pipeline per file, sequentially (keeps tfjs memory sane):
 *   1. face detection in-browser  →  2. resumable session URI
 *   3. browser PUTs bytes to Drive  →  4. confirm: fileId + descriptors → DB
 */
export function useUpload(onDone?: () => void) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const runningRef = useRef(false);
  const queueRef = useRef<UploadItem[]>([]);

  const update = useCallback((id: string, patch: Partial<UploadItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const processQueue = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    while (queueRef.current.length > 0) {
      const item = queueRef.current.shift()!;
      try {
        update(item.id, { status: "detecting", progress: 0 });
        const { faces, width, height } = await detectFaces(item.file);

        update(item.id, { status: "uploading" });
        const { uploadUri } = await uploadInit({
          fileName: item.file.name,
          mimeType: item.file.type,
          byteSize: item.file.size,
        });
        const fileId = await putFileToDrive(uploadUri, item.file, (loaded) =>
          update(item.id, { progress: Math.round((loaded / item.file.size) * 100) })
        );

        const result = await uploadConfirm({
          fileId,
          fileName: item.file.name,
          mimeType: item.file.type,
          byteSize: item.file.size,
          width,
          height,
          faces,
        });
        update(item.id, { status: "done", tagged: result.tagged, progress: 100 });
      } catch (err) {
        update(item.id, {
          status: "error",
          error: err instanceof Error ? err.message : "Upload failed",
        });
      }
    }
    runningRef.current = false;
    onDone?.();
  }, [update, onDone]);

  const addFiles = useCallback(
    (files: File[]) => {
      const accepted = files.filter((f) => f.type.startsWith("image/"));
      if (accepted.length === 0) return;
      const newItems = accepted.map<UploadItem>((file) => ({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        status: "queued",
        progress: 0,
      }));
      setItems((prev) => [...prev, ...newItems]);
      queueRef.current.push(...newItems);
      void processQueue();
    },
    [processQueue]
  );

  const reset = useCallback(() => {
    queueRef.current = [];
    setItems([]);
  }, []);

  return { items, addFiles, reset };
}
