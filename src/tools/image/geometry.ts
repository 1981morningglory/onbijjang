/**
 * 이미지 편집의 순수 계산: 회전·반전 좌표, 자르기, 출력 크기, 꾸미기 물체의 이동·크기 조절.
 * 캔버스를 쓰지 않아 그대로 단위 테스트할 수 있다.
 */
import { isLine, type Annotation, type BatchSettings, type Box, type PhotoEdits, type Point, type Rect, type ResolvedBatch } from './types'

export const EMPTY_EDITS: PhotoEdits = { quarter: 0, angle: 0, flipH: false, flipV: false, crop: null, objects: [] }

export function isEdited(e: PhotoEdits): boolean {
  return e.quarter !== 0 || e.angle !== 0 || e.flipH || e.flipV || e.crop !== null || e.objects.length > 0
}

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

// ── 행렬 ──────────────────────────────────────────────────
/** 캔버스 2D 와 같은 꼴: x' = a·x + c·y + e, y' = b·x + d·y + f */
export interface Matrix {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export function applyMatrix(m: Matrix, p: Point): Point {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f }
}

/** m1 ∘ m2 — m2 를 먼저 적용한다. */
export function multiply(m1: Matrix, m2: Matrix): Matrix {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  }
}

export function invert(m: Matrix): Matrix {
  const det = m.a * m.d - m.b * m.c
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  }
}

// ── 회전·반전 ─────────────────────────────────────────────
type Orientation = Pick<PhotoEdits, 'quarter' | 'angle' | 'flipH' | 'flipV'>

export function totalAngle(e: Orientation): number {
  return e.quarter * 90 + e.angle
}

/** 90° 배수에서 오차 없이 떨어지는 cos·sin */
export function trig(deg: number): { cos: number; sin: number } {
  const n = ((deg % 360) + 360) % 360
  if (n === 0) return { cos: 1, sin: 0 }
  if (n === 90) return { cos: 0, sin: 1 }
  if (n === 180) return { cos: -1, sin: 0 }
  if (n === 270) return { cos: 0, sin: -1 }
  const r = (n * Math.PI) / 180
  return { cos: Math.cos(r), sin: Math.sin(r) }
}

/** 돌린 뒤 사진 전체를 담는 상자 크기 */
export function orientedSize(w: number, h: number, e: Orientation): { w: number; h: number } {
  const { cos, sin } = trig(totalAngle(e))
  return { w: Math.abs(w * cos) + Math.abs(h * sin), h: Math.abs(w * sin) + Math.abs(h * cos) }
}

/** 원본 픽셀 좌표 → 돌리고 뒤집은 뒤의 좌표 */
export function orientationMatrix(w: number, h: number, e: Orientation): Matrix {
  const { cos, sin } = trig(totalAngle(e))
  const size = orientedSize(w, h, e)
  const fx = e.flipH ? -1 : 1
  const fy = e.flipV ? -1 : 1
  // T(size/2) · R(θ) · S(fx, fy) · T(-w/2, -h/2)
  const a = cos * fx
  const b = sin * fx
  const c = -sin * fy
  const d = cos * fy
  return { a, b, c, d, e: size.w / 2 - (a * w) / 2 - (c * h) / 2, f: size.h / 2 - (b * w) / 2 - (d * h) / 2 }
}

/** 회전으로 생긴 빈 모서리가 들어가지 않는, 사진과 같은 비율의 가장 큰 가운데 영역 */
export function inscribedRect(w: number, h: number, e: Orientation): Rect {
  const size = orientedSize(w, h, e)
  if (e.angle === 0) return { x: 0, y: 0, w: size.w, h: size.h }
  // 90° 회전까지 반영한 사진 크기
  const odd = e.quarter % 2 === 1
  const pw = odd ? h : w
  const ph = odd ? w : h
  const { cos, sin } = trig(Math.abs(e.angle))
  const s = Math.min(pw / (pw * cos + ph * sin), ph / (pw * sin + ph * cos))
  const rw = pw * s
  const rh = ph * s
  return { x: (size.w - rw) / 2, y: (size.h - rh) / 2, w: rw, h: rh }
}

export function clampRect(r: Rect, bw: number, bh: number, min = 1): Rect {
  const w = clamp(r.w, Math.min(min, bw), bw)
  const h = clamp(r.h, Math.min(min, bh), bh)
  return { x: clamp(r.x, 0, bw - w), y: clamp(r.y, 0, bh - h), w, h }
}

/** 실제로 쓰이는 자르기 영역(돌린 뒤 좌표). 직접 정한 값이 없으면 자동 영역. */
export function effectiveCrop(w: number, h: number, e: PhotoEdits): Rect {
  if (!e.crop) return inscribedRect(w, h, e)
  const size = orientedSize(w, h, e)
  return clampRect(e.crop, size.w, size.h)
}

const norm180 = (deg: number) => {
  const n = ((deg % 360) + 360) % 360
  return n > 180 ? n - 360 : n
}

function mapRotation(rotation: number, m: Matrix, keepUpright: boolean): number {
  const r = (rotation * Math.PI) / 180
  const ux = m.a * Math.cos(r) + m.c * Math.sin(r)
  const uy = m.b * Math.cos(r) + m.d * Math.sin(r)
  let next = (Math.atan2(uy, ux) * 180) / Math.PI
  // 뒤집힐 때 글자가 거울상이 되지 않도록, 두 후보 중 원래 각도에 가까운 쪽을 고른다.
  if (keepUpright && m.a * m.d - m.b * m.c < 0 && Math.abs(norm180(next - rotation)) > 90) next += 180
  next = norm180(next)
  return Math.abs(next) < 1e-9 ? 0 : Math.round(next * 1e6) / 1e6
}

export function transformObject(o: Annotation, m: Matrix): Annotation {
  if (isLine(o)) {
    const p1 = applyMatrix(m, { x: o.x1, y: o.y1 })
    const p2 = applyMatrix(m, { x: o.x2, y: o.y2 })
    return { ...o, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }
  }
  const c = applyMatrix(m, { x: o.cx, y: o.cy })
  return { ...o, cx: c.x, cy: c.y, rotation: mapRotation(o.rotation, m, o.type === 'text') }
}

/**
 * 회전·반전 값을 바꾸면서 자르기 영역과 꾸미기 물체가 사진의 같은 자리를 따라가게 한다.
 */
export function reorient(w: number, h: number, edits: PhotoEdits, next: Orientation): PhotoEdits {
  const target: Orientation = { quarter: next.quarter, angle: next.angle, flipH: next.flipH, flipV: next.flipV }
  const m = multiply(orientationMatrix(w, h, target), invert(orientationMatrix(w, h, edits)))
  const size = orientedSize(w, h, target)
  let crop: Rect | null = null
  if (edits.crop) {
    const axisAligned = (Math.abs(m.b) < 1e-9 && Math.abs(m.c) < 1e-9) || (Math.abs(m.a) < 1e-9 && Math.abs(m.d) < 1e-9)
    if (axisAligned) {
      const p1 = applyMatrix(m, { x: edits.crop.x, y: edits.crop.y })
      const p2 = applyMatrix(m, { x: edits.crop.x + edits.crop.w, y: edits.crop.y + edits.crop.h })
      crop = { x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), w: Math.abs(p2.x - p1.x), h: Math.abs(p2.y - p1.y) }
    } else {
      const c = applyMatrix(m, { x: edits.crop.x + edits.crop.w / 2, y: edits.crop.y + edits.crop.h / 2 })
      crop = { x: c.x - edits.crop.w / 2, y: c.y - edits.crop.h / 2, w: edits.crop.w, h: edits.crop.h }
    }
    crop = clampRect(crop, size.w, size.h)
  }
  return { ...edits, ...target, crop, objects: edits.objects.map((o) => transformObject(o, m)) }
}

/** 지금 보이는 모습 기준으로 90° 돌린다(dir 1 = 시계 방향). */
export function rotateQuarter(w: number, h: number, edits: PhotoEdits, dir: 1 | -1): PhotoEdits {
  return reorient(w, h, edits, { ...edits, quarter: ((edits.quarter + dir + 4) % 4) as PhotoEdits['quarter'] })
}

/** 지금 보이는 모습 기준으로 좌우(h)·상하(v) 반전한다. */
export function flipView(w: number, h: number, edits: PhotoEdits, axis: 'h' | 'v'): PhotoEdits {
  // 보이는 화면을 뒤집는 것은 "원본을 뒤집고 반대 방향으로 돌린 것"과 같다: F·R(θ) = R(-θ)·F
  return reorient(w, h, edits, {
    quarter: ((4 - edits.quarter) % 4) as PhotoEdits['quarter'],
    angle: edits.angle === 0 ? 0 : -edits.angle,
    flipH: axis === 'h' ? !edits.flipH : edits.flipH,
    flipV: axis === 'v' ? !edits.flipV : edits.flipV,
  })
}

export function setAngle(w: number, h: number, edits: PhotoEdits, angle: number): PhotoEdits {
  return reorient(w, h, edits, { ...edits, angle: clamp(angle, -45, 45) })
}

// ── 자르기 조작 ───────────────────────────────────────────
export type CropHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'move'

export const CROP_RATIOS = [
  { value: 'free', label: '자유', ratio: null },
  { value: '1:1', label: '1:1', ratio: 1 },
  { value: '4:3', label: '4:3', ratio: 4 / 3 },
  { value: '16:9', label: '16:9', ratio: 16 / 9 },
  { value: '3:4', label: '3:4', ratio: 3 / 4 },
  { value: '9:16', label: '9:16', ratio: 9 / 16 },
] as const
export type CropRatioKey = (typeof CROP_RATIOS)[number]['value']

/** base 안에 가운데 맞춤으로 들어가는, 비율(가로/세로) ratio 의 가장 큰 영역 */
export function fitRatio(base: Rect, ratio: number): Rect {
  let w = base.w
  let h = w / ratio
  if (h > base.h) {
    h = base.h
    w = h * ratio
  }
  return { x: base.x + (base.w - w) / 2, y: base.y + (base.h - h) / 2, w, h }
}

/**
 * 자르기 영역의 손잡이를 (dx, dy) 만큼 끌었을 때의 새 영역.
 * bounds 밖으로 나가지 않고, ratio 가 있으면 비율을 지킨다.
 */
export function dragCrop(start: Rect, handle: CropHandle, dx: number, dy: number, bounds: { w: number; h: number }, ratio: number | null, min = 8): Rect {
  const bw = bounds.w
  const bh = bounds.h
  if (handle === 'move') {
    return { ...start, x: clamp(start.x + dx, 0, Math.max(0, bw - start.w)), y: clamp(start.y + dy, 0, Math.max(0, bh - start.h)) }
  }
  const east = handle.includes('e')
  const west = handle.includes('w')
  const north = handle.includes('n')
  const south = handle.includes('s')
  let l = start.x
  let t = start.y
  let r = start.x + start.w
  let b = start.y + start.h

  if (ratio == null) {
    if (east) r = clamp(r + dx, l + min, bw)
    if (west) l = clamp(l + dx, 0, r - min)
    if (south) b = clamp(b + dy, t + min, bh)
    if (north) t = clamp(t + dy, 0, b - min)
    return { x: l, y: t, w: r - l, h: b - t }
  }

  const minW = Math.max(min, min * ratio)
  if ((east || west) && (north || south)) {
    // 모서리: 맞은편 모서리를 고정한다.
    const ax = east ? l : r
    const ay = south ? t : b
    const wantW = Math.abs((east ? r + dx : l + dx) - ax)
    const wantH = Math.abs((south ? b + dy : t + dy) - ay)
    let w = Math.max(wantW, wantH * ratio, minW)
    const maxW = east ? bw - ax : ax
    const maxH = south ? bh - ay : ay
    w = Math.min(w, maxW, maxH * ratio)
    const h = w / ratio
    return { x: east ? ax : ax - w, y: south ? ay : ay - h, w, h }
  }
  if (east || west) {
    // 좌우 변: 맞은편 변과 세로 가운데를 고정한다.
    const ax = east ? l : r
    const cy = (t + b) / 2
    let w = Math.max(Math.abs((east ? r + dx : l + dx) - ax), minW)
    w = Math.min(w, east ? bw - ax : ax, 2 * Math.min(cy, bh - cy) * ratio)
    const h = w / ratio
    return { x: east ? ax : ax - w, y: cy - h / 2, w, h }
  }
  const ay = south ? t : b
  const cx = (l + r) / 2
  let h = Math.max(Math.abs((south ? b + dy : t + dy) - ay), minW / ratio)
  h = Math.min(h, south ? bh - ay : ay, (2 * Math.min(cx, bw - cx)) / ratio)
  const w = h * ratio
  return { x: cx - w / 2, y: south ? ay : ay - h, w, h }
}

// ── 꾸미기 물체 ───────────────────────────────────────────
export type BoxHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

/** 상자 가운데 기준, 회전을 푼 좌표 */
export function toLocal(p: Point, box: Pick<Box, 'cx' | 'cy' | 'rotation'>): Point {
  const { cos, sin } = trig(-box.rotation)
  const dx = p.x - box.cx
  const dy = p.y - box.cy
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos }
}

export function fromLocal(p: Point, box: Pick<Box, 'cx' | 'cy' | 'rotation'>): Point {
  const { cos, sin } = trig(box.rotation)
  return { x: box.cx + p.x * cos - p.y * sin, y: box.cy + p.x * sin + p.y * cos }
}

export function boxCorners(box: Box): Point[] {
  const hw = box.w / 2
  const hh = box.h / 2
  return [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ].map((p) => fromLocal(p, box))
}

/** 회전한 상자의 손잡이를 pointer 위치로 끌었을 때의 새 상자. 맞은편 변은 제자리에 있다. */
export function resizeBox(start: Box, handle: BoxHandle, pointer: Point, min = 4): Box {
  const p = toLocal(pointer, start)
  let l = -start.w / 2
  let r = start.w / 2
  let t = -start.h / 2
  let b = start.h / 2
  if (handle.includes('e')) r = Math.max(p.x, l + min)
  if (handle.includes('w')) l = Math.min(p.x, r - min)
  if (handle.includes('s')) b = Math.max(p.y, t + min)
  if (handle.includes('n')) t = Math.min(p.y, b - min)
  const c = fromLocal({ x: (l + r) / 2, y: (t + b) / 2 }, start)
  return { cx: c.x, cy: c.y, w: r - l, h: b - t, rotation: start.rotation }
}

export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1)
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

export function pointInBox(p: Point, box: Box, pad = 0): boolean {
  const l = toLocal(p, box)
  return Math.abs(l.x) <= box.w / 2 + pad && Math.abs(l.y) <= box.h / 2 + pad
}

/** 물체가 p 에 닿는지. 글자는 크기를 재야 해서 measure 를 받는다. tol 은 선에 대한 여유(px). */
export function hitTest(o: Annotation, p: Point, tol: number, measure: (o: Annotation) => Box): boolean {
  if (isLine(o)) {
    return distToSegment(p, { x: o.x1, y: o.y1 }, { x: o.x2, y: o.y2 }) <= Math.max(o.width / 2, tol)
  }
  const box = measure(o)
  if ((o.type === 'rect' || o.type === 'ellipse') && !o.fill) {
    // 속이 빈 도형은 테두리 근처만 잡힌다. 안쪽을 눌러 아래 물체를 고를 수 있게.
    const l = toLocal(p, box)
    const edge = Math.max(o.width / 2, tol)
    if (o.type === 'rect') {
      const inOuter = Math.abs(l.x) <= box.w / 2 + edge && Math.abs(l.y) <= box.h / 2 + edge
      const inInner = Math.abs(l.x) < box.w / 2 - edge && Math.abs(l.y) < box.h / 2 - edge
      return inOuter && !inInner
    }
    const rx = box.w / 2
    const ry = box.h / 2
    const outer = (l.x / (rx + edge)) ** 2 + (l.y / (ry + edge)) ** 2 <= 1
    const inner = rx > edge && ry > edge && (l.x / (rx - edge)) ** 2 + (l.y / (ry - edge)) ** 2 < 1
    return outer && !inner
  }
  return pointInBox(p, box, o.type === 'text' ? 0 : tol)
}

export function moveObject(o: Annotation, dx: number, dy: number): Annotation {
  if (isLine(o)) return { ...o, x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy }
  return { ...o, cx: o.cx + dx, cy: o.cy + dy }
}

// ── 전체 설정 → 출력 크기 ─────────────────────────────────
export const DEFAULT_BATCH: BatchSettings = {
  resizeMode: 'none',
  width: 1000,
  height: 1000,
  long: 1200,
  fit: 'contain',
  padColor: '#ffffff',
  noUpscale: false,
  borderWidth: 0,
  borderColor: '#14201a',
  flipH: false,
  randomCrop: false,
  cropPctW: 3,
  cropPctH: 3,
  brightness: 100,
  contrast: 100,
  saturation: 100,
}

export const MAX_TARGET = 10000

const num = (v: unknown, fallback: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, min, max) : fallback)
const hex = (v: unknown, fallback: string) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback)

/** 저장된 값·입력 중인 값을 그릴 수 있는 범위로 정리한다. */
export function resolveBatch(b: BatchSettings): ResolvedBatch {
  const d = DEFAULT_BATCH as ResolvedBatch
  return {
    resizeMode: (['none', 'width', 'height', 'long', 'exact'] as const).includes(b.resizeMode) ? b.resizeMode : 'none',
    width: Math.round(num(b.width, d.width, 1, MAX_TARGET)),
    height: Math.round(num(b.height, d.height, 1, MAX_TARGET)),
    long: Math.round(num(b.long, d.long, 1, MAX_TARGET)),
    fit: b.fit === 'cover' ? 'cover' : 'contain',
    padColor: hex(b.padColor, d.padColor),
    noUpscale: Boolean(b.noUpscale),
    borderWidth: Math.round(num(b.borderWidth, 0, 0, 500)),
    borderColor: hex(b.borderColor, d.borderColor),
    flipH: Boolean(b.flipH),
    randomCrop: Boolean(b.randomCrop),
    cropPctW: num(b.cropPctW, d.cropPctW, 0, 30),
    cropPctH: num(b.cropPctH, d.cropPctH, 0, 30),
    brightness: num(b.brightness, 100, 0, 200),
    contrast: num(b.contrast, 100, 0, 200),
    saturation: num(b.saturation, 100, 0, 200),
  }
}

/** 문자열 → 32비트 씨앗(FNV-1a) */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** 씨앗이 같으면 같은 순서의 0–1 난수 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface OutputPlan {
  /** 편집을 마친 사진에서 가져올 부분 */
  src: Rect
  /** 출력 캔버스에서 사진이 놓일 자리 */
  dest: Rect
  width: number
  height: number
  /** 사진 바깥에 여백 색이 보이는지 */
  padded: boolean
}

/**
 * 정밀 편집을 마친 사진(w×h)에 전체 설정(랜덤 자르기·크기 맞춤)을 적용했을 때의 배치.
 * 미리보기와 저장이 같은 계산을 쓴다.
 */
export function planOutput(w: number, h: number, b: ResolvedBatch, seed: number): OutputPlan {
  const W = Math.max(1, Math.round(w))
  const H = Math.max(1, Math.round(h))
  let src: Rect = { x: 0, y: 0, w: W, h: H }
  if (b.randomCrop && (b.cropPctW > 0 || b.cropPctH > 0)) {
    const rand = mulberry32(seed)
    const cutW = Math.min(W - 1, Math.round((W * b.cropPctW) / 100))
    const cutH = Math.min(H - 1, Math.round((H * b.cropPctH) / 100))
    const rx = rand()
    const ry = rand()
    src = { x: Math.round(rx * cutW), y: Math.round(ry * cutH), w: W - cutW, h: H - cutH }
  }
  const scaled = (s: number): OutputPlan => {
    const k = b.noUpscale ? Math.min(1, s) : s
    const width = Math.max(1, Math.round(src.w * k))
    const height = Math.max(1, Math.round(src.h * k))
    return { src, dest: { x: 0, y: 0, w: width, h: height }, width, height, padded: false }
  }
  switch (b.resizeMode) {
    case 'width':
      return scaled(b.width / src.w)
    case 'height':
      return scaled(b.height / src.h)
    case 'long':
      return scaled(b.long / Math.max(src.w, src.h))
    case 'exact': {
      const width = b.width
      const height = b.height
      if (b.fit === 'cover') {
        const s = Math.max(width / src.w, height / src.h)
        const cw = width / s
        const ch = height / s
        return { src: { x: src.x + (src.w - cw) / 2, y: src.y + (src.h - ch) / 2, w: cw, h: ch }, dest: { x: 0, y: 0, w: width, h: height }, width, height, padded: false }
      }
      let s = Math.min(width / src.w, height / src.h)
      if (b.noUpscale) s = Math.min(1, s)
      const dw = Math.max(1, Math.min(width, Math.round(src.w * s)))
      const dh = Math.max(1, Math.min(height, Math.round(src.h * s)))
      const dest = { x: Math.round((width - dw) / 2), y: Math.round((height - dh) / 2), w: dw, h: dh }
      return { src, dest, width, height, padded: dw < width || dh < height }
    }
    default:
      return { src, dest: { x: 0, y: 0, w: src.w, h: src.h }, width: src.w, height: src.h, padded: false }
  }
}

/** 사진 한 장이 저장될 크기(원본 크기 w×h, 정밀 편집, 전체 설정 반영) */
export function plannedSize(w: number, h: number, edits: PhotoEdits, b: ResolvedBatch, seed: number): { width: number; height: number } {
  const crop = effectiveCrop(w, h, edits)
  const plan = planOutput(crop.w, crop.h, b, seed)
  return { width: plan.width, height: plan.height }
}

/** 사진마다 다른 랜덤 자르기 씨앗. "다시 섞기"는 shuffle 값을 바꾼다. */
export function photoSeed(photoId: string, shuffle: number): number {
  return hashSeed(`${photoId}:${shuffle}`)
}
