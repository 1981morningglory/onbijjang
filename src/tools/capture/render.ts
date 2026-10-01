/** 편집 결과를 캔버스로 만들고 PNG·JPG·PDF 로 내보낸다. 모두 브라우저 안에서 처리한다. */
import { buildPdf, type PdfPage } from '../../../extension/capture/lib/pdf.js'
import { A4_PT, footerMetrics, planPdfPages, sliceAcrossPieces } from '../../../extension/capture/lib/plan.js'
import { canvasToBlob, ctx2d, fileToCanvas, makeCanvas, type RasterFormat } from '@/lib/image'
import { pdfPageSize, splitByHeight, trimToRect, type Trim } from './logic'

export interface RenderOptions {
  trim: Trim
  /** 높이 기준 분할(px). 나누지 않으면 null */
  splitHeight: number | null
  /** 맨 아래에 넣을 한 줄. 넣지 않으면 빈 문자열 */
  footer: string
}

function aborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('취소했습니다.', 'AbortError')
}

/** 화면이 멈추지 않도록 한 번 쉬어 간다. */
const breathe = () => new Promise<void>((r) => setTimeout(r, 0))

/** 이미지 아래에 붙는 주소·시각 띠. 확장 프로그램 결과 화면과 같은 모양이다. */
export function drawFooter(width: number, text: string): HTMLCanvasElement {
  const m = footerMetrics(width)
  const canvas = makeCanvas(width, m.height)
  const ctx = ctx2d(canvas)
  ctx.fillStyle = '#f2eee3'
  ctx.fillRect(0, 0, width, m.height)
  ctx.fillStyle = '#dfd8c6'
  ctx.fillRect(0, 0, width, Math.max(1, Math.round(m.fontPx / 12)))
  ctx.font = `600 ${m.fontPx}px 'Pretendard Variable', Pretendard, 'Malgun Gothic', 'Apple SD Gothic Neo', system-ui, sans-serif`
  ctx.fillStyle = '#36443c'
  ctx.textBaseline = 'middle'
  const room = width - m.padX * 2
  let line = text
  // 길면 뒤를 줄인다.
  while (line.length > 4 && ctx.measureText(line).width > room) line = `${line.slice(0, Math.max(4, Math.floor((line.length - 1) * 0.9)))}…`
  ctx.fillText(line, m.padX, m.height / 2 + 1, room)
  return canvas
}

/** 자르기 → 나누기 → 한 줄 붙이기 순서로 결과 캔버스를 만든다. */
export async function renderPieces(file: Blob, opts: RenderOptions, signal?: AbortSignal): Promise<HTMLCanvasElement[]> {
  const source = await fileToCanvas(file)
  aborted(signal)
  const rect = trimToRect(opts.trim, source.width, source.height)
  const parts = opts.splitHeight ? splitByHeight(rect.h, opts.splitHeight) : [{ y: 0, h: rect.h }]
  if (!parts) throw new Error('조각이 너무 많습니다. 나누는 높이를 더 크게 정해 주세요.')
  const footer = opts.footer.trim() ? drawFooter(rect.w, opts.footer.trim()) : null

  const out: HTMLCanvasElement[] = []
  for (let i = 0; i < parts.length; i++) {
    aborted(signal)
    const part = parts[i]
    const extra = footer && i === parts.length - 1 ? footer.height : 0
    const canvas = makeCanvas(rect.w, part.h + extra)
    const ctx = ctx2d(canvas)
    ctx.drawImage(source, rect.x, rect.y + part.y, rect.w, part.h, 0, 0, rect.w, part.h)
    if (extra && footer) ctx.drawImage(footer, 0, part.h)
    out.push(canvas)
    if (i % 8 === 7) await breathe()
  }
  return out
}

export async function encodePieces(pieces: HTMLCanvasElement[], format: RasterFormat, quality: number, onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<Blob[]> {
  const blobs: Blob[] = []
  for (let i = 0; i < pieces.length; i++) {
    aborted(signal)
    blobs.push(await canvasToBlob(pieces[i], format, quality))
    onProgress?.(i + 1, pieces.length)
  }
  return blobs
}

async function jpegBytes(canvas: HTMLCanvasElement, quality: number) {
  return new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', quality)).arrayBuffer())
}

/**
 * PDF 로 만든다.
 * a4 가 true 면 조각들을 세로로 이은 긴 그림을 A4 폭에 맞춰 여러 쪽으로 나누고,
 * false 면 조각 하나를 그 크기 그대로 한 쪽에 담는다.
 */
export async function piecesToPdf(pieces: HTMLCanvasElement[], opts: { a4: boolean; quality: number; title: string }, onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<{ blob: Blob; pages: number }> {
  const pages: PdfPage[] = []
  if (opts.a4) {
    const width = pieces[0].width
    const heights = pieces.map((p) => p.height)
    const plan = planPdfPages(width, heights.reduce((a, b) => a + b, 0))
    for (let i = 0; i < plan.pages.length; i++) {
      aborted(signal)
      const page = plan.pages[i]
      const canvas = makeCanvas(width, page.h)
      const ctx = ctx2d(canvas)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, page.h)
      for (const part of sliceAcrossPieces(heights, page.y, page.h)) {
        ctx.drawImage(pieces[part.piece], 0, part.sy, width, part.sh, 0, part.dy, width, part.sh)
      }
      pages.push({ jpeg: await jpegBytes(canvas, opts.quality), pxW: width, pxH: page.h, pageW: A4_PT.width, pageH: A4_PT.height })
      onProgress?.(i + 1, plan.pages.length)
      await breathe()
    }
  } else {
    for (let i = 0; i < pieces.length; i++) {
      aborted(signal)
      const p = pieces[i]
      const size = pdfPageSize(p.width, p.height)
      pages.push({ jpeg: await jpegBytes(p, opts.quality), pxW: p.width, pxH: p.height, pageW: size.pageW, pageH: size.pageH, drawW: size.pageW, drawH: size.pageH })
      onProgress?.(i + 1, pieces.length)
      await breathe()
    }
  }
  const bytes = buildPdf(pages, { title: opts.title })
  return { blob: new Blob([bytes], { type: 'application/pdf' }), pages: pages.length }
}
