import { useEffect, useState } from 'react'
import { canEncodeWebp } from './sinks'

export interface VideoCodecChoice {
  container: 'mp4' | 'webm'
  /** VideoEncoder 에 넘기는 코덱 문자열 */
  codec: string
}

/** 화소 수에 맞는 H.264 레벨. 720p 까지 3.1, 1080p 까지 4.0, 그 위는 5.1 */
export function h264Candidates(width: number, height: number): string[] {
  const pixels = width * height
  const level = pixels <= 1280 * 720 ? '1f' : pixels <= 1920 * 1088 ? '28' : '33'
  // High → Main → Baseline 순으로 시도한다.
  return [`avc1.6400${level}`, `avc1.4d00${level}`, `avc1.4200${level}`]
}

const WEBM_CANDIDATES = ['vp09.00.40.08', 'vp8']

function hasWebCodecs(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined'
}

async function supported(config: VideoEncoderConfig): Promise<boolean> {
  try {
    return (await VideoEncoder.isConfigSupported(config)).supported === true
  } catch {
    return false
  }
}

/** 주어진 출력 조건으로 쓸 수 있는 영상 인코더를 고른다. MP4(H.264)가 안 되면 WebM, 둘 다 안 되면 null. */
export async function pickVideoCodec(width: number, height: number, fps: number, bitrate: number): Promise<VideoCodecChoice | null> {
  if (!hasWebCodecs()) return null
  for (const codec of h264Candidates(width, height)) {
    if (await supported({ codec, width, height, bitrate, framerate: fps, avc: { format: 'avc' } })) return { container: 'mp4', codec }
  }
  for (const codec of WEBM_CANDIDATES) {
    if (await supported({ codec, width, height, bitrate, framerate: fps })) return { container: 'webm', codec }
  }
  return null
}

export interface EncodeSupport {
  /** MP4 를 골랐을 때 실제로 나오는 형식. null 이면 영상 저장 불가 */
  video: 'mp4' | 'webm' | null
  webp: boolean
}

let cached: Promise<EncodeSupport> | null = null

/** 이 브라우저가 만들 수 있는 형식(대표 크기 1280×720 기준으로 확인) */
export function detectEncodeSupport(): Promise<EncodeSupport> {
  cached ??= (async () => {
    const choice = await pickVideoCodec(1280, 720, 30, 2_000_000)
    return { video: choice?.container ?? null, webp: canEncodeWebp() }
  })()
  return cached
}

/** 확인이 끝나기 전에는 null */
export function useEncodeSupport(): EncodeSupport | null {
  const [support, setSupport] = useState<EncodeSupport | null>(null)
  useEffect(() => {
    let alive = true
    detectEncodeSupport().then((s) => alive && setSupport(s))
    return () => {
      alive = false
    }
  }, [])
  return support
}
