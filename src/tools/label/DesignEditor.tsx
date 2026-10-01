import { Circle, ImagePlus, Minus, QrCode, ScanBarcode, Shapes, Square, SquareRoundCorner, Triangle, Type, type LucideIcon } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Button, MenuItem, Popover, Stage } from '@/ui'
import { SYMBOLOGIES } from './barcode'
import { cellOutlineCmds, clampElement, cmdsToD, resizeRect, round2, snapMove, type Handle, type LabelData, type LabelElement, type Rect, type ShapeKind, type SheetSpec, type Symbology } from './model'
import { LabelContent, LabelFrame } from './render'

const SHAPES: Array<{ id: ShapeKind; name: string; icon: LucideIcon }> = [
  { id: 'rect', name: '사각형', icon: Square },
  { id: 'round', name: '둥근 사각형', icon: SquareRoundCorner },
  { id: 'ellipse', name: '원', icon: Circle },
  { id: 'triangle', name: '삼각형', icon: Triangle },
  { id: 'line', name: '선', icon: Minus },
]

const HANDLES: Array<{ id: Handle; fx: number; fy: number; cursor: string }> = [
  { id: 'nw', fx: 0, fy: 0, cursor: 'nwse-resize' },
  { id: 'n', fx: 0.5, fy: 0, cursor: 'ns-resize' },
  { id: 'ne', fx: 1, fy: 0, cursor: 'nesw-resize' },
  { id: 'e', fx: 1, fy: 0.5, cursor: 'ew-resize' },
  { id: 'se', fx: 1, fy: 1, cursor: 'nwse-resize' },
  { id: 's', fx: 0.5, fy: 1, cursor: 'ns-resize' },
  { id: 'sw', fx: 0, fy: 1, cursor: 'nesw-resize' },
  { id: 'w', fx: 0, fy: 0.5, cursor: 'ew-resize' },
]

interface DesignEditorProps {
  sheet: SheetSpec
  design: LabelElement[]
  /** 자리표시를 풀어 보여 줄 라벨 */
  label: LabelData | null
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** 끄는 동안의 변경(되돌리기 기록 없음) */
  onPreview: (design: LabelElement[]) => void
  /** 끌기를 마쳤다 — 한 단계로 기록 */
  onCommit: () => void
  /** 한 번에 끝나는 변경 */
  onChange: (design: LabelElement[], tag?: string) => void
  onAddText: () => void
  onAddShape: (shape: ShapeKind) => void
  onAddBarcode: (symbology: Symbology) => void
  onPickImage: () => void
  onDuplicate: () => void
  rev: number
}

type Drag = ({ kind: 'move' } | { kind: 'resize'; handle: Handle }) & { id: string; from: { x: number; y: number }; rect: Rect; moved?: boolean }

/** 라벨 한 칸을 크게 놓고 요소를 직접 끌어 옮기고 크기를 바꾼다. 가장자리·가운데·다른 요소에 맞춰 붙는다(Alt 를 누르면 붙지 않는다). */
export function DesignEditor({ sheet, design, label, selectedId, onSelect, onPreview, onCommit, onChange, onAddText, onAddShape, onAddBarcode, onPickImage, onDuplicate, rev }: DesignEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [avail, setAvail] = useState(600)
  const drag = useRef<Drag | null>(null)
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null })

  useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    const update = () => setAvail(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const W = sheet.labelW
  const H = sheet.labelH
  // 화면 1mm 가 몇 px 인지: 폭과 높이(최대 480px)에 맞추되 작은 라벨이 지나치게 커지지 않게 한다.
  const scale = Math.max(1, Math.min((avail - 28) / W, 480 / H, 14))
  const pad = 14 / scale
  const hs = 9 / scale
  const selected = design.find((el) => el.id === selectedId) ?? null
  const outline = cellOutlineCmds(sheet, { x: 0, y: 0, w: W, h: H }).map(cmdsToD).join('')

  const toMm = (e: { clientX: number; clientY: number }) => {
    const ctm = svgRef.current?.getScreenCTM()
    if (!ctm) return { x: 0, y: 0 }
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse())
    return { x: p.x, y: p.y }
  }

  const startMove = (e: PointerEvent, el: LabelElement) => {
    if (e.button !== 0) return
    e.stopPropagation()
    onSelect(el.id)
    drag.current = { kind: 'move', id: el.id, from: toMm(e), rect: { x: el.x, y: el.y, w: el.w, h: el.h } }
    svgRef.current?.setPointerCapture(e.pointerId)
    host.current?.focus({ preventScroll: true })
  }
  const startResize = (e: PointerEvent, el: LabelElement, handle: Handle) => {
    if (e.button !== 0) return
    e.stopPropagation()
    drag.current = { kind: 'resize', id: el.id, handle, from: toMm(e), rect: { x: el.x, y: el.y, w: el.w, h: el.h } }
    svgRef.current?.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current
    if (!d) return
    const p = toMm(e)
    const dx = p.x - d.from.x
    const dy = p.y - d.from.y
    // 누르기만 한 것(3px 미만)은 옮긴 것으로 치지 않는다.
    if (!d.moved && Math.hypot(dx, dy) * scale < 3) return
    d.moved = true
    const others = design.filter((el) => el.id !== d.id).map((el) => ({ x: el.x, y: el.y, w: el.w, h: el.h }))
    const threshold = e.altKey ? 0 : 6 / scale
    let next: Rect
    let gx: number | null
    let gy: number | null
    if (d.kind === 'move') {
      const s = snapMove({ ...d.rect, x: d.rect.x + dx, y: d.rect.y + dy }, { w: W, h: H }, others, threshold)
      next = { ...d.rect, x: s.x, y: s.y }
      gx = s.guideX
      gy = s.guideY
    } else {
      const r = resizeRect(d.rect, d.handle, dx, dy, { w: W, h: H }, others, threshold)
      // 라벨 밖으로 나간 변은 가장자리에서 멈춘다.
      const x0 = Math.max(0, r.x)
      const y0 = Math.max(0, r.y)
      next = { x: x0, y: y0, w: Math.min(r.x + r.w, W) - x0, h: Math.min(r.y + r.h, H) - y0 }
      gx = r.guideX
      gy = r.guideY
    }
    setGuides({ x: gx, y: gy })
    onPreview(design.map((el) => (el.id === d.id ? clampElement({ ...el, ...next }, W, H) : el)))
  }
  const endDrag = () => {
    if (!drag.current) return
    drag.current = null
    setGuides({ x: null, y: null })
    onCommit()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') return onSelect(null)
    if (!selected) return
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      onChange(design.filter((el) => el.id !== selected.id))
      onSelect(null)
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault()
      onDuplicate()
    } else if (e.key.startsWith('Arrow')) {
      e.preventDefault()
      const step = e.shiftKey ? 0.1 : 0.5
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
      onChange(design.map((el) => (el.id === selected.id ? clampElement({ ...el, x: round2(el.x + dx), y: round2(el.y + dy) }, W, H) : el)), `nudge:${selected.id}`)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" icon={Type} onClick={onAddText}>
          글자
        </Button>
        <Button size="sm" icon={ImagePlus} onClick={onPickImage}>
          이미지
        </Button>
        <Popover
          trigger={({ ref, ...props }) => (
            <span ref={ref} className="inline-flex">
              <Button size="sm" icon={Shapes} {...props}>
                도형
              </Button>
            </span>
          )}
        >
          {(close) =>
            SHAPES.map((s) => (
              <MenuItem
                key={s.id}
                icon={s.icon}
                onClick={() => {
                  onAddShape(s.id)
                  close()
                }}
              >
                {s.name}
              </MenuItem>
            ))
          }
        </Popover>
        <Popover
          trigger={({ ref, ...props }) => (
            <span ref={ref} className="inline-flex">
              <Button size="sm" icon={ScanBarcode} {...props}>
                바코드
              </Button>
            </span>
          )}
        >
          {(close) =>
            SYMBOLOGIES.map((s) => (
              <MenuItem
                key={s.id}
                icon={s.kind === 'linear' ? ScanBarcode : QrCode}
                onClick={() => {
                  onAddBarcode(s.id)
                  close()
                }}
              >
                {s.name}
              </MenuItem>
            ))
          }
        </Popover>
        <p className="num ml-auto text-sm text-muted">
          한 칸 {round2(W)}×{round2(H)}mm
        </p>
      </div>

      <Stage minHeight={380} className="p-3! sm:p-5!">
        <div ref={host} tabIndex={0} role="group" aria-label="라벨 디자인. 요소를 끌어 옮기고 화살표 키로 조금씩 움직입니다." onKeyDown={onKeyDown} className="flex w-full justify-center outline-offset-4">
          <svg
            ref={svgRef}
            xmlns="http://www.w3.org/2000/svg"
            viewBox={`${-pad} ${-pad} ${W + pad * 2} ${H + pad * 2}`}
            width={(W + pad * 2) * scale}
            height={(H + pad * 2) * scale}
            className="max-w-full touch-none select-none"
            onPointerDown={(e) => {
              if (e.button === 0) onSelect(null)
            }}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <path d={outline} fill="#ffffff" fillRule="evenodd" style={{ filter: 'drop-shadow(0 0.4px 0.8px rgb(0 0 0 / 0.35))' }} />
            <LabelFrame sheet={sheet} x={0} y={0}>
              <LabelContent design={design} label={label} mode="screen" rev={rev} />
            </LabelFrame>
            {/* 요소마다 잡을 수 있는 투명한 상자 */}
            {design.map((el) => (
              <rect
                key={el.id}
                data-el={el.id}
                x={el.x}
                y={el.y}
                width={el.w}
                height={el.h}
                fill="transparent"
                stroke={el.id === selectedId ? 'none' : 'var(--color-info)'}
                strokeOpacity={0.35}
                strokeWidth={1 / scale}
                strokeDasharray={`${3 / scale} ${3 / scale}`}
                style={{ cursor: 'move' }}
                onPointerDown={(e) => startMove(e, el)}
              />
            ))}
            {guides.x !== null && <line x1={guides.x} y1={-pad} x2={guides.x} y2={H + pad} stroke="var(--color-accent)" strokeWidth={1 / scale} pointerEvents="none" />}
            {guides.y !== null && <line x1={-pad} y1={guides.y} x2={W + pad} y2={guides.y} stroke="var(--color-accent)" strokeWidth={1 / scale} pointerEvents="none" />}
            {selected && (
              <g>
                <rect x={selected.x} y={selected.y} width={selected.w} height={selected.h} fill="none" stroke="var(--color-brand)" strokeWidth={1.5 / scale} pointerEvents="none" />
                {HANDLES.map((h) => {
                  const cx = selected.x + selected.w * h.fx
                  const cy = selected.y + selected.h * h.fy
                  return (
                    <g key={h.id} data-handle={h.id} style={{ cursor: h.cursor }} onPointerDown={(e) => startResize(e, selected, h.id)}>
                      {/* 잡기 쉽게 보이는 점보다 넓은 투명 영역 */}
                      <rect x={cx - hs} y={cy - hs} width={hs * 2} height={hs * 2} fill="transparent" />
                      <rect x={cx - hs / 2} y={cy - hs / 2} width={hs} height={hs} rx={hs * 0.2} fill="var(--color-surface)" stroke="var(--color-brand)" strokeWidth={1.5 / scale} />
                    </g>
                  )
                })}
              </g>
            )}
          </svg>
        </div>
      </Stage>
    </div>
  )
}
