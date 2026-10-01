import { useMemo, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { Stage } from '@/ui'
import { cellAt, cellRange, cellRect, cellsPerSheet, labelsOnPage, nearestCell, type LabelDoc, type planDoc } from './model'
import { SheetSvg } from './render'

interface SheetPreviewProps {
  doc: LabelDoc
  plan: ReturnType<typeof planDoc>
  page: number
  /** 이 쪽에서 고른 칸 번호 */
  selection: number[]
  onSelect: (cells: number[]) => void
  /** Delete 키 — 고른 칸의 내용 지우기 */
  onClear: () => void
  zoom: 'fit' | 'actual'
  rev: number
}

/** 실제 비율의 A4 미리보기. 칸을 누르거나 끌어서 여러 칸을 고른다(Ctrl 로 하나씩 더하기, Shift 로 범위). */
export function SheetPreview({ doc, plan, page, selection, onSelect, onClear, zoom, rev }: SheetPreviewProps) {
  const svgHost = useRef<HTMLDivElement>(null)
  const drag = useRef<{ anchor: number; base: number[] } | null>(null)
  const anchor = useRef<number | null>(null)
  const { sheet } = doc
  const items = useMemo(() => labelsOnPage(plan, page), [plan, page])
  const perSheet = cellsPerSheet(sheet)
  const blocked = useMemo(() => {
    if (page !== 0) return []
    const free = new Set(plan.free0)
    return Array.from({ length: perSheet }, (_, i) => i).filter((c) => !free.has(c))
  }, [plan.free0, page, perSheet])

  const toMm = (e: { clientX: number; clientY: number }) => {
    const svg = svgHost.current?.querySelector('svg')
    const ctm = svg?.getScreenCTM()
    if (!svg || !ctm) return null
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse())
    return { x: p.x, y: p.y }
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const p = toMm(e)
    if (!p) return
    const cell = cellAt(sheet, p.x, p.y)
    if (cell < 0) {
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey) onSelect([])
      return
    }
    if (e.ctrlKey || e.metaKey) {
      onSelect(selection.includes(cell) ? selection.filter((c) => c !== cell) : [...selection, cell])
      anchor.current = cell
      return
    }
    if (e.shiftKey && anchor.current !== null) {
      onSelect(cellRange(sheet, anchor.current, cell))
      return
    }
    anchor.current = cell
    drag.current = { anchor: cell, base: [] }
    e.currentTarget.setPointerCapture(e.pointerId)
    onSelect([cell])
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    const p = toMm(e)
    if (!p) return
    const next = cellRange(sheet, drag.current.anchor, nearestCell(sheet, p.x, p.y))
    if (next.length !== selection.length || next.some((c, i) => c !== selection[i])) onSelect(next)
  }
  const endDrag = () => {
    drag.current = null
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') onSelect([])
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      onSelect(Array.from({ length: perSheet }, (_, i) => i))
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length) {
      e.preventDefault()
      onClear()
    } else if (e.key.startsWith('Arrow')) {
      e.preventDefault()
      const from = selection.length ? selection[selection.length - 1] : -1
      const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' ? -sheet.cols : sheet.cols
      const to = from < 0 ? 0 : from + step
      if (to >= 0 && to < perSheet) {
        anchor.current = to
        onSelect([to])
      }
    }
  }

  return (
    <Stage minHeight={420} className="p-3! sm:p-5!">
      <div className={zoom === 'actual' ? 'max-h-[78dvh] max-w-full overflow-auto rounded-xs' : 'flex w-full justify-center'}>
        <div
          ref={svgHost}
          tabIndex={0}
          role="group"
          aria-label={`용지 미리보기 ${page + 1}쪽. 칸을 누르거나 끌어서 고릅니다.`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onKeyDown}
          className="cursor-cell touch-none select-none rounded-xs shadow-3 outline-offset-4"
          style={zoom === 'actual' ? { width: '210mm' } : { width: '100%', maxWidth: 600 }}
        >
          <SheetSvg sheet={sheet} design={doc.design} items={items} mode="screen" cutLines={doc.print.cutLines} rev={rev} style={{ display: 'block', width: '100%', height: 'auto' }}>
            {blocked.map((c) => {
              const r = cellRect(sheet, c)
              return (
                <g key={`b${c}`} pointerEvents="none">
                  <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="var(--color-ink)" opacity={0.1} />
                  <path d={`M${r.x} ${r.y}L${r.x + r.w} ${r.y + r.h}M${r.x + r.w} ${r.y}L${r.x} ${r.y + r.h}`} stroke="var(--color-faint)" strokeWidth={0.3} />
                </g>
              )
            })}
            {selection.map((c) => {
              const r = cellRect(sheet, c)
              return <rect key={`s${c}`} x={r.x} y={r.y} width={r.w} height={r.h} fill="var(--color-brand)" fillOpacity={0.14} stroke="var(--color-brand)" strokeWidth={0.7} pointerEvents="none" />
            })}
          </SheetSvg>
        </div>
      </div>
    </Stage>
  )
}
