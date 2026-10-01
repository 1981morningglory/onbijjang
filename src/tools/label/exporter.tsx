import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { isCanvasSizeSafe } from '@/lib/image'
import { isBarcodeLibReady, loadBarcodeLib, makeBarcode } from './barcode'
import { ensureFonts, fontCss, fontWeight, loadPdfFonts, measureFor } from './fonts'
import { MM_PER_PT, planDoc, resolveText, type LabelDoc, type Rect, type TextEl, type TextLayout } from './model'
import type { PdfStats } from './pdf'
import { LabelContent, LabelFrame } from './render'

/** 디자인에 쓰인 글(자리표시를 푼 것)을 모두 모은다 — 글꼴을 미리 불러올 때 쓴다. */
export function collectTexts(doc: LabelDoc): string[] {
  const plan = planDoc(doc)
  const out: string[] = []
  const sources = doc.design.flatMap((el) => (el.type === 'text' ? [el.text] : el.type === 'barcode' ? [el.value] : []))
  for (const src of sources) {
    out.push(src)
    if (!src.includes('{')) continue
    for (const label of plan.labels) if (label) out.push(resolveText(src, label))
  }
  return out
}

/** 인쇄·PDF 전에 필요한 것(바코드 라이브러리, 글꼴)을 모두 불러온다. */
export async function prepareOutput(doc: LabelDoc): Promise<void> {
  const tasks: Promise<unknown>[] = [ensureFonts(doc.design, collectTexts(doc))]
  if (doc.design.some((el) => el.type === 'barcode') && !isBarcodeLibReady()) tasks.push(loadBarcodeLib())
  await Promise.all(tasks)
}

const RASTER_DPI = 600

/** 글자 한 덩어리를 600dpi 투명 PNG 로 만든다(PDF 에 심을 수 없는 글꼴용). */
async function rasterText(el: TextEl, layout: TextLayout): Promise<{ png: Uint8Array; box: Rect } | null> {
  const fs = layout.sizePt * MM_PER_PT
  const pad = fs
  const box: Rect = { x: el.x - pad, y: el.y - pad, w: el.w + pad * 2, h: Math.max(el.h, layout.lines.length * layout.lineHeight) + pad * 2 }
  let pxPerMm = RASTER_DPI / 25.4
  while (!isCanvasSizeSafe(box.w * pxPerMm, box.h * pxPerMm) && pxPerMm > 4) pxPerMm /= 2
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(box.w * pxPerMm))
  canvas.height = Math.max(1, Math.ceil(box.h * pxPerMm))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.scale(pxPerMm, pxPerMm)
  ctx.font = `${fontWeight(el.bold)} ${fs}px ${fontCss(el.font)}`
  ctx.fillStyle = el.color
  ctx.textAlign = el.align
  ctx.textBaseline = 'alphabetic'
  const anchorX = pad + (el.align === 'left' ? 0 : el.align === 'center' ? el.w / 2 : el.w)
  layout.lines.forEach((line, i) => ctx.fillText(line, anchorX, pad + layout.baselines[i]))
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) return null
  return { png: new Uint8Array(await blob.arrayBuffer()), box }
}

export interface PdfResult {
  blob: Blob
  stats: PdfStats
  /** 글꼴 파일을 받지 못해 모든 글자를 그림으로 넣었다 */
  fontFallback: boolean
}

/** 지금 문서를 PDF 로 만든다. */
export async function exportPdf(doc: LabelDoc, opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void }): Promise<PdfResult> {
  await prepareOutput(doc)
  const needsText = doc.design.some((el) => el.type === 'text' || (el.type === 'barcode' && el.showText))
  let fonts: Awaited<ReturnType<typeof loadPdfFonts>> | null = null
  let fontkit: unknown = null
  let fontFallback = false
  if (needsText) {
    try {
      const [loaded, kit] = await Promise.all([loadPdfFonts(), import('@pdf-lib/fontkit')])
      fonts = loaded
      fontkit = (kit as { default?: unknown }).default ?? kit
    } catch {
      fontFallback = true
    }
  }
  if (opts.signal?.aborted) throw new DOMException('취소했습니다.', 'AbortError')
  const { buildLabelPdf } = await import('./pdf')
  const { bytes, stats } = await buildLabelPdf(doc, { measureFor, barcode: makeBarcode, fonts, fontkit, rasterText, onProgress: opts.onProgress, signal: opts.signal })
  return { blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }), stats, fontFallback }
}

/** 팀 보관함 목록에 보일 작은 미리보기(라벨 한 칸). 실패하면 undefined. */
export async function makeThumb(doc: LabelDoc): Promise<string | undefined> {
  try {
    await prepareOutput(doc)
    const { labelW: w, labelH: h } = doc.sheet
    const label = planDoc(doc).labels.find(Boolean) ?? null
    const host = document.createElement('div')
    const root = createRoot(host)
    flushSync(() =>
      root.render(
        <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
          <rect width={w} height={h} fill="#ffffff" />
          <LabelFrame sheet={doc.sheet} x={0} y={0}>
            <LabelContent design={doc.design} label={label} mode="print" rev={0} />
          </LabelFrame>
        </svg>,
      ),
    )
    const svg = host.querySelector('svg')
    const markup = svg ? new XMLSerializer().serializeToString(svg) : ''
    root.unmount()
    if (!markup) return undefined
    const scale = Math.min(200 / w, 200 / h)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(w * scale))
    canvas.height = Math.max(1, Math.round(h * scale))
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('thumb'))
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
    })
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
    const url = canvas.toDataURL('image/png')
    return url.length < 300_000 ? url : undefined
  } catch {
    return undefined
  }
}
