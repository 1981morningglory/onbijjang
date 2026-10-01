import { memo, useId, type ReactNode } from 'react'
import { makeBarcode } from './barcode'
import { fontCss, fontWeight, measureFor } from './fonts'
import {
  MM_PER_PT,
  barcodeBox,
  cellOutlineCmds,
  cellRect,
  cellsPerSheet,
  cmdsToD,
  imageBox,
  layoutText,
  resolveText,
  shapeCmds,
  type BarcodeEl,
  type LabelData,
  type LabelElement,
  type SheetSpec,
  type TextEl,
} from './model'

/**
 * 라벨을 SVG 로 그린다. 좌표 단위가 곧 mm 라서(viewBox) 화면에서는 비율 그대로, 인쇄에서는 실제 크기 벡터로 나온다.
 * mode 가 print 면 안내용 표시(값이 틀린 바코드 자리 등)를 그리지 않는다.
 */
export type RenderMode = 'screen' | 'print'

function TextNode({ el, text }: { el: TextEl; text: string }) {
  if (text.trim() === '') return null
  const layout = layoutText({ text, w: el.w, h: el.h, size: el.size, valign: el.valign, shrink: el.shrink }, measureFor(el.font, el.bold))
  const anchorX = el.align === 'left' ? el.x : el.align === 'center' ? el.x + el.w / 2 : el.x + el.w
  return (
    <text
      fontFamily={fontCss(el.font)}
      fontSize={layout.sizePt * MM_PER_PT}
      fontWeight={fontWeight(el.bold)}
      fill={el.color}
      textAnchor={el.align === 'left' ? 'start' : el.align === 'center' ? 'middle' : 'end'}
      style={{ whiteSpace: 'pre' }}
    >
      {layout.lines.map((line, i) => (
        <tspan key={i} x={anchorX} y={el.y + layout.baselines[i]}>
          {line}
        </tspan>
      ))}
    </text>
  )
}

function BarcodeNode({ el, value, mode }: { el: BarcodeEl; value: string; mode: RenderMode }) {
  const result = makeBarcode(el.symbology, value)
  if (!result.ok) {
    if (mode === 'print') return null
    // 값이 틀렸거나 아직 준비 중 — 자리만 표시한다(인쇄되지 않는다).
    const fs = Math.min(3, el.h * 0.5, el.w / 6)
    return (
      <g>
        <rect x={el.x} y={el.y} width={el.w} height={el.h} fill="var(--color-danger-soft)" stroke="var(--color-danger)" strokeWidth={0.25} strokeDasharray="1 0.8" opacity={result.pending ? 0.4 : 1} />
        {!result.pending && (
          <text x={el.x + el.w / 2} y={el.y + el.h / 2 + fs * 0.35} fontSize={fs} textAnchor="middle" fill="var(--color-danger)" fontFamily={fontCss('pretendard')} fontWeight={600}>
            바코드 값 확인
          </text>
        )}
      </g>
    )
  }
  const box = barcodeBox(el, result.geometry, result.def.kind === 'linear')
  return (
    <g>
      <path
        d={result.geometry.d}
        fill={el.color}
        fillRule="evenodd"
        shapeRendering="crispEdges"
        transform={`translate(${el.x + box.bars.x} ${el.y + box.bars.y}) scale(${box.bars.w / result.geometry.w} ${box.bars.h / result.geometry.h})`}
      />
      {box.textBaseline !== null && (
        <text x={el.x + el.w / 2} y={el.y + box.textBaseline} fontSize={box.textSizeMm} textAnchor="middle" fill={el.color} fontFamily={fontCss('pretendard')} fontWeight={400} style={{ whiteSpace: 'pre' }}>
          {result.display}
        </text>
      )}
    </g>
  )
}

export function ElementNode({ el, label, mode }: { el: LabelElement; label: LabelData | null; mode: RenderMode }) {
  switch (el.type) {
    case 'text':
      return <TextNode el={el} text={resolveText(el.text, label)} />
    case 'barcode':
      return <BarcodeNode el={el} value={resolveText(el.value, label)} mode={mode} />
    case 'image': {
      const box = imageBox(el)
      return (
        <svg x={el.x} y={el.y} width={el.w} height={el.h} viewBox={`0 0 ${el.w} ${el.h}`} overflow="hidden">
          <image href={el.src} x={box.x} y={box.y} width={box.w} height={box.h} preserveAspectRatio="none" />
        </svg>
      )
    }
    case 'shape': {
      const closed = el.shape !== 'line'
      return (
        <path
          d={cmdsToD(shapeCmds(el))}
          fill={closed && el.fill ? el.fill : 'none'}
          stroke={el.stroke && el.strokeWidth > 0 ? el.stroke : 'none'}
          strokeWidth={el.strokeWidth}
        />
      )
    }
  }
}

/** 라벨 한 칸의 내용(0,0 이 칸의 왼쪽 위). rev 는 글꼴·바코드 준비 상태가 바뀔 때 다시 그리게 하는 번호다. */
export const LabelContent = memo(function LabelContent({ design, label, mode }: { design: LabelElement[]; label: LabelData | null; mode: RenderMode; rev: number }) {
  return (
    <>
      {design.map((el) => (
        <ElementNode key={el.id} el={el} label={label} mode={mode} />
      ))}
    </>
  )
})

/** 칸 모양으로 내용을 잘라 주는 틀. CD 는 고리 모양으로 자른다. */
export function LabelFrame({ sheet, x, y, children }: { sheet: SheetSpec; x: number; y: number; children: ReactNode }) {
  const clipId = `lm${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const w = sheet.labelW
  const h = sheet.labelH
  if (sheet.shape !== 'cd') {
    return (
      <svg x={x} y={y} width={w} height={h} viewBox={`0 0 ${w} ${h}`} overflow="hidden">
        {children}
      </svg>
    )
  }
  const ring = cellOutlineCmds(sheet, { x: 0, y: 0, w, h }).map(cmdsToD).join('')
  return (
    <svg x={x} y={y} width={w} height={h} viewBox={`0 0 ${w} ${h}`} overflow="hidden">
      <clipPath id={clipId}>
        <path d={ring} clipRule="evenodd" />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>{children}</g>
    </svg>
  )
}

export interface SheetSvgProps {
  sheet: SheetSpec
  design: LabelElement[]
  /** 이 쪽에 놓이는 라벨들 */
  items: Array<{ cell: number; label: LabelData }>
  mode: RenderMode
  cutLines: boolean
  /** 인쇄 위치 보정(mm) — 인쇄에서만 준다 */
  offsetX?: number
  offsetY?: number
  rev: number
  className?: string
  style?: React.CSSProperties
  /** 화면용 덧그림(선택 표시 등). 용지 좌표(mm)로 그린다 */
  children?: ReactNode
}

/** A4 한 장. viewBox 가 210×297 이라 width 를 210mm 로 주면 실제 크기가 된다. */
export function SheetSvg({ sheet, design, items, mode, cutLines, offsetX = 0, offsetY = 0, rev, className, style, children }: SheetSvgProps) {
  const cells = Array.from({ length: cellsPerSheet(sheet) }, (_, i) => i)
  const outline = cells.flatMap((c) => cellOutlineCmds(sheet, cellRect(sheet, c)).map(cmdsToD)).join('')
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${sheet.pageW} ${sheet.pageH}`} className={className} style={style}>
      {mode === 'screen' && <rect x={0} y={0} width={sheet.pageW} height={sheet.pageH} fill="#ffffff" />}
      <g transform={offsetX || offsetY ? `translate(${offsetX} ${offsetY})` : undefined}>
        {items.map(({ cell, label }) => {
          const r = cellRect(sheet, cell)
          return (
            <LabelFrame key={cell} sheet={sheet} x={r.x} y={r.y}>
              <LabelContent design={design} label={label} mode={mode} rev={rev} />
            </LabelFrame>
          )
        })}
        {mode === 'print'
          ? cutLines && <path d={outline} fill="none" stroke="#8c8c8c" strokeWidth={0.1} />
          : <path d={outline} fill="none" stroke={cutLines ? '#8c8c8c' : '#c4baa1'} strokeWidth={0.2} strokeDasharray={cutLines ? undefined : '1.2 1'} />}
      </g>
      {children}
    </svg>
  )
}
