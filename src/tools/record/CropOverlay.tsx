import clsx from 'clsx'
import { useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { moveRect, rectFromDrag, resizeRect, setRectField, type Handle, type Rect } from './crop'

export interface CropOverlayProps {
  rect: Rect
  /** 공유 화면의 실제 크기(px) */
  bounds: { w: number; h: number }
  ratio: number | null
  /** 카운트다운·녹화 중에는 고칠 수 없다 */
  locked?: boolean
  /** 지금 녹화되고 있는지(틀 색과 꼬리표가 바뀐다) */
  recording?: boolean
  onChange: (rect: Rect) => void
}

type Drag = { mode: 'move'; dx: number; dy: number } | { mode: 'resize'; handle: Handle } | { mode: 'new'; x0: number; y0: number }

const HANDLES: Array<{ id: Handle; className: string }> = [
  { id: 'nw', className: 'top-0 left-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize' },
  { id: 'n', className: 'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize' },
  { id: 'ne', className: 'top-0 right-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize' },
  { id: 'e', className: 'top-1/2 right-0 translate-x-1/2 -translate-y-1/2 cursor-ew-resize' },
  { id: 'se', className: 'right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize' },
  { id: 's', className: 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 cursor-ns-resize' },
  { id: 'sw', className: 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize' },
  { id: 'w', className: 'top-1/2 left-0 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize' },
]

/**
 * 미리보기 위에 겹쳐 놓는 녹화 영역 틀. 화면에 보이는 크기와 상관없이 값은 공유 화면의 실제 화소로 다룬다.
 * 빈 곳을 끌면 새로 그리고, 안쪽을 끌면 옮기고, 손잡이를 끌면 크기를 바꾼다.
 */
export function CropOverlay({ rect, bounds, ratio, locked, recording, onChange }: CropOverlayProps) {
  const root = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const { w: bw, h: bh } = bounds
  const pct = (v: number, total: number) => `${(v / total) * 100}%`

  const toSource = (e: { clientX: number; clientY: number }) => {
    const r = root.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) * bw) / r.width, y: ((e.clientY - r.top) * bh) / r.height }
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (locked || e.button !== 0) return
    const target = e.target as HTMLElement
    const p = toSource(e)
    const handle = target.dataset.handle as Handle | undefined
    if (handle) drag.current = { mode: 'resize', handle }
    else if (target.closest('[data-crop]')) drag.current = { mode: 'move', dx: p.x - rect.x, dy: p.y - rect.y }
    else drag.current = { mode: 'new', x0: p.x, y0: p.y }
    e.currentTarget.setPointerCapture(e.pointerId)
    box.current?.focus({ preventScroll: true })
    e.preventDefault()
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || locked) return
    const p = toSource(e)
    if (d.mode === 'move') onChange(moveRect(rect, p.x - d.dx - rect.x, p.y - d.dy - rect.y, bw, bh))
    else if (d.mode === 'resize') onChange(resizeRect(rect, d.handle, p.x, p.y, ratio, bw, bh))
    else if (Math.abs(p.x - d.x0) > 4 || Math.abs(p.y - d.y0) > 4) onChange(rectFromDrag(d.x0, d.y0, p.x, p.y, ratio, bw, bh))
  }
  const endDrag = () => {
    drag.current = null
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (locked) return
    const dir = e.key === 'ArrowLeft' ? [-1, 0] : e.key === 'ArrowRight' ? [1, 0] : e.key === 'ArrowUp' ? [0, -1] : e.key === 'ArrowDown' ? [0, 1] : null
    if (!dir) return
    e.preventDefault()
    const step = e.shiftKey ? 10 : 1
    if (e.altKey) {
      // Alt + 방향키: 오른쪽·아래 변을 움직여 크기를 바꾼다.
      if (dir[0]) onChange(setRectField(rect, 'w', rect.w + dir[0] * step, ratio, bw, bh))
      else onChange(setRectField(rect, 'h', rect.h + dir[1] * step, ratio, bw, bh))
    } else {
      onChange(moveRect(rect, dir[0] * step, dir[1] * step, bw, bh))
    }
  }

  const right = rect.x + rect.w
  const bottom = rect.y + rect.h
  const shade = 'pointer-events-none absolute bg-ink/60'

  return (
    <div
      ref={root}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={clsx('absolute inset-0 touch-none select-none', locked ? 'cursor-default' : 'cursor-crosshair')}
    >
      {/* 영역 바깥을 어둡게 */}
      <div className={shade} style={{ left: 0, top: 0, right: 0, height: pct(rect.y, bh) }} />
      <div className={shade} style={{ left: 0, bottom: 0, right: 0, height: pct(bh - bottom, bh) }} />
      <div className={shade} style={{ left: 0, top: pct(rect.y, bh), width: pct(rect.x, bw), height: pct(rect.h, bh) }} />
      <div className={shade} style={{ right: 0, top: pct(rect.y, bh), width: pct(bw - right, bw), height: pct(rect.h, bh) }} />

      <div
        ref={box}
        data-crop
        tabIndex={locked ? -1 : 0}
        role="group"
        aria-label={`녹화 영역 ${rect.w} × ${rect.h}px. 방향키로 옮기고 Alt 와 방향키로 크기를 바꿉니다.`}
        onKeyDown={onKeyDown}
        className={clsx(
          'absolute border-2 outline-none',
          recording ? 'border-accent' : locked ? 'border-mark' : 'cursor-move border-mark focus-visible:ring-3 focus-visible:ring-mark/50',
        )}
        style={{ left: pct(rect.x, bw), top: pct(rect.y, bh), width: pct(rect.w, bw), height: pct(rect.h, bh) }}
      >
        <span
          className={clsx(
            'num pointer-events-none absolute left-0 rounded-xs px-1.5 text-2xs leading-5 font-semibold whitespace-nowrap',
            recording ? 'bg-accent text-on-brand' : 'bg-mark text-ink',
            rect.y / bh < 0.08 ? 'top-0' : '-top-6',
          )}
        >
          {recording ? '녹화 중' : `${rect.w} × ${rect.h}`}
        </span>
        {!locked && HANDLES.map((h) => <span key={h.id} data-handle={h.id} className={clsx('absolute size-3.5 rounded-xs border border-ink bg-mark', h.className)} />)}
      </div>
    </div>
  )
}
