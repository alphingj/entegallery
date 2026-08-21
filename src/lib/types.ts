export interface BoundingBox {
  /** left edge, normalized 0..1 */
  x: number;
  /** top edge, normalized 0..1 */
  y: number;
  /** width, normalized 0..1 (squarified around face center at detect time) */
  width: number;
  height: number;
}

export interface DetectedFacePayload {
  descriptor: number[];
  box: BoundingBox;
}

export interface PhotoRow {
  id: string;
  google_drive_file_id: string;
  file_name: string | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  byte_size: number | null;
  thumbnail_url: string | null;
  created_at: string;
}

/** A specific person's appearance in a specific photo — drives CSS face crops. */
export interface FaceItem {
  faceId: string;
  photoId: string;
  fileId: string;
  fileName: string | null;
  thumbnailUrl: string | null;
  box: BoundingBox;
  /** natural image dimensions, needed for aspect-correct CSS crops */
  width: number | null;
  height: number | null;
  createdAt: string;
}

export interface PersonSummary {
  id: string;
  name: string;
  photoCount: number;
  /** representative (most recent) face used for the People-grid crop card */
  face: FaceItem | null;
}
