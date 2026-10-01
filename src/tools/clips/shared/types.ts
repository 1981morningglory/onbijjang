/** clips · gif · record 가 함께 쓰는 출력 설정 타입과 기본값 */

export type OutputFormat = 'gif' | 'mp4' | 'webp'
export type AspectMode = 'source' | '16:9' | '9:16' | '1:1'
export type FitMode = 'pad' | 'cover'
export type QualityLevel = 'high' | 'medium' | 'low'
export type BitrateChoice = QualityLevel | 'custom'

export interface OutputSettings {
  format: OutputFormat
  /** GIF·WebP 긴 변(px) 320–960 */
  gifLongSide: number
  /** GIF·WebP 초당 프레임 */
  gifFps: number
  /** GIF 팔레트 품질(색 수) */
  gifQuality: QualityLevel
  /** MP4 긴 변(px). 0 이면 원본 크기 */
  videoLongSide: number
  videoFps: number
  /** MP4 비트레이트: 화질 단계 또는 직접 입력 */
  videoBitrate: BitrateChoice
  /** 직접 입력일 때 Mbps */
  videoMbps: number
  aspect: AspectMode
  fit: FitMode
  padColor: string
}

export const DEFAULT_OUTPUT: OutputSettings = {
  format: 'gif',
  gifLongSide: 480,
  gifFps: 10,
  gifQuality: 'medium',
  videoLongSide: 1080,
  videoFps: 30,
  videoBitrate: 'medium',
  videoMbps: 2,
  aspect: 'source',
  fit: 'pad',
  padColor: '#000000',
}

export const GIF_FPS_OPTIONS = [5, 10, 15, 20] as const
export const GIF_SIZE_MIN = 320
export const GIF_SIZE_MAX = 960
/** GIF·WebP 한 구간 최대 길이(초) */
export const GIF_MAX_SECONDS = 60

/** 화질 단계별 화소당 비트 수(초당). 720p30 기준 낮음 약 1.4 · 보통 2.8 · 높음 5 Mbps */
const BITS_PER_PIXEL: Record<QualityLevel, number> = { low: 0.05, medium: 0.1, high: 0.18 }

/** 출력 크기·프레임 수·화질 선택으로 비트레이트(bps)를 정한다. */
export function resolveBitrate(settings: Pick<OutputSettings, 'videoBitrate' | 'videoMbps'>, width: number, height: number, fps: number): number {
  if (settings.videoBitrate === 'custom') {
    const mbps = Number.isFinite(settings.videoMbps) ? settings.videoMbps : 2
    return Math.round(Math.min(50, Math.max(0.1, mbps)) * 1_000_000)
  }
  const raw = width * height * fps * BITS_PER_PIXEL[settings.videoBitrate]
  return Math.round(Math.min(40_000_000, Math.max(150_000, raw)))
}

export function clampGifLongSide(v: number): number {
  if (!Number.isFinite(v)) return 480
  return Math.round(Math.min(GIF_SIZE_MAX, Math.max(GIF_SIZE_MIN, v)))
}

/** 형식별로 실제 쓰는 긴 변·프레임 수 */
export function effectiveSize(settings: OutputSettings): { longSide: number; fps: number } {
  if (settings.format === 'mp4') return { longSide: settings.videoLongSide > 0 ? settings.videoLongSide : Infinity, fps: settings.videoFps }
  return { longSide: clampGifLongSide(settings.gifLongSide), fps: settings.gifFps }
}
