import type { AspectMode, FitMode } from './types'

/** 원본의 어느 부분(s*)을 출력 캔버스의 어디(d*)에 그릴지 */
export interface FrameLayout {
  width: number
  height: number
  sx: number
  sy: number
  sw: number
  sh: number
  dx: number
  dy: number
  dw: number
  dh: number
}

export interface LayoutOptions {
  aspect: AspectMode
  fit: FitMode
  /** 출력 긴 변 한도(px). Infinity 면 줄이지 않는다. 원본보다 키우지는 않는다. */
  longSide: number
  /** 영상 인코더는 짝수 크기만 받는다 */
  even?: boolean
  /** 원본 안에서 쓸 영역(녹화 영역 지정). 없으면 전체 */
  crop?: { x: number; y: number; w: number; h: number }
}

const RATIO: Record<Exclude<AspectMode, 'source'>, number> = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1 }

function toEven(n: number): number {
  const r = Math.max(2, Math.round(n))
  return r % 2 === 0 ? r : r - 1 >= 2 ? r - 1 : r + 1
}

/** 출력 틀(비율·맞춤·긴 변)에 따른 캔버스 크기와 그릴 위치를 계산한다. */
export function computeLayout(srcW: number, srcH: number, opts: LayoutOptions): FrameLayout {
  const crop = opts.crop ?? { x: 0, y: 0, w: srcW, h: srcH }
  const cw = Math.max(1, crop.w)
  const ch = Math.max(1, crop.h)
  const srcRatio = cw / ch
  const ratio = opts.aspect === 'source' ? srcRatio : RATIO[opts.aspect]

  // 줄이기 전 틀 크기: 여백 추가는 원본을 감싸고, 꽉 채우기는 원본 안에 들어간다.
  let boxW: number
  let boxH: number
  if (opts.aspect === 'source') {
    boxW = cw
    boxH = ch
  } else if ((opts.fit === 'pad') === srcRatio > ratio) {
    boxW = cw
    boxH = cw / ratio
  } else {
    boxH = ch
    boxW = ch * ratio
  }

  const limit = opts.longSide > 0 ? opts.longSide : Infinity
  const scale = Math.min(1, limit / Math.max(boxW, boxH))
  let width = Math.max(1, Math.round(boxW * scale))
  let height = Math.max(1, Math.round(boxH * scale))
  if (opts.even) {
    width = toEven(width)
    height = toEven(height)
  }

  if (opts.aspect === 'source' || opts.fit === 'cover') {
    // 캔버스를 가득 채운다. 비율이 다르면 원본 가운데를 잘라 쓴다.
    const outRatio = width / height
    let sw = cw
    let sh = ch
    if (srcRatio > outRatio) sw = ch * outRatio
    else sh = cw / outRatio
    return { width, height, sx: crop.x + (cw - sw) / 2, sy: crop.y + (ch - sh) / 2, sw, sh, dx: 0, dy: 0, dw: width, dh: height }
  }

  const s = Math.min(width / cw, height / ch)
  const dw = cw * s
  const dh = ch * s
  return { width, height, sx: crop.x, sy: crop.y, sw: cw, sh: ch, dx: (width - dw) / 2, dy: (height - dh) / 2, dw, dh }
}

/** 계산한 배치대로 한 프레임을 그린다. 여백이 있으면 먼저 색을 칠한다. */
export function drawFrame(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  source: CanvasImageSource,
  layout: FrameLayout,
  padColor: string,
) {
  const padded = layout.dx > 0.01 || layout.dy > 0.01 || layout.dw < layout.width - 0.01 || layout.dh < layout.height - 0.01
  if (padded) {
    ctx.fillStyle = padColor
    ctx.fillRect(0, 0, layout.width, layout.height)
  }
  ctx.drawImage(source, layout.sx, layout.sy, layout.sw, layout.sh, layout.dx, layout.dy, layout.dw, layout.dh)
}
