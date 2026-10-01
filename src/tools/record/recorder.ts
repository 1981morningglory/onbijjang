import type { WatermarkSettings } from '@/app/config'
import { makeCanvas } from '@/lib/image'
import { prepareWatermark } from '@/lib/watermark'
import { computeLayout, drawFrame, type FrameLayout } from '../clips/shared/layout'
import { createGifSink, isAbort, type FrameSink } from '../clips/shared/sinks'
import type { QualityLevel } from '../clips/shared/types'
import { clampRect, type Rect } from './crop'
import { detectRecorderFormat } from './support'
import { fixWebmDuration } from './webmDuration'

/**
 * 일정한 박자로 onTick 을 부른다. 탭이 가려져도 느려지지 않게 워커의 타이머를 쓴다.
 * 돌려주는 함수를 부르면 멈춘다.
 */
export function createTicker(intervalMs: number, onTick: () => void): () => void {
  try {
    const worker = new Worker(new URL('./ticker.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = onTick
    worker.postMessage({ interval: intervalMs })
    return () => {
      worker.postMessage('stop')
      worker.terminate()
    }
  } catch {
    const timer = setInterval(onTick, intervalMs)
    return () => clearInterval(timer)
  }
}

export interface RecordingOptions {
  mode: 'video' | 'gif'
  /** 공유 화면을 재생 중인 <video> */
  source: HTMLVideoElement
  /** 녹화 영역(공유 화면의 화소 기준) */
  crop: Rect
  /** 결과 긴 변(px). 0 이면 영역 크기 그대로 */
  longSide: number
  fps: number
  /** 영상 비트레이트(bps) */
  bitrate: number
  gifQuality: QualityLevel
  watermark: WatermarkSettings
  /** 함께 담을 소리(마이크·시스템). 영상일 때만 쓴다. */
  audioTracks: MediaStreamTrack[]
  maxMs: number
  onElapsed: (ms: number) => void
  /** 최대 시간에 닿았을 때 한 번 */
  onLimit: () => void
  onError: (err: Error) => void
}

export interface RecordingResult {
  blob: Blob
  kind: 'mp4' | 'webm' | 'gif'
  ext: string
  width: number
  height: number
  ms: number
}

export interface Recording {
  readonly kind: 'mp4' | 'webm' | 'gif'
  readonly width: number
  readonly height: number
  readonly paused: boolean
  pause(): void
  resume(): void
  stop(): Promise<RecordingResult>
  cancel(): void
}

export const NO_RECORDER = '이 브라우저는 영상 녹화를 지원하지 않습니다. GIF 로 바꾸거나 최신 크롬·엣지에서 열어 주세요.'

/** 녹화 도중 공유 화면 크기가 바뀌면(창 크기 조절 등) 같은 캔버스 안에 비율을 지켜 다시 맞춘다. */
function relayout(base: FrameLayout, crop: Rect, vw: number, vh: number): FrameLayout {
  const c = clampRect(crop, vw, vh)
  const s = Math.min(base.width / c.w, base.height / c.h)
  const dw = c.w * s
  const dh = c.h * s
  return { ...base, sx: c.x, sy: c.y, sw: c.w, sh: c.h, dx: (base.width - dw) / 2, dy: (base.height - dh) / 2, dw, dh }
}

export async function startRecording(opts: RecordingOptions): Promise<Recording> {
  const { source, mode } = opts
  let srcW = source.videoWidth
  let srcH = source.videoHeight
  if (!srcW || !srcH) throw new Error('공유 화면이 아직 준비되지 않았습니다. 잠시 뒤 다시 눌러 주세요.')
  const crop = clampRect(opts.crop, srcW, srcH)
  let layout = computeLayout(srcW, srcH, { aspect: 'source', fit: 'pad', longSide: opts.longSide > 0 ? opts.longSide : Infinity, even: mode === 'video', crop })
  const { width, height } = layout
  const canvas = makeCanvas(width, height)
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: mode === 'gif' })
  if (!ctx) throw new Error('녹화용 캔버스를 만들지 못했습니다. 영역이나 해상도를 줄여 주세요.')
  ctx.imageSmoothingQuality = 'high'
  const drawMark = await prepareWatermark(opts.watermark)

  const draw = () => {
    if (source.videoWidth !== srcW || source.videoHeight !== srcH) {
      if (!source.videoWidth || !source.videoHeight) return
      srcW = source.videoWidth
      srcH = source.videoHeight
      layout = relayout(layout, opts.crop, srcW, srcH)
    }
    drawFrame(ctx, source, layout, '#000000')
    drawMark(ctx, width, height)
  }
  draw()

  // ── 인코더 준비 ──
  let sink: FrameSink | null = null
  let recorder: MediaRecorder | null = null
  let audioContext: AudioContext | null = null
  let canvasTrack: MediaStreamTrack | null = null
  const chunks: Blob[] = []
  let kind: Recording['kind'] = 'gif'

  if (mode === 'gif') {
    sink = createGifSink({ width, height, quality: opts.gifQuality })
  } else {
    const liveAudio = opts.audioTracks.filter((t) => t.readyState === 'live')
    const format = detectRecorderFormat(liveAudio.length > 0)
    if (!format) throw new Error(NO_RECORDER)
    kind = format.kind
    canvasTrack = canvas.captureStream(opts.fps).getVideoTracks()[0]
    const tracks: MediaStreamTrack[] = [canvasTrack]
    if (liveAudio.length === 1) {
      tracks.push(liveAudio[0])
    } else if (liveAudio.length > 1) {
      // MediaRecorder 는 소리 한 줄만 담으므로 마이크와 시스템 소리를 하나로 섞는다.
      audioContext = new AudioContext()
      const mixed = audioContext.createMediaStreamDestination()
      for (const t of liveAudio) audioContext.createMediaStreamSource(new MediaStream([t])).connect(mixed)
      void audioContext.resume().catch(() => undefined)
      tracks.push(mixed.stream.getAudioTracks()[0])
    }
    recorder = new MediaRecorder(new MediaStream(tracks), { mimeType: format.mimeType, videoBitsPerSecond: opts.bitrate, audioBitsPerSecond: 128_000 })
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data)
    }
    recorder.onerror = () => opts.onError(new Error('녹화 중 인코더에 문제가 생겼습니다. 해상도를 낮춰 다시 시도해 주세요.'))
    recorder.start(1000)
  }

  // ── 시계(일시정지한 시간은 빼고 센다) ──
  let accumulated = 0
  let since = performance.now()
  let paused = false
  let ended = false
  let limitHit = false
  let lastReport = -1000
  const elapsed = () => accumulated + (paused ? 0 : performance.now() - since)

  const tick = () => {
    if (ended || paused) return
    try {
      draw()
    } catch {
      return // 공유가 막 끊긴 순간 등 — 다음 박자에 다시 시도
    }
    const ms = elapsed()
    if (sink && !sink.busy) {
      sink.add(canvas, ms).catch((err) => {
        if (!ended && !isAbort(err)) opts.onError(err instanceof Error ? err : new Error('GIF 를 만들지 못했습니다.'))
      })
    }
    if (ms - lastReport >= 200) {
      lastReport = ms
      opts.onElapsed(ms)
    }
    if (ms >= opts.maxMs && !limitHit) {
      limitHit = true
      opts.onLimit()
    }
  }
  if (sink) void sink.add(canvas, 0).catch(() => undefined)
  const stopTicker = createTicker(1000 / opts.fps, tick)

  const release = () => {
    stopTicker()
    canvasTrack?.stop()
    void audioContext?.close().catch(() => undefined)
  }

  return {
    kind,
    width,
    height,
    get paused() {
      return paused
    },
    pause() {
      if (ended || paused) return
      accumulated = elapsed()
      paused = true
      if (recorder?.state === 'recording') recorder.pause()
    },
    resume() {
      if (ended || !paused) return
      since = performance.now()
      paused = false
      if (recorder?.state === 'paused') recorder.resume()
    },
    async stop() {
      if (ended) throw new Error('이미 끝난 녹화입니다.')
      const ms = Math.min(elapsed(), opts.maxMs + 1000)
      ended = true
      try {
        if (sink) {
          const blob = await sink.finish(Math.max(ms, 50))
          return { blob, kind: 'gif', ext: 'gif', width, height, ms }
        }
        const rec = recorder!
        await new Promise<void>((resolve) => {
          if (rec.state === 'inactive') return resolve()
          rec.onstop = () => resolve()
          rec.stop()
        })
        if (!chunks.length) throw new Error('녹화된 내용이 없습니다. 조금 더 길게 녹화해 주세요.')
        let blob = new Blob(chunks, { type: kind === 'mp4' ? 'video/mp4' : 'video/webm' })
        if (kind === 'webm') blob = await fixWebmDuration(blob, ms)
        return { blob, kind, ext: kind, width, height, ms }
      } finally {
        release()
      }
    },
    cancel() {
      if (ended) return
      ended = true
      sink?.close()
      try {
        if (recorder && recorder.state !== 'inactive') recorder.stop()
      } catch {
        // 이미 멈춘 녹화기
      }
      release()
    },
  }
}
