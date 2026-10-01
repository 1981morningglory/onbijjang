import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { ctx2d, makeCanvas } from '@/lib/image'
import { drawStrokes, shouldAddPoint, type InkPoint, type InkStyle, type Stroke } from './ink'
import { trimCanvas } from './raster'

/** 가로 2 : 세로 1 의 그리기 판. 좌표는 판 너비를 1 로 본 값으로 저장한다. */
const PAD_RATIO = 0.5

export function DrawPad({ strokes, onChange, style, color }: { strokes: Stroke[]; onChange: (next: Stroke[]) => void; style: InkStyle; color: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const current = useRef<Stroke | null>(null)
  const frame = useRef(0)
  const latest = useRef({ strokes, style, color })
  latest.current = { strokes, style, color }

  const paint = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = ctx2d(canvas)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const all = current.current ? [...latest.current.strokes, current.current] : latest.current.strokes
    drawStrokes(ctx, all, latest.current.style, canvas.width, latest.current.color)
  }
  const schedule = () => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(paint)
  }

  // 판 크기에 맞춰 캔버스 해상도를 맞춘다
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const fit = () => {
      const dpr = Math.min(3, window.devicePixelRatio || 1)
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
      if (canvas.width !== w) {
        canvas.width = w
        canvas.height = Math.round(w * PAD_RATIO)
      }
      paint()
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(canvas)
    return () => {
      ro.disconnect()
      cancelAnimationFrame(frame.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(schedule)

  const pointOf = (e: PointerEvent | ReactPointerEvent): InkPoint => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.width,
      t: e.timeStamp,
      p: e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : undefined,
    }
  }

  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // 캡처 없이도 판 위에서는 그릴 수 있다
    }
    current.current = [pointOf(e)]
    schedule()
  }
  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const stroke = current.current
    if (!stroke) return
    const native = e.nativeEvent
    const events = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : []
    for (const ev of events.length ? events : [native]) {
      const p = pointOf(ev)
      if (shouldAddPoint(stroke, p)) stroke.push(p)
    }
    schedule()
  }
  const onUp = () => {
    const stroke = current.current
    if (!stroke) return
    current.current = null
    onChange([...latest.current.strokes, stroke])
  }

  return (
    <div className="relative overflow-hidden rounded-md border border-line-strong bg-surface">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="서명을 쓰는 곳. 마우스나 손가락, 펜으로 씁니다."
        className="block aspect-[2/1] w-full cursor-crosshair touch-none"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />
      {/* 글씨 기준선 */}
      <div className="pointer-events-none absolute inset-x-4 top-[72%] border-b border-dashed border-line-strong" />
      {strokes.length === 0 && <p className="pointer-events-none absolute inset-x-0 top-[34%] text-center text-sm text-faint">여기에 서명을 써 주세요</p>}
    </div>
  )
}

/** 획들을 고해상도 검은색 이미지로 만든다(가장자리 여백 제거). 내용이 없으면 null. */
export function strokesToCanvas(strokes: Stroke[], style: InkStyle, width = 1600): HTMLCanvasElement | null {
  if (!strokes.length) return null
  const canvas = makeCanvas(width, width * PAD_RATIO)
  drawStrokes(ctx2d(canvas), strokes, style, canvas.width, '#000')
  return trimCanvas(canvas, 8)
}
