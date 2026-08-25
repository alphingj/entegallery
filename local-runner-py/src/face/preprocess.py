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

from pathlib import Path
from ..config import ARC_TEMPLATE, MAX_INFER_DIM

# Standard InsightFace warp: estimate similarity transform from 5 points to 112x112 template
def _estimate_norm(lmk: np.ndarray, image_size=112):
    """lmk: (5,2) float32 in image coords -> M 2x3 for warpAffine"""
    # ARC_TEMPLATE is for 112x112
    src = np.array(ARC_TEMPLATE, dtype=np.float32)
    # lmk should be (5,2)
    # Use cv2.estimateAffinePartial2D (similarity)
    M, _ = cv2.estimateAffinePartial2D(lmk, src, method=cv2.LMEDS)
    if M is None:
        # fallback: use getAffineTransform on first 3 points
        M = cv2.getAffineTransform(lmk[:3].astype(np.float32), src[:3].astype(np.float32))
    return M

def warp_and_crop(img: np.ndarray, lmk: np.ndarray, image_size=112) -> np.ndarray:
    """img: HxWx3 BGR uint8, lmk: (5,2) -> 112x112 BGR uint8"""
    M = _estimate_norm(lmk, image_size)
    warped = cv2.warpAffine(img, M, (image_size, image_size), borderValue=0)
    return warped

def to_nchw112(img112: np.ndarray) -> np.ndarray:
    """BGR 112x112 uint8 -> float32 NCHW 1x3x112x112 normalized (x-127.5)/127.5, RGB order"""
    # insight-client does RGB: data[idx] per channel loop
    # cv2 is BGR, so convert to RGB
    rgb = cv2.cvtColor(img112, cv2.COLOR_BGR2RGB)
    arr = rgb.astype(np.float32)
    arr = (arr - 127.5) / 127.5
    # HWC -> CHW
    chw = np.transpose(arr, (2,0,1))
    nchw = chw[np.newaxis, :, :, :]
    return nchw.astype(np.float32)

def resize_for_detect(img: np.ndarray, max_dim=MAX_INFER_DIM):
    h, w = img.shape[:2]
    scale = min(1.0, max_dim / max(h, w))
    if scale < 1.0:
        img = cv2.resize(img, (int(w*scale), int(h*scale)), interpolation=cv2.INTER_LINEAR)
    return img, scale

def l2_normalize(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v)
    if n == 0:
        return v
    return v / n

def squarify_box(box: list[float], w: int, h: int) -> dict:
    x,y,width,height = box
    size = max(width, height)
    x -= (size - width)/2
    y -= (size - height)/2
    width = height = size
    px = max(0, x)
    py = max(0, y)
    pw = min(w - px, width)
    ph = min(h - py, height)
    return {"x": px/w, "y": py/h, "width": max(pw,1)/w, "height": max(ph,1)/h}

# SCRFD preprocessing for detection (640 input)
def scrfd_preprocess(img: np.ndarray, input_size=(640,640)):
    """Resize + pad to input_size, normalize 127.5"""
    h,w = img.shape[:2]
    # keep aspect, pad
    scale = min(input_size[0]/h, input_size[1]/w)
    nh, nw = int(h*scale), int(w*scale)
    resized = cv2.resize(img, (nw, nh))
    # create 640x640 canvas with 114 padding (like yolov5)
    canvas = np.full((input_size[0], input_size[1], 3), 114, dtype=np.uint8)
    top = (input_size[0]-nh)//2
    left = (input_size[1]-nw)//2
    canvas[top:top+nh, left:left+nw] = resized
    # BGR->RGB, (x-127.5)/127.5, HWC->CHW, NCHW
    rgb = cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB).astype(np.float32)
    rgb = (rgb - 127.5)/127.5
    chw = np.transpose(rgb, (2,0,1))
    return chw[np.newaxis].astype(np.float32), scale, (left, top)
