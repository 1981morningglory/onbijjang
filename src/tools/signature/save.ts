/** 저장 — PDF 는 원본에 서명 이미지를 끼워 넣고(글자·벡터 유지), 사진·Word 는 쪽 이미지를 만든다 */
import { blobToFile, dataUrlToBlob, sanitizeFilename } from '@/lib/files'
import { canvasToBlob, ctx2d, isCanvasSizeSafe, makeCanvas, type RasterFormat } from '@/lib/image'
import { pdfImagePlacement } from './geometry'
import { loadCachedImage, tintCanvas } from './raster'
import type { DocSource, Item } from './types'

export type Progress = (done: number, total: number) => void

/** pdf-lib 이 이 PDF 를 고칠 수 없을 때(암호·손상). 쪽 이미지 방식으로 대신 저장한다. */
export class PdfStructureError extends Error {
  constructor(public reason: 'encrypted' | 'unreadable') {
    super(reason === 'encrypted' ? '암호가 걸린 PDF 입니다.' : 'PDF 구조를 읽지 못했습니다.')
  }
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const checkAbort = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('취소됨', 'AbortError')
}

/** 색을 입힌 항목 이미지(원본 해상도) */
async function itemImage(item: Pick<Item, 'src' | 'tint'>): Promise<CanvasImageSource> {
  const img = await loadCachedImage(item.src)
  return item.tint ? tintCanvas(img, img.naturalWidth, img.naturalHeight, item.tint) : img
}

async function itemPngBytes(item: Pick<Item, 'src' | 'tint'>): Promise<Uint8Array> {
  if (!item.tint && item.src.startsWith('data:image/png')) return new Uint8Array(await (await dataUrlToBlob(item.src)).arrayBuffer())
  const img = await loadCachedImage(item.src)
  let canvas: HTMLCanvasElement
  if (item.tint) canvas = tintCanvas(img, img.naturalWidth, img.naturalHeight, item.tint)
  else {
    // PNG 가 아닌 원본(JPG·WebP)은 PNG 로만 바꾼다
    canvas = makeCanvas(img.naturalWidth, img.naturalHeight)
    ctx2d(canvas).drawImage(img, 0, 0)
  }
  return new Uint8Array(await (await canvasToBlob(canvas, 'image/png')).arrayBuffer())
}

/** 쪽 캔버스 위에 항목들을 그린다. scale = 좌표 1 단위당 픽셀 */
export async function drawItems(ctx: CanvasRenderingContext2D, items: Item[], scale: number): Promise<void> {
  for (const item of items) {
    const image = await itemImage(item)
    ctx.save()
    ctx.translate(item.cx * scale, item.cy * scale)
    ctx.rotate((item.rot * Math.PI) / 180)
    ctx.globalAlpha = Math.min(1, Math.max(0, item.opacity))
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(image, (-item.w * scale) / 2, (-item.h * scale) / 2, item.w * scale, item.h * scale)
    ctx.restore()
  }
}

/** 저장용 해상도: 사진은 원본 그대로, 문서는 2배(PDF 144dpi, Word 192dpi). 너무 큰 쪽은 줄인다. */
export function exportScale(doc: DocSource, page: number): number {
  const { width, height } = doc.pages[page]
  let scale = doc.kind === 'image' ? 1 : 2
  const maxPixels = 40_000_000
  if (width * height * scale * scale > maxPixels) scale = Math.sqrt(maxPixels / (width * height))
  while (!isCanvasSizeSafe(width * scale, height * scale) && scale > 0.05) scale *= 0.9
  return scale
}

export async function renderPageWithItems(doc: DocSource, page: number, items: Item[], signal?: AbortSignal): Promise<HTMLCanvasElement> {
  const scale = exportScale(doc, page)
  const canvas = await doc.render(page, scale, signal, true)
  checkAbort(signal)
  // 실제로 그려진 크기 기준으로 맞춘다(반올림 차이 보정)
  const actual = canvas.width / doc.pages[page].width
  await drawItems(ctx2d(canvas), items.filter((i) => i.page === page), actual)
  return canvas
}

export function outputBaseName(doc: DocSource): string {
  return `${sanitizeFilename(doc.baseName, '문서')}_서명`
}

/** PDF 원본에 서명 이미지를 넣는다. 글자 선택·벡터가 그대로 남는다. */
export async function savePdfKeepingOriginal(doc: DocSource, items: Item[], onProgress: Progress, signal?: AbortSignal): Promise<File> {
  if (!doc.bytes) throw new PdfStructureError('unreadable')
  const { PDFDocument, degrees } = await import('pdf-lib')
  let pdf: Awaited<ReturnType<typeof PDFDocument.load>>
  try {
    pdf = await PDFDocument.load(doc.bytes, { updateMetadata: false })
  } catch (err) {
    const text = `${(err as Error)?.name ?? ''} ${(err as Error)?.message ?? ''}`
    throw new PdfStructureError(/encrypt/i.test(text) ? 'encrypted' : 'unreadable')
  }
  checkAbort(signal)
  const pages = pdf.getPages()
  if (pages.length !== doc.pages.length) throw new PdfStructureError('unreadable')

  const embedded = new Map<string, Awaited<ReturnType<typeof pdf.embedPng>>>()
  let done = 0
  for (const item of items) {
    checkAbort(signal)
    const info = doc.pages[item.page]?.pdf
    const page = pages[item.page]
    if (!info || !page) continue
    const key = `${item.tint ?? ''}|${item.src}`
    let image = embedded.get(key)
    if (!image) {
      image = await pdf.embedPng(await itemPngBytes(item))
      embedded.set(key, image)
    }
    const place = pdfImagePlacement(info, item)
    page.drawImage(image, {
      x: place.x,
      y: place.y,
      width: place.width,
      height: place.height,
      rotate: degrees(place.rotate),
      opacity: Math.min(1, Math.max(0, item.opacity)),
    })
    onProgress(++done, items.length + 1)
    await tick()
  }
  const bytes = await pdf.save()
  checkAbort(signal)
  onProgress(items.length + 1, items.length + 1)
  return blobToFile(new Blob([bytes as BlobPart], { type: 'application/pdf' }), `${outputBaseName(doc)}.pdf`)
}

/** 쪽마다 이미지 파일 하나 */
export async function savePageImages(doc: DocSource, items: Item[], format: RasterFormat, quality: number, onProgress: Progress, signal?: AbortSignal): Promise<File[]> {
  const ext = format === 'image/jpeg' ? 'jpg' : 'png'
  const total = doc.pages.length
  const digits = String(total).length
  const files: File[] = []
  for (let p = 0; p < total; p++) {
    checkAbort(signal)
    const canvas = await renderPageWithItems(doc, p, items, signal)
    const blob = await canvasToBlob(canvas, format, quality)
    canvas.width = canvas.height = 1
    const suffix = total > 1 ? `_${String(p + 1).padStart(digits, '0')}` : ''
    files.push(blobToFile(blob, `${outputBaseName(doc)}${suffix}.${ext}`))
    onProgress(p + 1, total)
    await tick()
  }
  return files
}

/** 쪽 이미지를 모아 새 PDF 로(Word, 암호 PDF). 글자는 선택할 수 없다. */
export async function savePagesAsPdf(doc: DocSource, items: Item[], onProgress: Progress, signal?: AbortSignal): Promise<File> {
  const { PDFDocument } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  const ptPerUnit = (72 / 96) * doc.unitPx
  const total = doc.pages.length
  for (let p = 0; p < total; p++) {
    checkAbort(signal)
    const canvas = await renderPageWithItems(doc, p, items, signal)
    const jpg = await canvasToBlob(canvas, 'image/jpeg', 0.92)
    canvas.width = canvas.height = 1
    const image = await pdf.embedJpg(await jpg.arrayBuffer())
    const w = doc.pages[p].width * ptPerUnit
    const h = doc.pages[p].height * ptPerUnit
    pdf.addPage([w, h]).drawImage(image, { x: 0, y: 0, width: w, height: h })
    onProgress(p + 1, total + 1)
    await tick()
  }
  const bytes = await pdf.save()
  checkAbort(signal)
  onProgress(total + 1, total + 1)
  return blobToFile(new Blob([bytes as BlobPart], { type: 'application/pdf' }), `${outputBaseName(doc)}.pdf`)
}
