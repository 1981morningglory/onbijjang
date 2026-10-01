import clsx from 'clsx'
import { ChevronLeft, ChevronRight, ImageOff, SquarePen, Trash2 } from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'
import { formatBytes } from '@/lib/files'
import { ctx2d } from '@/lib/image'
import { Badge, IconButton, Spinner } from '@/ui'
import { isEdited, photoSeed, plannedSize } from './geometry'
import { releaseCanvas, renderPhoto, type WatermarkDraw } from './render'
import type { Photo, ResolvedBatch } from './types'

export interface GridSettings {
  batch: ResolvedBatch
  watermark: WatermarkDraw | null
  shuffle: number
}

// ── 썸네일 그리기 대기열: 한 번에 몰아서 그리지 않고 조금씩 나눠 화면이 멈추지 않게 한다. ──
const queue = new Map<object, () => void>()
let running = false
function runQueue() {
  const start = performance.now()
  for (const [key, task] of queue) {
    queue.delete(key)
    try {
      task()
    } catch {
      // 한 장이 실패해도 나머지는 계속 그린다.
    }
    if (performance.now() - start > 14) break
  }
  if (queue.size) setTimeout(runQueue, 0)
  else running = false
}
function schedule(key: object, task: () => void): () => void {
  queue.set(key, task)
  if (!running) {
    running = true
    setTimeout(runQueue, 0)
  }
  return () => {
    if (queue.get(key) === task) queue.delete(key)
  }
}

function useInView<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const io = new IntersectionObserver((entries) => setInView(entries[entries.length - 1].isIntersecting), { rootMargin: '300px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return [ref, inView]
}

/** 전체 설정과 정밀 편집이 반영된 작은 결과 그림. 화면에 보일 때만 그린다. */
function Thumb({ photo, settings }: { photo: Photo; settings: GridSettings }) {
  const [wrapRef, inView] = useInView<HTMLDivElement>()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const key = useRef({}).current
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const preview = photo.preview
    if (!inView || !preview) return
    return schedule(key, () => {
      const canvas = canvasRef.current
      if (!canvas || !preview.width) return
      try {
        const out = renderPhoto(
          { image: preview, width: photo.width, height: photo.height },
          photo.edits,
          { batch: settings.batch, watermark: settings.watermark, seed: photoSeed(photo.id, settings.shuffle) },
          { maxSide: 320 },
        )
        canvas.width = out.width
        canvas.height = out.height
        ctx2d(canvas).drawImage(out, 0, 0)
        releaseCanvas(out)
        setFailed(false)
      } catch {
        setFailed(true)
      }
    })
  }, [inView, key, photo.preview, photo.width, photo.height, photo.edits, photo.id, settings])

  return (
    <div ref={wrapRef} className="checker flex aspect-square items-center justify-center overflow-hidden rounded-sm border border-line">
      {photo.status === 'pending' && <Spinner className="text-muted" />}
      {(photo.status === 'error' || failed) && <ImageOff className="size-6 text-danger" aria-hidden />}
      <canvas ref={canvasRef} className={clsx('max-h-full max-w-full', (photo.status !== 'ready' || failed) && 'hidden')} />
    </div>
  )
}

export interface PhotoCardProps {
  photo: Photo
  index: number
  total: number
  selected: boolean
  settings: GridSettings
  /** 마지막 저장에서 나온 용량(설정이 그대로일 때만) */
  savedBytes?: number
  disabled?: boolean
  onSelect: (id: string) => void
  onEdit: (id: string) => void
  onRemove: (id: string) => void
  onMove: (id: string, dir: -1 | 1) => void
  onReorder: (dragId: string, targetId: string) => void
}

const DRAG_TYPE = 'application/x-onbijjang-photo'

export const PhotoCard = memo(function PhotoCard({ photo, index, total, selected, settings, savedBytes, disabled, onSelect, onEdit, onRemove, onMove, onReorder }: PhotoCardProps) {
  const [over, setOver] = useState(false)
  const ready = photo.status === 'ready'
  const out = ready ? plannedSize(photo.width, photo.height, photo.edits, settings.batch, photoSeed(photo.id, settings.shuffle)) : null
  return (
    <li
      draggable={!disabled}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, photo.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false)
        const id = e.dataTransfer.getData(DRAG_TYPE)
        if (!id) return
        e.preventDefault()
        e.stopPropagation()
        if (id !== photo.id) onReorder(id, photo.id)
      }}
      className={clsx(
        'flex min-w-0 flex-col gap-1.5 rounded-md border bg-surface p-1.5 transition-[border-color,box-shadow] duration-150',
        selected ? 'border-brand shadow-2 ring-2 ring-brand/25' : 'border-line hover:border-line-strong',
        over && 'border-brand bg-brand-soft',
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(photo.id)}
        onDoubleClick={() => ready && !disabled && onEdit(photo.id)}
        aria-pressed={selected}
        aria-label={`${index + 1}번째 사진 ${photo.name} 선택`}
        className="relative block rounded-sm"
      >
        <Thumb photo={photo} settings={settings} />
        <span className="num absolute left-1 top-1 rounded-xs bg-ink/75 px-1.5 text-2xs font-bold leading-5 text-paper">{index + 1}</span>
        {isEdited(photo.edits) && (
          <Badge tone="mark" className="absolute right-1 top-1">
            편집됨
          </Badge>
        )}
      </button>
      <div className="min-w-0 px-0.5">
        <p className="truncate text-xs font-semibold text-ink" title={photo.name}>
          {photo.name}
        </p>
        {photo.status === 'error' ? (
          <p className="text-2xs text-danger">{photo.error}</p>
        ) : (
          <>
            <p className="num truncate text-2xs text-muted">{ready ? `${photo.width}×${photo.height} · ${formatBytes(photo.bytes)}` : `읽는 중 · ${formatBytes(photo.bytes)}`}</p>
            <p className="num truncate text-2xs text-brand-ink">
              {out ? `저장 ${out.width}×${out.height}` : ' '}
              {savedBytes != null && ` · ${formatBytes(savedBytes)}`}
            </p>
          </>
        )}
      </div>
      <div className="flex items-center justify-between">
        <div className="flex">
          <IconButton icon={ChevronLeft} label="앞으로 옮기기" size="sm" disabled={disabled || index === 0} onClick={() => onMove(photo.id, -1)} />
          <IconButton icon={ChevronRight} label="뒤로 옮기기" size="sm" disabled={disabled || index === total - 1} onClick={() => onMove(photo.id, 1)} />
        </div>
        <div className="flex">
          <IconButton icon={SquarePen} label="정밀 편집" size="sm" disabled={disabled || !ready} onClick={() => onEdit(photo.id)} />
          <IconButton icon={Trash2} label="목록에서 빼기" size="sm" disabled={disabled} onClick={() => onRemove(photo.id)} />
        </div>
      </div>
    </li>
  )
})
