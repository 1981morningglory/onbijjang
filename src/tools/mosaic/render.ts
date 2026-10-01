import { ctx2d, makeCanvas } from '@/lib/image'
import { blurRadius, pixelBlock, type Region } from './regions'

type Source = CanvasImageSource & { width: number; height: number }

/** 큰 배율로 줄일 때 화소를 건너뛰지 않도록 절반씩 줄여 평균에 가깝게 만든다. */
function shrink(source: Source, sx: number, sy: number, sw: number, sh: number, tw: number, th: number): HTMLCanvasElement {
  let cw = Math.max(1, Math.round(sw))
  let ch = Math.max(1, Math.round(sh))
  let cur = makeCanvas(cw, ch)
  let ctx = ctx2d(cur)
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, cw, ch)
  while (cw / 2 > tw || ch / 2 > th) {
    const nw = Math.max(tw, Math.round(cw / 2))
    const nh = Math.max(th, Math.round(ch / 2))
    const next = makeCanvas(nw, nh)
    ctx = ctx2d(next)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(cur, 0, 0, cw, ch, 0, 0, nw, nh)
    cur = next
    cw = nw
    ch = nh
  }
  if (cw !== tw || ch !== th) {
    const last = makeCanvas(tw, th)
    ctx = ctx2d(last)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(cur, 0, 0, cw, ch, 0, 0, tw, th)
    cur = last
  }
  return cur
}

let filterSupport: boolean | null = null
function supportsFilter(ctx: CanvasRenderingContext2D): boolean {
  if (filterSupport === null) filterSupport = typeof ctx.filter === 'string'
  return filterSupport
}

/**
 * 깨끗한 사진(source) 위에 가릴 영역을 그린다. ctx 에는 이미 source 가 그려져 있어야 한다.
 * k 는 원본 대비 캔버스 배율(미리보기는 1 보다 작다). 세기는 영역 크기에 비례하므로 미리보기와 저장 결과가 같아 보인다.
 */
export function applyRegions(ctx: CanvasRenderingContext2D, source: Source, regions: Region[], k: number) {
  const W = ctx.canvas.width
  const H = ctx.canvas.height
  for (const r of regions) {
    const x = r.x * k
    const y = r.y * k
    const w = r.w * k
    const h = r.h * k
    if (w < 1 || h < 1) continue
    ctx.save()
    ctx.beginPath()
    if (r.shape === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
    else ctx.rect(x, y, w, h)
    ctx.clip()

    if (r.effect === 'fill') {
      ctx.fillStyle = r.color
      ctx.fillRect(x, y, w, h)
    } else if (r.effect === 'pixel') {
      const block = Math.max(2, pixelBlock(r, r.strength) * k)
      const cols = Math.max(1, Math.round(w / block))
      const rows = Math.max(1, Math.round(h / block))
      const small = shrink(source, x, y, w, h, cols, rows)
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(small, 0, 0, cols, rows, x, y, w, h)
    } else {
      const radius = Math.max(2, blurRadius(r, r.strength) * k)
      // 영역 바깥을 조금 포함해서 흐리게 해야 가장자리가 투명하게 빠지지 않는다.
      const pad = radius * 2
      const sx = Math.max(0, x - pad)
      const sy = Math.max(0, y - pad)
      const sw = Math.min(W, x + w + pad) - sx
      const sh = Math.min(H, y + h + pad) - sy
      if (supportsFilter(ctx)) {
        // 바탕을 먼저 평균색에 가깝게 깔아 가장자리 번짐으로 원본이 비치지 않게 한다.
        const base = shrink(source, x, y, w, h, 2, 2)
        ctx.drawImage(base, 0, 0, 2, 2, x - 1, y - 1, w + 2, h + 2)
        ctx.filter = `blur(${radius}px)`
        ctx.drawImage(source, sx, sy, sw, sh, sx, sy, sw, sh)
        ctx.filter = 'none'
      } else {
        // 필터를 지원하지 않는 브라우저: 크게 줄였다가 부드럽게 늘려 흐린다.
        const tw = Math.max(2, Math.round(sw / radius))
        const th = Math.max(2, Math.round(sh / radius))
        const small = shrink(source, sx, sy, sw, sh, tw, th)
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(small, 0, 0, tw, th, sx, sy, sw, sh)
      }
    }
    ctx.restore()
  }
}

/** 원본 크기로 결과 캔버스를 만든다(저장용). */
export function renderResult(source: Source, regions: Region[], drawWatermark?: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): HTMLCanvasElement {
  const canvas = makeCanvas(source.width, source.height)
  const ctx = ctx2d(canvas)
  ctx.drawImage(source, 0, 0)
  applyRegions(ctx, source, regions, 1)
  drawWatermark?.(ctx, canvas.width, canvas.height)
  return canvas
}
