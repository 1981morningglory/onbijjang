import { clampRange, round3 } from './shared/time'
import { GIF_MAX_SECONDS, type OutputFormat } from './shared/types'

export interface ClipRange {
  id: string
  name: string
  start: number
  end: number
  /** 변환 대상으로 고른 구간인지 */
  selected: boolean
}

export const MIN_RANGE = 0.1
export const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024
export const MAX_DURATION = 60 * 60

let seq = 0
export function newRangeId(): string {
  return `r${Date.now().toString(36)}${(seq++).toString(36)}`
}

/** "구간 3" — 이미 쓰는 번호는 건너뛴다. */
export function nextRangeName(ranges: ClipRange[]): string {
  const used = new Set(ranges.map((r) => r.name.trim()))
  for (let n = ranges.length + 1; ; n++) {
    const name = `구간 ${n}`
    if (!used.has(name)) return name
  }
}

export function addRange(ranges: ClipRange[], start: number, end: number, duration: number): ClipRange[] {
  const c = clampRange(start, end, duration, MIN_RANGE)
  return [...ranges, { id: newRangeId(), name: nextRangeName(ranges), start: c.start, end: c.end, selected: true }]
}

/**
 * 시작 또는 끝 하나만 옮긴다. 반대쪽을 넘어가지 않게 막고(최소 길이 유지) 영상 길이 안에 둔다.
 * 타임라인에서 손잡이를 끌 때와 숫자를 직접 고칠 때 쓴다.
 */
export function moveEdge(range: ClipRange, edge: 'start' | 'end', time: number, duration: number): ClipRange {
  if (!Number.isFinite(time)) return range
  if (edge === 'start') {
    const start = round3(Math.min(Math.max(0, time), Math.max(0, range.end - MIN_RANGE)))
    return { ...range, start }
  }
  const end = round3(Math.max(Math.min(duration, time), Math.min(duration, range.start + MIN_RANGE)))
  return { ...range, end }
}

/** 이 형식으로 변환할 수 없는 이유. 문제없으면 null. */
export function rangeProblem(range: ClipRange, format: OutputFormat): string | null {
  const length = range.end - range.start
  if (length < MIN_RANGE - 1e-6) return '구간이 너무 짧습니다.'
  if (format !== 'mp4' && length > GIF_MAX_SECONDS + 1e-6) {
    return `${format === 'gif' ? 'GIF' : 'WebP'} 는 한 구간 ${GIF_MAX_SECONDS}초까지입니다. 구간을 줄이거나 MP4 로 바꿔 주세요.`
  }
  return null
}

const TICK_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800]

/** 타임라인 눈금 간격(초). 보이는 폭에 눈금이 maxTicks 개를 넘지 않게 고른다. */
export function tickStep(duration: number, zoom: number, maxTicks = 8): number {
  const visible = duration / Math.max(1, zoom)
  for (const step of TICK_STEPS) if (visible / step <= maxTicks) return step
  return TICK_STEPS[TICK_STEPS.length - 1]
}

export function tickTimes(duration: number, step: number): number[] {
  const out: number[] = []
  for (let i = 0; i * step <= duration + 1e-9; i++) out.push(round3(i * step))
  return out
}

/** 타임라인 위 가로 위치(0–1)를 시각으로 */
export function timeAt(fraction: number, duration: number): number {
  return round3(Math.min(1, Math.max(0, fraction)) * duration)
}
