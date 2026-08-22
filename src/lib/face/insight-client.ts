"use client";

import type { BoundingBox } from "@/lib/types";

// InsightFace buffalo_sc via onnxruntime-web (w600k_mbf = 512d ArcFace, MobileFaceNet)
// Detection still uses face-api SSD (proven) -> recognition via ONNX for 512d.

type FaceApi = typeof import("@vladmandic/face-api");

let faceApiPromise: Promise<FaceApi> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ortSessionPromise: Promise<any> | null = null;

async function loadDetection(): Promise<FaceApi> {
  if (!faceApiPromise) {
    faceApiPromise = (async () => {
      const faceapi = await import("@vladmandic/face-api");
      try {
        const tf = (faceapi as unknown as { tf: unknown }).tf as { setBackend: (s: string) => Promise<void>; ready: () => Promise<void>; getBackend: () => string } | undefined;
        if (tf?.setBackend) {
          await tf.setBackend("webgl");
          await tf.ready();
          console.log(`[face] tf backend: ${tf.getBackend()}`);
        }
      } catch {
        /* keep default */
      }
      const base = "/models";
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri(base),
        faceapi.nets.faceLandmark68Net.loadFromUri(base),
      ]);
      return faceapi;
    })().catch((e) => {
      faceApiPromise = null;
      throw e;
    });
  }
  return faceApiPromise;
}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadRecognition(): Promise<any> {
  if (!ortSessionPromise) {
    ortSessionPromise = (async () => {
      const ort = await import("onnxruntime-web");
      // Use CDN for wasm binaries — avoids copying to public/ort-wasm
      try {
        ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";
        // Single thread avoids needing COOP/COEP headers (which would break Drive thumbnails)
        ort.env.wasm.numThreads = 1;
      } catch {
        /* ignore */
      }
      // Try glintr100 250MB from external CDNs (stays under Vercel Free 100MB limit), fallback to local w600k_mbf 13MB
      const CANDIDATES = [
        "https://huggingface.co/deepinsight/insightface/resolve/main/models/antelopev2/glintr100.onnx",
        "https://cdn.jsdelivr.net/gh/deepinsight/insightface-zoo@main/models/antelopev2/glintr100.onnx",
        "https://github.com/deepinsight/insightface/releases/download/v0.7/antelopev2.zip",
      ];
      const CACHE_NAME = "insight-models-v1";
      let modelBuffer: ArrayBuffer | null = null;
      let lastErr: unknown = null;
      for (const MODEL_URL of CANDIDATES) {
        try {
          const isZip = MODEL_URL.endsWith(".zip");
          // try cache first
          try {
            const cache = await caches.open(CACHE_NAME);
            const cached = await cache.match(MODEL_URL);
            if (cached) {
              modelBuffer = await cached.arrayBuffer();
              console.log(`[insight] cache hit ${MODEL_URL} ${(modelBuffer.byteLength / 1e6).toFixed(1)}MB`);
              break;
            }
          } catch {
            /* cache not available */
          }
          console.log(`[insight] fetching ${MODEL_URL} ...`);
          const res = await fetch(MODEL_URL);
          if (!res.ok) throw new Error(`model fetch ${res.status} ${MODEL_URL}`);
          if (isZip) {
            // antelopev2.zip contains glintr100.onnx — extract via JSZip
            const JSZip = (await import("jszip")).default;
            const zipBuf = await res.arrayBuffer();
            const zip = await JSZip.loadAsync(zipBuf);
            const entry = Object.keys(zip.files).find((k) => k.endsWith("glintr100.onnx"));
            if (!entry) throw new Error("glintr100.onnx not in zip");
            modelBuffer = await zip.files[entry].async("arraybuffer");
          } else {
            try {
              const cache = await caches.open(CACHE_NAME);
              await cache.put(MODEL_URL, res.clone());
            } catch {
              /* ignore cache put failure */
            }
            modelBuffer = await res.arrayBuffer();
          }
          console.log(`[insight] fetched ${(modelBuffer.byteLength / 1e6).toFixed(1)}MB from ${MODEL_URL}`);
          break;
        } catch (e) {
          console.warn(`[insight] fetch failed for candidate`, e);
          lastErr = e;
          continue;
        }
      }
      if (!modelBuffer) {
        console.warn("[insight] all glintr100 candidates failed, falling back to local w600k_mbf 13MB", lastErr);
        const res = await fetch("/models/insight/w600k_mbf.onnx");
        if (!res.ok) throw new Error(`fallback w600k_mbf fetch ${res.status}`);
        modelBuffer = await res.arrayBuffer();
      }
      const session = await ort.InferenceSession.create(new Uint8Array(modelBuffer), {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      });
      console.log(`[insight] model loaded ${(modelBuffer.byteLength / 1e6).toFixed(1)}MB, inputs: ${session.inputNames.join(",")}`);
      return session;
    })().catch((e) => {
      ortSessionPromise = null;
      throw e;
    });
  }
  return ortSessionPromise;
}

const MAX_INFER_DIM = 1920;

function loadImageElement(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode image"));
    img.src = url;
  });
}

function drawScaled(img: HTMLImageElement): { canvas: HTMLCanvasElement; naturalWidth: number; naturalHeight: number } {
  const scale = Math.min(1, MAX_INFER_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
  return { canvas, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight };
}

function squarify(box: { x: number; y: number; width: number; height: number }, w: number, h: number): BoundingBox {
  let { x, y, width, height } = box;
  const size = Math.max(width, height);
  x -= (size - width) / 2;
  y -= (size - height) / 2;
  width = size;
  height = size;
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

/** Crop a face box (pixel coords on `canvas`) into a 112x112 canvas, with 20% margin. */
function cropFace112(canvas: HTMLCanvasElement, box: { x: number; y: number; width: number; height: number }): HTMLCanvasElement {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const size = Math.max(box.width, box.height) * 1.3; // 30% margin for better alignment
  const x0 = Math.max(0, Math.round(cx - size / 2));
  const y0 = Math.max(0, Math.round(cy - size / 2));
  const s = Math.min(size, Math.min(canvas.width - x0, canvas.height - y0));
  const out = document.createElement("canvas");
  out.width = 112;
  out.height = 112;
  const ctx = out.getContext("2d")!;
  ctx.drawImage(canvas, x0, y0, s, s, 0, 0, 112, 112);
  return out;
}

function canvasToNCHW112(canvas: HTMLCanvasElement): Float32Array {
  const ctx = canvas.getContext("2d")!;
  const { data } = ctx.getImageData(0, 0, 112, 112);
  const chw = new Float32Array(1 * 3 * 112 * 112);
  // Normalize to [-1, 1] as InsightFace expects (mean 127.5, std 127.5), NCHW, RGB order
  let p = 0;
  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < 112; y++) {
      for (let x = 0; x < 112; x++) {
        const idx = (y * 112 + x) * 4 + c; // data is RGBA
        chw[p++] = (data[idx] - 127.5) / 127.5;
      }
    }
  }
  // onnxruntime expects RGB; canvas data is RGBA, we already read R,G,B per c
  return chw;
}

function l2normalize(v: Float32Array | number[]): number[] {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const norm = Math.sqrt(sum) || 1;
  const out = new Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

export interface DetectedFace {
  descriptor: number[];
  box: BoundingBox;
}

export async function detectFaces(blob: Blob): Promise<{ faces: DetectedFace[]; width: number; height: number }> {
  const [faceapi, session] = await Promise.all([loadDetection(), loadRecognition()]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ort: any = await import("onnxruntime-web");

  const imgEl = await loadImageElement(blob);
  const prepared = drawScaled(imgEl);
  URL.revokeObjectURL(imgEl.src);

  const detections = await faceapi
    .detectAllFaces(prepared.canvas, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
    .withFaceLandmarks();

  const faces: DetectedFace[] = [];
  for (const det of detections) {
    const box = det.detection.box;
    const faceCanvas = cropFace112(prepared.canvas, box);
    const nchw = canvasToNCHW112(faceCanvas);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tensor = new (ort as any).Tensor("float32", nchw, [1, 3, 112, 112]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const feeds: Record<string, any> = {};
    feeds[session.inputNames[0]] = tensor;
    const results = await session.run(feeds);
    const outName = session.outputNames[0];
    const embedding = results[outName].data as Float32Array;
    // glintr100 outputs 512d, already L2-ish but normalize for cosine
    const descriptor = l2normalize(embedding as unknown as Float32Array);

    faces.push({
      descriptor,
      box: squarify(box, prepared.canvas.width, prepared.canvas.height),
    });
  }

  return { faces, width: prepared.naturalWidth, height: prepared.naturalHeight };
}

// Keep old name for compatibility with import-runner
export const loadFaceApi = loadDetection;
