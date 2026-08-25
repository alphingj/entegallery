import math
from typing import List, Tuple, Optional

def cosine_distance(a, b) -> float:
    # a,b are 512d lists/np
    dot = sum(x*y for x,y in zip(a,b))
    na = math.sqrt(sum(x*x for x in a))
    nb = math.sqrt(sum(y*y for y in b))
    return 1 - dot / ((na or 1)*(nb or 1))

def mean_descriptor(vecs):
    if not vecs:
        raise ValueError("no vectors")
    dim = 512
    s = [0.0]*dim
    for v in vecs:
        for i in range(dim):
            s[i] += float(v[i] or 0)
    n = len(vecs)
    for i in range(dim):
        s[i] /= n
    # L2
    norm = math.sqrt(sum(x*x for x in s)) or 1
    return [x/norm for x in s]

def is_valid_descriptor(d) -> bool:
    return isinstance(d, (list, tuple)) and len(d)==512 and all(isinstance(x,(int,float)) and math.isfinite(x) for x in d)

def decide_match(candidates: List[dict], threshold: float, margin: float, floor: float):
    """candidates sorted by distance asc from rpc match_person_top2. Returns person_id or None -> create new."""
    if not candidates:
        return None
    best = candidates[0]
    second = candidates[1] if len(candidates)>1 else None
    if best["distance"] < floor:
        return best
    if second is None:
        return best if best["distance"] < threshold else None
    if best["distance"] < threshold and (second["distance"] - best["distance"] >= margin):
        return best
    return None
