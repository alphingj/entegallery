export const HEIC_MIMES = new Set(["image/heic", "image/heif"]);

export function isHeic(mime?: string | null, name?: string | null): boolean {
  if (mime && HEIC_MIMES.has(mime.toLowerCase())) return true;
  if (name) {
    const ext = name.split(".").pop()?.toLowerCase();
    return ext === "heic" || ext === "heif";
  }
  return false;
}