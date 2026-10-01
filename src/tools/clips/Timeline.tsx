import clsx from 'clsx'
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { tickStep, tickTimes, timeAt, type ClipRange } from './ranges'
import { useCurrentTime } from './shared/player'
import { formatTime } from './shared/time'

export interface TimelineProps {
  video: HTMLVideoElement | null
  duration: number
  ranges: ClipRange[]
  activeId: string | null
  /** 시작만 찍어 둔 지점 */
  pendingStart: number | null
  /** 1 = 전체가 한눈에, 클수록 확대 */
  zoom: number
  onSeek: (time: number) => void
  onSelect: (id: string) => void
  onEdge: (id: string, edge: 'start' | 'end', time: number) => void
}

type Drag = { kind: 'seek' } | { kind: 'edge'; id: string; edge: 'start' | 'end' }

/** 영상 전체를 한 줄로 보여 주는 타임라인. 빈 곳을 누르거나 끌면 이동, 구간 양 끝 손잡이를 끌면 길이 조절. */
export function Timeline({ video, duration, ranges, activeId, pendingStart, zoom, onSeek, onSelect, onEdge }: TimelineProps) {
  const time = useCurrentTime(video)
  const scroller = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const pct = (t: number) => `${(Math.min(Math.max(0, t), duration) / duration) * 100}%`

  // 확대해 둔 상태에서 재생 위치가 화면 밖으로 나가면 따라간다.
  useEffect(() => {
    const el = scroller.current
    if (!el || zoom <= 1 || drag.current) return
    const x = (time / duration) * el.scrollWidth
    if (x < el.scrollLeft + 24 || x > el.scrollLeft + el.clientWidth - 24) el.scrollLeft = Math.max(0, x - el.clientWidth / 3)
  }, [time, duration, zoom])

  const timeFromEvent = (e: { clientX: number }) => {
    const rect = track.current!.getBoundingClientRect()
    return timeAt((e.clientX - rect.left) / rect.width, duration)
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    const edge = target.dataset.edge as 'start' | 'end' | undefined
    const id = target.closest<HTMLElement>('[data-range]')?.dataset.range
    if (id) onSelect(id)
    if (edge && id) {
      drag.current = { kind: 'edge', id, edge }
    } else {
      drag.current = { kind: 'seek' }
      onSeek(timeFromEvent(e))
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const t = timeFromEvent(e)
    if (d.kind === 'seek') onSeek(t)
    else {
      onEdge(d.id, d.edge, t)
      onSeek(t)
    }
  }
  const endDrag = () => {
    drag.current = null
  }

  const step = tickStep(duration, zoom)
  const ticks = tickTimes(duration, step)

  return (
    <div ref={scroller} className="overflow-x-auto pb-1">
      <div style={{ width: `${zoom * 100}%` }} className="min-w-full">
        <div className="relative h-5 select-none" aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="num absolute top-0 border-l border-line-strong pl-1 text-2xs leading-5 text-muted" style={{ left: pct(t) }}>
              {formatTime(t, step < 1)}
            </span>
          ))}
        </div>
        <div
          ref={track}
          role="slider"
          tabIndex={0}
          aria-label="재생 위치"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={formatTime(time)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="relative h-12 cursor-pointer touch-none rounded-sm border border-line-strong bg-sunken select-none focus-visible:ring-3 focus-visible:ring-brand/30"
        >
          {ranges.map((r) => {
            const active = r.id === activeId
            return (
              <div
                key={r.id}
                data-range={r.id}
                title={`${r.name} ${formatTime(r.start)}–${formatTime(r.end)}`}
                className={clsx(
                  'absolute top-1.5 bottom-1.5 min-w-1 overflow-hidden rounded-xs border transition-colors duration-150',
                  active ? 'z-10 border-ink bg-mark' : r.selected ? 'border-brand bg-brand/30 hover:bg-brand/45' : 'border-line-strong bg-line hover:bg-line-strong',
                )}
                style={{ left: pct(r.start), width: `${((r.end - r.start) / duration) * 100}%` }}
              >
                <span className="pointer-events-none block truncate px-2.5 text-2xs leading-[34px] font-semibold text-ink">{r.name}</span>
                <span data-edge="start" className={clsx('absolute inset-y-0 left-0 w-2 cursor-ew-resize', active ? 'bg-ink' : 'bg-brand')} />
                <span data-edge="end" className={clsx('absolute inset-y-0 right-0 w-2 cursor-ew-resize', active ? 'bg-ink' : 'bg-brand')} />
              </div>
            )
          })}
          {pendingStart != null && (
            <div className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-brand" style={{ left: pct(pendingStart) }}>
              <span className="absolute top-0 left-0.5 rounded-r-xs bg-brand px-1 text-2xs leading-4 font-bold whitespace-nowrap text-on-brand">시작</span>
            </div>
          )}
          <div className="pointer-events-none absolute -top-1 -bottom-1 z-30 w-0.5 -translate-x-1/2 bg-accent" style={{ left: pct(time) }}>
            <span className="absolute -top-0.5 left-1/2 size-2.5 -translate-x-1/2 rounded-full bg-accent" />
          </div>
        </div>
      </div>
    </div>
  )
}
