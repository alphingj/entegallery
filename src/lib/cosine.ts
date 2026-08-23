export function parseDescriptor(desc: unknown): number[] | null {
  if (!desc) return null;
  let v: number[];
  if (typeof desc === "string") {
    v = desc
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "" && s !== "null")
      .map(Number)
      .filter((n) => Number.isFinite(n));
  } else if (Array.isArray(desc)) {
    v = (desc as number[]).filter((n) => typeof n === "number" && Number.isFinite(n));
  } else return null;
  return v.length === 512 ? v : null;
}

export function cosineDistance(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < 512; i++) {
    const av = a[i] ?? 0, bv = b[i] ?? 0;
    dot += av * bv; na += av * av; nb += bv * bv;
  }
  return 1 - dot / ((Math.sqrt(na) || 1) * (Math.sqrt(nb) || 1));
}

export function l2Normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

export function meanDescriptor(vecs: number[][]): number[] {
  if (vecs.length === 0) throw new Error("no vectors");
  const dim = 512;
  const sum = new Array(dim).fill(0);
  for (const v of vecs) for (let i = 0; i < dim; i++) sum[i] += v[i] ?? 0;
  for (let i = 0; i < dim; i++) sum[i] /= vecs.length;
  return l2Normalize(sum);
}
