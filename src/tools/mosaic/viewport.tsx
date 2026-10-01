import clsx from 'clsx'
import { Maximize, ZoomIn, ZoomOut } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { IconButton } from '@/ui'

export interface ImagePoint {
  /** 원본 이미지 기준 좌표(px) */
  x: number
  y: number
}

export interface ViewInfo {
  /** 이미지 1px 이 화면에서 차지하는 px */
  scale: number
}

export interface ViewportProps {
  /** 이미지 원본 크기 */
  width: number
  height: number
  zoom: number
  onZoom: (zoom: number) => void
  maxZoom?: number
  /** true 면 끌기가 항상 화면 이동이 된다(이동 도구) */
  panMode?: boolean
  cursor?: string
  onDown?: (pt: ImagePoint, e: ReactPointerEvent<HTMLDivElement>) => void
  onMove?: (pt: ImagePoint, e: ReactPointerEvent<HTMLDivElement>) => void
  onUp?: (pt: ImagePoint, e: ReactPointerEvent<HTMLDivElement>) => void
  /** 누르지 않은 채 움직일 때(브러시 커서 등). 영역을 벗어나면 null */
  onHover?: (pt: ImagePoint | null) => void
  /** 이미지 크기에 맞춰 늘어나는 안쪽 상자에 들어갈 내용(캔버스 등) */
  children: (view: ViewInfo) => ReactNode
  className?: string
  label: string
}

const PAD = 16

/**
 * 확대·이동이 되는 작업 무대. 맞춤 크기를 100% 로 보고 maxZoom 까지 확대한다.
 * 이동: 스페이스바를 누른 채 끌기, 휠 버튼 끌기, 확대 상태에서 휠. 확대: Ctrl+휠.
 */
export function Viewport({ width, height, zoom, onZoom, maxZoom = 3, panMode, cursor, onDown, onMove, onUp, onHover, children, className, label }: ViewportProps) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [space, setSpace] = useState(false)
  const drag = useRef<{ mode: 'pan' | 'tool'; sx: number; sy: number; px: number; py: number } | null>(null)

  useLayoutEffect(() => {
    const el = outer.current
    if (!el) return
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const fit = box.w > 0 ? Math.min((box.w - PAD * 2) / width, (box.h - PAD * 2) / height, 1) : 0
  const scale = Math.max(fit * zoom, 0.0001)
  const cw = width * scale
  const ch = height * scale

  const clampPan = useCallback(
    (p: { x: number; y: number }, w = cw, h = ch) => {
      const mx = Math.max(0, (w - box.w) / 2 + PAD)
      const my = Math.max(0, (h - box.h) / 2 + PAD)
      return { x: Math.max(-mx, Math.min(mx, p.x)), y: Math.max(-my, Math.min(my, p.y)) }
    },
    [cw, ch, box.w, box.h],
  )

  // 크기·확대가 바뀌면 이동 범위를 다시 맞춘다.
  useEffect(() => {
    setPan((p) => {
      const c = clampPan(p)
      return c.x === p.x && c.y === p.y ? p : c
    })
  }, [clampPan])

  // 사진이 바뀌면 처음 위치로
  useEffect(() => setPan({ x: 0, y: 0 }), [width, height])

  useEffect(() => {
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
    }
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !typing(e.target)) {
        // 버튼에 초점이 있을 때 스페이스로 눌리는 것은 그대로 둔다.
        if ((e.target as HTMLElement | null)?.tagName === 'BUTTON') return
        e.preventDefault()
        setSpace(true)
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpace(false)
    }
    const blur = () => setSpace(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  // 휠: Ctrl+휠 은 커서 위치 기준 확대, 확대된 상태의 일반 휠은 화면 이동
  const state = useRef({ zoom, pan, fit, box, maxZoom, width, height })
  state.current = { zoom, pan, fit, box, maxZoom, width, height }
  useEffect(() => {
    const el = outer.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const s = state.current
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const next = Math.max(1, Math.min(s.maxZoom, s.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))
        if (next === s.zoom) return
        const rect = el.getBoundingClientRect()
        // 커서 아래 지점이 그대로 있도록 이동량을 보정한다.
        const cx = e.clientX - rect.left - rect.width / 2
        const cy = e.clientY - rect.top - rect.height / 2
        const k = next / s.zoom
        const nw = s.width * s.fit * next
        const nh = s.height * s.fit * next
        const mx = Math.max(0, (nw - s.box.w) / 2 + PAD)
        const my = Math.max(0, (nh - s.box.h) / 2 + PAD)
        const nx = cx - (cx - s.pan.x) * k
        const ny = cy - (cy - s.pan.y) * k
        setPan({ x: Math.max(-mx, Math.min(mx, nx)), y: Math.max(-my, Math.min(my, ny)) })
        onZoomRef.current(next)
      } else if (s.zoom > 1.001) {
        e.preventDefault()
        setPan((p) => clampRef.current({ x: p.x - e.deltaX, y: p.y - e.deltaY }))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
  const onZoomRef = useRef(onZoom)
  onZoomRef.current = onZoom
  const clampRef = useRef(clampPan)
  clampRef.current = clampPan

  const toImage = (e: { clientX: number; clientY: number }): ImagePoint => {
    const rect = inner.current!.getBoundingClientRect()
    return { x: ((e.clientX - rect.left) / rect.width) * width, y: ((e.clientY - rect.top) / rect.height) * height }
  }

  const handleDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!inner.current) return
    const wantPan = panMode || space || e.button === 1
    if (!wantPan && e.button !== 0) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // 일부 입력 장치는 포인터 잡기를 지원하지 않는다. 잡지 못해도 동작에는 문제 없다.
    }
    if (wantPan) {
      e.preventDefault()
      drag.current = { mode: 'pan', sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y }
    } else {
      drag.current = { mode: 'tool', sx: e.clientX, sy: e.clientY, px: 0, py: 0 }
      onDown?.(toImage(e), e)
    }
  }
  const handleMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!inner.current) return
    const d = drag.current
    if (d?.mode === 'pan') {
      setPan(clampPan({ x: d.px + e.clientX - d.sx, y: d.py + e.clientY - d.sy }))
      return
    }
    const pt = toImage(e)
    if (d?.mode === 'tool') onMove?.(pt, e)
    onHover?.(pt)
  }
  const handleUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (d?.mode === 'tool' && inner.current) onUp?.(toImage(e), e)
  }

  const panning = panMode || space
  return (
    <div
      ref={outer}
      role="application"
      aria-label={label}
      tabIndex={0}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
      onPointerLeave={() => onHover?.(null)}
      onContextMenu={(e) => e.preventDefault()}
      className={clsx('mat relative h-[min(68dvh,640px)] min-h-[300px] touch-none select-none overflow-hidden rounded-lg border border-mat-deep', className)}
      style={{ cursor: panning ? (drag.current?.mode === 'pan' ? 'grabbing' : 'grab') : cursor }}
    >
      {fit > 0 && (
        <div
          ref={inner}
          className="absolute"
          style={{ width: cw, height: ch, left: (box.w - cw) / 2 + pan.x, top: (box.h - ch) / 2 + pan.y }}
        >
          {children({ scale })}
        </div>
      )}
    </div>
  )
}

/** 확대 조절 버튼 묶음. 100% 는 화면에 맞춘 크기다. */
export function ZoomControls({ zoom, onZoom, max = 3 }: { zoom: number; onZoom: (z: number) => void; max?: number }) {
  const step = (dir: 1 | -1) => onZoom(Math.max(1, Math.min(max, Math.round((zoom + dir * 0.25) * 4) / 4)))
  return (
    <div className="flex items-center gap-0.5">
      <IconButton icon={ZoomOut} label="축소" size="sm" disabled={zoom <= 1} onClick={() => step(-1)} />
      <span className="num w-12 text-center text-sm font-semibold text-ink-2">{Math.round(zoom * 100)}%</span>
      <IconButton icon={ZoomIn} label="확대" size="sm" disabled={zoom >= max} onClick={() => step(1)} />
      <IconButton icon={Maximize} label="화면에 맞추기" size="sm" disabled={zoom === 1} onClick={() => onZoom(1)} />
    </div>
  )
}
