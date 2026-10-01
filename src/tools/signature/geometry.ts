/**
 * 좌표 계산 — 화면(보이는 페이지) 좌표와 PDF 내부 좌표 사이의 변환, 끌기·크기·회전 계산.
 *
 * "보이는 좌표"는 사용자가 보는 똑바로 선 페이지 기준이다: 원점은 왼쪽 위, y 는 아래로 증가.
 * 단위는 PDF 는 pt(× UserUnit), 사진은 px, Word 는 CSS px.
 */

export interface Point {
  x: number
  y: number
}

/** 페이지 위에 놓인 사각형: 중심·크기·시계 방향 회전(도) */
export interface Box {
  cx: number
  cy: number
  w: number
  h: number
  rot: number
}

/** pdfjs 가 알려 주는 페이지 정보(view = CropBox∩MediaBox, rotate = 0/90/180/270) */
export interface PdfPageBox {
  /** [x0, y0, x1, y1] — PDF 사용자 좌표(왼쪽 아래 원점) */
  view: [number, number, number, number]
  rotate: number
  userUnit: number
}

const RAD = Math.PI / 180

export function normalizeRotation(deg: number): 0 | 90 | 180 | 270 {
  if (!Number.isFinite(deg) || deg % 90 !== 0) return 0
  return ((((deg % 360) + 360) % 360) as 0 | 90 | 180 | 270)
}

/** 화면에 보이는 페이지 크기(회전 반영) */
export function pdfViewSize(page: PdfPageBox): { width: number; height: number } {
  const [x0, y0, x1, y1] = page.view
  const w = Math.abs(x1 - x0) * page.userUnit
  const h = Math.abs(y1 - y0) * page.userUnit
  const r = normalizeRotation(page.rotate)
  return r === 90 || r === 270 ? { width: h, height: w } : { width: w, height: h }
}

/** 보이는 좌표 → PDF 사용자 좌표 */
export function viewToPdfPoint(page: PdfPageBox, vx: number, vy: number): Point {
  const x0 = Math.min(page.view[0], page.view[2])
  const x1 = Math.max(page.view[0], page.view[2])
  const y0 = Math.min(page.view[1], page.view[3])
  const y1 = Math.max(page.view[1], page.view[3])
  const x = vx / page.userUnit
  const y = vy / page.userUnit
  switch (normalizeRotation(page.rotate)) {
    case 90:
      return { x: x0 + y, y: y0 + x }
    case 180:
      return { x: x1 - x, y: y0 + y }
    case 270:
      return { x: x1 - y, y: y1 - x }
    default:
      return { x: x0 + x, y: y1 - y }
  }
}

/** PDF 사용자 좌표 → 보이는 좌표 */
export function pdfToViewPoint(page: PdfPageBox, px: number, py: number): Point {
  const x0 = Math.min(page.view[0], page.view[2])
  const x1 = Math.max(page.view[0], page.view[2])
  const y0 = Math.min(page.view[1], page.view[3])
  const y1 = Math.max(page.view[1], page.view[3])
  const u = page.userUnit
  switch (normalizeRotation(page.rotate)) {
    case 90:
      return { x: (py - y0) * u, y: (px - x0) * u }
    case 180:
      return { x: (x1 - px) * u, y: (py - y0) * u }
    case 270:
      return { x: (y1 - py) * u, y: (x1 - px) * u }
    default:
      return { x: (px - x0) * u, y: (y1 - py) * u }
  }
}

export interface PdfImagePlacement {
  /** 이미지 왼쪽 아래 모서리(회전의 기준점) */
  x: number
  y: number
  width: number
  height: number
  /** 반시계 방향 회전(도) — pdf-lib 의 degrees() 에 그대로 넣는다 */
  rotate: number
}

/**
 * 화면에 놓인 사각형을 pdf-lib drawImage 인자로 바꾼다.
 * pdf-lib 은 (x, y) 를 기준으로 반시계 회전한 뒤 width×height 로 그리므로,
 * 중심이 맞도록 회전된 왼쪽 아래 모서리를 계산한다.
 */
export function pdfImagePlacement(page: PdfPageBox, box: Box): PdfImagePlacement {
  const center = viewToPdfPoint(page, box.cx, box.cy)
  const width = box.w / page.userUnit
  const height = box.h / page.userUnit
  // 화면에서 시계 방향 rot → 페이지 회전(시계 방향 rotate)을 되돌리면 PDF 좌표에서는 반시계 (rotate - rot)
  const ccw = normalizeRotation(page.rotate) - box.rot
  const a = ccw * RAD
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const hx = width / 2
  const hy = height / 2
  return {
    x: center.x - (hx * cos - hy * sin),
    y: center.y - (hx * sin + hy * cos),
    width,
    height,
    rotate: ccw,
  }
}

/** pdfImagePlacement 결과가 그리는 사각형의 네 모서리(PDF 좌표). 검증용. */
export function placementCorners(p: PdfImagePlacement): Point[] {
  const a = p.rotate * RAD
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  return [
    [0, 0],
    [p.width, 0],
    [p.width, p.height],
    [0, p.height],
  ].map(([lx, ly]) => ({ x: p.x + lx * cos - ly * sin, y: p.y + lx * sin + ly * cos }))
}

/** 보이는 좌표에서 사각형의 네 모서리(왼쪽 위부터 시계 방향) */
export function boxCorners(box: Box): Point[] {
  const a = box.rot * RAD
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const hx = box.w / 2
  const hy = box.h / 2
  return [
    [-hx, -hy],
    [hx, -hy],
    [hx, hy],
    [-hx, hy],
  ].map(([lx, ly]) => ({ x: box.cx + lx * cos - ly * sin, y: box.cy + lx * sin + ly * cos }))
}

/**
 * 모서리 손잡이를 끌어 크기를 바꾼다. 비율을 유지하고 반대쪽 모서리는 제자리에 둔다.
 * sx, sy 는 끄는 모서리의 방향(-1 왼쪽/위, 1 오른쪽/아래), pointer 는 보이는 좌표.
 */
export function resizeFromCorner(box: Box, sx: 1 | -1, sy: 1 | -1, pointer: Point, minSize: number): Box {
  const a = box.rot * RAD
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  // 고정되는 반대쪽 모서리
  const ax = box.cx + (-sx * box.w * cos) / 2 - (-sy * box.h * sin) / 2
  const ay = box.cy + (-sx * box.w * sin) / 2 + (-sy * box.h * cos) / 2
  // 고정점에서 포인터까지를 사각형의 로컬 축으로
  const dx = pointer.x - ax
  const dy = pointer.y - ay
  const lx = dx * cos + dy * sin
  const ly = -dx * sin + dy * cos
  // 대각선 위로 투영해 비율 유지
  const diagX = sx * box.w
  const diagY = sy * box.h
  let scale = (lx * diagX + ly * diagY) / (diagX * diagX + diagY * diagY)
  const minScale = minSize / Math.min(box.w, box.h)
  if (!Number.isFinite(scale) || scale < minScale) scale = minScale
  const w = box.w * scale
  const h = box.h * scale
  return {
    ...box,
    w,
    h,
    cx: ax + (sx * w * cos) / 2 - (sy * h * sin) / 2,
    cy: ay + (sx * w * sin) / 2 + (sy * h * cos) / 2,
  }
}

/** 회전 손잡이(위쪽 가운데)를 끌 때의 각도(시계 방향, -180~180) */
export function rotationFromPointer(center: Point, pointer: Point): number {
  const deg = Math.atan2(pointer.y - center.y, pointer.x - center.x) / RAD + 90
  return normalizeAngle(deg)
}

/** -180 초과 180 이하로 맞춘다 */
export function normalizeAngle(deg: number): number {
  let d = ((deg % 360) + 360) % 360
  if (d > 180) d -= 360
  return Math.round(d * 10) / 10
}

/** 0·90·180·270 근처(±tolerance)면 달라붙고, step 이 있으면 그 단위로 맞춘다 */
export function snapAngle(deg: number, tolerance = 3, step?: number): number {
  if (step) return normalizeAngle(Math.round(deg / step) * step)
  const nearest = Math.round(deg / 90) * 90
  return Math.abs(deg - nearest) <= tolerance ? normalizeAngle(nearest) : normalizeAngle(deg)
}

/** 중심이 페이지 밖으로 나가지 않게 한다 */
export function clampCenter<T extends { cx: number; cy: number }>(box: T, pageW: number, pageH: number): T {
  return { ...box, cx: Math.min(pageW, Math.max(0, box.cx)), cy: Math.min(pageH, Math.max(0, box.cy)) }
}

/**
 * 같은 자리를 다른 크기의 페이지로 옮긴다. 크기가 같으면 그대로,
 * 다르면 위치는 비율로, 크기는 너비 비율로 맞춘다.
 */
export function mapToPage<T extends Box>(box: T, from: { width: number; height: number }, to: { width: number; height: number }): T {
  if (Math.abs(from.width - to.width) < 0.5 && Math.abs(from.height - to.height) < 0.5) return box
  const k = to.width / from.width
  return { ...box, cx: (box.cx / from.width) * to.width, cy: (box.cy / from.height) * to.height, w: box.w * k, h: box.h * k }
}

/** 종류별 처음 크기(페이지 너비 대비 가로 비율). 글자는 줄 높이 기준. */
const DEFAULT_WIDTH_RATIO: Record<string, number> = { sign: 0.28, seal: 0.14, image: 0.25, mark: 0.035 }
const TEXT_HEIGHT_RATIO = 0.03

/** 새로 놓을 항목의 크기. aspect = 가로 ÷ 세로. 페이지의 90% 를 넘지 않는다. */
export function defaultItemSize(kind: string, aspect: number, pageW: number, pageH: number): { w: number; h: number } {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1
  let w: number
  let h: number
  if (kind === 'text') {
    h = pageW * TEXT_HEIGHT_RATIO
    w = h * a
  } else {
    w = pageW * (DEFAULT_WIDTH_RATIO[kind] ?? 0.25)
    h = w / a
  }
  const k = Math.min(1, (pageW * 0.9) / w, (pageH * 0.9) / h)
  return { w: w * k, h: h * k }
}

/** 새 항목이 기존 항목과 정확히 겹치지 않게 조금씩 밀어 놓는다 */
export function cascadePosition(target: Point, taken: Point[], step: number, pageW: number, pageH: number): Point {
  let p = { ...target }
  for (let i = 0; i < 12; i++) {
    if (!taken.some((t) => Math.abs(t.x - p.x) < step / 2 && Math.abs(t.y - p.y) < step / 2)) break
    p = { x: p.x + step, y: p.y + step }
  }
  return { x: Math.min(pageW, Math.max(0, p.x)), y: Math.min(pageH, Math.max(0, p.y)) }
}
