/** PDF → 이미지 · Word · Excel · PPT 내보내기. 무거운 라이브러리는 쓰는 순간에만 불러온다. */
import { blobToFile, readAsDataURL } from '@/lib/files'
import { FORMAT_EXT, canvasToBlob } from '@/lib/image'
import type { PaperSettings } from './geometry'
import { pageTextPieces } from './pdfjs'
import { itemSize, renderItem } from './render'
import { breathe, type PageItem, type Sheet, type Source } from './store'
import { groupLines, inferTable, linesToParagraphs, sheetName, toCellValue } from './tables'

export interface ExportContext {
  sources: Record<string, Source>
  paper: PaperSettings
  signal?: AbortSignal
  onProgress?: (done: number, total: number) => void
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

// ── 이미지 ────────────────────────────────────────────────
export async function exportImages(
  items: PageItem[],
  ctx: ExportContext,
  opts: { format: 'image/png' | 'image/jpeg'; dpi: number; quality: number; nameOf: (item: PageItem, position: number, ext: string) => string },
): Promise<File[]> {
  const files: File[] = []
  for (let i = 0; i < items.length; i++) {
    ctx.signal?.throwIfAborted()
    const item = items[i]
    const source = ctx.sources[item.sourceId]
    if (!source) continue
    const canvas = await renderItem(item, source, { dpi: opts.dpi, paper: ctx.paper, signal: ctx.signal })
    const blob = await canvasToBlob(canvas, opts.format, opts.quality)
    files.push(blobToFile(blob, opts.nameOf(item, i, FORMAT_EXT[opts.format])))
    ctx.onProgress?.(i + 1, items.length)
    await breathe()
  }
  return files
}

// ── Word ──────────────────────────────────────────────────
export interface DocxTextResult {
  blob: Blob
  /** 글자를 찾지 못한 쪽 수(스캔 문서) */
  emptyPages: number
}

/** 글자를 뽑아 문단으로 만든 docx. 사진 쪽과 스캔 쪽은 글자가 없어 빈 쪽이 된다. */
export async function exportDocxText(items: PageItem[], ctx: ExportContext): Promise<DocxTextResult> {
  const { Document, Packer, Paragraph, TextRun, PageBreak } = await import('docx')
  const children: InstanceType<typeof Paragraph>[] = []
  let emptyPages = 0
  for (let i = 0; i < items.length; i++) {
    ctx.signal?.throwIfAborted()
    const item = items[i]
    const source = ctx.sources[item.sourceId]
    const paragraphs = source?.kind === 'pdf' ? linesToParagraphs(groupLines((await pageTextPieces(source.pdf, item.index, item.rotation)).pieces, 3)) : []
    if (!paragraphs.length) emptyPages++
    if (i > 0) children.push(new Paragraph({ children: [new PageBreak()] }))
    for (const p of paragraphs) {
      const halfPoints = Math.max(16, Math.min(96, Math.round(p.size * 2)))
      children.push(
        new Paragraph({
          spacing: { after: 120 },
          children: [new TextRun({ text: p.text, size: halfPoints, bold: p.heading, font: '맑은 고딕' })],
        }),
      )
    }
    ctx.onProgress?.(i + 1, items.length)
    if (i % 5 === 4) await breathe()
  }
  const doc = new Document({ creator: '온비짱', sections: [{ children }] })
  return { blob: new Blob([await Packer.toBlob(doc)], { type: DOCX_MIME }), emptyPages }
}

/** 쪽을 그림으로 넣은 docx — 모양은 그대로지만 글자를 고칠 수 없다. */
export async function exportDocxImages(items: PageItem[], ctx: ExportContext, dpi: number): Promise<Blob> {
  const { Document, Packer, Paragraph, ImageRun, PageOrientation, HorizontalPositionRelativeFrom, VerticalPositionRelativeFrom } = await import('docx')
  const sections = []
  for (let i = 0; i < items.length; i++) {
    ctx.signal?.throwIfAborted()
    const item = items[i]
    const source = ctx.sources[item.sourceId]
    if (!source) continue
    const size = await itemSize(item, source, ctx.paper)
    const canvas = await renderItem(item, source, { dpi, paper: ctx.paper, signal: ctx.signal })
    const data = new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', 0.9)).arrayBuffer())
    // Word 쪽 크기 단위는 1/20 pt, 그림 크기는 96dpi 픽셀. 쪽 크기는 Word 한도(22인치) 안으로.
    const fit = Math.min(1, 1584 / size.width, 1584 / size.height)
    const w = size.width * fit
    const h = size.height * fit
    const landscape = w > h
    sections.push({
      // docx 는 가로 방향일 때 너비·높이를 스스로 바꿔 적으므로 짧은 변을 width 로 준다.
      properties: {
        page: {
          size: { width: Math.round(Math.min(w, h) * 20), height: Math.round(Math.max(w, h) * 20), orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
          margin: { top: 0, right: 0, bottom: 0, left: 0, header: 0, footer: 0, gutter: 0 },
        },
      },
      // 그림을 쪽 왼쪽 위에 고정해 띄운다 — 글줄에 넣으면 줄 간격 때문에 다음 쪽으로 밀려 빈 쪽이 생길 수 있다.
      children: [
        new Paragraph({
          children: [
            new ImageRun({
              type: 'jpg',
              data,
              transformation: { width: Math.round((w / 72) * 96), height: Math.round((h / 72) * 96) },
              floating: {
                horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 },
                verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 },
                behindDocument: true,
              },
            }),
          ],
        }),
      ],
    })
    ctx.onProgress?.(i + 1, items.length)
    await breathe()
  }
  const doc = new Document({ creator: '온비짱', sections })
  return new Blob([await Packer.toBlob(doc)], { type: DOCX_MIME })
}

/** 인식한 글자(쪽마다 한 덩어리)를 docx 로 */
export async function textToDocx(pages: string[]): Promise<Blob> {
  const { Document, Packer, Paragraph, TextRun, PageBreak } = await import('docx')
  const children: InstanceType<typeof Paragraph>[] = []
  pages.forEach((text, i) => {
    if (i > 0) children.push(new Paragraph({ children: [new PageBreak()] }))
    for (const para of text.split(/\n\s*\n/)) {
      const line = para.replace(/\s*\n\s*/g, ' ').trim()
      if (line) children.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: line, font: '맑은 고딕' })] }))
    }
  })
  return new Blob([await Packer.toBlob(new Document({ creator: '온비짱', sections: [{ children }] }))], { type: DOCX_MIME })
}

// ── Excel ─────────────────────────────────────────────────
/** 쪽마다 글자 좌표로 표를 추정한다. */
export async function extractSheets(items: PageItem[], positions: Map<string, number>, ctx: ExportContext): Promise<Sheet[]> {
  const sheets: Sheet[] = []
  const used = new Set<string>()
  for (let i = 0; i < items.length; i++) {
    ctx.signal?.throwIfAborted()
    const item = items[i]
    const source = ctx.sources[item.sourceId]
    const table = source?.kind === 'pdf' ? inferTable((await pageTextPieces(source.pdf, item.index, item.rotation)).pieces) : { rows: [], tableRows: 0 }
    sheets.push({ name: sheetName(`${(positions.get(item.id) ?? i) + 1}쪽`, used), rows: table.rows, tableRows: table.tableRows })
    ctx.onProgress?.(i + 1, items.length)
    if (i % 5 === 4) await breathe()
  }
  return sheets
}

export async function sheetsToXlsx(sheets: Sheet[], opts: { oneSheet: boolean; numeric: boolean }): Promise<Blob> {
  const XLSX = await import('xlsx')
  const book = XLSX.utils.book_new()
  const toAoa = (rows: string[][]) => rows.map((row) => row.map((cell) => toCellValue(cell, opts.numeric)))
  const widths = (rows: string[][]) => {
    const cols = Math.max(0, ...rows.map((r) => r.length))
    return Array.from({ length: cols }, (_, c) => ({ wch: Math.max(6, Math.min(60, Math.max(...rows.map((r) => displayWidth(r[c] ?? ''))) + 2)) }))
  }
  const filled = sheets.filter((s) => s.rows.length)
  if (opts.oneSheet) {
    const rows = filled.flatMap((s, i) => (i > 0 ? [[], ...s.rows] : s.rows))
    const ws = XLSX.utils.aoa_to_sheet(toAoa(rows))
    ws['!cols'] = widths(rows)
    XLSX.utils.book_append_sheet(book, ws, '표')
  } else {
    for (const s of filled) {
      const ws = XLSX.utils.aoa_to_sheet(toAoa(s.rows))
      ws['!cols'] = widths(s.rows)
      XLSX.utils.book_append_sheet(book, ws, s.name)
    }
  }
  const out = XLSX.write(book, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer
  return new Blob([out], { type: XLSX_MIME })
}

/** 한글은 두 칸으로 센 글자 폭 */
function displayWidth(text: string): number {
  let w = 0
  for (const ch of text) w += ch.charCodeAt(0) > 0x2e7f ? 2 : 1
  return w
}

// ── PPT ───────────────────────────────────────────────────
/** 쪽마다 그림 한 장을 꽉 채운 슬라이드. 슬라이드 크기는 첫 쪽에 맞춘다. */
export async function exportPptx(items: PageItem[], ctx: ExportContext, dpi: number): Promise<Blob> {
  const PptxGenJS = (await import('pptxgenjs')).default
  const pptx = new PptxGenJS()
  let slideW = 0
  let slideH = 0
  for (let i = 0; i < items.length; i++) {
    ctx.signal?.throwIfAborted()
    const item = items[i]
    const source = ctx.sources[item.sourceId]
    if (!source) continue
    const size = await itemSize(item, source, ctx.paper)
    if (!slideW) {
      // PowerPoint 슬라이드는 1–56인치
      const s = Math.min(1, 56 / (size.width / 72), 56 / (size.height / 72))
      slideW = Math.max(1, (size.width / 72) * s)
      slideH = Math.max(1, (size.height / 72) * s)
      pptx.defineLayout({ name: 'PDF', width: slideW, height: slideH })
      pptx.layout = 'PDF'
    }
    const canvas = await renderItem(item, source, { dpi, paper: ctx.paper, signal: ctx.signal })
    const data = await readAsDataURL(await canvasToBlob(canvas, 'image/jpeg', 0.9))
    const fit = Math.min(slideW / (size.width / 72), slideH / (size.height / 72))
    const w = (size.width / 72) * fit
    const h = (size.height / 72) * fit
    const slide = pptx.addSlide()
    slide.background = { color: 'FFFFFF' }
    slide.addImage({ data, x: (slideW - w) / 2, y: (slideH - h) / 2, w, h })
    ctx.onProgress?.(i + 1, items.length)
    await breathe()
  }
  const blob = (await pptx.write({ outputType: 'blob' })) as Blob
  return new Blob([blob], { type: PPTX_MIME })
}
