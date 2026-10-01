/** 저장: 파일 이름 규칙과 형식·품질·목표 용량 인코딩 */
import { sanitizeFilename, stripExt } from '@/lib/files'
import { FORMAT_EXT, canvasToBlob, encodeUnderSize, resizeCanvas, type RasterFormat } from '@/lib/image'
import type { EncodedResult, ExportSettings } from './types'

export const DEFAULT_EXPORT: ExportSettings = {
  format: 'image/jpeg',
  quality: 90,
  limitSize: false,
  targetKB: 500,
  shrinkToFit: false,
  naming: 'original',
  suffix: '_편집',
  seqBase: '',
  seqStart: null,
}

export const FORMAT_LABEL: Record<RasterFormat, string> = { 'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/webp': 'WebP' }

const FORMATS: RasterFormat[] = ['image/jpeg', 'image/png', 'image/webp']

export interface ResolvedExport {
  format: RasterFormat
  /** 0–1 */
  quality: number
  /** 바이트. 제한이 없으면 null */
  maxBytes: number | null
  shrinkToFit: boolean
}

export function resolveExport(e: ExportSettings): ResolvedExport {
  const format = FORMATS.includes(e.format) ? e.format : 'image/jpeg'
  const q = typeof e.quality === 'number' && Number.isFinite(e.quality) ? Math.min(100, Math.max(1, e.quality)) : 90
  const kb = typeof e.targetKB === 'number' && Number.isFinite(e.targetKB) && e.targetKB > 0 ? e.targetKB : null
  return { format, quality: q / 100, maxBytes: e.limitSize && kb ? Math.round(kb * 1024) : null, shrinkToFit: Boolean(e.shrinkToFit) }
}

export interface NamingContext {
  /** 팀 파일명 규칙(관리자 프리셋) */
  team: { base: string; start: number; digits: number }
}

/** index 는 목록에서의 순서(0부터). 확장자는 저장 형식에 맞춘다. */
export function outputName(originalName: string, index: number, e: ExportSettings, ctx: NamingContext): string {
  const ext = FORMAT_EXT[FORMATS.includes(e.format) ? e.format : 'image/jpeg']
  if (e.naming === 'sequence') {
    const base = sanitizeFilename(e.seqBase.trim() || ctx.team.base, '사진')
    const start = typeof e.seqStart === 'number' && Number.isFinite(e.seqStart) ? Math.max(0, Math.floor(e.seqStart)) : ctx.team.start
    const digits = Math.min(8, Math.max(1, Math.floor(ctx.team.digits) || 1))
    return `${base}_${String(start + index).padStart(digits, '0')}.${ext}`
  }
  const stem = sanitizeFilename(stripExt(originalName), '사진')
  const suffix = e.suffix.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
  return `${stem}${suffix}.${ext}`
}

/** 목표 용량을 넘었을 때 다음에 시도할 축소 배율(이전 배율에 곱한다). 용량은 대략 넓이에 비례한다고 본다. */
export function shrinkStep(bytes: number, maxBytes: number): number {
  if (bytes <= maxBytes) return 1
  return Math.min(0.95, Math.max(0.5, Math.sqrt(maxBytes / bytes) * 0.97))
}

export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('취소했습니다.', 'AbortError')
}

export const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError'

/**
 * 캔버스를 저장 형식으로 만든다.
 * 목표 용량이 있으면 먼저 고른 품질로 해 보고, 넘으면 품질을 자동으로 낮춘다.
 * 그래도 넘으면 shrinkToFit 일 때만 크기를 조금씩 줄인다.
 */
export async function encodeCanvas(canvas: HTMLCanvasElement, e: ResolvedExport, signal?: AbortSignal): Promise<EncodedResult> {
  const { format, maxBytes } = e
  const base = e.quality
  let blob = await canvasToBlob(canvas, format, base)
  let quality = format === 'image/png' ? 1 : base
  let width = canvas.width
  let height = canvas.height
  let scale = 1
  if (maxBytes == null) return { blob, width, height, quality, scale, over: false }

  throwIfAborted(signal)
  if (blob.size > maxBytes && format !== 'image/png') {
    const r = await encodeUnderSize(canvas, format, maxBytes)
    blob = r.blob
    quality = r.quality
  }
  if (blob.size > maxBytes && e.shrinkToFit) {
    for (let i = 0; i < 8 && blob.size > maxBytes; i++) {
      throwIfAborted(signal)
      scale *= shrinkStep(blob.size, maxBytes)
      const w = Math.max(1, Math.round(canvas.width * scale))
      const h = Math.max(1, Math.round(canvas.height * scale))
      if (w < 16 || h < 16) break
      const small = resizeCanvas(canvas, w, h)
      if (format === 'image/png') {
        blob = await canvasToBlob(small, format)
      } else {
        const r = await encodeUnderSize(small, format, maxBytes)
        blob = r.blob
        quality = r.quality
      }
      width = w
      height = h
      small.width = 0
    }
  }
  return { blob, width, height, quality, scale: width / canvas.width, over: blob.size > maxBytes }
}
