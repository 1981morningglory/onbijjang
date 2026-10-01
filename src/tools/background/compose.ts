import { ctx2d, makeCanvas } from '@/lib/image'
import { blurAlpha, maskBounds, thumbLayout, type Bounds } from './mask'

type Source = CanvasImageSource & { width: number; height: number }

export interface BackgroundSettings {
  kind: 'transparent' | 'color' | 'gradient' | 'image'
  color: string
  from: string
  to: string
  direction: 'down' | 'right' | 'diagonal'
}

export interface ThumbSettings {
  enabled: boolean
  width: number
  height: number
  /** 한쪽 여백(짧은 변의 %) */
  marginPct: number
  shadow: boolean
  /** 10–80 (%) */
  shadowStrength: number
}

export const DEFAULT_BACKGROUND: BackgroundSettings = { kind: 'transparent', color: '#ffffff', from: '#ffffff', to: '#dcefe4', direction: 'down' }
export const DEFAULT_THUMB: ThumbSettings = { enabled: false, width: 1000, height: 1000, marginPct: 8, shadow: false, shadowStrength: 35 }

let filterSupport: boolean | null = null
function supportsFilter(ctx: CanvasRenderingContext2D): boolean {
  if (filterSupport === null) filterSupport = typeof ctx.filter === 'string'
  return filterSupport
}

/** 0–255 마스크 배열을 알파 채널로 가진 캔버스로 만든다. */
export function maskToCanvas(alpha: Uint8Array, w: number, h: number): HTMLCanvasElement {
  const canvas = makeCanvas(w, h)
  const ctx = ctx2d(canvas, true)
  const img = ctx.createImageData(w, h)
  for (let i = 0; i < alpha.length; i++) {
    img.data[i * 4] = 255
    img.data[i * 4 + 1] = 255
    img.data[i * 4 + 2] = 255
    img.data[i * 4 + 3] = alpha[i]
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

/** 마스크 캔버스의 알파 채널을 배열로 꺼낸다. */
export function canvasToMask(canvas: HTMLCanvasElement): Uint8Array {
  const data = ctx2d(canvas, true).getImageData(0, 0, canvas.width, canvas.height).data
  const out = new Uint8Array(canvas.width * canvas.height)
  for (let i = 0; i < out.length; i++) out[i] = data[i * 4 + 3]
  return out
}

/**
 * 사진에서 마스크만큼만 남긴 캔버스(배경은 투명)를 사진 크기로 만든다.
 * 마스크는 사진보다 작을 수 있으며 부드럽게 늘려 적용한다. feather 는 마스크 해상도 기준 px.
 */
export function cutout(image: Source, mask: HTMLCanvasElement, feather: number): HTMLCanvasElement {
  const out = makeCanvas(image.width, image.height)
  const ctx = ctx2d(out)
  const k = image.width / mask.width
  const blur = feather * k
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  if (blur >= 0.5 && supportsFilter(ctx)) {
    ctx.filter = `blur(${blur}px)`
    ctx.drawImage(mask, 0, 0, out.width, out.height)
    ctx.filter = 'none'
  } else if (blur >= 0.5) {
    // 캔버스 필터가 없는 브라우저: 마스크 해상도에서 직접 흐린 뒤 늘린다.
    const src = ctx2d(mask, true).getImageData(0, 0, mask.width, mask.height).data
    const alpha = new Uint8Array(mask.width * mask.height)
    for (let i = 0; i < alpha.length; i++) alpha[i] = src[i * 4 + 3]
    ctx.drawImage(maskToCanvas(blurAlpha(alpha, mask.width, mask.height, feather), mask.width, mask.height), 0, 0, out.width, out.height)
  } else {
    ctx.drawImage(mask, 0, 0, out.width, out.height)
  }
  ctx.globalCompositeOperation = 'source-in'
  ctx.drawImage(image, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  return out
}

/** 배경을 칠한다. 사진 배경은 비율을 지켜 가득 채운다. */
export function paintBackground(ctx: CanvasRenderingContext2D, w: number, h: number, bg: BackgroundSettings, bgImage: Source | null) {
  if (bg.kind === 'transparent') return
  if (bg.kind === 'color') {
    ctx.fillStyle = bg.color
    ctx.fillRect(0, 0, w, h)
  } else if (bg.kind === 'gradient') {
    const g = bg.direction === 'down' ? ctx.createLinearGradient(0, 0, 0, h) : bg.direction === 'right' ? ctx.createLinearGradient(0, 0, w, 0) : ctx.createLinearGradient(0, 0, w, h)
    g.addColorStop(0, bg.from)
    g.addColorStop(1, bg.to)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  } else if (bgImage) {
    const k = Math.max(w / bgImage.width, h / bgImage.height)
    const dw = bgImage.width * k
    const dh = bgImage.height * k
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bgImage, (w - dw) / 2, (h - dh) / 2, dw, dh)
  } else {
    // 배경 사진을 아직 고르지 않았으면 흰색으로 둔다.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
  }
}

/** 물건 아래에 깔리는 부드러운 타원 그림자 */
function paintShadow(ctx: CanvasRenderingContext2D, cx: number, bottom: number, subjectWidth: number, strength: number) {
  const rx = subjectWidth * 0.46
  const ry = Math.max(4, rx * 0.11)
  ctx.save()
  ctx.translate(cx, bottom - ry * 0.35)
  ctx.scale(1, ry / rx)
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx)
  const a = Math.max(0, Math.min(1, strength / 100))
  g.addColorStop(0, `rgba(0,0,0,${a})`)
  g.addColorStop(0.55, `rgba(0,0,0,${a * 0.45})`)
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(0, 0, rx, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

export interface ComposeInput {
  image: Source
  /** 알파 채널이 마스크인 캔버스(사진과 같은 비율) */
  mask: HTMLCanvasElement
  feather: number
  background: BackgroundSettings
  bgImage: Source | null
}

/** 사진 크기 그대로: 새 배경 위에 누끼를 올린다. */
export function composeFull(input: ComposeInput, target?: HTMLCanvasElement): HTMLCanvasElement {
  const { image } = input
  const out = target ?? makeCanvas(image.width, image.height)
  if (out.width !== image.width || out.height !== image.height) {
    out.width = image.width
    out.height = image.height
  }
  const ctx = ctx2d(out)
  ctx.clearRect(0, 0, out.width, out.height)
  paintBackground(ctx, out.width, out.height, input.background, input.bgImage)
  ctx.drawImage(cutout(image, input.mask, input.feather), 0, 0)
  return out
}

/** 마스크에서 물건이 차지하는 범위(마스크 해상도 기준) */
export function subjectBounds(mask: HTMLCanvasElement): Bounds | null {
  const data = ctx2d(mask, true).getImageData(0, 0, mask.width, mask.height).data
  return maskBounds(data, mask.width, mask.height, 24, 4)
}

/**
 * 썸네일: 물건만 잘라 가운데에 놓고 여백·그림자를 더한다.
 * 배경이 '투명'이면 흰색으로 채운다(썸네일의 기본은 흰 배경).
 */
export function composeThumb(input: ComposeInput, thumb: ThumbSettings, target?: HTMLCanvasElement): HTMLCanvasElement {
  const { image, mask } = input
  const out = target ?? makeCanvas(thumb.width, thumb.height)
  if (out.width !== thumb.width || out.height !== thumb.height) {
    out.width = thumb.width
    out.height = thumb.height
  }
  const ctx = ctx2d(out)
  ctx.clearRect(0, 0, out.width, out.height)
  const bg: BackgroundSettings = input.background.kind === 'transparent' ? { ...input.background, kind: 'color', color: '#ffffff' } : input.background
  paintBackground(ctx, out.width, out.height, bg, input.bgImage)
  const b = subjectBounds(mask)
  if (!b) return out
  // 마스크 좌표 → 사진 좌표
  const k = image.width / mask.width
  const sb = { x: b.x * k, y: b.y * k, w: b.w * k, h: b.h * k }
  const layout = thumbLayout(sb, out.width, out.height, thumb.marginPct)
  if (thumb.shadow) paintShadow(ctx, layout.x + layout.w / 2, layout.y + layout.h, layout.w, thumb.shadowStrength)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(cutout(image, mask, input.feather), sb.x, sb.y, sb.w, sb.h, layout.x, layout.y, layout.w, layout.h)
  return out
}
