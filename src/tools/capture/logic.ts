/** 캡처 편집 화면의 순수 계산(자르기·나누기·이름·PDF 쪽 크기). 화면 코드와 테스트가 함께 쓴다. */
import { splitHeights } from '../../../extension/capture/lib/plan.js'
import { sanitizeFilename, stripExt } from '@/lib/files'

export interface Trim {
  top: number
  bottom: number
  left: number
  right: number
}
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}
export interface Point {
  x: number
  y: number
}
/** 자르기 틀에서 잡을 수 있는 곳: 통째 옮기기, 여덟 방향 손잡이, 새로 그리기 */
export type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'new'

export const NO_TRIM: Trim = { top: 0, bottom: 0, left: 0, right: 0 }
/** 자른 뒤 남겨야 하는 최소 크기(px) */
export const MIN_SIDE = 8
export const MAX_SPLIT_PIECES = 200
export const MIN_SPLIT_HEIGHT = 100

const int = (v: unknown) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? n : 0
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** 잘라내는 양을 이미지 안으로 맞춘다. 마주 보는 두 값이 겹치면 나중 값(bottom, right)을 줄인다. */
export function clampTrim(trim: Trim, w: number, h: number): Trim {
  const minW = Math.min(MIN_SIDE, w)
  const minH = Math.min(MIN_SIDE, h)
  const top = clamp(int(trim.top), 0, h - minH)
  const bottom = clamp(int(trim.bottom), 0, h - minH - top)
  const left = clamp(int(trim.left), 0, w - minW)
  const right = clamp(int(trim.right), 0, w - minW - left)
  return { top, bottom, left, right }
}

export function trimToRect(trim: Trim, w: number, h: number): Rect {
  const t = clampTrim(trim, w, h)
  return { x: t.left, y: t.top, w: w - t.left - t.right, h: h - t.top - t.bottom }
}

export function rectToTrim(rect: Rect, w: number, h: number): Trim {
  return clampTrim({ top: rect.y, left: rect.x, right: w - rect.x - rect.w, bottom: h - rect.y - rect.h }, w, h)
}

export function isTrimmed(trim: Trim): boolean {
  return trim.top > 0 || trim.bottom > 0 || trim.left > 0 || trim.right > 0
}

/** 두 점으로 새 사각형을 만든다(끌어서 새로 그리기). */
export function rectFromPoints(a: Point, b: Point, w: number, h: number): Rect {
  const x0 = clamp(Math.min(a.x, b.x), 0, w)
  const y0 = clamp(Math.min(a.y, b.y), 0, h)
  const x1 = clamp(Math.max(a.x, b.x), 0, w)
  const y1 = clamp(Math.max(a.y, b.y), 0, h)
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/**
 * 자르기 틀을 끌었을 때의 새 사각형. start 는 끌기 시작할 때의 사각형, dx·dy 는 이미지 픽셀 기준 이동량.
 * 틀은 이미지 밖으로 나가지 않고 MIN_SIDE 보다 작아지지 않는다.
 */
export function dragRect(start: Rect, handle: Exclude<Handle, 'new'>, dx: number, dy: number, w: number, h: number): Rect {
  if (handle === 'move') {
    return { x: clamp(start.x + dx, 0, w - start.w), y: clamp(start.y + dy, 0, h - start.h), w: start.w, h: start.h }
  }
  const minW = Math.min(MIN_SIDE, w)
  const minH = Math.min(MIN_SIDE, h)
  let left = start.x
  let top = start.y
  let right = start.x + start.w
  let bottom = start.y + start.h
  if (handle.includes('w')) left = clamp(left + dx, 0, right - minW)
  if (handle.includes('e')) right = clamp(right + dx, left + minW, w)
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - minH)
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + minH, h)
  return { x: left, y: top, w: right - left, h: bottom - top }
}

/** 높이 기준 분할. 조각이 너무 많아지면 null (높이를 키우라고 알린다). */
export function splitByHeight(total: number, pieceHeight: number): Array<{ y: number; h: number }> | null {
  const size = Math.max(1, int(pieceHeight))
  if (Math.ceil(total / size) > MAX_SPLIT_PIECES) return null
  return splitHeights(total, size).map((p) => ({ y: p.y, h: p.height }))
}

/** 원본 이름을 살린 결과 이름의 몸통 */
export function baseNameOf(fileName: string): string {
  return sanitizeFilename(stripExt(fileName), '캡처')
}

/** 결과 파일명: 한 장이면 "이름_편집.png", 나눴으면 "이름_분할_1.png" */
export function outputName(base: string, index: number, count: number, ext: string): string {
  return count > 1 ? `${base}_분할_${index + 1}.${ext}` : `${base}_편집.${ext}`
}

/** PDF 한 쪽에 이미지 한 장을 그대로 담을 때의 종이 크기(pt). PDF 한계(14,400pt)를 넘으면 비율대로 줄인다. */
export function pdfPageSize(pxW: number, pxH: number): { pageW: number; pageH: number } {
  const MAX_PT = 14400
  let pageW = pxW * 0.75
  let pageH = pxH * 0.75
  const over = Math.max(pageW, pageH) / MAX_PT
  if (over > 1) {
    pageW /= over
    pageH /= over
  }
  return { pageW, pageH }
}
