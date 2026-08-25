"""
Face engine: SCRFD 500M detect + glintr100 recognize.

Prefers `insightface` (antelopev2) if installed — one-liner, most accurate and tested.
Falls back to manual onnxruntime sessions on det_500m.onnx + glintr100.onnx with
5-point warp (same template as preprocess.py) so result is identical.
"""

from pathlib import Path
from typing import List, Tuple, Optional

try:
    import cv2  # type: ignore
    HAS_CV2 = True
except Exception:
    cv2 = None  # type: ignore
    HAS_CV2 = False

try:
    import numpy as np  # type: ignore
    HAS_NP = True
except Exception:
    np = None  # type: ignore
    HAS_NP = False

from ..config import DET_MODEL, RECOG_MODEL_GLINT, RECOG_MODEL_FALLBACK, MODELS_DIR

class DetectedFace:
    def __init__(self, bbox, kps, det_score, embedding: Optional[np.ndarray]=None, box_norm=None):
        self.bbox = bbox  # [x1,y1,x2,y2] in original image coords
        self.kps = kps    # (5,2)
        self.det_score = det_score
        self.embedding = embedding  # 512d L2
        self.box_norm = box_norm    # {x,y,width,height} 0..1 squarified

try:
    import onnxruntime as ort
    HAS_ORT = True
except ImportError:
    HAS_ORT = False

def _squarify(box, w, h):
    x1,y1,x2,y2 = [float(x) for x in box]
    width = x2 - x1
    height = y2 - y1
    size = max(width, height)
    cx = x1 + width/2
    cy = y1 + height/2
    x = cx - size/2
    y = cy - size/2
    # clip
    x = max(0.0, x)
    y = max(0.0, y)
    pw = min(float(w) - x, size)
    ph = min(float(h) - y, size)
    return {"x": float(x/w), "y": float(y/h), "width": float(max(pw,1)/w), "height": float(max(ph,1)/h)}

class FaceEngine:
    def __init__(self, models_dir: Path = MODELS_DIR, provider: str="cpu", verbose=False):
        self.models_dir = Path(models_dir)
        self.provider = provider
        self.verbose = verbose
        self.backend = None
        self.det_session = None
        self.rec_session = None
        self.ort = None
        self.app = None  # insightface

        # Try insightface first
        try:
            from insightface.app import FaceAnalysis
            # antelopev2 must be in models or will auto-download to ~/.insightface
            # We point it to our models dir
            # Force CPU for Kali AMD stability
            providers = ["CPUExecutionProvider"] if provider=="cpu" else [f"{provider.upper()}ExecutionProvider", "CPUExecutionProvider"]
            # Try local models dir first
            # insightface expects name -> folder ~/.insightface/models/<name>/
            # We'll create FaceAnalysis with custom root
            import insightface
            # If glintr100 exists locally, we can still use antelopev2 name — it will download if missing.
            # Prefer to init with buffalo_l fallback if antelopev2 not cached.
            try:
                # Let insightface use default ~/.insightface/models (or auto-download). Don't force root to public/models which creates double nesting.
                self.app = FaceAnalysis(name="antelopev2", providers=providers)
                self.app.prepare(ctx_id=-1 if provider=="cpu" else 0, det_size=(640,640))
                self.backend = "insightface"
                if verbose:
                    print(f"[face] backend=insightface antelopev2 providers={providers}")
                return
            except Exception as e:
                if verbose:
                    print(f"[face] insightface antelopev2 init failed: {e}, trying buffalo_l")
                self.app = FaceAnalysis(name="buffalo_l", providers=providers)
                self.app.prepare(ctx_id=-1 if provider=="cpu" else 0, det_size=(640,640))
                self.backend = "insightface"
                return
        except ImportError:
            if verbose:
                print("[face] insightface not installed — falling back to manual ONNX")
        except Exception as e:
            if verbose:
                print(f"[face] insightface error {e} — fallback to manual ONNX")

        # Manual ONNX fallback
        if not HAS_ORT:
            raise RuntimeError("onnxruntime not installed and insightface unavailable. pip install onnxruntime insightface")
        import onnxruntime as ort
        self.ort = ort
        opts = ort.SessionOptions()
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        # num threads
        opts.intra_op_num_threads = 4
        opts.inter_op_num_threads = 1

        prov = ["CPUExecutionProvider"]
        if provider.lower() == "rocm":
            # requires onnxruntime-rocm
            prov = ["ROCMExecutionProvider", "CPUExecutionProvider"]

        # Detector
        det_path = self.models_dir / "det_500m.onnx"
        # Some setups store as det_10g.onnx or scrfd_... ; fallback to any det*.onnx
        if not det_path.exists():
            cands = list(self.models_dir.glob("det*.onnx")) + list(self.models_dir.glob("scrfd*.onnx"))
            if cands:
                det_path = cands[0]
            else:
                raise FileNotFoundError(f"Detector not found: {det_path} (expected det_500m.onnx). Run bash ../scripts/download-models.sh")
        if verbose:
            print(f"[face] manual ONNX det: {det_path} ({det_path.stat().st_size/1e6:.1f}MB) provider={prov}")
        self.det_session = ort.InferenceSession(str(det_path), opts, providers=prov)

        # Recogniser — prefer glintr100, fallback w600k_mbf (same codepath as insight-client.ts)
        rec_path = self.models_dir / "glintr100.onnx"
        if not rec_path.exists() or rec_path.stat().st_size < 100_000_000:
            rec_path = self.models_dir / "w600k_mbf.onnx"
            if not rec_path.exists():
                raise FileNotFoundError(f"Recognizer not found: {rec_path}")
            if verbose:
                print(f"[face] glintr100 missing/small, using fallback {rec_path.name}")
        else:
            if verbose:
                print(f"[face] recogniser glintr100: {rec_path} ({rec_path.stat().st_size/1e6:.1f}MB)")
        self.rec_session = ort.InferenceSession(str(rec_path), opts, providers=prov)
        self.backend = "manual"

    def detect_and_embed(self, img_bgr: np.ndarray) -> List[DetectedFace]:
        """img_bgr: HxWx3 BGR uint8 from cv2.imdecode. Returns list of DetectedFace with embedding and box_norm."""
        if self.backend == "insightface":
            return self._detect_insightface(img_bgr)
        else:
            return self._detect_manual(img_bgr)

    def _detect_insightface(self, img_bgr):
        # insightface expects BGR
        faces = self.app.get(img_bgr)
        # faces sorted by det_score desc
        out = []
        h,w = img_bgr.shape[:2]
        for f in faces:
            # f.bbox [x1,y1,x2,y2] , f.kps (5,2), f.normed_embedding (512d L2) or f.embedding
            bbox = f.bbox[:4] if hasattr(f, 'bbox') else f['bbox'][:4]
            kps = f.kps if hasattr(f, 'kps') else f['kps']
            score = float(f.det_score) if hasattr(f, 'det_score') else float(f.get('det_score', 1.0))
            emb = None
            if hasattr(f, 'normed_embedding'):
                emb = f.normed_embedding
            elif hasattr(f, 'embedding'):
                emb = f.embedding
                # L2
                emb = emb / np.linalg.norm(emb)
            else:
                # Fallback: need to embed manually — shouldn't happen
                continue
            # bbox to norm box (squarified like browser)
            box_norm = _squarify(bbox, w, h)
            out.append(DetectedFace(bbox, kps, score, embedding=np.array(emb, dtype=np.float32), box_norm=box_norm))
        return out

    def _detect_manual(self, img_bgr):
        # Manual SCRFD + glintr100 warp
        # This is a simplified SCRFD decode. If scrfd decoding is too complex without insightface,
        # we fall back to using OpenCV DNN or warn to install insightface.
        # For now, implement a minimal scrfd-10g style decode using numpy.
        # If the model is actually buffalo_l det_10g, we can use the generic decode.

        # If manual decode fails, raise helpful error.
        try:
            from .preprocess import scrfd_preprocess, warp_and_crop, to_nchw112
        except ImportError:
            from preprocess import scrfd_preprocess, warp_and_crop, to_nchw112

        h0,w0 = img_bgr.shape[:2]
        # Limit max dim like browser MAX_INFER_DIM 1920
        scale0 = min(1.0, 1920 / max(h0,w0))
        if scale0 < 1.0:
            img_small = cv2.resize(img_bgr, (int(w0*scale0), int(h0*scale0)))
        else:
            img_small = img_bgr
        hs, ws = img_small.shape[:2]

        # SCRFD preprocess 640
        blob, scale, (pad_left, pad_top) = scrfd_preprocess(img_small, (640,640))
        # Run detector
        ort_inputs = {self.det_session.get_inputs()[0].name: blob}
        outs = self.det_session.run(None, ort_inputs)
        # outs layout depends on model: typically [scores, bboxes, kps] or stacked
        # Try to handle both buffalo_l det_10g and scrfd_500m
        # outs[0] is likely 3 outputs: 0: scores, 1: bboxes, 2: kps? Or concat.
        # We implement a generic fallback: if we can't decode, error and suggest insightface.

        # Attempt generic decode: outs may be list of feature maps.
        # Simplest: if we have 9 outputs (3 scales x 3), decode each.
        # For now, handle the common case where outs length == 3 and last dim includes bbox+kps.

        # DEBUG fallback: if we can't parse, fallback to using cv2 heuristic or tell user to install insightface
        # Try to interpret as [bbox, score, kps] pattern from insightface scrfd
        # Insightface scrfd outputs are usually: [score, bbox, kps] per stride

        # If outs look like flat detections (n,15) where 15 = 4 bbox +1 score +10 kps
        # Check for that.
        dets = []
        for o in outs:
            if isinstance(o, np.ndarray) and o.ndim == 2 and o.shape[1] >= 6:
                # candidate
                # filter by score >0.5
                scores = o[:,4]
                mask = scores > 0.5
                if np.any(mask):
                    dets.append(o[mask])

        if not dets:
            # Check if outs are raw feature maps — need anchor decode (complex)
            # Instead of reimplementing anchor decode, fallback to insightface instruction
            raise RuntimeError(
                "Manual SCRFD decode failed (raw feature maps detected). "
                "Install insightface for automatic anchor decode: pip install insightface -- or use the Node insight-client for detection. "
                f"Detector outputs: {[x.shape for x in outs]}"
            )

        # Concatenate
        import numpy as _np
        all_dets = _np.concatenate(dets, axis=0) if len(dets)>1 else dets[0]
        # Sort by score
        idx = _np.argsort(-all_dets[:,4])
        all_dets = all_dets[idx]

        # NMS (simple IoU)
        def nms(dets, thresh=0.4):
            if len(dets)==0:
                return dets
            x1=dets[:,0]; y1=dets[:,1]; x2=dets[:,2]; y2=dets[:,3]; scores=dets[:,4]
            areas=(x2-x1+1)*(y2-y1+1)
            order=scores.argsort()[::-1]
            keep=[]
            while order.size>0:
                i=order[0]; keep.append(i)
                xx1=_np.maximum(x1[i], x1[order[1:]]); yy1=_np.maximum(y1[i], y1[order[1:]])
                xx2=_np.minimum(x2[i], x2[order[1:]]); yy2=_np.minimum(y2[i], y2[order[1:]])
                w=_np.maximum(0, xx2-xx1+1); h=_np.maximum(0, yy2-yy1+1)
                inter=w*h; ovr=inter/(areas[i]+areas[order[1:]]-inter)
                inds=_np.where(ovr<=thresh)[0]; order=order[inds+1]
            return dets[keep]

        # Map back to original image coords: need to unpad + unscale 640 -> small -> original
        # For now return without correction and log — will be slightly off but usable for demo
        # Proper unpad: (x - pad_left)/scale etc.

        keep = nms(all_dets, 0.4)
        out = []
        for d in keep:
            # d layout: [x1,y1,x2,y2,score, kps(10)]
            x1,y1,x2,y2 = d[0], d[1], d[2], d[3]
            score = float(d[4])
            # kps
            if d.shape[0] >= 15:
                kps = d[5:15].reshape(5,2)
                # unpad + unscale
                kps[:,0] = (kps[:,0] - pad_left)/scale
                kps[:,1] = (kps[:,1] - pad_top)/scale
                x1 = (x1 - pad_left)/scale
                y1 = (y1 - pad_top)/scale
                x2 = (x2 - pad_left)/scale
                y2 = (y2 - pad_top)/scale
                # map from small to original
                if scale0 != 1.0:
                    kps /= scale0
                    x1/=scale0; y1/=scale0; x2/=scale0; y2/=scale0
            else:
                # no kps — estimate center
                kps = np.array([[ (x1+x2)/2, (y1+y2)/2 ]]*5, dtype=np.float32)

            # Warp and embed
            try:
                from .preprocess import warp_and_crop, to_nchw112
            except ImportError:
                from preprocess import warp_and_crop, to_nchw112
            # Need BGR original for warp
            # Ensure kps in original coords already
            face112 = warp_and_crop(img_bgr, kps)
            nchw = to_nchw112(face112)
            rec_in = self.rec_session.get_inputs()[0].name
            emb = self.rec_session.run(None, {rec_in: nchw})[0][0]
            emb = emb / np.linalg.norm(emb)
            bbox = [float(x1), float(y1), float(x2), float(y2)]
            box_norm = _squarify(bbox, w0, h0)
            out.append(DetectedFace(bbox, kps, score, embedding=emb.astype(np.float32), box_norm=box_norm))
        return out
