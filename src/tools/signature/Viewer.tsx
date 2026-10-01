import clsx from 'clsx'
import { RotateCw } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent } from 'react'
import { Callout, Spinner, Stage } from '@/ui'
import { AssetView } from './AssetView'
import { isCancelError } from './docs'
import { clampCenter, resizeFromCorner, rotationFromPointer, snapAngle, type Point } from './geometry'
import type { DocSource, Item } from './types'

export type Zoom = 'page' | 'width' | number

interface Gesture {
  kind: 'move' | 'resize' | 'rotate'
  id: string
  tag: string
  start: Point
  orig: Item
  sx: 1 | -1
  sy: 1 | -1
}

export interface ViewerProps {
  source: DocSource
  page: number
  zoom: Zoom
  /** 실제로 적용된 배율(좌표 1 단위당 CSS px)을 알려 준다 */
  onScale: (pxPerUnit: number) => void
  items: Item[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onChange: (id: string, patch: Partial<Item>, tag: string) => void
  /** 방향키로 조금 옮기기(보이는 좌표 단위) */
  onNudge: (id: string, dx: number, dy: number) => void
  onDelete: (id: string) => void
  onDuplicate: (id: string) => void
  /** 지금 보이는 영역의 가운데(보이는 좌표)를 돌려주는 함수를 담아 둔다 */
  centerRef: MutableRefObject<(() => Point) | null>
}

const MAX_RENDER_PIXELS = 16_000_000
const CORNERS: Array<{ sx: 1 | -1; sy: 1 | -1; className: string; cursor: string }> = [
  { sx: -1, sy: -1, className: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2', cursor: 'nwse-resize' },
  { sx: 1, sy: -1, className: 'right-0 top-0 translate-x-1/2 -translate-y-1/2', cursor: 'nesw-resize' },
  { sx: 1, sy: 1, className: 'right-0 bottom-0 translate-x-1/2 translate-y-1/2', cursor: 'nwse-resize' },
  { sx: -1, sy: 1, className: 'left-0 bottom-0 -translate-x-1/2 translate-y-1/2', cursor: 'nesw-resize' },
]

let gestureSeq = 0

function boxStyle(item: Item, scale: number): CSSProperties {
  return {
    left: (item.cx - item.w / 2) * scale,
    top: (item.cy - item.h / 2) * scale,
    width: item.w * scale,
    height: item.h * scale,
    transform: `rotate(${item.rot}deg)`,
  }
}

export function Viewer({ source, page, zoom, onScale, items, selectedId, onSelect, onChange, onNudge, onDelete, onDuplicate, centerRef }: ViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const holderRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const itemEls = useRef(new Map<string, HTMLDivElement>())
  const gesture = useRef<Gesture | null>(null)
  const [avail, setAvail] = useState({ w: 0, h: 0 })
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [renderScale, setRenderScale] = useState(0)

  const info = source.pages[page]

  // 쓸 수 있는 공간 재기
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => {
      const w = el.clientWidth
      const h = Math.round(Math.max(320, Math.min(window.innerHeight * 0.76, 980)))
      setAvail((prev) => (prev.w === w && prev.h === h ? prev : { w, h }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  const fitWidth = avail.w > 0 ? (avail.w - 2) / info.width : source.unitPx
  const fitPage = avail.w > 0 ? Math.min(fitWidth, (avail.h - 2) / info.height) : source.unitPx
  const scale = zoom === 'page' ? fitPage : zoom === 'width' ? fitWidth : zoom
  const cssW = info.width * scale
  const cssH = info.height * scale

  useEffect(() => {
    if (avail.w > 0) onScale(scale)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, avail.w])

  // 쪽이 바뀌면 이전 쪽 그림을 바로 치운다
  useLayoutEffect(() => {
    holderRef.current?.replaceChildren()
    setBusy(true)
    setError(null)
  }, [source, page])

  // 배율이 자리 잡으면 그 해상도로 다시 그린다
  useEffect(() => {
    const t = setTimeout(() => setRenderScale(scale), holderRef.current?.childElementCount ? 180 : 0)
    return () => clearTimeout(t)
  }, [scale, source, page])

  useEffect(() => {
    if (!renderScale || avail.w === 0) return
    const ctrl = new AbortController()
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
    const target = Math.min(renderScale * dpr, Math.sqrt(MAX_RENDER_PIXELS / (info.width * info.height)))
    setBusy(true)
    source
      .render(page, target, ctrl.signal)
      .then((canvas) => {
        if (ctrl.signal.aborted) return
        canvas.style.cssText = 'display:block;width:100%;height:100%'
        holderRef.current?.replaceChildren(canvas)
        setError(null)
        setBusy(false)
      })
      .catch((err) => {
        if (ctrl.signal.aborted || isCancelError(err)) return
        setError('이 쪽을 그리지 못했습니다. 다른 쪽으로 갔다가 돌아오거나 파일을 다시 열어 주세요.')
        setBusy(false)
      })
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, page, renderScale, avail.w === 0])

  // 보이는 영역의 가운데
  useEffect(() => {
    centerRef.current = () => {
      const box = scrollRef.current?.getBoundingClientRect()
      const pageBox = overlayRef.current?.getBoundingClientRect()
      if (!box || !pageBox || !pageBox.width) return { x: info.width / 2, y: info.height / 2 }
      const left = Math.max(box.left, pageBox.left)
      const right = Math.min(box.right, pageBox.right)
      const top = Math.max(box.top, pageBox.top, 0)
      const bottom = Math.min(box.bottom, pageBox.bottom, window.innerHeight)
      if (right <= left || bottom <= top) return { x: info.width / 2, y: info.height / 2 }
      const k = info.width / pageBox.width
      return { x: ((left + right) / 2 - pageBox.left) * k, y: ((top + bottom) / 2 - pageBox.top) * k }
    }
    return () => {
      centerRef.current = null
    }
  }, [centerRef, info.width, info.height])

  // 새로 고른 항목으로 키보드 초점을 옮긴다(입력 중일 때는 건드리지 않는다)
  useEffect(() => {
    if (!selectedId) return
    const active = document.activeElement as HTMLElement | null
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return
    itemEls.current.get(selectedId)?.focus({ preventScroll: true })
  }, [selectedId])

  const toView = (e: { clientX: number; clientY: number }): Point => {
    const r = overlayRef.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale }
  }

  const begin = (e: ReactPointerEvent<HTMLElement>, item: Item, kind: Gesture['kind'], sx: 1 | -1 = 1, sy: 1 | -1 = 1) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // 포인터가 이미 사라진 경우 — 캡처 없이도 요소 위에서는 동작한다
    }
    gesture.current = { kind, id: item.id, tag: `gesture-${++gestureSeq}`, start: toView(e), orig: item, sx, sy }
    onSelect(item.id)
    itemEls.current.get(item.id)?.focus({ preventScroll: true })
  }

  const drag = (e: ReactPointerEvent<HTMLElement>) => {
    const g = gesture.current
    if (!g) return
    const p = toView(e)
    if (g.kind === 'move') {
      const dx = p.x - g.start.x
      const dy = p.y - g.start.y
      if (Math.abs(dx) * scale < 1 && Math.abs(dy) * scale < 1 && g.orig === items.find((i) => i.id === g.id)) return
      const next = clampCenter({ cx: g.orig.cx + dx, cy: g.orig.cy + dy }, info.width, info.height)
      onChange(g.id, next, g.tag)
    } else if (g.kind === 'resize') {
      const next = resizeFromCorner(g.orig, g.sx, g.sy, p, 10 / scale)
      onChange(g.id, { cx: next.cx, cy: next.cy, w: next.w, h: next.h }, g.tag)
    } else {
      const angle = rotationFromPointer({ x: g.orig.cx, y: g.orig.cy }, p)
      onChange(g.id, { rot: e.shiftKey ? snapAngle(angle, 0, 15) : snapAngle(angle) }, g.tag)
    }
  }

  const end = (e: ReactPointerEvent<HTMLElement>) => {
    if (!gesture.current) return
    gesture.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>, item: Item) => {
    const step = (e.shiftKey ? 10 : 1) / scale
    const move = (dx: number, dy: number) => {
      e.preventDefault()
      onNudge(item.id, dx, dy)
    }
    if (e.key === 'ArrowLeft') move(-step, 0)
    else if (e.key === 'ArrowRight') move(step, 0)
    else if (e.key === 'ArrowUp') move(0, -step)
    else if (e.key === 'ArrowDown') move(0, step)
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      onDelete(item.id)
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault()
      onDuplicate(item.id)
    } else if (e.key === 'Escape') {
      onSelect(null)
      e.currentTarget.blur()
    }
  }

  return (
    <Stage minHeight={360} className="p-3! sm:p-5!">
      <div ref={scrollRef} className="w-full overflow-auto" style={{ maxHeight: avail.h || undefined, scrollbarGutter: 'stable both-edges' }}>
        <div className="relative mx-auto bg-surface shadow-3" style={{ width: cssW, height: cssH }}>
          <div ref={holderRef} className="absolute inset-0" />
          {busy && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-sm text-ink-2 shadow-2">
                <Spinner /> 쪽을 그리는 중
              </span>
            </div>
          )}
          {error && (
            <div className="absolute inset-x-3 top-3">
              <Callout tone="danger" title="쪽을 표시할 수 없습니다">
                {error}
              </Callout>
            </div>
          )}
          {/* 그림 층: 쪽 밖으로 나간 부분은 저장할 때처럼 잘려 보인다 */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {items.map((item) => (
              <div key={item.id} className="absolute" style={boxStyle(item, scale)}>
                <AssetView src={item.src} tint={item.tint} style={{ opacity: item.opacity }} />
              </div>
            ))}
          </div>
          {/* 조작 층: 손잡이는 쪽 밖으로 나가도 보인다 */}
          <div
            ref={overlayRef}
            className="absolute inset-0"
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) onSelect(null)
            }}
          >
            {items.map((item) => {
              const selected = item.id === selectedId
              return (
                <div
                  key={item.id}
                  ref={(el) => {
                    if (el) itemEls.current.set(item.id, el)
                    else itemEls.current.delete(item.id)
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`${item.label} — 방향키로 옮기고 Delete 로 지웁니다`}
                  aria-pressed={selected}
                  className={clsx(
                    'absolute cursor-move touch-none rounded-xs',
                    selected ? 'z-10 outline-none' : 'outline-offset-2 hover:outline-2 hover:outline-dashed hover:outline-brand/60',
                  )}
                  style={boxStyle(item, scale)}
                  onPointerDown={(e) => begin(e, item, 'move')}
                  onPointerMove={drag}
                  onPointerUp={end}
                  onPointerCancel={end}
                  onFocus={() => onSelect(item.id)}
                  onKeyDown={(e) => onKey(e, item)}
                >
                  {selected && (
                    <>
                      <div className="pointer-events-none absolute -inset-px rounded-xs border-2 border-brand" />
                      {CORNERS.map((c) => (
                        <span
                          key={`${c.sx}${c.sy}`}
                          className={clsx('absolute size-3.5 touch-none rounded-full border-2 border-brand bg-surface shadow-1 before:absolute before:-inset-2.5 before:content-[""]', c.className)}
                          style={{ cursor: c.cursor }}
                          onPointerDown={(e) => begin(e, item, 'resize', c.sx, c.sy)}
                          onPointerMove={drag}
                          onPointerUp={end}
                          onPointerCancel={end}
                        />
                      ))}
                      <span className="pointer-events-none absolute bottom-full left-1/2 h-4 w-0.5 -translate-x-1/2 bg-brand" />
                      <span
                        className="absolute bottom-full left-1/2 mb-4 flex size-6 -translate-x-1/2 cursor-grab touch-none items-center justify-center rounded-full bg-brand text-on-brand shadow-2 before:absolute before:-inset-2 before:content-[''] active:cursor-grabbing"
                        title="끌어서 회전 (Shift: 15도씩)"
                        onPointerDown={(e) => begin(e, item, 'rotate')}
                        onPointerMove={drag}
                        onPointerUp={end}
                        onPointerCancel={end}
                      >
                        <RotateCw className="size-3.5" aria-hidden />
                      </span>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </Stage>
  )
}
