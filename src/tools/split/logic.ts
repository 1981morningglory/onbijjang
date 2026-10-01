/** 사진 분할의 순수 계산: 분할선 위치, 조각 사각형, 파일명. 모든 좌표는 "저장될 크기" 기준 정수 px. */

export type SplitMode = 'count' | 'grid' | 'every'
/** stack: 위아래로 쌓이는 조각이 더 많게(세로 우선) · side: 좌우로 나란한 조각이 더 많게(가로 우선) */
export type CountDirection = 'stack' | 'side'
export type EveryAxis = 'height' | 'width'

export const COUNT_OPTIONS = [2, 4, 8, 16] as const
export const MAX_GRID = 20
export const MAX_PIECES = 400

export interface PieceRect {
  /** 0부터, 왼쪽 위에서 오른쪽으로, 다음 줄로 */
  index: number
  row: number
  col: number
  x: number
  y: number
  w: number
  h: number
}

/** 조각 수를 행×열로 바꾼다. 2→2×1, 4→2×2, 8→4×2, 16→4×4 (stack 기준, side 는 행·열이 뒤바뀐다). */
export function countToGrid(count: number, direction: CountDirection): { rows: number; cols: number } {
  const n = Math.max(1, Math.floor(count))
  let small = 1
  for (let d = 1; d * d <= n; d++) if (n % d === 0) small = d
  const large = n / small
  return direction === 'stack' ? { rows: large, cols: small } : { rows: small, cols: large }
}

/** 정수로 다듬고, 범위(1 … total-1) 밖과 중복을 버리고 정렬한다. */
export function sanitizeCuts(cuts: readonly number[], total: number): number[] {
  const set = new Set<number>()
  for (const c of cuts) {
    const v = Math.round(c)
    if (Number.isFinite(v) && v >= 1 && v <= total - 1) set.add(v)
  }
  return [...set].sort((a, b) => a - b)
}

/** total 을 parts 조각으로 고르게 나누는 분할선(parts-1 개). 너무 작아 나눌 수 없으면 가능한 만큼만. */
export function evenCuts(total: number, parts: number): number[] {
  const n = Math.max(1, Math.floor(parts))
  const cuts: number[] = []
  for (let i = 1; i < n; i++) cuts.push((total * i) / n)
  return sanitizeCuts(cuts, total)
}

/** step px 마다 자르는 분할선. 마지막 조각은 남는 만큼. 조각 수는 maxPieces 를 넘지 않는다. */
export function everyCuts(total: number, step: number, maxPieces = MAX_PIECES): number[] {
  const s = Math.floor(step)
  if (!Number.isFinite(s) || s < 1) return []
  const cuts: number[] = []
  for (let pos = s; pos < total && cuts.length < maxPieces - 1; pos += s) cuts.push(pos)
  return cuts
}

/** step px 마다 자르면 몇 조각이 되는지(제한 적용 전) */
export function everyPieceCount(total: number, step: number): number {
  const s = Math.floor(step)
  if (!Number.isFinite(s) || s < 1) return 1
  return Math.max(1, Math.ceil(total / s))
}

/** index 번째 분할선을 pos 로 옮긴다. 양옆 분할선·가장자리와 minGap 이상 떨어지게 막는다. */
export function moveCut(cuts: readonly number[], index: number, pos: number, total: number, minGap = 1): number[] {
  if (index < 0 || index >= cuts.length) return [...cuts]
  const lo = (index > 0 ? cuts[index - 1] : 0) + minGap
  const hi = (index < cuts.length - 1 ? cuts[index + 1] : total) - minGap
  if (lo > hi) return [...cuts]
  const next = [...cuts]
  next[index] = Math.min(hi, Math.max(lo, Math.round(pos)))
  return next
}

/** 전체 크기가 바뀌었을 때 손으로 옮긴 분할선을 같은 비율 위치로 옮긴다. */
export function rescaleCuts(cuts: readonly number[], from: number, to: number): number[] {
  if (from <= 0) return []
  return sanitizeCuts(cuts.map((c) => (c * to) / from), to)
}

/** 세로 분할선(xCuts)과 가로 분할선(yCuts)으로 생기는 조각들 */
export function pieceRects(xCuts: readonly number[], yCuts: readonly number[], width: number, height: number): PieceRect[] {
  const xs = [0, ...sanitizeCuts(xCuts, width), width]
  const ys = [0, ...sanitizeCuts(yCuts, height), height]
  const out: PieceRect[] = []
  for (let r = 0; r < ys.length - 1; r++) {
    for (let c = 0; c < xs.length - 1; c++) {
      out.push({ index: out.length, row: r, col: c, x: xs[c], y: ys[r], w: xs[c + 1] - xs[c], h: ys[r + 1] - ys[r] })
    }
  }
  return out
}

/** 원본명_01.png — 자릿수는 조각 수에 맞추되 최소 2자리 */
export function pieceName(base: string, index: number, total: number, ext: string): string {
  const digits = Math.max(2, String(Math.max(1, total)).length)
  return `${base}_${String(index + 1).padStart(digits, '0')}.${ext}`
}

export type ScaleChoice = { kind: 'factor'; factor: number } | { kind: 'width'; width: number }

/** 분할 전 전체 크기(비율 유지). 너비를 직접 주면 높이는 비율대로. */
export function scaledSize(w: number, h: number, choice: ScaleChoice): { width: number; height: number; scale: number } {
  const scale = choice.kind === 'factor' ? choice.factor : choice.width / w
  if (!Number.isFinite(scale) || scale <= 0) return { width: w, height: h, scale: 1 }
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), scale }
}

export interface SplitPlan {
  xCuts: number[]
  yCuts: number[]
  /** every 모드에서 조각 수 제한에 걸려 일부만 나눴으면 true */
  capped: boolean
}

export interface SplitParams {
  mode: SplitMode
  count: number
  direction: CountDirection
  rows: number
  cols: number
  everyAxis: EveryAxis
  everyPx: number
}

/** 설정대로 처음 분할선을 놓는다(균등 분할 초기화에도 쓴다). */
export function planCuts(p: SplitParams, width: number, height: number): SplitPlan {
  if (p.mode === 'every') {
    const total = p.everyAxis === 'height' ? height : width
    const cuts = everyCuts(total, p.everyPx)
    const capped = everyPieceCount(total, p.everyPx) > MAX_PIECES
    return p.everyAxis === 'height' ? { xCuts: [], yCuts: cuts, capped } : { xCuts: cuts, yCuts: [], capped }
  }
  const clamp = (n: number) => Math.min(MAX_GRID, Math.max(1, Math.floor(n) || 1))
  const { rows, cols } = p.mode === 'count' ? countToGrid(p.count, p.direction) : { rows: clamp(p.rows), cols: clamp(p.cols) }
  return { xCuts: evenCuts(width, cols), yCuts: evenCuts(height, rows), capped: false }
}
