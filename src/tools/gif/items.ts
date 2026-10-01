import { GIF_MAX_SECONDS, type OutputFormat } from '../clips/shared/types'

export interface VideoItem {
  id: string
  file: File
  /** loading: 길이·크기를 읽는 중 · ready: 변환 가능 · error: 열 수 없는 파일 */
  status: 'loading' | 'ready' | 'error'
  error?: string
  duration: number
  width: number
  height: number
  /** 쓸 구간(초) */
  start: number
  end: number
  thumb: string | null
}

export const MAX_FILES = 20
export const MAX_FILE_BYTES = 1024 * 1024 * 1024
export const MAX_DURATION = 60 * 60
const MIN_LENGTH = 0.1

let seq = 0
export function newItemId(): string {
  return `v${Date.now().toString(36)}${(seq++).toString(36)}`
}

const round3 = (n: number) => Math.round(n * 1000) / 1000

/** "모두 처음 N초": 영상이 N초보다 짧으면 전체를 쓴다. */
export function applyFirstSeconds<T extends Pick<VideoItem, 'status' | 'duration' | 'start' | 'end'>>(item: T, seconds: number): T {
  if (item.status !== 'ready') return item
  const n = Number.isFinite(seconds) && seconds > 0 ? seconds : item.duration
  return { ...item, start: 0, end: round3(Math.max(Math.min(item.duration, MIN_LENGTH), Math.min(item.duration, n))) }
}

/** 시작 또는 끝 하나만 옮긴다. 서로 넘어가지 않고 영상 길이를 벗어나지 않는다. */
export function moveItemEdge<T extends Pick<VideoItem, 'duration' | 'start' | 'end'>>(item: T, edge: 'start' | 'end', time: number): T {
  if (!Number.isFinite(time)) return item
  if (edge === 'start') return { ...item, start: round3(Math.min(Math.max(0, time), Math.max(0, item.end - MIN_LENGTH))) }
  return { ...item, end: round3(Math.max(Math.min(item.duration, time), Math.min(item.duration, item.start + MIN_LENGTH))) }
}

/** 이 형식으로 변환할 수 없는 이유. 문제없으면 null. */
export function itemProblem(item: Pick<VideoItem, 'start' | 'end'>, format: OutputFormat): string | null {
  const length = item.end - item.start
  if (length < MIN_LENGTH - 1e-6) return '구간이 너무 짧습니다.'
  if (format !== 'mp4' && length > GIF_MAX_SECONDS + 1e-6) {
    return `${format === 'gif' ? 'GIF' : 'WebP'} 는 ${GIF_MAX_SECONDS}초까지입니다. 구간을 줄이거나 MP4 로 바꿔 주세요.`
  }
  return null
}
