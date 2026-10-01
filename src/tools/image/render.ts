/**
 * 그리기 파이프라인. 목록 썸네일·결과 미리보기·저장·정밀 편집 화면이 모두 여기 함수를 쓴다.
 * 그래서 화면에 보이는 것과 저장되는 것이 같다.
 *
 *   원본 → [사진별] 반전·회전 → 자르기 → 보정(밝기·대비·채도) → 모자이크 → 글자·도형
 *        → [전체] 랜덤 자르기 → 크기 맞춤 → 테두리 → 워터마크
 */
import { ctx2d, isCanvasSizeSafe, makeCanvas, resizeCanvas } from '@/lib/image'
import { boxCorners, effectiveCrop, flipView, orientationMatrix, planOutput } from './geometry'
import { isLine, type Annotation, type Box, type FontKey, type LineObject, type MosaicObject, type PhotoEdits, type Rect, type ResolvedBatch, type ShapeObject, type TextObject } from './types'

/** 그릴 원본. image 는 줄인 미리보기여도 되고, width·height 는 항상 원본 크기다. */
export interface PhotoSource {
  image: ImageBitmap | HTMLCanvasElement
  width: number
  height: number
}

export type WatermarkDraw = (ctx: CanvasRenderingContext2D, width: number, height: number) => void

export interface RenderSettings {
  batch: ResolvedBatch
  watermark?: WatermarkDraw | null
  /** 랜덤 자르기 위치를 정하는 씨앗(사진마다 다름) */
  seed: number
}

// ── 글꼴 ──────────────────────────────────────────────────
export const FONTS: Record<FontKey, { label: string; family: string; stack: string; boldable: boolean }> = {
  gothic: { label: '고딕', family: 'Pretendard Variable', stack: "'Pretendard Variable', Pretendard, 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif", boldable: true },
  display: { label: '굵은 제목', family: 'Black Han Sans', stack: "'Black Han Sans', 'Pretendard Variable', 'Malgun Gothic', sans-serif", boldable: false },
  hand: { label: '손글씨', family: 'Gaegu', stack: "'Gaegu', 'Pretendard Variable', 'Malgun Gothic', sans-serif", boldable: true },
  pen: { label: '펜글씨', family: 'Nanum Pen Script', stack: "'Nanum Pen Script', 'Pretendard Variable', 'Malgun Gothic', cursive", boldable: false },
  serif: { label: '명조', family: 'serif', stack: "'Nanum Myeongjo', Batang, 'AppleMyungjo', serif", boldable: true },
}

export function fontString(o: Pick<TextObject, 'font' | 'bold' | 'size'>): string {
  const f = FONTS[o.font] ?? FONTS.gothic
  return `${o.bold && f.boldable ? 700 : 400} ${o.size}px ${f.stack}`
}

/** 글자에 쓰인 웹 글꼴(필요한 글자 조각까지)을 그리기 전에 받아 둔다. */
export async function ensureFonts(edits: PhotoEdits): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return
  const jobs: Promise<unknown>[] = []
  for (const o of edits.objects) {
    if (o.type !== 'text') continue
    const f = FONTS[o.font] ?? FONTS.gothic
    if (f.family === 'serif') continue
    jobs.push(document.fonts.load(`${o.bold && f.boldable ? 700 : 400} 32px '${f.family}'`, o.text || '가').catch(() => undefined))
  }
  if (jobs.length) await Promise.all(jobs)
}

/** 글자에 쓰인 글꼴이 모두 준비되어 있는지 */
export function fontsReady(edits: PhotoEdits): boolean {
  if (typeof document === 'undefined' || !document.fonts) return true
  return edits.objects.every((o) => {
    if (o.type !== 'text') return true
    const f = FONTS[o.font] ?? FONTS.gothic
    if (f.family === 'serif') return true
    try {
      return document.fonts.check(`${o.bold && f.boldable ? 700 : 400} 32px '${f.family}'`, o.text || '가')
    } catch {
      return true
    }
  })
}

const LINE_HEIGHT = 1.3
const PAD_X = 0.35
const PAD_Y = 0.18

let measureCtx: CanvasRenderingContext2D | null = null

/** 글자 상자 크기(여백 포함, 원본 사진 px) */
export function measureText(o: TextObject): { w: number; h: number; lines: string[]; widths: number[] } {
  measureCtx ??= ctx2d(makeCanvas(4, 4))
  measureCtx.font = fontString(o)
  const lines = (o.text || ' ').split('\n')
  const widths = lines.map((l) => measureCtx!.measureText(l || ' ').width)
  return { w: Math.max(...widths) + o.size * PAD_X * 2, h: lines.length * o.size * LINE_HEIGHT + o.size * PAD_Y * 2, lines, widths }
}

/** 물체가 차지하는 상자(선·화살표는 양 끝을 잇는 상자) */
export function boxOf(o: Annotation): Box {
  if (o.type === 'text') {
    const m = measureText(o)
    return { cx: o.cx, cy: o.cy, w: m.w, h: m.h, rotation: o.rotation }
  }
  if (isLine(o)) {
    return { cx: (o.x1 + o.x2) / 2, cy: (o.y1 + o.y2) / 2, w: Math.abs(o.x2 - o.x1), h: Math.abs(o.y2 - o.y1), rotation: 0 }
  }
  return { cx: o.cx, cy: o.cy, w: o.w, h: o.h, rotation: o.rotation }
}

// ── 물체 그리기 ───────────────────────────────────────────
function drawText(ctx: CanvasRenderingContext2D, o: TextObject) {
  const m = measureText(o)
  ctx.save()
  ctx.translate(o.cx, o.cy)
  ctx.rotate((o.rotation * Math.PI) / 180)
  if (o.background) {
    ctx.fillStyle = o.backgroundColor
    const r = o.size * 0.16
    ctx.beginPath()
    if (typeof ctx.roundRect === 'function') ctx.roundRect(-m.w / 2, -m.h / 2, m.w, m.h, r)
    else ctx.rect(-m.w / 2, -m.h / 2, m.w, m.h)
    ctx.fill()
  }
  ctx.font = fontString(o)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const lineH = o.size * LINE_HEIGHT
  const top = -((m.lines.length - 1) * lineH) / 2
  if (o.outline > 0) {
    ctx.lineJoin = 'round'
    ctx.miterLimit = 2
    ctx.lineWidth = o.outline * 2
    ctx.strokeStyle = o.outlineColor
    m.lines.forEach((line, i) => ctx.strokeText(line, 0, top + i * lineH))
  }
  ctx.fillStyle = o.color
  m.lines.forEach((line, i) => ctx.fillText(line, 0, top + i * lineH))
  ctx.restore()
}

function drawShape(ctx: CanvasRenderingContext2D, o: ShapeObject) {
  ctx.save()
  ctx.translate(o.cx, o.cy)
  ctx.rotate((o.rotation * Math.PI) / 180)
  ctx.beginPath()
  if (o.type === 'rect') ctx.rect(-o.w / 2, -o.h / 2, o.w, o.h)
  else ctx.ellipse(0, 0, Math.max(0.5, o.w / 2), Math.max(0.5, o.h / 2), 0, 0, Math.PI * 2)
  if (o.fill) {
    ctx.fillStyle = o.color
    ctx.fill()
  } else {
    ctx.lineJoin = 'miter'
    ctx.lineWidth = o.width
    ctx.strokeStyle = o.color
    ctx.stroke()
  }
  ctx.restore()
}

function drawLine(ctx: CanvasRenderingContext2D, o: LineObject) {
  const dx = o.x2 - o.x1
  const dy = o.y2 - o.y1
  const len = Math.hypot(dx, dy)
  if (len < 0.01) return
  ctx.save()
  ctx.strokeStyle = o.color
  ctx.fillStyle = o.color
  ctx.lineWidth = o.width
  ctx.lineCap = 'round'
  if (o.type === 'line') {
    ctx.beginPath()
    ctx.moveTo(o.x1, o.y1)
    ctx.lineTo(o.x2, o.y2)
    ctx.stroke()
  } else {
    const ux = dx / len
    const uy = dy / len
    const head = Math.min(len * 0.6, o.width * 4.5)
    const half = head * 0.5
    const bx = o.x2 - ux * head
    const by = o.y2 - uy * head
    ctx.beginPath()
    ctx.moveTo(o.x1, o.y1)
    ctx.lineTo(bx + ux * head * 0.1, by + uy * head * 0.1)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(o.x2, o.y2)
    ctx.lineTo(bx - uy * half, by + ux * half)
    ctx.lineTo(bx + uy * half, by - ux * half)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

/** 캔버스에 이미 그려진 사진의 한 영역을 모자이크로 바꾼다. toPx: 사진 좌표 → 캔버스 픽셀 */
function applyMosaic(ctx: CanvasRenderingContext2D, o: MosaicObject, scale: number, offX: number, offY: number) {
  const canvas = ctx.canvas
  const corners = boxCorners(o).map((p) => ({ x: p.x * scale + offX, y: p.y * scale + offY }))
  const x0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.x))))
  const y0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.y))))
  const x1 = Math.min(canvas.width, Math.ceil(Math.max(...corners.map((p) => p.x))))
  const y1 = Math.min(canvas.height, Math.ceil(Math.max(...corners.map((p) => p.y))))
  const w = x1 - x0
  const h = y1 - y0
  if (w < 1 || h < 1) return
  const block = Math.max(2, o.block * scale)
  const tw = Math.max(1, Math.round(w / block))
  const th = Math.max(1, Math.round(h / block))
  // 절반씩 줄여 가며 평균을 내야 칸 색이 고르게 나온다.
  let cur: HTMLCanvasElement = makeCanvas(w, h)
  ctx2d(cur).drawImage(canvas, x0, y0, w, h, 0, 0, w, h)
  while (cur.width / 2 > tw && cur.height / 2 > th) {
    const next = makeCanvas(Math.ceil(cur.width / 2), Math.ceil(cur.height / 2))
    const nctx = ctx2d(next)
    nctx.imageSmoothingQuality = 'high'
    nctx.drawImage(cur, 0, 0, next.width, next.height)
    cur = next
  }
  const tiny = makeCanvas(tw, th)
  const tctx = ctx2d(tiny)
  tctx.imageSmoothingQuality = 'high'
  tctx.drawImage(cur, 0, 0, tw, th)

  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.beginPath()
  corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
  ctx.closePath()
  ctx.clip()
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(tiny, 0, 0, tw, th, x0, y0, w, h)
  ctx.restore()
}

export function drawObject(ctx: CanvasRenderingContext2D, o: Annotation) {
  if (o.type === 'text') drawText(ctx, o)
  else if (o.type === 'rect' || o.type === 'ellipse') drawShape(ctx, o)
  else if (isLine(o)) drawLine(ctx, o)
}

// ── 보정 ──────────────────────────────────────────────────
export interface Adjust {
  brightness: number
  contrast: number
  saturation: number
}

export const isAdjusted = (a: Adjust) => a.brightness !== 100 || a.contrast !== 100 || a.saturation !== 100

/** ctx.filter 가 없는 브라우저용. CSS 필터와 같은 식(밝기 → 대비 → 채도)으로 픽셀을 바꾼다. */
export function adjustPixels(data: Uint8ClampedArray, a: Adjust) {
  const br = a.brightness / 100
  const ct = a.contrast / 100
  const s = a.saturation / 100
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i] * br
    let g = data[i + 1] * br
    let b = data[i + 2] * br
    r = (r - 127.5) * ct + 127.5
    g = (g - 127.5) * ct + 127.5
    b = (b - 127.5) * ct + 127.5
    r = Math.min(255, Math.max(0, r))
    g = Math.min(255, Math.max(0, g))
    b = Math.min(255, Math.max(0, b))
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
    data[i] = l + (r - l) * s
    data[i + 1] = l + (g - l) * s
    data[i + 2] = l + (b - l) * s
  }
}

let filterSupport: boolean | null = null
function supportsFilter(): boolean {
  if (filterSupport == null) {
    const ctx = ctx2d(makeCanvas(1, 1))
    filterSupport = typeof ctx.filter === 'string'
  }
  return filterSupport
}

// ── 사진별 편집 그리기 ────────────────────────────────────
export interface EditedOptions {
  /** 돌린 뒤 좌표에서 그릴 영역. 없으면 자르기 영역 */
  region?: Rect
  /** 원본 1px 이 캔버스 몇 px 인지 */
  scale: number
  adjust?: Adjust
}

/**
 * 사진 한 장의 정밀 편집(반전·회전·자르기·모자이크·글자·도형)을 그린 캔버스.
 * 캔버스 크기는 region × scale 이다.
 */
export function renderEdited(source: PhotoSource, edits: PhotoEdits, opts: EditedOptions): HTMLCanvasElement {
  const region = opts.region ?? effectiveCrop(source.width, source.height, edits)
  const s = opts.scale
  const canvas = makeCanvas(Math.max(1, Math.round(region.w * s)), Math.max(1, Math.round(region.h * s)))
  const ctx = ctx2d(canvas)
  const offX = -region.x * s
  const offY = -region.y * s

  const m = orientationMatrix(source.width, source.height, edits)
  const adjust = opts.adjust && isAdjusted(opts.adjust) ? opts.adjust : null
  ctx.save()
  ctx.setTransform(s, 0, 0, s, offX, offY)
  ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f)
  ctx.imageSmoothingQuality = 'high'
  if (adjust && supportsFilter()) ctx.filter = `brightness(${adjust.brightness}%) contrast(${adjust.contrast}%) saturate(${adjust.saturation}%)`
  ctx.drawImage(source.image, 0, 0, source.width, source.height)
  ctx.restore()
  if (adjust && !supportsFilter()) {
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
    adjustPixels(img.data, adjust)
    ctx.putImageData(img, 0, 0)
  }

  for (const o of edits.objects) if (o.type === 'mosaic') applyMosaic(ctx, o, s, offX, offY)
  ctx.save()
  ctx.setTransform(s, 0, 0, s, offX, offY)
  for (const o of edits.objects) drawObject(ctx, o)
  ctx.restore()
  return canvas
}

// ── 전체 파이프라인 ───────────────────────────────────────
export interface RenderOptions {
  /** 미리보기용: 결과의 긴 변을 이 값 이하로 줄여 그린다. 배치는 저장본과 같다. */
  maxSide?: number
}

/**
 * 사진 한 장의 최종 결과. 썸네일·미리보기·저장이 모두 이 함수를 쓴다.
 */
export function renderPhoto(source: PhotoSource, edits: PhotoEdits, settings: RenderSettings, opts: RenderOptions = {}): HTMLCanvasElement {
  const { batch } = settings
  // 전체 좌우 반전은 사진과 꾸미기 위치를 함께 뒤집되 글자는 읽히는 방향으로 둔다.
  const eff = batch.flipH ? flipView(source.width, source.height, edits, 'h') : edits
  const crop = effectiveCrop(source.width, source.height, eff)
  const plan = planOutput(crop.w, crop.h, batch, settings.seed)
  if (!isCanvasSizeSafe(plan.width, plan.height)) throw new Error('결과 크기가 너무 큽니다. 크기 맞춤 값을 줄여 주세요.')
  const k = opts.maxSide ? Math.min(1, opts.maxSide / Math.max(plan.width, plan.height)) : 1

  const region: Rect = { x: crop.x + plan.src.x, y: crop.y + plan.src.y, w: plan.src.w, h: plan.src.h }
  // 원본이 가진 해상도로 그린 다음 고품질로 줄인다.
  let scale = source.image.width / source.width
  scale = Math.min(scale, 16384 / Math.max(region.w, region.h), Math.sqrt(100_000_000 / (region.w * region.h)))
  const edited = renderEdited(source, eff, { region, scale, adjust: batch })

  const dw = Math.max(1, Math.round(plan.dest.w * k))
  const dh = Math.max(1, Math.round(plan.dest.h * k))
  const outW = Math.max(1, Math.round(plan.width * k))
  const outH = Math.max(1, Math.round(plan.height * k))
  let photo = edited
  if (edited.width !== dw || edited.height !== dh) {
    photo = resizeCanvas(edited, dw, dh)
    edited.width = 0
  }
  let out = photo
  if (plan.padded || dw !== outW || dh !== outH) {
    out = makeCanvas(outW, outH)
    const octx = ctx2d(out)
    octx.fillStyle = batch.padColor
    octx.fillRect(0, 0, outW, outH)
    octx.drawImage(photo, Math.round(plan.dest.x * k), Math.round(plan.dest.y * k))
    photo.width = 0
  }
  const ctx = ctx2d(out)

  const border = Math.min(batch.borderWidth, Math.floor(Math.min(plan.width, plan.height) / 2))
  if (border > 0) {
    const b = border * k
    ctx.fillStyle = batch.borderColor
    ctx.fillRect(0, 0, outW, b)
    ctx.fillRect(0, outH - b, outW, b)
    ctx.fillRect(0, b, b, outH - 2 * b)
    ctx.fillRect(outW - b, b, b, outH - 2 * b)
  }
  if (settings.watermark) {
    ctx.save()
    ctx.scale(k, k)
    ctx.translate(border, border)
    settings.watermark(ctx, Math.max(1, plan.width - border * 2), Math.max(1, plan.height - border * 2))
    ctx.restore()
  }
  return out
}

export function releaseCanvas(c: HTMLCanvasElement | null | undefined) {
  if (c) c.width = c.height = 0
}
