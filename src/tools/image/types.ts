import type { RasterFormat } from '@/lib/image'

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** 가운데·크기·각도로 나타낸 상자(도 단위, 시계 방향) */
export interface Box {
  cx: number
  cy: number
  w: number
  h: number
  rotation: number
}

export type FontKey = 'gothic' | 'display' | 'hand' | 'pen' | 'serif'

interface ObjectBase {
  id: string
}

export interface TextObject extends ObjectBase {
  type: 'text'
  cx: number
  cy: number
  rotation: number
  text: string
  font: FontKey
  /** 글자 높이(px, 원본 사진 기준) */
  size: number
  color: string
  bold: boolean
  /** 외곽선 두께(px, 원본 사진 기준). 0 이면 없음 */
  outline: number
  outlineColor: string
  background: boolean
  backgroundColor: string
}

export interface ShapeObject extends ObjectBase, Box {
  type: 'rect' | 'ellipse'
  color: string
  /** 선 두께(px, 원본 사진 기준) */
  width: number
  fill: boolean
}

export interface MosaicObject extends ObjectBase, Box {
  type: 'mosaic'
  /** 모자이크 한 칸 크기(px, 원본 사진 기준) */
  block: number
}

export interface LineObject extends ObjectBase {
  type: 'line' | 'arrow'
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
  width: number
}

export type Annotation = TextObject | ShapeObject | MosaicObject | LineObject
export const isLine = (o: Annotation): o is LineObject => o.type === 'line' || o.type === 'arrow'
export type AnnotationType = Annotation['type']

/**
 * 사진 한 장의 정밀 편집 내용. 전부 데이터라서 다시 열어 고칠 수 있다.
 * 좌표는 "돌리고 뒤집은 뒤의 사진"(자르기 전) 기준 픽셀이다.
 */
export interface PhotoEdits {
  /** 90° 단위 회전 횟수(시계 방향) */
  quarter: 0 | 1 | 2 | 3
  /** 미세 회전(도, -45–45) */
  angle: number
  /** 회전 전에 적용되는 원본 기준 반전 */
  flipH: boolean
  flipV: boolean
  /** null 이면 자동(회전으로 생긴 빈 모서리가 없는 가장 큰 영역) */
  crop: Rect | null
  objects: Annotation[]
}

export type ResizeMode = 'none' | 'width' | 'height' | 'long' | 'exact'

/** 전체 사진 설정. 입력 중 빈 칸은 null 로 들어올 수 있어 쓰기 전에 resolveBatch 로 정리한다. */
export interface BatchSettings {
  resizeMode: ResizeMode
  width: number | null
  height: number | null
  long: number | null
  /** 정확한 크기일 때: cover 잘라서 채우기 · contain 여백 두고 전체 보이기 */
  fit: 'cover' | 'contain'
  padColor: string
  noUpscale: boolean
  borderWidth: number | null
  borderColor: string
  flipH: boolean
  randomCrop: boolean
  cropPctW: number
  cropPctH: number
  brightness: number
  contrast: number
  saturation: number
}

export type ResolvedBatch = { [K in keyof BatchSettings]: NonNullable<BatchSettings[K]> }

export interface ExportSettings {
  format: RasterFormat
  /** 1–100 */
  quality: number
  limitSize: boolean
  targetKB: number | null
  /** 품질을 낮춰도 목표 용량을 넘으면 크기를 줄인다 */
  shrinkToFit: boolean
  naming: 'original' | 'sequence'
  suffix: string
  /** 비어 있으면 팀 파일명 규칙의 이름을 쓴다 */
  seqBase: string
  seqStart: number | null
}

export interface Photo {
  id: string
  file: File
  name: string
  bytes: number
  status: 'pending' | 'ready' | 'error'
  error?: string
  /** 원본 크기(EXIF 회전 반영). 읽기 전에는 0 */
  width: number
  height: number
  /** 작은 미리보기 원본(긴 변 512px 이하) */
  preview: HTMLCanvasElement | null
  edits: PhotoEdits
}

export interface EncodedResult {
  blob: Blob
  width: number
  height: number
  /** 0–1. PNG 는 1 */
  quality: number
  /** 목표 용량에 맞추려고 줄인 배율(1 이면 그대로) */
  scale: number
  /** 목표 용량을 끝내 넘겼는지 */
  over: boolean
}
