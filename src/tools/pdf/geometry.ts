/** 쪽 크기·좌표 계산과 파일 이름 규칙. 순수 함수만 둔다. */
import { sanitizeFilename, stripExt } from '@/lib/files'

export const MM = 72 / 25.4
export const A4 = { w: 210 * MM, h: 297 * MM }
/** 화면 픽셀을 인쇄 크기로 바꿀 때 기준(96dpi) */
export const PX_TO_PT = 0.75
/** PDF 한 쪽의 최대 크기(규격상 200인치) */
const MAX_PAGE_PT = 14400

export type Quarter = 0 | 90 | 180 | 270

export function normalizeRotation(deg: number): Quarter {
  const r = ((Math.round(deg / 90) * 90) % 360 + 360) % 360
  return r as Quarter
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 회전이 걸린 쪽에서 "보이는 그대로의 좌표"(왼쪽 아래 원점)를 PDF 내부 좌표로 바꾼다.
 * angle 은 그 자리에 글자·그림을 똑바로 보이게 그릴 때 줘야 하는 회전(도, 반시계).
 */
export function visualToUser(box: Box, rotation: Quarter, vx: number, vy: number): { x: number; y: number; angle: Quarter } {
  switch (rotation) {
    case 90:
      return { x: box.x + box.width - vy, y: box.y + vx, angle: 90 }
    case 180:
      return { x: box.x + box.width - vx, y: box.y + box.height - vy, angle: 180 }
    case 270:
      return { x: box.x + vy, y: box.y + box.height - vx, angle: 270 }
    default:
      return { x: box.x + vx, y: box.y + vy, angle: 0 }
  }
}

/** 회전을 반영한 보이는 크기 */
export function visualSize(box: { width: number; height: number }, rotation: Quarter): { width: number; height: number } {
  return rotation === 90 || rotation === 270 ? { width: box.height, height: box.width } : { width: box.width, height: box.height }
}

export type PaperSize = 'fit' | 'a4-auto' | 'a4-portrait' | 'a4-landscape'

export interface PaperSettings {
  size: PaperSize
  marginMm: number
  /** 용지보다 작은 사진을 늘리지 않는다 */
  noUpscale?: boolean
}

export interface ImagePlacement {
  pageW: number
  pageH: number
  x: number
  y: number
  w: number
  h: number
}

/** 사진 한 장을 한 쪽에 놓는 자리. 단위 pt, 원점은 왼쪽 아래. */
export function fitImagePage(imgW: number, imgH: number, paper: PaperSettings): ImagePlacement {
  const margin = Math.max(0, paper.marginMm) * MM
  const natW = imgW * PX_TO_PT
  const natH = imgH * PX_TO_PT
  if (paper.size === 'fit') {
    const limit = MAX_PAGE_PT - margin * 2
    const s = Math.min(1, limit / natW, limit / natH)
    const w = natW * s
    const h = natH * s
    return { pageW: w + margin * 2, pageH: h + margin * 2, x: margin, y: margin, w, h }
  }
  const landscape = paper.size === 'a4-landscape' || (paper.size === 'a4-auto' && imgW > imgH)
  const pageW = landscape ? A4.h : A4.w
  const pageH = landscape ? A4.w : A4.h
  const areaW = Math.max(1, pageW - margin * 2)
  const areaH = Math.max(1, pageH - margin * 2)
  let s = Math.min(areaW / natW, areaH / natH)
  if (paper.noUpscale) s = Math.min(s, 1)
  const w = natW * s
  const h = natH * s
  return { pageW, pageH, x: (pageW - w) / 2, y: (pageH - h) / 2, w, h }
}

/** 결과 파일 이름: "원본이름_꼬리.확장자". 원본 이름이 없으면 "문서". */
export function outputName(sourceName: string, suffix: string, ext: string): string {
  const base = sanitizeFilename(stripExt(sourceName), '문서')
  return `${base}${suffix ? `_${suffix}` : ''}.${ext}`
}
