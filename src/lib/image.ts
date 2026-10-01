/** 캔버스·이미지 공통 도우미. 저장은 항상 캔버스에서 새로 만들어 EXIF·GPS 등 메타정보가 남지 않는다. */

export type RasterFormat = 'image/png' | 'image/jpeg' | 'image/webp'

export const FORMAT_EXT: Record<RasterFormat, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

/** EXIF 회전을 반영해 비트맵으로 읽는다. */
export async function loadBitmap(source: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(source, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('이미지를 열 수 없습니다. 손상되었거나 지원하지 않는 형식입니다.')
  }
}

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('이미지를 불러오지 못했습니다.'))
    img.src = src
  })
}

export function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(width))
  c.height = Math.max(1, Math.round(height))
  return c
}

export function ctx2d(canvas: HTMLCanvasElement | OffscreenCanvas, willReadFrequently = false): CanvasRenderingContext2D {
  const ctx = (canvas as HTMLCanvasElement).getContext('2d', { willReadFrequently })
  if (!ctx) throw new Error('캔버스를 만들 수 없습니다. 이미지가 너무 클 수 있습니다.')
  return ctx
}

export async function bitmapToCanvas(bitmap: ImageBitmap | HTMLImageElement | HTMLCanvasElement): Promise<HTMLCanvasElement> {
  const w = 'naturalWidth' in bitmap ? bitmap.naturalWidth : bitmap.width
  const h = 'naturalHeight' in bitmap ? bitmap.naturalHeight : bitmap.height
  const c = makeCanvas(w, h)
  ctx2d(c).drawImage(bitmap, 0, 0)
  return c
}

export async function fileToCanvas(file: Blob): Promise<HTMLCanvasElement> {
  const bmp = await loadBitmap(file)
  const c = await bitmapToCanvas(bmp)
  bmp.close()
  return c
}

/** quality 는 0–1. JPEG 는 투명 영역을 흰색으로 채운다. */
export function canvasToBlob(canvas: HTMLCanvasElement, type: RasterFormat = 'image/png', quality = 0.92): Promise<Blob> {
  let source = canvas
  if (type === 'image/jpeg') {
    source = makeCanvas(canvas.width, canvas.height)
    const ctx = ctx2d(source)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, source.width, source.height)
    ctx.drawImage(canvas, 0, 0)
  }
  return new Promise((resolve, reject) => {
    source.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('이미지를 저장하지 못했습니다.'))), type, quality)
  })
}

/** 목표 용량(바이트) 이하가 되도록 품질을 이분 탐색한다. PNG 는 품질 조절이 없어 그대로 돌려준다. */
export async function encodeUnderSize(canvas: HTMLCanvasElement, type: RasterFormat, maxBytes: number): Promise<{ blob: Blob; quality: number }> {
  if (type === 'image/png') return { blob: await canvasToBlob(canvas, type), quality: 1 }
  let lo = 0.3
  let hi = 0.95
  let best = await canvasToBlob(canvas, type, hi)
  let bestQ = hi
  if (best.size <= maxBytes) return { blob: best, quality: hi }
  for (let i = 0; i < 6; i++) {
    const q = (lo + hi) / 2
    const blob = await canvasToBlob(canvas, type, q)
    if (blob.size <= maxBytes) {
      best = blob
      bestQ = q
      lo = q
    } else {
      hi = q
      if (best.size > maxBytes) {
        best = blob
        bestQ = q
      }
    }
  }
  return { blob: best, quality: bestQ }
}

/** 고품질 축소: 절반씩 단계적으로 줄여 계단 현상을 줄인다. */
export function resizeCanvas(src: HTMLCanvasElement | ImageBitmap, width: number, height: number): HTMLCanvasElement {
  let cur: HTMLCanvasElement | ImageBitmap = src
  let cw = src.width
  let ch = src.height
  while (cw / 2 > width && ch / 2 > height) {
    cw = Math.round(cw / 2)
    ch = Math.round(ch / 2)
    const step = makeCanvas(cw, ch)
    const sctx = ctx2d(step)
    sctx.imageSmoothingQuality = 'high'
    sctx.drawImage(cur, 0, 0, cw, ch)
    cur = step
  }
  const out = makeCanvas(width, height)
  const ctx = ctx2d(out)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(cur, 0, 0, out.width, out.height)
  return out
}

/** 긴 변이 max 를 넘으면 비율을 유지해 줄인 크기를 돌려준다. */
export function fitWithin(w: number, h: number, max: number): { width: number; height: number; scale: number } {
  const scale = Math.min(1, max / Math.max(w, h))
  return { width: Math.round(w * scale), height: Math.round(h * scale), scale }
}

/** 브라우저 캔버스 한계(대부분 16,384px·약 2억 6천만 화소)를 넘지 않는지 */
export function isCanvasSizeSafe(w: number, h: number): boolean {
  return w <= 16384 && h <= 16384 && w * h <= 120_000_000
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = hex.replace('#', '')
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m
  const n = parseInt(full, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}
