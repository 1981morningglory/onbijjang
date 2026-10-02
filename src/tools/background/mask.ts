/** 배경 지우기에 쓰는 마스크 계산(순수 함수). 마스크 값은 0(배경)–255(남길 부분). */

export interface Rgb {
  r: number
  g: number
  b: number
}

export interface Bounds {
  x: number
  y: number
  w: number
  h: number
}

// ── 색으로 지우기 ─────────────────────────────────────────
export interface ColorKeyOptions {
  color: Rgb
  /** 0–100. 클수록 비슷한 색까지 배경으로 본다. */
  tolerance: number
  /** 0–100. 경계에서 반투명으로 넘어가는 폭 */
  softness: number
  /** true 면 사진 가장자리와 이어진 배경만 지운다(물건 안쪽의 같은 색은 남긴다). */
  contiguous: boolean
}

/** 사진 테두리에서 가장 흔한 색을 배경색으로 본다. */
export function detectBackgroundColor(rgba: Uint8ClampedArray, w: number, h: number): Rgb {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>()
  const add = (x: number, y: number) => {
    const i = (y * w + x) * 4
    if (rgba[i + 3] < 128) return
    const key = ((rgba[i] >> 4) << 8) | ((rgba[i + 1] >> 4) << 4) | (rgba[i + 2] >> 4)
    let b = buckets.get(key)
    if (!b) buckets.set(key, (b = { n: 0, r: 0, g: 0, b: 0 }))
    b.n++
    b.r += rgba[i]
    b.g += rgba[i + 1]
    b.b += rgba[i + 2]
  }
  const stepX = Math.max(1, Math.floor(w / 400))
  const stepY = Math.max(1, Math.floor(h / 400))
  for (let x = 0; x < w; x += stepX) {
    add(x, 0)
    add(x, h - 1)
  }
  for (let y = 0; y < h; y += stepY) {
    add(0, y)
    add(w - 1, y)
  }
  let best: { n: number; r: number; g: number; b: number } | null = null
  for (const b of buckets.values()) if (!best || b.n > best.n) best = b
  if (!best) return { r: 255, g: 255, b: 255 }
  return { r: Math.round(best.r / best.n), g: Math.round(best.g / best.n), b: Math.round(best.b / best.n) }
}

/** 고른 색과 비슷한 화소를 배경으로 보고 지운 마스크를 만든다. */
export function colorKeyMask(rgba: Uint8ClampedArray, w: number, h: number, opt: ColorKeyOptions): Uint8Array {
  const n = w * h
  // 색 거리(0–441)를 기준으로 tol 이하는 완전히 지우고, tol+soft 이상은 완전히 남긴다.
  const tol = (Math.max(0, Math.min(100, opt.tolerance)) / 100) * 220
  const soft = 2 + (Math.max(0, Math.min(100, opt.softness)) / 100) * 80
  const { r, g, b } = opt.color
  const alpha = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const p = i * 4
    if (rgba[p + 3] === 0) continue
    const dr = rgba[p] - r
    const dg = rgba[p + 1] - g
    const db = rgba[p + 2] - b
    const d = Math.sqrt(dr * dr + dg * dg + db * db)
    const t = (d - tol) / soft
    const a = t <= 0 ? 0 : t >= 1 ? 255 : Math.round(t * 255)
    alpha[i] = Math.min(a, rgba[p + 3])
  }
  if (!opt.contiguous) return alpha

  // 가장자리에서 시작해 배경색(완전히 남길 화소가 아닌 곳)을 따라 번져 간 곳만 지운다.
  const out = new Uint8Array(n).fill(255)
  for (let i = 0; i < n; i++) if (rgba[i * 4 + 3] === 0) out[i] = 0
  const seen = new Uint8Array(n)
  const queue = new Int32Array(n)
  let head = 0
  let tail = 0
  const push = (i: number) => {
    if (seen[i] || alpha[i] === 255) return
    seen[i] = 1
    queue[tail++] = i
  }
  for (let x = 0; x < w; x++) {
    push(x)
    push((h - 1) * w + x)
  }
  for (let y = 0; y < h; y++) {
    push(y * w)
    push(y * w + w - 1)
  }
  while (head < tail) {
    const i = queue[head++]
    out[i] = alpha[i]
    // 반투명 경계에서는 더 번지지 않는다(물건 안쪽으로 새는 것을 막는다).
    if (alpha[i] > 0) continue
    const x = i % w
    if (x > 0) push(i - 1)
    if (x < w - 1) push(i + 1)
    if (i >= w) push(i - w)
    if (i < n - w) push(i + w)
  }
  return out
}

// ── 크기 바꾸기·부드럽게 ──────────────────────────────────
/** 실수 배열을 쌍선형 보간으로 다른 크기로 만든다. */
export function resizeBilinear(src: Float32Array, sw: number, sh: number, dw: number, dh: number): Float32Array {
  const out = new Float32Array(dw * dh)
  const fx = sw / dw
  const fy = sh / dh
  for (let y = 0; y < dh; y++) {
    const sy = Math.max(0, Math.min(sh - 1, (y + 0.5) * fy - 0.5))
    const y0 = Math.floor(sy)
    const y1 = Math.min(sh - 1, y0 + 1)
    const wy = sy - y0
    for (let x = 0; x < dw; x++) {
      const sx = Math.max(0, Math.min(sw - 1, (x + 0.5) * fx - 0.5))
      const x0 = Math.floor(sx)
      const x1 = Math.min(sw - 1, x0 + 1)
      const wx = sx - x0
      const top = src[y0 * sw + x0] * (1 - wx) + src[y0 * sw + x1] * wx
      const bottom = src[y1 * sw + x0] * (1 - wx) + src[y1 * sw + x1] * wx
      out[y * dw + x] = top * (1 - wy) + bottom * wy
    }
  }
  return out
}

/** 반지름 r 인 상자 평균(가장자리는 있는 화소만 평균). 누적합으로 계산한다. */
export function boxMean(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  const acc = new Float64Array(Math.max(w, h) + 1)
  for (let y = 0; y < h; y++) {
    const row = y * w
    acc[0] = 0
    for (let x = 0; x < w; x++) acc[x + 1] = acc[x] + src[row + x]
    for (let x = 0; x < w; x++) {
      const a = Math.max(0, x - r)
      const b = Math.min(w - 1, x + r)
      tmp[row + x] = (acc[b + 1] - acc[a]) / (b - a + 1)
    }
  }
  for (let x = 0; x < w; x++) {
    acc[0] = 0
    for (let y = 0; y < h; y++) acc[y + 1] = acc[y] + tmp[y * w + x]
    for (let y = 0; y < h; y++) {
      const a = Math.max(0, y - r)
      const b = Math.min(h - 1, y + r)
      out[y * w + x] = (acc[b + 1] - acc[a]) / (b - a + 1)
    }
  }
  return out
}

/**
 * 작은 해상도의 마스크(coarse, 0–1)를 사진 해상도로 키우되, 사진의 밝기 경계를 따라가도록 다듬는다
 * (가이드 필터 — He 외, 빠른 계산을 위해 줄인 해상도에서 계수를 구해 다시 키운다).
 * 단순 확대보다 경계가 물건 윤곽에 붙고 계단이 덜 생긴다.
 */
export function guidedUpsample(coarse: Float32Array, cw: number, ch: number, guide: Uint8ClampedArray, w: number, h: number): Uint8Array {
  // 계수는 긴 변 약 512 로 줄인 해상도에서 구한다.
  const s = Math.max(1, Math.round(Math.max(w, h) / 512))
  const lw = Math.max(1, Math.round(w / s))
  const lh = Math.max(1, Math.round(h / s))
  const lum = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) lum[i] = (guide[i * 4] * 0.299 + guide[i * 4 + 1] * 0.587 + guide[i * 4 + 2] * 0.114) / 255
  const I = s === 1 ? lum : resizeBilinear(lum, w, h, lw, lh)
  const p = resizeBilinear(coarse, cw, ch, lw, lh)
  // 모델 해상도의 화소 한두 칸 정도를 다듬는 반경
  const r = Math.max(2, Math.round((Math.max(lw, lh) / Math.max(cw, ch)) * 2))
  const eps = 1e-3
  const n = lw * lh
  const Ip = new Float32Array(n)
  const II = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    Ip[i] = I[i] * p[i]
    II[i] = I[i] * I[i]
  }
  const mI = boxMean(I, lw, lh, r)
  const mp = boxMean(p, lw, lh, r)
  const mIp = boxMean(Ip, lw, lh, r)
  const mII = boxMean(II, lw, lh, r)
  const a = new Float32Array(n)
  const b = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const cov = mIp[i] - mI[i] * mp[i]
    const variance = mII[i] - mI[i] * mI[i]
    a[i] = cov / (variance + eps)
    b[i] = mp[i] - a[i] * mI[i]
  }
  const ma = boxMean(a, lw, lh, r)
  const mb = boxMean(b, lw, lh, r)
  const A = s === 1 ? ma : resizeBilinear(ma, lw, lh, w, h)
  const B = s === 1 ? mb : resizeBilinear(mb, lw, lh, w, h)
  const P = resizeBilinear(coarse, cw, ch, w, h)
  const out = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const q = A[i] * lum[i] + B[i]
    // 모델이 확신하는 곳(거의 0 또는 1)은 그대로 두고 경계 부근만 다듬은 값을 쓴다.
    const pv = P[i]
    const edge = 1 - Math.min(1, Math.abs(pv - 0.5) * 2.2)
    // 거의 확실한 값은 끝까지 밀어 물건 안쪽이 살짝 비치거나 배경에 옅은 얼룩이 남지 않게 한다.
    const v = (pv * (1 - edge) + q * edge - 0.03) / 0.94
    out[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255)
  }
  return out
}

/** 마스크를 흐리게(상자 흐림 3번 ≈ 가우시안). 캔버스 필터를 못 쓰는 브라우저용. */
export function blurAlpha(alpha: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const r = Math.round(radius)
  if (r < 1) return alpha.slice()
  let f: Float32Array = Float32Array.from(alpha)
  const each = Math.max(1, Math.round(r / 2))
  for (let i = 0; i < 3; i++) f = boxMean(f, w, h, each)
  const out = new Uint8Array(w * h)
  for (let i = 0; i < out.length; i++) out[i] = Math.round(f[i])
  return out
}

/** 남길 부분(값이 threshold 보다 큰 화소)을 둘러싼 상자. 없으면 null */
export function maskBounds(alpha: Uint8Array | Uint8ClampedArray, w: number, h: number, threshold = 24, stride = 1): Bounds | null {
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[(y * w + x) * stride + (stride - 1)] > threshold) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/**
 * 잘라 낸 물건(bounds 크기)을 outW×outH 가운데에 여백 %를 두고 놓을 때의 배율과 위치.
 * 여백은 짧은 변 기준 한쪽 여백의 비율이다.
 */
export function thumbLayout(bounds: Bounds, outW: number, outH: number, marginPct: number): { scale: number; x: number; y: number; w: number; h: number } {
  const margin = (Math.min(outW, outH) * Math.max(0, Math.min(45, marginPct))) / 100
  const boxW = Math.max(1, outW - margin * 2)
  const boxH = Math.max(1, outH - margin * 2)
  const scale = Math.min(boxW / bounds.w, boxH / bounds.h)
  const w = bounds.w * scale
  const h = bounds.h * scale
  return { scale, x: (outW - w) / 2, y: (outH - h) / 2, w, h }
}

/** 마스크에서 남는 부분의 비율(0–1). 결과가 비었는지·통째로 남았는지 알려 주는 데 쓴다. */
export function coverage(alpha: Uint8Array): number {
  let sum = 0
  for (let i = 0; i < alpha.length; i++) sum += alpha[i]
  return alpha.length ? sum / (alpha.length * 255) : 0
}
