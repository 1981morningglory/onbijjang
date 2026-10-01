import { sanitizeFilename } from '@/lib/files'
import type { QualityLevel } from './types'

/** 초 → "1:23.4" (한 시간이 넘으면 "1:02:03.4"). tenths=false 면 소수점 없이. */
export function formatTime(seconds: number, tenths = true): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const total = tenths ? Math.round(seconds * 10) / 10 : Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total - h * 3600 - m * 60
  const sec = tenths ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** "83.5" · "1:23.5" · "1:02:03" → 초. 읽을 수 없으면 null. */
export function parseTime(text: string): number | null {
  const t = text.trim().replace(/,/g, '.')
  if (!t) return null
  const parts = t.split(':')
  if (parts.length > 3) return null
  let total = 0
  for (const [i, p] of parts.entries()) {
    if (!/^\d+(\.\d+)?$/.test(p) && !(i === parts.length - 1 && /^\d*\.\d+$/.test(p))) return null
    const n = Number(p)
    if (!Number.isFinite(n)) return null
    // 마지막 칸(초)만 소수 허용, 앞 칸은 정수
    if (i < parts.length - 1 && !Number.isInteger(n)) return null
    total = total * 60 + n
  }
  return total
}

/** "12초" · "1분 5초" 같은 길이 표시 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  if (seconds < 60) return `${Math.round(seconds * 10) / 10}초`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds - m * 60)
  if (s === 60) return `${m + 1}분`
  return s ? `${m}분 ${s}초` : `${m}분`
}

/** 구간을 영상 길이 안으로 넣고, 최소 길이를 지킨다. */
export function clampRange(start: number, end: number, duration: number, minLength = 0.1): { start: number; end: number } {
  const d = Math.max(minLength, duration)
  let s = Math.min(Math.max(0, start), d)
  let e = Math.min(Math.max(0, end), d)
  if (e < s) [s, e] = [e, s]
  if (e - s < minLength) {
    e = Math.min(d, s + minLength)
    s = Math.max(0, e - minLength)
  }
  return { start: round3(s), end: round3(e) }
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

/** 구간에서 뽑을 프레임 시각들. 마지막 프레임은 끝 시각을 넘지 않는다. */
export function frameTimes(start: number, end: number, fps: number): number[] {
  const count = Math.max(1, Math.round((end - start) * fps))
  const times: number[] = []
  for (let i = 0; i < count; i++) times.push(start + i / fps)
  return times
}

/** GIF 예상 용량(바이트) — 화면 내용에 따라 크게 달라지는 어림값이다. */
export function estimateGifBytes(width: number, height: number, frames: number, quality: QualityLevel): number {
  const perPixel = quality === 'high' ? 0.42 : quality === 'medium' ? 0.3 : 0.2
  return Math.round(width * height * frames * perPixel)
}

export function estimateVideoBytes(bitrate: number, seconds: number): number {
  return Math.round((bitrate * seconds) / 8)
}

/** 결과 파일명: 원본이름_구간이름.ext */
export function outputName(sourceName: string, label: string, ext: string): string {
  const base = sanitizeFilename(sourceName.replace(/\.[^.]+$/, ''), '영상')
  const tail = sanitizeFilename(label, '').replace(/\s+/g, '-')
  return `${base}${tail ? `_${tail}` : ''}.${ext}`
}
