/**
 * 손글씨 선 — 빠르게 그으면 가늘고 천천히 그으면 굵어지는 필압 느낌의 선을 만든다.
 * 좌표는 그리기 판의 너비를 1 로 본 정규화 값이라 해상도와 무관하게 다시 그릴 수 있다.
 */

export interface InkPoint {
  x: number
  y: number
  /** 시각(ms) */
  t: number
  /** 펜의 실제 필압(0–1). 마우스·손가락은 없음 */
  p?: number
}

export type Stroke = InkPoint[]

export interface InkStyle {
  /** 가장 굵을 때의 선 굵기(판 너비 대비) */
  maxWidth: number
  /** 가장 가늘 때의 비율(0–1) */
  thin: number
}

export const DEFAULT_INK: InkStyle = { maxWidth: 0.012, thin: 0.35 }

/** 너무 가까운 점은 버려 손떨림을 줄인다 */
export function shouldAddPoint(stroke: Stroke, next: InkPoint, minDist = 0.002): boolean {
  const last = stroke[stroke.length - 1]
  if (!last) return true
  return Math.hypot(next.x - last.x, next.y - last.y) >= minDist
}

/**
 * 점마다 선 굵기를 정한다. 펜 필압이 있으면 그것을, 없으면 속도를 쓴다.
 * 속도는 지수 평활해 굵기가 갑자기 바뀌지 않게 한다.
 */
export function strokeWidths(stroke: Stroke, style: InkStyle = DEFAULT_INK): number[] {
  const n = stroke.length
  if (n === 0) return []
  const maxW = style.maxWidth
  const minW = style.maxWidth * style.thin
  const hasPressure = stroke.some((p) => p.p != null && p.p > 0 && p.p !== 0.5)
  const widths: number[] = new Array(n)
  let velocity = 0
  let prevWidth = (maxW + minW) / 2
  for (let i = 0; i < n; i++) {
    const cur = stroke[i]
    let target: number
    if (hasPressure) {
      target = minW + (maxW - minW) * Math.min(1, Math.max(0, cur.p ?? 0.5))
    } else if (i === 0) {
      target = prevWidth
    } else {
      const prev = stroke[i - 1]
      const dt = Math.max(1, cur.t - prev.t)
      // 판 너비/초 단위 속도
      const v = (Math.hypot(cur.x - prev.x, cur.y - prev.y) / dt) * 1000
      velocity = 0.7 * v + 0.3 * velocity
      target = Math.max(minW, maxW / (1 + velocity * 0.9))
    }
    // 이웃 점과 굵기가 크게 다르지 않게
    const w = i === 0 ? target : prevWidth + (target - prevWidth) * 0.5
    widths[i] = Math.min(maxW, Math.max(minW, w))
    prevWidth = widths[i]
  }
  // 획의 끝은 살짝 가늘게 빠진다
  if (!hasPressure && n > 3) {
    widths[n - 1] = Math.max(minW, widths[n - 1] * 0.7)
    widths[n - 2] = Math.max(minW, widths[n - 2] * 0.88)
  }
  return widths
}

export interface InkDot {
  x: number
  y: number
  /** 반지름 */
  r: number
}

/**
 * 획을 부드러운 곡선 위의 원들로 바꾼다. 점 사이는 중점을 잇는 2차 곡선으로 보간한다.
 * 원 사이 간격은 반지름의 절반 이하라 이어진 선으로 보인다.
 */
export function strokeDots(stroke: Stroke, style: InkStyle = DEFAULT_INK): InkDot[] {
  const n = stroke.length
  if (n === 0) return []
  const widths = strokeWidths(stroke, style)
  if (n === 1) return [{ x: stroke[0].x, y: stroke[0].y, r: (style.maxWidth * 0.75) / 2 }]
  const dots: InkDot[] = []
  const mid = (a: InkPoint, b: InkPoint) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

  const curve = (x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, w0: number, w1: number) => {
    const length = Math.hypot(cx - x0, cy - y0) + Math.hypot(x1 - cx, y1 - cy)
    const spacing = Math.max(0.0004, Math.min(w0, w1) / 4)
    const steps = Math.max(1, Math.ceil(length / spacing))
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      const u = 1 - t
      dots.push({
        x: u * u * x0 + 2 * u * t * cx + t * t * x1,
        y: u * u * y0 + 2 * u * t * cy + t * t * y1,
        r: (w0 + (w1 - w0) * t) / 2,
      })
    }
  }

  // 첫 점 → 첫 중점(직선)
  const m0 = mid(stroke[0], stroke[1])
  const wMid = (i: number) => (widths[i] + widths[i + 1]) / 2
  curve(stroke[0].x, stroke[0].y, (stroke[0].x + m0.x) / 2, (stroke[0].y + m0.y) / 2, m0.x, m0.y, widths[0], wMid(0))
  for (let i = 1; i < n - 1; i++) {
    const a = mid(stroke[i - 1], stroke[i])
    const b = mid(stroke[i], stroke[i + 1])
    curve(a.x, a.y, stroke[i].x, stroke[i].y, b.x, b.y, wMid(i - 1), wMid(i))
  }
  // 마지막 중점 → 마지막 점
  const ml = mid(stroke[n - 2], stroke[n - 1])
  curve(ml.x, ml.y, (ml.x + stroke[n - 1].x) / 2, (ml.y + stroke[n - 1].y) / 2, stroke[n - 1].x, stroke[n - 1].y, wMid(n - 2), widths[n - 1])
  return dots
}

/** 획들을 캔버스에 그린다. 캔버스 너비가 정규화 좌표 1 에 해당한다. */
export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], style: InkStyle, canvasWidth: number, color = '#000') {
  ctx.fillStyle = color
  for (const stroke of strokes) {
    const dots = strokeDots(stroke, style)
    ctx.beginPath()
    for (const d of dots) {
      const x = d.x * canvasWidth
      const y = d.y * canvasWidth
      const r = Math.max(0.5, d.r * canvasWidth)
      ctx.moveTo(x + r, y)
      ctx.arc(x, y, r, 0, Math.PI * 2)
    }
    ctx.fill()
  }
}
