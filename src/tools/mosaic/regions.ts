/** 가릴 영역의 모양·크기 계산(순수 함수). 좌표는 모두 원본 이미지 px 기준이다. */

export type Shape = 'rect' | 'ellipse'
export type Effect = 'pixel' | 'blur' | 'fill'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface RegionStyle {
  shape: Shape
  effect: Effect
  /** 1–10. 1 도 알아볼 수 없을 만큼은 가린다. */
  strength: number
  /** 색 채우기에 쓰는 색 */
  color: string
}

export interface Region extends Box, RegionStyle {
  id: string
  source: 'manual' | 'face' | 'text'
}

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export const MIN_REGION = 6

export function handlePoint(b: Box, h: Handle): { x: number; y: number } {
  const x = h.includes('w') ? b.x : h.includes('e') ? b.x + b.w : b.x + b.w / 2
  const y = h.includes('n') ? b.y : h.includes('s') ? b.y + b.h : b.y + b.h / 2
  return { x, y }
}

/** 두 점으로 만든 상자(끌어서 그리기). 사진 밖으로 나가지 않게 자른다. */
export function boxFromPoints(ax: number, ay: number, bx: number, by: number, width: number, height: number): Box {
  const x0 = Math.max(0, Math.min(ax, bx))
  const y0 = Math.max(0, Math.min(ay, by))
  const x1 = Math.min(width, Math.max(ax, bx))
  const y1 = Math.min(height, Math.max(ay, by))
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) }
}

/** 크기는 그대로 두고 사진 안에 머물도록 옮긴다. */
export function moveBox(b: Box, dx: number, dy: number, width: number, height: number): Box {
  const w = Math.min(b.w, width)
  const h = Math.min(b.h, height)
  return { x: Math.max(0, Math.min(width - w, b.x + dx)), y: Math.max(0, Math.min(height - h, b.y + dy)), w, h }
}

/** 손잡이를 (dx, dy) 만큼 끌었을 때의 상자. 반대쪽 변을 넘어가지 않고 최소 크기를 지킨다. */
export function resizeBox(b: Box, handle: Handle, dx: number, dy: number, width: number, height: number): Box {
  let x0 = b.x
  let y0 = b.y
  let x1 = b.x + b.w
  let y1 = b.y + b.h
  if (handle.includes('w')) x0 = Math.max(0, Math.min(x1 - MIN_REGION, x0 + dx))
  if (handle.includes('e')) x1 = Math.min(width, Math.max(x0 + MIN_REGION, x1 + dx))
  if (handle.includes('n')) y0 = Math.max(0, Math.min(y1 - MIN_REGION, y0 + dy))
  if (handle.includes('s')) y1 = Math.min(height, Math.max(y0 + MIN_REGION, y1 + dy))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** 점이 영역 안인지(타원은 타원 안쪽만) */
export function hitRegion(r: Box & { shape: Shape }, px: number, py: number): boolean {
  if (px < r.x || py < r.y || px > r.x + r.w || py > r.y + r.h) return false
  if (r.shape === 'rect') return true
  const nx = (px - (r.x + r.w / 2)) / (r.w / 2)
  const ny = (py - (r.y + r.h / 2)) / (r.h / 2)
  return nx * nx + ny * ny <= 1
}

/** 잡을 수 있는 손잡이. radius 는 이미지 px 기준 허용 거리 */
export function hitHandle(b: Box, px: number, py: number, radius: number): Handle | null {
  let best: Handle | null = null
  let bestD = radius
  for (const h of HANDLES) {
    const p = handlePoint(b, h)
    const d = Math.max(Math.abs(p.x - px), Math.abs(p.y - py))
    if (d <= bestD) {
      bestD = d
      best = h
    }
  }
  return best
}

/** 상자를 가로·세로 비율(%)만큼 사방으로 넓힌다(얼굴 주변 여백). */
export function expandBox(b: Box, pct: number, width: number, height: number): Box {
  const mx = (b.w * pct) / 100
  const my = (b.h * pct) / 100
  const x0 = Math.max(0, b.x - mx)
  const y0 = Math.max(0, b.y - my)
  const x1 = Math.min(width, b.x + b.w + mx)
  const y1 = Math.min(height, b.y + b.h + my)
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

function area(b: Box) {
  return Math.max(0, b.w) * Math.max(0, b.h)
}
function intersection(a: Box, b: Box) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}
export function iou(a: Box, b: Box): number {
  const i = intersection(a, b)
  return i ? i / (area(a) + area(b) - i) : 0
}

/**
 * 여러 번(전체 + 조각) 찾은 얼굴 상자에서 같은 얼굴을 하나로 줄인다.
 * 많이 겹치면 점수가 높은 쪽을, 한쪽이 다른 쪽에 거의 들어가면 큰 쪽을 남긴다.
 */
export function mergeDetections<T extends Box & { score: number }>(boxes: T[]): T[] {
  const sorted = [...boxes].sort((a, b) => b.score - a.score)
  const kept: T[] = []
  for (const b of sorted) {
    let duplicate = false
    for (let k = 0; k < kept.length; k++) {
      const a = kept[k]
      const inter = intersection(a, b)
      if (!inter) continue
      const contained = inter / Math.min(area(a), area(b))
      if (iou(a, b) > 0.3 || contained > 0.6) {
        // 조각 가장자리에서 잘린 작은 상자보다 온전한 큰 상자를 남긴다.
        if (contained > 0.6 && area(b) > area(a) * 1.3) kept[k] = b
        duplicate = true
        break
      }
    }
    if (!duplicate) kept.push(b)
  }
  return kept
}

/** 전체 사진과, 작은 얼굴을 위한 겹치는 조각들의 목록 */
export function tileGrid(width: number, height: number): Box[] {
  const tiles: Box[] = [{ x: 0, y: 0, w: width, h: height }]
  const long = Math.max(width, height)
  for (const div of [2, 4]) {
    const size = Math.ceil(long / div)
    // 조각이 너무 작으면(얼굴이 몇 px 수준) 찾아도 의미가 없다.
    if (size < 160) break
    const step = size / 2
    const nx = Math.max(1, Math.ceil((width - size) / step) + 1)
    const ny = Math.max(1, Math.ceil((height - size) / step) + 1)
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const x = Math.max(0, Math.min(width - size, Math.round(ix * step)))
        const y = Math.max(0, Math.min(height - size, Math.round(iy * step)))
        const w = Math.min(size, width - x)
        const h = Math.min(size, height - y)
        if (!tiles.some((t) => t.x === x && t.y === y && t.w === w && t.h === h)) tiles.push({ x, y, w, h })
      }
    }
  }
  return tiles
}

// ── 가리는 세기 ───────────────────────────────────────────
export const MIN_STRENGTH = 1
export const MAX_STRENGTH = 10

/** 픽셀 한 칸의 크기(px). 가장 약해도 영역의 짧은 변에 12칸을 넘지 않아 원래 모습을 알아볼 수 없다. */
export function pixelBlock(region: Box, strength: number): number {
  const s = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, strength))
  const cells = 12 - (s - 1) // 12칸(약) → 3칸(강)
  return Math.max(6, Math.min(region.w, region.h) / cells)
}

/** 블러 반경(px). 가장 약해도 짧은 변의 10% · 8px 이상이라 되돌려 읽을 수 없다. */
export function blurRadius(region: Box, strength: number): number {
  const s = Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, strength))
  return Math.max(8, Math.min(region.w, region.h) * (0.1 + (s - 1) * 0.025))
}
