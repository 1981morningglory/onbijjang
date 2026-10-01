import clsx from 'clsx'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { extOf, formatBytes, sanitizeFilename, stripExt } from '@/lib/files'
import { FORMAT_EXT, canvasToBlob, ctx2d, isCanvasSizeSafe, loadBitmap, makeCanvas, type RasterFormat } from '@/lib/image'
import { Field, Segmented, Slider, toast } from '@/ui'

// ── 한도 ──────────────────────────────────────────────────
/** 한 장 최대 용량 */
export const MAX_FILE_BYTES = 40 * 1024 * 1024
/** 한 장 최대 화소(가로×세로). 이보다 크면 브라우저 메모리가 버티지 못한다. */
export const MAX_PIXELS = 40_000_000

export const ACCEPT_IMAGES = 'image/png,image/jpeg,image/webp,image/bmp,image/gif,image/avif'

/** 개수·용량 한도를 확인해 받을 수 있는 파일만 돌려주고, 제외한 이유를 알려준다. */
export function takeImageFiles(incoming: File[], currentCount: number, maxCount: number): File[] {
  const images = incoming.filter((f) => f.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'avif'].includes(extOf(f.name)))
  if (images.length < incoming.length) toast.warn(`사진이 아닌 파일 ${incoming.length - images.length}개는 제외했습니다.`)
  const small = images.filter((f) => f.size <= MAX_FILE_BYTES)
  if (small.length < images.length) toast.warn(`${formatBytes(MAX_FILE_BYTES)}를 넘는 사진 ${images.length - small.length}장은 제외했습니다.`)
  const room = Math.max(0, maxCount - currentCount)
  if (small.length > room) toast.warn(`한 번에 ${maxCount}장까지 다룰 수 있어 ${small.length - room}장은 제외했습니다.`)
  return small.slice(0, room)
}

/** 사진을 열고 화소 한도를 확인한다. 넘으면 이유와 한도를 담은 오류를 던진다. */
export async function openImage(file: Blob): Promise<ImageBitmap> {
  const bmp = await loadBitmap(file)
  if (bmp.width * bmp.height > MAX_PIXELS || !isCanvasSizeSafe(bmp.width, bmp.height)) {
    const mp = Math.round((bmp.width * bmp.height) / 1_000_000)
    bmp.close()
    throw new Error(`사진이 너무 큽니다(약 ${mp}백만 화소). ${MAX_PIXELS / 1_000_000}백만 화소 이하로 줄여서 올려 주세요.`)
  }
  return bmp
}

/** 목록에 쓰는 작은 미리보기(긴 변 size px) */
export function makeThumb(source: CanvasImageSource & { width: number; height: number }, size = 160): string {
  const k = Math.min(1, size / Math.max(source.width, source.height))
  const c = makeCanvas(source.width * k, source.height * k)
  const ctx = ctx2d(c)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, c.width, c.height)
  return c.toDataURL('image/webp', 0.7)
}

// ── 저장 형식 ─────────────────────────────────────────────
export interface ExportSettings {
  format: RasterFormat
  /** 10–100 (JPG·WebP 에만 쓰인다) */
  quality: number
}
export const DEFAULT_EXPORT: ExportSettings = { format: 'image/png', quality: 92 }

export function exportName(original: string, suffix: string, format: RasterFormat): string {
  return `${sanitizeFilename(stripExt(original), '사진')}${suffix}.${FORMAT_EXT[format]}`
}

export function encodeCanvas(canvas: HTMLCanvasElement, s: ExportSettings): Promise<Blob> {
  return canvasToBlob(canvas, s.format, s.quality / 100)
}

/** 저장 형식(PNG·JPG·WebP)과 품질 */
export function ExportFields({ value, onChange, transparentHint }: { value: ExportSettings; onChange: (v: ExportSettings) => void; transparentHint?: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <Segmented
        label="저장 형식"
        block
        value={value.format}
        onValue={(format) => onChange({ ...value, format })}
        options={[
          { value: 'image/png', label: 'PNG' },
          { value: 'image/jpeg', label: 'JPG' },
          { value: 'image/webp', label: 'WebP' },
        ]}
      />
      {value.format !== 'image/png' && (
        <Field label="품질" aside={`${value.quality}`}>
          {(id) => <Slider id={id} min={10} max={100} step={1} value={value.quality} onValue={(quality) => onChange({ ...value, quality })} />}
        </Field>
      )}
      {transparentHint && value.format === 'image/jpeg' && <p className="text-sm text-warn">JPG 는 투명한 부분을 담지 못해 흰색으로 채워집니다. 투명하게 저장하려면 PNG 나 WebP 를 고르세요.</p>}
    </div>
  )
}

// ── 사진 목록 ─────────────────────────────────────────────
export interface StripItem {
  id: string
  name: string
  thumb: string | null
}

/** 여러 장을 오갈 때 쓰는 가로 썸네일 목록 */
export function FileStrip<T extends StripItem>({ items, activeId, onSelect, onRemove, badge, disabled }: { items: T[]; activeId: string | null; onSelect: (id: string) => void; onRemove: (id: string) => void; badge?: (item: T) => ReactNode; disabled?: boolean }) {
  return (
    <ul className="flex gap-2.5 overflow-x-auto px-0.5 pb-1 pr-2 pt-2" aria-label="올린 사진 목록">
      {items.map((it) => {
        const active = it.id === activeId
        return (
          <li key={it.id} className="relative shrink-0">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onSelect(it.id)}
              aria-pressed={active}
              title={it.name}
              className={clsx(
                'checker relative block size-[72px] overflow-hidden rounded-md border-2 transition-[border-color,box-shadow] duration-150 disabled:opacity-60',
                active ? 'border-brand shadow-2' : 'border-line-strong hover:border-faint',
              )}
            >
              {it.thumb ? <img src={it.thumb} alt={it.name} className="size-full object-cover" draggable={false} /> : <span className="skeleton block size-full" />}
              {badge && <span className="absolute inset-x-0 bottom-0 flex justify-center bg-ink/70 px-1 py-0.5 text-2xs font-semibold text-paper">{badge(it)}</span>}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onRemove(it.id)}
              aria-label={`${it.name} 빼기`}
              title="목록에서 빼기"
              className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border border-line-strong bg-surface text-muted shadow-1 transition-colors duration-150 hover:bg-danger-soft hover:text-danger disabled:opacity-50"
            >
              <X className="size-3" aria-hidden />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

let seq = 0
export const newId = () => `${Date.now().toString(36)}-${(seq++).toString(36)}`
