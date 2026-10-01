export declare const LIMITS: Readonly<{
  PIECE_MAX_PX: number
  TOTAL_MAX_PX: number
  MAX_SHOTS: number
  CAPTURE_GAP_MS: number
  KEEP_MS: number
  KEEP_COUNT: number
}>
export declare const A4_PT: Readonly<{ width: number; height: number }>

export interface Shot {
  y: number
}
export interface ViewRect {
  x: number
  y: number
  w: number
  h: number
}
export interface Segment {
  shot: number
  from: number
  to: number
}
export interface DrawOp {
  piece: number
  shot: number
  sx: number
  sy: number
  sw: number
  sh: number
  dx: number
  dy: number
}
export interface StitchPlan {
  width: number
  height: number
  pieces: Array<{ y: number; height: number }>
  ops: DrawOp[]
}

export declare function waitBeforeCapture(lastAt: number, now: number, gap?: number): number
export declare function maxCssHeight(scale: number, totalMaxPx?: number): number
export declare function planSegments(shots: Shot[], viewH: number, limit?: number): Segment[]
export declare function splitHeights(total: number, max: number): Array<{ y: number; height: number }>
export declare function planStitch(p: { shots: Shot[]; view: ViewRect; scale: number; imgW: number; imgH: number; limitCss?: number; pieceMax?: number }): StitchPlan
export declare function planRegion(p: { rect: ViewRect; scale: number; imgW: number; imgH: number }): { sx: number; sy: number; sw: number; sh: number }
export declare function planPdfPages(width: number, height: number, pageW?: number, pageH?: number): { sliceH: number; pages: Array<{ y: number; h: number }> }
export declare function sliceAcrossPieces(pieceHeights: number[], y: number, h: number): Array<{ piece: number; sy: number; sh: number; dy: number }>
export declare function footerMetrics(width: number): { fontPx: number; height: number; padX: number }
export declare function formatCaptureTime(ms: number): string
export declare function footerText(url: string | null | undefined, ms: number): string
export declare function safeName(name: unknown, fallback?: string): string
export declare function captureFileName(title: string | null | undefined, url: string | null | undefined, ms: number): string
export declare function pieceFileName(base: string, index: number, count: number, ext: string): string
export declare function normalizeOrigin(input: unknown): { ok: true; origin: string; pattern: string } | { ok: false; reason: string }
export declare function pickExpired(list: Array<{ id: string; createdAt: number }>, now: number, maxAgeMs?: number, keep?: number): string[]
