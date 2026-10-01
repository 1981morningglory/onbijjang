/** 작업대의 쪽(PDF 쪽 또는 사진)을 캔버스로 그리기, 미리보기 그림 만들기. */
import { canvasToBlob, ctx2d, isCanvasSizeSafe, loadBitmap, makeCanvas } from '@/lib/image'
import { fitImagePage, visualSize, type PaperSettings, type Quarter } from './geometry'
import { pdfPageSize, renderPdfPage } from './pdfjs'
import { onSourceRemoved, type ImageSource, type PageItem, type Source } from './store'

export interface RenderItemOptions {
  dpi: number
  paper: PaperSettings
  signal?: AbortSignal
}

/** 쪽의 보이는 크기(pt) — 회전 반영 */
export async function itemSize(item: PageItem, source: Source, paper: PaperSettings): Promise<{ width: number; height: number }> {
  if (source.kind === 'pdf') return pdfPageSize(source.pdf, item.index, item.rotation)
  const place = fitImagePage(source.width, source.height, paper)
  return visualSize({ width: place.pageW, height: place.pageH }, item.rotation)
}

/** 쪽을 dpi 해상도로 그린다. 사진은 원본보다 크게 늘리지 않는다. */
export async function renderItem(item: PageItem, source: Source, { dpi, paper, signal }: RenderItemOptions): Promise<HTMLCanvasElement> {
  if (source.kind === 'pdf') return renderPdfPage(source.pdf, item.index, { scale: dpi / 72, rotation: item.rotation, signal })
  signal?.throwIfAborted()
  return rotateCanvas(await renderImagePage(source, dpi, paper), item.rotation)
}

async function renderImagePage(source: ImageSource, dpi: number, paper: PaperSettings): Promise<HTMLCanvasElement> {
  const place = fitImagePage(source.width, source.height, paper)
  const native = source.width / place.w // 원본 픽셀을 그대로 살리는 배율(px/pt)
  let scale = Math.min(dpi / 72, native)
  if (!isCanvasSizeSafe(Math.ceil(place.pageW * scale), Math.ceil(place.pageH * scale))) {
    scale = Math.min(16384 / place.pageW, 16384 / place.pageH, Math.sqrt(120_000_000 / (place.pageW * place.pageH))) * 0.98
  }
  const canvas = makeCanvas(place.pageW * scale, place.pageH * scale)
  const ctx = ctx2d(canvas)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const bmp = await loadBitmap(source.file)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, place.x * scale, (place.pageH - place.y - place.h) * scale, place.w * scale, place.h * scale)
  bmp.close()
  return canvas
}

export function rotateCanvas(canvas: HTMLCanvasElement, rotation: Quarter): HTMLCanvasElement {
  if (!rotation) return canvas
  const swap = rotation === 90 || rotation === 270
  const out = makeCanvas(swap ? canvas.height : canvas.width, swap ? canvas.width : canvas.height)
  const ctx = ctx2d(out)
  ctx.translate(out.width / 2, out.height / 2)
  ctx.rotate((rotation * Math.PI) / 180)
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2)
  return out
}

// ── 미리보기 그림(썸네일) ────────────────────────────────
const THUMB_PX = 260
const thumbs = new Map<string, Promise<string>>()
const thumbKey = (sourceId: string, index: number) => `${sourceId}:${index}`

let active = 0
const waiting: Array<() => void> = []
async function withSlot<T>(work: () => Promise<T>): Promise<T> {
  if (active >= 2) await new Promise<void>((resolve) => waiting.push(resolve))
  active++
  try {
    return await work()
  } finally {
    active--
    waiting.shift()?.()
  }
}

/** 회전하지 않은 상태의 작은 그림 주소. 회전은 화면에서 CSS 로 돌린다. */
export function thumbUrl(item: PageItem, source: Source): Promise<string> {
  const key = thumbKey(item.sourceId, item.index)
  let p = thumbs.get(key)
  if (!p) {
    p = withSlot(async () => {
      let canvas: HTMLCanvasElement
      if (source.kind === 'pdf') {
        const size = await pdfPageSize(source.pdf, item.index)
        canvas = await renderPdfPage(source.pdf, item.index, { scale: THUMB_PX / Math.max(size.width, size.height) })
      } else {
        const bmp = await loadBitmap(source.file)
        const s = Math.min(1, THUMB_PX / Math.max(bmp.width, bmp.height))
        canvas = makeCanvas(bmp.width * s, bmp.height * s)
        const ctx = ctx2d(canvas)
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
        bmp.close()
      }
      const blob = await canvasToBlob(canvas, source.kind === 'image' && source.file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.8)
      return URL.createObjectURL(blob)
    })
    thumbs.set(key, p)
    p.catch(() => thumbs.delete(key))
  }
  return p
}

onSourceRemoved((source) => {
  for (const [key, p] of thumbs) {
    if (key.startsWith(`${source.id}:`)) {
      thumbs.delete(key)
      void p.then((url) => URL.revokeObjectURL(url)).catch(() => {})
    }
  }
})

/** 크게 보기용: 긴 변 px 에 맞춰 그린 그림 */
export async function previewBlob(item: PageItem, source: Source, paper: PaperSettings, px = 1400): Promise<Blob> {
  const size = await itemSize(item, source, paper)
  const dpi = Math.min(220, (px / Math.max(size.width, size.height)) * 72)
  return canvasToBlob(await renderItem(item, source, { dpi, paper }), 'image/jpeg', 0.88)
}
