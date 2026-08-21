"use client";

import type { BoundingBox } from "@/lib/types";

type FaceApi = typeof import("@vladmandic/face-api");

let loaderPromise: Promise<FaceApi> | null = null;

/** Lazily loads face-api + weights (≈12MB, browser-cached after first visit). */
export function loadFaceApi(): Promise<FaceApi> {
  if (!loaderPromise) {
    loaderPromise = (async () => {
      const faceapi = await import("@vladmandic/face-api");
      const base = "/models";
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri(base),
        faceapi.nets.faceLandmark68Net.loadFromUri(base),
        faceapi.nets.faceRecognitionNet.loadFromUri(base),
      ]);
      return faceapi;
    })().catch((err) => {
      loaderPromise = null;
      throw err;
    });
  }
  return loaderPromise;
}

const MAX_INFER_DIM = 1600;

interface PreparedImage {
  canvas: HTMLCanvasElement;
  naturalWidth: number;
  naturalHeight: number;
}

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not decode ${file.name}`));
    img.src = url;
  });
}

function drawScaled(img: HTMLImageElement): PreparedImage {
  const scale = Math.min(1, MAX_INFER_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
  return { canvas, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight };
}

/**
 * Expand a pixel-space box into a square around its center (pre-normalization)
 * so CSS face crops work on containers of any aspect ratio.
 */
function squarify(box: { x: number; y: number; width: number; height: number }, w: number, h: number): BoundingBox {
  let { x, y, width, height } = box;
  const size = Math.max(width, height);
  x -= (size - width) / 2;
  y -= (size - height) / 2;
  width = size;
  height = size;

  // Clamp to image bounds (pixel space), then normalize.
  const px = Math.max(0, x);
  const py = Math.max(0, y);
  const pw = Math.min(w - px, width);
  const ph = Math.min(h - py, height);

  return {
    x: px / w,
    y: py / h,
    width: Math.max(pw, 1) / w,
    height: Math.max(ph, 1) / h,
  };
}

export interface DetectedFace {
  descriptor: number[];
  box: BoundingBox;
}

export async function detectFaces(file: File): Promise<{ faces: DetectedFace[]; width: number; height: number }> {
  const faceapi = await loadFaceApi();
  const imgEl = await loadImageElement(file);
  const prepared = drawScaled(imgEl);
  URL.revokeObjectURL(imgEl.src);

  const results = await faceapi
    .detectAllFaces(prepared.canvas, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptors();

  const faces = results.map((r) => ({
    descriptor: Array.from(r.descriptor),
    box: squarify(r.detection.box, prepared.canvas.width, prepared.canvas.height),
  }));

  return { faces, width: prepared.naturalWidth, height: prepared.naturalHeight };
}
