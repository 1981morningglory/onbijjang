import type { Pos9, WatermarkSettings } from '@/app/config'
import { hexToRgb, loadImageElement } from './image'

const logoCache = new Map<string, Promise<HTMLImageElement>>()

/** 워터마크 로고(data URL)를 한 번만 디코딩해 재사용한다. */
export function loadWatermarkLogo(dataUrl: string): Promise<HTMLImageElement> {
  let p = logoCache.get(dataUrl)
  if (!p) {
    p = loadImageElement(dataUrl)
    logoCache.set(dataUrl, p)
  }
  return p
}

function anchor(pos: Pos9, w: number, h: number, bw: number, bh: number, margin: number): { x: number; y: number } {
  const col = pos[1]
  const row = pos[0]
  const x = col === 'l' ? margin : col === 'c' ? (w - bw) / 2 : w - bw - margin
  const y = row === 't' ? margin : row === 'm' ? (h - bh) / 2 : h - bh - margin
  return { x, y }
}

/**
 * 캔버스에 워터마크를 그린다. 이미지·GIF 프레임·녹화 프레임 어디서나 같은 결과가 나오도록 공통으로 쓴다.
 * logo 는 kind 가 'logo' 일 때만 필요하다(loadWatermarkLogo 로 미리 준비).
 */
export function drawWatermark(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  wm: WatermarkSettings,
  logo?: CanvasImageSource & { width: number; height: number },
) {
  if (!wm.enabled) return
  const short = Math.min(width, height)
  const margin = Math.min(wm.margin, short / 4)
  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, wm.opacity / 100))
  if (wm.kind === 'logo') {
    if (logo) {
      const bw = Math.max(8, (short * wm.sizePct * 4) / 100)
      const bh = (bw * logo.height) / logo.width
      const { x, y } = anchor(wm.position, width, height, bw, bh, margin)
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(logo, x, y, bw, bh)
    }
  } else if (wm.text.trim()) {
    const size = Math.max(10, (short * wm.sizePct) / 100)
    ctx.font = `700 ${size}px 'Pretendard Variable', Pretendard, 'Malgun Gothic', sans-serif`
    ctx.textBaseline = 'top'
    const lines = wm.text.split('\n')
    const lineH = size * 1.25
    const bw = Math.max(...lines.map((l) => ctx.measureText(l).width))
    const bh = lineH * lines.length
    const { x, y } = anchor(wm.position, width, height, bw, bh, margin)
    const { r, g, b } = hexToRgb(wm.color)
    // 밝은 글자에는 어두운 그림자, 어두운 글자에는 밝은 그림자 — 어떤 사진 위에서도 읽히도록
    const light = r * 0.299 + g * 0.587 + b * 0.114 > 150
    ctx.shadowColor = light ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.55)'
    ctx.shadowBlur = size * 0.18
    ctx.shadowOffsetY = size * 0.04
    ctx.fillStyle = wm.color
    lines.forEach((line, i) => {
      const lw = ctx.measureText(line).width
      const col = wm.position[1]
      const lx = col === 'l' ? x : col === 'c' ? x + (bw - lw) / 2 : x + (bw - lw)
      ctx.fillText(line, lx, y + i * lineH)
    })
  }
  ctx.restore()
}

/** 워터마크를 그릴 준비(로고 디코딩)까지 마친 그리기 함수를 돌려준다. */
export async function prepareWatermark(wm: WatermarkSettings) {
  const logo = wm.enabled && wm.kind === 'logo' && wm.logoDataUrl ? await loadWatermarkLogo(wm.logoDataUrl) : undefined
  return (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, width: number, height: number) =>
    drawWatermark(ctx, width, height, wm, logo)
}
