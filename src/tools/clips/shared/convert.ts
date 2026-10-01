import type { WatermarkSettings } from '@/app/config'
import { isCanvasSizeSafe, makeCanvas } from '@/lib/image'
import { prepareWatermark } from '@/lib/watermark'
import { seekTo } from './frameSource'
import { computeLayout, drawFrame, type FrameLayout } from './layout'
import { AbortError, createGifSink, createWebpSink, type FrameSink } from './sinks'
import { frameTimes } from './time'
import { effectiveSize, resolveBitrate, type OutputSettings } from './types'
import { createVideoSink } from './videoSink'

export interface ConvertJob {
  /** openVideo 로 연 영상(변환 전용 — 화면에 보이는 플레이어와 따로 쓴다) */
  video: HTMLVideoElement
  start: number
  end: number
  output: OutputSettings
  watermark: WatermarkSettings
  signal: AbortSignal
  /** 0–1 */
  onProgress?: (fraction: number) => void
}

export interface ConvertResult {
  blob: Blob
  /** 실제 형식 — MP4 를 골라도 브라우저에 따라 webm 일 수 있다 */
  kind: FrameSink['kind']
  ext: string
  width: number
  height: number
  frames: number
  seconds: number
}

export const NO_VIDEO_ENCODER = '이 브라우저는 영상(MP4·WebM) 저장을 지원하지 않습니다. GIF 로 바꾸거나 최신 크롬·엣지에서 열어 주세요.'

/** 출력 설정에 따른 캔버스 배치. 영상 형식은 짝수 크기로 맞춘다. */
export function layoutFor(srcW: number, srcH: number, output: OutputSettings): FrameLayout {
  const { longSide } = effectiveSize(output)
  return computeLayout(srcW, srcH, { aspect: output.aspect, fit: output.fit, longSide, even: output.format === 'mp4' })
}

export async function createSinkFor(output: OutputSettings, layout: FrameLayout, seconds: number): Promise<FrameSink> {
  const { fps } = effectiveSize(output)
  if (output.format === 'gif') return createGifSink({ width: layout.width, height: layout.height, quality: output.gifQuality })
  if (output.format === 'webp') return createWebpSink({ width: layout.width, height: layout.height, quality: output.gifQuality })
  const bitrate = resolveBitrate(output, layout.width, layout.height, fps)
  const sink = await createVideoSink({ width: layout.width, height: layout.height, fps, bitrate, expectedSeconds: seconds })
  if (!sink) throw new Error(NO_VIDEO_ENCODER)
  return sink
}

/** 영상의 한 구간을 프레임 단위로 읽어 출력 틀·워터마크를 입히고 파일 하나로 만든다. */
export async function convertRange(job: ConvertJob): Promise<ConvertResult> {
  const { video, output, signal } = job
  if (signal.aborted) throw new AbortError()
  const layout = layoutFor(video.videoWidth, video.videoHeight, output)
  if (!isCanvasSizeSafe(layout.width, layout.height)) throw new Error('출력 크기가 너무 큽니다. 긴 변을 줄여 주세요.')
  const { fps } = effectiveSize(output)
  const times = frameTimes(job.start, job.end, fps)
  const seconds = times.length / fps

  const canvas = makeCanvas(layout.width, layout.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: output.format === 'gif', alpha: false })
  if (!ctx) throw new Error('캔버스를 만들 수 없습니다. 출력 크기를 줄여 주세요.')
  ctx.imageSmoothingQuality = 'high'
  const drawMark = await prepareWatermark(job.watermark)
  const sink = await createSinkFor(output, layout, seconds)
  const stepMs = 1000 / fps
  // 인코더가 밀려 기다리는 중에도 취소가 바로 먹도록 한다.
  const onAbort = () => sink.close()
  signal.addEventListener('abort', onAbort)

  try {
    for (let i = 0; i < times.length; i++) {
      if (signal.aborted) throw new AbortError()
      // 프레임 경계에서 앞 프레임이 잡히지 않도록 아주 조금 안쪽을 읽는다.
      await seekTo(video, times[i] + 0.001, signal)
      drawFrame(ctx, video, layout, output.padColor)
      drawMark(ctx, layout.width, layout.height)
      await sink.add(canvas, i * stepMs)
      job.onProgress?.((i + 1) / (times.length + 1))
    }
    if (signal.aborted) throw new AbortError()
    const blob = await sink.finish(times.length * stepMs)
    job.onProgress?.(1)
    return { blob, kind: sink.kind, ext: sink.ext, width: layout.width, height: layout.height, frames: times.length, seconds }
  } finally {
    signal.removeEventListener('abort', onAbort)
    sink.close()
  }
}
