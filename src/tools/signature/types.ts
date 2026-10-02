import type { Box, PdfPageBox } from './geometry'

export type AssetKind = 'sign' | 'seal' | 'image' | 'text' | 'mark'

export interface TextSpec {
  value: string
  /** fonts.ts 의 글꼴 id */
  font: string
  /** font 가 'local' 일 때의 글꼴 이름 */
  family?: string
}

/** 아직 문서에 놓지 않은 서명·도장·글자 이미지 */
export interface Asset {
  /** 투명 배경 PNG data URL */
  src: string
  /** 불투명한 부분을 이 색으로 칠한다. null 이면 이미지 색 그대로 */
  tint: string | null
  /** 가로 ÷ 세로 */
  aspect: number
  kind: AssetKind
  label: string
  text?: TextSpec
}

/** 페이지 위에 놓인 항목. 위치·크기는 "보이는 좌표"(geometry.ts 참고) */
export interface Item extends Box {
  id: string
  /** 0 부터 */
  page: number
  /** 0–1 */
  opacity: number
  src: string
  tint: string | null
  kind: AssetKind
  label: string
  text?: TextSpec
}

/** "내 서명"으로 이 브라우저에 저장하는 항목, 팀 보관함에 저장하는 내용도 같은 모양 */
export interface SavedSignature {
  id: string
  name: string
  src: string
  tint: string | null
  aspect: number
  kind: AssetKind
  createdAt: string
}

export interface PageInfo {
  /** 보이는 좌표 단위의 크기 */
  width: number
  height: number
  pdf?: PdfPageBox
}

export type DocKind = 'image' | 'pdf' | 'docx'

export interface DocSource {
  kind: DocKind
  file: File
  /** 확장자를 뺀 이름 */
  baseName: string
  pages: PageInfo[]
  /** 100% 로 볼 때 좌표 1 단위가 차지하는 CSS px */
  unitPx: number
  /** pxPerUnit: 좌표 1 단위를 몇 픽셀로 그릴지 */
  /**
   * forExport: 저장용으로 그린다. 화면용 그리기는 탭이 가려지면 멈출 수 있어(애니메이션 프레임 사용),
   * 저장할 때는 멈추지 않는 방식으로 그린다.
   */
  render(page: number, pxPerUnit: number, signal?: AbortSignal, forExport?: boolean): Promise<HTMLCanvasElement>
  destroy(): void
  /** PDF 원본 바이트(pdf-lib 저장용) */
  bytes?: Uint8Array
  /** 암호·편집 제한 때문에 원본 구조를 유지한 저장이 안 되는 PDF */
  rasterOnly?: boolean
  /** 화면에 알릴 주의 사항 */
  notes: string[]
}

export const MAX_PAGES = 50
export const MAX_FILE_BYTES = 100 * 1024 * 1024
