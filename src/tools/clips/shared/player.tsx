import { useEffect, useRef, useState } from 'react'
import type { WatermarkSettings } from '@/app/config'
import { prepareWatermark } from '@/lib/watermark'
import { layoutFor } from './convert'
import { drawFrame } from './layout'
import type { OutputSettings } from './types'

/** 재생 위치를 화면에 따라오게 한다. 재생 중에는 매 프레임, 멈춰 있을 때는 이동할 때만 갱신한다. */
export function useCurrentTime(video: HTMLVideoElement | null): number {
  const [time, setTime] = useState(0)
  useEffect(() => {
    if (!video) return
    let raf = 0
    const sync = () => setTime(video.currentTime)
    const loop = () => {
      sync()
      if (!video.paused && !video.ended) raf = requestAnimationFrame(loop)
    }
    const onPlay = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(loop)
    }
    const events = ['seeking', 'seeked', 'timeupdate', 'pause', 'loadeddata', 'ended'] as const
    events.forEach((n) => video.addEventListener(n, sync))
    video.addEventListener('play', onPlay)
    sync()
    if (!video.paused) onPlay()
    return () => {
      cancelAnimationFrame(raf)
      events.forEach((n) => video.removeEventListener(n, sync))
      video.removeEventListener('play', onPlay)
    }
  }, [video])
  return time
}

export function usePlaying(video: HTMLVideoElement | null): boolean {
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    if (!video) return
    const sync = () => setPlaying(!video.paused && !video.ended)
    const events = ['play', 'pause', 'ended', 'emptied'] as const
    events.forEach((n) => video.addEventListener(n, sync))
    sync()
    return () => events.forEach((n) => video.removeEventListener(n, sync))
  }, [video])
  return playing
}

/**
 * 지금 보고 있는 장면에 출력 틀·워터마크를 입힌 모습. 실제 변환과 같은 그리기 코드를 쓴다.
 * 화면에 보이는 플레이어(video)의 현재 프레임을 읽는다.
 */
export function FramePreview({ video, output, watermark }: { video: HTMLVideoElement | null; output: OutputSettings; watermark: WatermarkSettings }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!video) return
    let alive = true
    let queued = false
    let drawMark: Awaited<ReturnType<typeof prepareWatermark>> | null = null
    const draw = () => {
      queued = false
      const canvas = canvasRef.current
      if (!alive || !canvas || !drawMark || video.readyState < 2 || !video.videoWidth) return
      const layout = layoutFor(video.videoWidth, video.videoHeight, output)
      if (canvas.width !== layout.width || canvas.height !== layout.height) {
        canvas.width = layout.width
        canvas.height = layout.height
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.imageSmoothingQuality = 'high'
      drawFrame(ctx, video, layout, output.padColor)
      drawMark(ctx, layout.width, layout.height)
    }
    // 재생 중 잦은 갱신은 한 프레임에 한 번으로 모은다.
    const request = () => {
      if (queued) return
      queued = true
      requestAnimationFrame(draw)
    }
    prepareWatermark(watermark)
      .catch(() => null)
      .then((fn) => {
        if (!alive) return
        drawMark = fn ?? (() => undefined)
        request()
      })
    const events = ['seeked', 'timeupdate', 'loadeddata', 'pause'] as const
    events.forEach((n) => video.addEventListener(n, request))
    return () => {
      alive = false
      events.forEach((n) => video.removeEventListener(n, request))
    }
  }, [video, output, watermark])

  return (
    <div className="flex justify-center rounded-md border border-line bg-sunken p-2">
      <canvas ref={canvasRef} width={320} height={180} className="max-h-48 max-w-full rounded-xs shadow-1" aria-label="결과 미리보기" />
    </div>
  )
}
