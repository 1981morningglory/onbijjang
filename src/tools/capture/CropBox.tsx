import clsx from 'clsx'
import { useRef, type PointerEvent } from 'react'
import { MIN_SIDE, dragRect, isTrimmed, rectFromPoints, rectToTrim, trimToRect, type Handle, type Point, type Rect, type Trim } from './logic'

interface CropBoxProps {
  src: string
  alt: string
  /** 원본 크기(px) */
  w: number
  h: number
  trim: Trim
  onTrim: (trim: Trim) => void
  /** 나누는 선의 위치(원본 이미지 y, px) */
  cuts: number[]
}

const pct = (v: number, total: number) => `${(v / total) * 100}%`

const KNOB = 'pointer-events-none absolute size-3 rounded-xs border border-ink bg-mark shadow-1'

/**
 * 미리보기 위의 자르기 틀. 노란 틀의 가장자리·모서리를 끌어 줄이고, 틀 안을 끌어 옮기고,
 * 틀 밖(또는 아직 자르지 않은 이미지)을 끌면 새로 그린다. 터치에서는 스크롤을 막지 않도록 손잡이만 끈다.
 */
export function CropBox({ src, alt, w, h, trim, onTrim, cuts }: CropBoxProps) {
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<{ handle: Handle; start: Point; rect: Rect; pointerId: number } | null>(null)
  const rect = trimToRect(trim, w, h)
  const trimmed = isTrimmed(trim)

  const toImage = (e: PointerEvent): Point => {
    const r = box.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * w, y: ((e.clientY - r.top) / r.height) * h }
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !box.current) return
    const named = (e.target as HTMLElement).closest<HTMLElement>('[data-handle]')?.dataset.handle as Handle | undefined
    // 아직 자르지 않았으면 틀이 이미지 전체라 옮길 곳이 없다. 그때는 안쪽을 끌어 새로 그린다.
    const handle: Handle = named === 'move' && !trimmed ? 'new' : (named ?? 'new')
    if (e.pointerType === 'touch' && (handle === 'move' || handle === 'new')) return
    e.preventDefault()
    box.current.setPointerCapture(e.pointerId)
    drag.current = { handle, start: toImage(e), rect, pointerId: e.pointerId }
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    const p = toImage(e)
    let next: Rect
    if (d.handle === 'new') {
      next = rectFromPoints(d.start, p, w, h)
      // 실수로 찍은 점 하나로 틀이 사라지지 않게, 어느 정도 끌었을 때부터 반영한다.
      if (next.w < MIN_SIDE || next.h < MIN_SIDE) return
    } else {
      next = dragRect(d.rect, d.handle, p.x - d.start.x, p.y - d.start.y, w, h)
    }
    onTrim(rectToTrim(next, w, h))
  }

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== e.pointerId) return
    drag.current = null
    if (box.current?.hasPointerCapture(e.pointerId)) box.current.releasePointerCapture(e.pointerId)
  }

  const shade = 'absolute bg-ink/55'
  return (
    <div
      ref={box}
      className="relative inline-block max-w-full cursor-crosshair select-none align-top"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <img src={src} alt={alt} draggable={false} className="block h-auto max-w-full bg-surface shadow-3" />
      <div aria-hidden className="absolute inset-0">
        {/* 잘려 나가는 부분 */}
        <div className={shade} style={{ left: 0, right: 0, top: 0, height: pct(rect.y, h) }} />
        <div className={shade} style={{ left: 0, right: 0, bottom: 0, height: pct(h - rect.y - rect.h, h) }} />
        <div className={shade} style={{ left: 0, width: pct(rect.x, w), top: pct(rect.y, h), height: pct(rect.h, h) }} />
        <div className={shade} style={{ right: 0, width: pct(w - rect.x - rect.w, w), top: pct(rect.y, h), height: pct(rect.h, h) }} />

        {/* 남는 부분 */}
        <div
          data-handle="move"
          className={clsx('absolute outline-2 -outline-offset-2 outline-mark', trimmed ? 'cursor-move' : 'cursor-crosshair')}
          style={{ left: pct(rect.x, w), top: pct(rect.y, h), width: pct(rect.w, w), height: pct(rect.h, h) }}
        >
          {cuts.map((y, i) => (
            <div key={y} className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-accent" style={{ top: pct(y - rect.y, rect.h) }}>
              <span className="num absolute left-1 top-1 rounded-xs bg-accent px-1.5 text-2xs font-bold text-on-brand">{i + 2}</span>
            </div>
          ))}

          <div data-handle="n" className="absolute inset-x-0 -top-2 h-4 cursor-ns-resize touch-none">
            <span className={clsx(KNOB, 'left-1/2 top-0.5 -translate-x-1/2')} />
          </div>
          <div data-handle="s" className="absolute inset-x-0 -bottom-2 h-4 cursor-ns-resize touch-none">
            <span className={clsx(KNOB, 'bottom-0.5 left-1/2 -translate-x-1/2')} />
          </div>
          <div data-handle="w" className="absolute inset-y-0 -left-2 w-4 cursor-ew-resize touch-none">
            <span className={clsx(KNOB, 'left-0.5 top-1/2 -translate-y-1/2')} />
          </div>
          <div data-handle="e" className="absolute inset-y-0 -right-2 w-4 cursor-ew-resize touch-none">
            <span className={clsx(KNOB, 'right-0.5 top-1/2 -translate-y-1/2')} />
          </div>
          <div data-handle="nw" className="absolute -left-2 -top-2 size-5 cursor-nwse-resize touch-none">
            <span className={clsx(KNOB, 'left-0.5 top-0.5')} />
          </div>
          <div data-handle="ne" className="absolute -right-2 -top-2 size-5 cursor-nesw-resize touch-none">
            <span className={clsx(KNOB, 'right-0.5 top-0.5')} />
          </div>
          <div data-handle="sw" className="absolute -bottom-2 -left-2 size-5 cursor-nesw-resize touch-none">
            <span className={clsx(KNOB, 'bottom-0.5 left-0.5')} />
          </div>
          <div data-handle="se" className="absolute -bottom-2 -right-2 size-5 cursor-nwse-resize touch-none">
            <span className={clsx(KNOB, 'bottom-0.5 right-0.5')} />
          </div>
        </div>
      </div>
    </div>
  )
}
