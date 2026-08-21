import { BoundingBox, FaceItem } from "@/lib/types";

export type { FaceItem };

async function jsonFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return body as T;
}

// ---------- upload pipeline ----------

export interface InitResponse {
  uploadUri: string;
}

export const uploadInit = (body: { fileName: string; mimeType: string; byteSize: number }) =>
  jsonFetch<InitResponse>("/api/upload/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export interface ConfirmResponse {
  photoId: string;
  tagged: { personId: string; name: string }[];
}

export const uploadConfirm = (body: {
  fileId: string;
  fileName?: string;
  mimeType?: string;
  byteSize?: number;
  width?: number;
  height?: number;
  faces?: { descriptor: number[]; box: BoundingBox }[];
}) =>
  jsonFetch<ConfirmResponse>("/api/upload/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/** PUT the raw file straight to Drive's resumable session URI, with progress. */
export function putFileToDrive(
  uploadUri: string,
  file: File,
  onProgress: (loaded: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUri);
    xhr.setRequestHeader("Content-Type", file.type);
    if (file.size > 0) xhr.setRequestHeader("Content-Length", String(file.size));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status === 200 || xhr.status === 201) {
        try {
          resolve(JSON.parse(xhr.responseText).id as string);
        } catch {
          reject(new Error("Drive returned an unreadable upload response."));
        }
      } else {
        reject(new Error(`Drive upload failed (${xhr.status}).`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during Drive upload."));
    xhr.send(file);
  });
}

// ---------- reads ----------

export interface PhotosResponse {
  photos: {
    id: string;
    google_drive_file_id: string;
    file_name: string | null;
    width: number | null;
    height: number | null;
    thumbnail_url: string | null;
    created_at: string;
  }[];
  nextCursor: string | null;
}

export const fetchPhotos = (cursor?: string | null) =>
  jsonFetch<PhotosResponse>(`/api/photos${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);

export interface FaceBox {
  faceId: string;
  personId: string;
  name: string;
  box: BoundingBox;
}

export const fetchPhotoFaces = (photoId: string) =>
  jsonFetch<{ faces: FaceBox[] }>(`/api/photos/${photoId}/faces`);

export const fetchPersonFaces = (personId: string) =>
  jsonFetch<{ items: FaceItem[] }>(`/api/photos/by-person/${personId}`);

export interface PersonSummary {
  id: string;
  name: string;
  photoCount: number;
  face: (FaceItem & { width?: number; height?: number }) | null;
}

export const fetchPeople = (q?: string) =>
  jsonFetch<{ people: PersonSummary[] }>(`/api/people${q ? `?q=${encodeURIComponent(q)}` : ""}`);

export const renamePerson = (personId: string, name: string) =>
  jsonFetch<{ person: { id: string; name: string } }>(`/api/people/${personId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });

export const moveFace = (faceId: string, payload: { personId?: string; newName?: string }) =>
  jsonFetch<{ ok: boolean; personId: string }>(`/api/photo-faces/${faceId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

export const login = (password: string) =>
  jsonFetch<{ ok: boolean }>("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });

export const logout = () => fetch("/api/auth/logout", { method: "POST" });
