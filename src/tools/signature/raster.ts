/** 서명 이미지 만들기에 쓰는 픽셀·캔버스 도우미 */
import { canvasToBlob, ctx2d, loadImageElement, makeCanvas } from '@/lib/image'
import { readAsDataURL } from '@/lib/files'

export interface Bounds {
  x: number
  y: number
  w: number
  h: number
}

/** 불투명한 픽셀이 차지하는 영역. 전부 투명하면 null. */
export function alphaBounds(data: Uint8ClampedArray | Uint8Array, width: number, height: number, threshold = 8): Bounds | null {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    const row = y * width * 4
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] > threshold) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

/**
 * 흰 배경을 투명하게. 밝기가 threshold 이상이면 완전히 투명, threshold - soft 이하면 그대로,
 * 그 사이는 부드럽게 이어진다. 반투명해진 가장자리는 흰색이 섞인 만큼 색을 되돌려 테두리가 뿌옇지 않게 한다.
 * data 를 직접 고친다.
 */
export function whiteToAlpha(data: Uint8ClampedArray, threshold: number, soft = 60): void {
  const lo = Math.max(0, threshold - soft)
  const span = Math.max(1, threshold - lo)
  for (let i = 0; i < data.length; i += 4) {
    const a0 = data[i + 3]
    if (a0 === 0) continue
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    // 가장 어두운 채널 기준: 색이 있는 잉크(파랑·빨강)도 남긴다
    const light = Math.min(r, g, b)
    if (light >= threshold) {
      data[i + 3] = 0
      continue
    }
    if (light <= lo) continue
    const keep = (threshold - light) / span
    // 흰색이 (1-keep) 만큼 섞였다고 보고 원래 색을 되돌린다
    data[i] = Math.max(0, Math.min(255, (r - 255 * (1 - keep)) / keep))
    data[i + 1] = Math.max(0, Math.min(255, (g - 255 * (1 - keep)) / keep))
    data[i + 2] = Math.max(0, Math.min(255, (b - 255 * (1 - keep)) / keep))
    data[i + 3] = Math.round(a0 * keep)
  }
}

/** 투명한 가장자리를 잘라 낸다. 내용이 없으면 null. */
export function trimCanvas(canvas: HTMLCanvasElement, pad = 4): HTMLCanvasElement | null {
  const ctx = ctx2d(canvas, true)
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const b = alphaBounds(data, canvas.width, canvas.height)
  if (!b) return null
  const x = Math.max(0, b.x - pad)
  const y = Math.max(0, b.y - pad)
  const w = Math.min(canvas.width - x, b.w + pad * 2)
  const h = Math.min(canvas.height - y, b.h + pad * 2)
  const out = makeCanvas(w, h)
  ctx2d(out).drawImage(canvas, x, y, w, h, 0, 0, w, h)
  return out
}

/** 불투명한 부분을 한 가지 색으로 칠한 사본 */
export function tintCanvas(source: CanvasImageSource, width: number, height: number, color: string): HTMLCanvasElement {
  const out = makeCanvas(width, height)
  const ctx = ctx2d(out)
  ctx.drawImage(source, 0, 0, width, height)
  ctx.globalCompositeOperation = 'source-in'
  ctx.fillStyle = color
  ctx.fillRect(0, 0, out.width, out.height)
  return out
}

/** 긴 변이 max 를 넘으면 줄인 사본(넘지 않으면 원본 그대로) */
export function limitCanvas(canvas: HTMLCanvasElement, max: number): HTMLCanvasElement {
  const longest = Math.max(canvas.width, canvas.height)
  if (longest <= max) return canvas
  const k = max / longest
  const out = makeCanvas(canvas.width * k, canvas.height * k)
  const ctx = ctx2d(out)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(canvas, 0, 0, out.width, out.height)
  return out
}

export async function canvasToPngDataUrl(canvas: HTMLCanvasElement): Promise<string> {
  return readAsDataURL(await canvasToBlob(canvas, 'image/png'))
}

/**
 * 글자를 검은색(투명 배경) 이미지로 만든다. 높이는 글꼴의 줄 높이로 고정하고 좌우만 잘라
 * 글자가 바뀌어도 세로 위치가 흔들리지 않는다. tight 면 위아래도 글자에 맞춰 자른다(서명용).
 */
export function renderTextCanvas(text: string, fontFamily: string, fontWeight: number, tight: boolean, fontPx = 160): HTMLCanvasElement | null {
  const value = text.replace(/\s+/g, ' ').trim()
  if (!value) return null
  const probe = ctx2d(makeCanvas(4, 4))
  const font = `${fontWeight} ${fontPx}px ${fontFamily}`
  probe.font = font
  const m = probe.measureText(value)
  const left = Math.ceil(m.actualBoundingBoxLeft) + 8
  const right = Math.ceil(Math.max(m.width, m.actualBoundingBoxRight)) + 8
  const ascent = Math.ceil(Math.max(m.fontBoundingBoxAscent || fontPx * 0.9, m.actualBoundingBoxAscent)) + 6
  const descent = Math.ceil(Math.max(m.fontBoundingBoxDescent || fontPx * 0.25, m.actualBoundingBoxDescent)) + 6
  const canvas = makeCanvas(Math.min(8000, left + right), ascent + descent)
  const ctx = ctx2d(canvas)
  ctx.font = font
  ctx.fillStyle = '#000'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(value, left, ascent)
  if (tight) return trimCanvas(canvas, 6)
  // 좌우만 자른다
  const { data } = ctx2d(canvas, true).getImageData(0, 0, canvas.width, canvas.height)
  const b = alphaBounds(data, canvas.width, canvas.height)
  if (!b) return null
  const x = Math.max(0, b.x - 4)
  const w = Math.min(canvas.width - x, b.w + 8)
  const out = makeCanvas(w, canvas.height)
  ctx2d(out).drawImage(canvas, x, 0, w, canvas.height, 0, 0, w, canvas.height)
  return out
}

export type MarkShape = 'check' | 'cross' | 'circle' | 'dot'

/** 체크·가위표·동그라미·점 — 검은색(투명 배경) */
export function renderMarkCanvas(shape: MarkShape, size = 240): HTMLCanvasElement {
  const canvas = makeCanvas(size, size)
  const ctx = ctx2d(canvas)
  const lw = size * 0.12
  ctx.lineWidth = lw
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#000'
  ctx.fillStyle = '#000'
  const p = lw / 2 + size * 0.04
  ctx.beginPath()
  if (shape === 'check') {
    ctx.moveTo(p, size * 0.55)
    ctx.lineTo(size * 0.38, size - p - size * 0.06)
    ctx.lineTo(size - p, p + size * 0.08)
    ctx.stroke()
  } else if (shape === 'cross') {
    ctx.moveTo(p, p)
    ctx.lineTo(size - p, size - p)
    ctx.moveTo(size - p, p)
    ctx.lineTo(p, size - p)
    ctx.stroke()
  } else if (shape === 'circle') {
    ctx.lineWidth = lw * 0.7
    ctx.arc(size / 2, size / 2, size / 2 - p, 0, Math.PI * 2)
    ctx.stroke()
  } else {
    ctx.arc(size / 2, size / 2, size * 0.3, 0, Math.PI * 2)
    ctx.fill()
  }
  return canvas
}

const imageCache = new Map<string, Promise<HTMLImageElement>>()

/** data URL 이미지를 한 번만 디코딩해 재사용한다 */
export function loadCachedImage(src: string): Promise<HTMLImageElement> {
  let p = imageCache.get(src)
  if (!p) {
    p = loadImageElement(src)
    imageCache.set(src, p)
    p.catch(() => imageCache.delete(src))
    if (imageCache.size > 200) imageCache.delete(imageCache.keys().next().value as string)
  }
  return p
}

/** 저장·미리보기용 작은 이미지(data URL) */
export async function makeThumb(src: string, tint: string | null, max = 96): Promise<string> {
  const img = await loadCachedImage(src)
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * k))
  const h = Math.max(1, Math.round(img.naturalHeight * k))
  const canvas = tint ? tintCanvas(img, w, h, tint) : (() => {
    const c = makeCanvas(w, h)
    ctx2d(c).drawImage(img, 0, 0, w, h)
    return c
  })()
  return canvas.toDataURL('image/png')
}
