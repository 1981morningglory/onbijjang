/** 녹화 영역 계산. 좌표는 모두 공유 화면의 실제 화소 기준이다. */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type RatioLock = 'free' | '1:1' | '16:9' | '4:3'
export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export const MIN_CROP = 16

export function ratioValue(lock: RatioLock): number | null {
  return lock === '1:1' ? 1 : lock === '16:9' ? 16 / 9 : lock === '4:3' ? 4 / 3 : null
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi))

/** 정수로 맞추고 화면 안에 넣는다. 최소 크기를 지킨다(화면이 그보다 작으면 화면 크기). */
export function clampRect(rect: Rect, bw: number, bh: number): Rect {
  const minW = Math.min(MIN_CROP, bw)
  const minH = Math.min(MIN_CROP, bh)
  const w = clamp(Math.round(rect.w), minW, bw)
  const h = clamp(Math.round(rect.h), minH, bh)
  const x = clamp(Math.round(rect.x), 0, bw - w)
  const y = clamp(Math.round(rect.y), 0, bh - h)
  return { x, y, w, h }
}

export function fullRect(bw: number, bh: number): Rect {
  return { x: 0, y: 0, w: bw, h: bh }
}

/** 가운데를 유지하며 주어진 비율로 줄인다(늘리지 않는다). */
export function fitRatio(rect: Rect, ratio: number | null, bw: number, bh: number): Rect {
  if (!ratio) return clampRect(rect, bw, bh)
  let w = rect.w
  let h = rect.h
  if (w / h > ratio) w = h * ratio
  else h = w / ratio
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  return clampRect({ x: cx - w / 2, y: cy - h / 2, w, h }, bw, bh)
}

export function moveRect(rect: Rect, dx: number, dy: number, bw: number, bh: number): Rect {
  return clampRect({ ...rect, x: rect.x + dx, y: rect.y + dy }, bw, bh)
}

/**
 * 손잡이를 (px, py)까지 끌었을 때의 영역. 반대쪽 모서리·변은 제자리에 있다.
 * ratio 가 있으면 비율을 지키고, 화면 밖으로 나가지 않는 최대 크기에서 멈춘다.
 */
export function resizeRect(rect: Rect, handle: Handle, px: number, py: number, ratio: number | null, bw: number, bh: number): Rect {
  const west = handle.includes('w')
  const east = handle.includes('e')
  const north = handle.includes('n')
  const south = handle.includes('s')
  let left = rect.x
  let top = rect.y
  let right = rect.x + rect.w
  let bottom = rect.y + rect.h
  if (west) left = clamp(px, 0, right - MIN_CROP)
  if (east) right = clamp(px, left + MIN_CROP, bw)
  if (north) top = clamp(py, 0, bottom - MIN_CROP)
  if (south) bottom = clamp(py, top + MIN_CROP, bh)
  let w = right - left
  let h = bottom - top
  if (!ratio) return clampRect({ x: left, y: top, w, h }, bw, bh)

  const horizontal = west || east
  const vertical = north || south
  const minW = Math.max(MIN_CROP, MIN_CROP * ratio)
  if (horizontal && vertical) {
    // 모서리: 더 많이 끈 쪽을 따른다.
    if (w / ratio >= h) h = w / ratio
    else w = h * ratio
    const anchorX = west ? rect.x + rect.w : rect.x
    const anchorY = north ? rect.y + rect.h : rect.y
    const maxW = west ? anchorX : bw - anchorX
    const maxH = north ? anchorY : bh - anchorY
    w = Math.max(w, minW)
    const s = Math.min(1, maxW / w, maxH / (w / ratio))
    w *= s
    h = w / ratio
    return clampRect({ x: west ? anchorX - w : anchorX, y: north ? anchorY - h : anchorY, w, h }, bw, bh)
  }
  if (horizontal) {
    // 좌우 변: 높이는 세로 가운데를 기준으로 함께 변한다.
    const cy = rect.y + rect.h / 2
    w = Math.max(w, minW)
    h = w / ratio
    const maxH = 2 * Math.min(cy, bh - cy)
    if (h > maxH) {
      h = maxH
      w = h * ratio
    }
    const anchorX = west ? rect.x + rect.w : rect.x
    return clampRect({ x: west ? anchorX - w : anchorX, y: cy - h / 2, w, h }, bw, bh)
  }
  // 위아래 변: 너비는 가로 가운데를 기준으로 함께 변한다.
  const cx = rect.x + rect.w / 2
  h = Math.max(h, minW / ratio)
  w = h * ratio
  const maxW = 2 * Math.min(cx, bw - cx)
  if (w > maxW) {
    w = maxW
    h = w / ratio
  }
  const anchorY = north ? rect.y + rect.h : rect.y
  return clampRect({ x: cx - w / 2, y: north ? anchorY - h : anchorY, w, h }, bw, bh)
}

/** 빈 곳을 끌어 새 영역을 그린다. (x0, y0) 가 처음 누른 곳. */
export function rectFromDrag(x0: number, y0: number, x1: number, y1: number, ratio: number | null, bw: number, bh: number): Rect {
  const ax = clamp(x0, 0, bw)
  const ay = clamp(y0, 0, bh)
  const bx = clamp(x1, 0, bw)
  const by = clamp(y1, 0, bh)
  let w = Math.abs(bx - ax)
  let h = Math.abs(by - ay)
  if (ratio) {
    if (w / ratio >= h) h = w / ratio
    else w = h * ratio
    const maxW = bx >= ax ? bw - ax : ax
    const maxH = by >= ay ? bh - ay : ay
    const s = Math.min(1, maxW / Math.max(w, 1e-6), maxH / Math.max(h, 1e-6))
    w *= s
    h *= s
  }
  return clampRect({ x: bx >= ax ? ax : ax - w, y: by >= ay ? ay : ay - h, w, h }, bw, bh)
}

/** 숫자 입력으로 한 값만 바꾼다. 비율 고정이면 너비·높이가 함께 바뀐다. */
export function setRectField(rect: Rect, field: keyof Rect, value: number, ratio: number | null, bw: number, bh: number): Rect {
  if (!Number.isFinite(value)) return rect
  const next = { ...rect, [field]: value }
  if (ratio && field === 'w') {
    next.w = clamp(value, MIN_CROP, Math.min(bw - rect.x, (bh - rect.y) * ratio))
    next.h = next.w / ratio
  } else if (ratio && field === 'h') {
    next.h = clamp(value, MIN_CROP, Math.min(bh - rect.y, (bw - rect.x) / ratio))
    next.w = next.h * ratio
  } else if (field === 'w') {
    next.w = clamp(value, MIN_CROP, bw - rect.x)
  } else if (field === 'h') {
    next.h = clamp(value, MIN_CROP, bh - rect.y)
  }
  return clampRect(next, bw, bh)
}

export function isFullRect(rect: Rect, bw: number, bh: number): boolean {
  return rect.x === 0 && rect.y === 0 && rect.w === bw && rect.h === bh
}
