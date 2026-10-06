/** SNS 영상 받기 — 화면 쪽 순수 로직(시간 입력·사이트 알아보기) */

export type Kind = 'video' | 'audio' | 'transcript'
export type EditMode = 'keep' | 'cut'

export interface Range {
  start: number
  end: number
}

export const VIDEO_FORMATS = [
  { value: 'mp4', label: 'MP4 (가장 무난)' },
  { value: 'mov', label: 'MOV (맥·편집 프로그램)' },
  { value: 'mkv', label: 'MKV (원본 그대로)' },
  { value: 'webm', label: 'WebM (웹용)' },
  { value: 'avi', label: 'AVI (오래된 프로그램용)' },
] as const
export const AUDIO_FORMATS = [
  { value: 'mp3', label: 'MP3' },
  { value: 'm4a', label: 'M4A (AAC)' },
  { value: 'wav', label: 'WAV (무손실)' },
] as const
export const TEXT_FORMATS = [
  { value: 'txt', label: 'TXT (대본만)' },
  { value: 'srt', label: 'SRT (시간 포함 자막)' },
] as const
export const BITRATES = [
  { value: '320', label: '320kbps (최고)' },
  { value: '256', label: '256kbps' },
  { value: '192', label: '192kbps (권장)' },
  { value: '128', label: '128kbps (작은 파일)' },
  { value: '96', label: '96kbps (말소리)' },
] as const

/** "1:23", "01:02:03", "83", "1:23.5" → 초. 잘못되면 null */
export function parseTime(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(t)) return null
  const parts = t.split(':').map(Number)
  let sec = 0
  for (const p of parts) sec = sec * 60 + p
  return Number.isFinite(sec) ? sec : null
}

/** 초 → "1:05" / "1:02:03" */
export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const s = Math.floor(sec % 60)
  const m = Math.floor((sec / 60) % 60)
  const h = Math.floor(sec / 3600)
  const frac = sec % 1 >= 0.05 ? `.${Math.round((sec % 1) * 10) % 10}` : ''
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${frac}` : `${m}:${String(s).padStart(2, '0')}${frac}`
}

/** 남게 될 구간(초). keep 은 고른 구간, cut 은 전체에서 고른 구간을 뺀 나머지 */
export function keptRanges(mode: EditMode, ranges: Range[], duration: number): Array<[number, number]> {
  const clean = ranges
    .map((r) => [Math.max(0, r.start), duration ? Math.min(duration, r.end) : r.end] as [number, number])
    .filter(([s, e]) => e - s >= 0.1)
    .sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const [s, e] of clean) {
    const last = merged[merged.length - 1]
    if (last && s <= last[1]) last[1] = Math.max(last[1], e)
    else merged.push([s, e])
  }
  if (mode === 'keep') return merged
  if (!duration) return []
  const out: Array<[number, number]> = []
  let t = 0
  for (const [s, e] of merged) {
    if (s - t >= 0.1) out.push([t, s])
    t = Math.max(t, e)
  }
  if (duration - t >= 0.1) out.push([t, duration])
  return out
}

/** 사이트 이름(화면 표시용) */
export function siteOf(url: string): string {
  try {
    const h = new URL(url).hostname.replace(/^www\.|^m\./, '')
    if (/youtube\.com$|youtu\.be$/.test(h)) return '유튜브'
    if (/tiktok\.com$/.test(h)) return '틱톡'
    if (/instagram\.com$/.test(h)) return '인스타그램'
    if (/facebook\.com$|fb\.watch$/.test(h)) return '페이스북'
    if (/x\.com$|twitter\.com$/.test(h)) return 'X(트위터)'
    if (/naver\.com$/.test(h)) return '네이버'
    if (/vimeo\.com$/.test(h)) return '비메오'
    return h
  } catch {
    return ''
  }
}

/** 유튜브 영상 id (미리보기 재생용) */
export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url)
    const h = u.hostname.replace(/^www\.|^m\./, '')
    if (h === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null
    if (/youtube\.com$/.test(h)) {
      if (u.searchParams.get('v')) return u.searchParams.get('v')
      const m = u.pathname.match(/^\/(shorts|embed|live)\/([\w-]{6,})/)
      if (m) return m[2]
    }
  } catch {}
  return null
}

/** 붙여넣은 글에서 첫 링크만 꺼낸다(공유 문구에 링크가 섞여 오는 경우) */
export function extractUrl(text: string): string {
  const m = text.match(/https?:\/\/[^\s<>"']+/)
  return m ? m[0] : text.trim()
}

/** 영상 제목 → 파일 이름. "YENA(최예나) - '캐치 캐치' M/V" → "YENA(최예나) 캐치 캐치" */
export function fileNameFromTitle(title: string): string {
  let t = title
    .replace(/[\[(（【]\s*(official|공식|lyrics?|가사|m\/?v|music video|audio|performance|4k|hd|mv)[^\])）】]*[\])）】]/gi, ' ')
    .replace(/\b(official\s+)?(music\s+video|lyric\s+video|audio|m\/v|mv)\b/gi, ' ')
    .replace(/['"‘’“”「」『』]/g, ' ')
    .replace(/\s[-–—|·]\s/g, ' ')
    .replace(/[\\/:*?<>|\x00-\x1f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  t = t.replace(/^[-–—|·\s]+|[-–—|·\s]+$/g, '')
  return t.slice(0, 80) || '영상'
}
