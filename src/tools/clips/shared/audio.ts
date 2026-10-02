/**
 * MP4·WebM 으로 바꿀 때 원본의 소리를 함께 담는다.
 * 브라우저에는 파일에서 소리만 조금씩 꺼내는 방법이 없어 파일 전체를 한 번에 풀어야 한다.
 * 그래서 큰 파일(200MB 또는 15분 초과)은 소리 없이 화면만 저장한다.
 */

export const AUDIO_MAX_BYTES = 200 * 1024 * 1024
export const AUDIO_MAX_SECONDS = 15 * 60
const SAMPLE_RATE = 48_000
/** 한 번에 인코더에 넘기는 표본 수(0.1초) */
const BLOCK = 4800

/** 소리를 담을 수 없는 이유. 담을 수 있으면 null. */
export function audioLimitReason(fileBytes: number, seconds: number): string | null {
  if (fileBytes > AUDIO_MAX_BYTES || seconds > AUDIO_MAX_SECONDS) return '원본이 200MB 또는 15분을 넘으면 소리를 담지 못해 화면만 저장합니다.'
  return null
}

export function canEncodeAudio(): boolean {
  return typeof AudioEncoder !== 'undefined' && typeof AudioData !== 'undefined' && typeof OfflineAudioContext !== 'undefined'
}

/** 파일의 소리를 통째로 푼다. 소리가 없거나 풀 수 없는 형식이면 null. */
export async function decodeAudio(file: Blob): Promise<AudioBuffer | null> {
  if (!canEncodeAudio()) return null
  try {
    const data = await file.arrayBuffer()
    const ctx = new OfflineAudioContext(2, 1, SAMPLE_RATE)
    const buffer = await ctx.decodeAudioData(data)
    return buffer.length > 0 && buffer.numberOfChannels > 0 ? buffer : null
  } catch {
    return null
  }
}

/** 구간(초)을 표본 위치로. 버퍼 길이를 넘지 않는다. */
export function sampleRange(sampleRate: number, totalFrames: number, start: number, end: number): { from: number; to: number } {
  const from = Math.min(totalFrames, Math.max(0, Math.round(start * sampleRate)))
  const to = Math.min(totalFrames, Math.max(from, Math.round(end * sampleRate)))
  return { from, to }
}

/**
 * 채널별 표본에서 [from, from+count) 를 꺼내 "채널 순서대로 이어 붙인" 배열로 만든다(f32-planar).
 * 원본이 모노인데 2채널로 내보내면 같은 소리를 양쪽에 넣고, 3채널 이상이면 앞의 두 채널만 쓴다.
 */
export function planarBlock(channels: ArrayLike<number>[], from: number, count: number, outChannels: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(count * outChannels)
  for (let c = 0; c < outChannels; c++) {
    const src = channels[Math.min(c, channels.length - 1)]
    const base = c * count
    for (let i = 0; i < count; i++) out[base + i] = src[from + i] ?? 0
  }
  return out
}

export interface AudioPlan {
  /** AudioEncoder 코덱 문자열 */
  codec: string
  kind: 'aac' | 'opus'
  sampleRate: number
  channels: number
  bitrate: number
}

/** 이 컨테이너에 넣을 수 있고 브라우저가 인코딩할 수 있는 소리 형식을 고른다. 없으면 null. */
export async function planAudio(container: 'mp4' | 'webm', buffer: AudioBuffer): Promise<AudioPlan | null> {
  if (!canEncodeAudio()) return null
  const channels = Math.min(2, buffer.numberOfChannels)
  const bitrate = channels === 1 ? 96_000 : 128_000
  const candidates: Array<[string, AudioPlan['kind']]> = container === 'mp4' ? [['mp4a.40.2', 'aac'], ['opus', 'opus']] : [['opus', 'opus']]
  for (const [codec, kind] of candidates) {
    try {
      const { supported } = await AudioEncoder.isConfigSupported({ codec, sampleRate: buffer.sampleRate, numberOfChannels: channels, bitrate })
      if (supported) return { codec, kind, sampleRate: buffer.sampleRate, channels, bitrate }
    } catch {
      // 다음 후보
    }
  }
  return null
}

/**
 * 풀어 둔 소리의 한 구간을 조금씩 인코딩해 넘긴다.
 * 영상 프레임과 번갈아 파일에 들어가도록, 영상이 진행된 만큼만 feedUntil 로 밀어 넣는다.
 */
export class AudioFeeder {
  private readonly encoder: AudioEncoder
  private readonly channels: Float32Array[]
  private position: number
  private readonly from: number
  private readonly to: number
  private failed: Error | null = null

  constructor(
    buffer: AudioBuffer,
    start: number,
    end: number,
    private readonly plan: AudioPlan,
    onChunk: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => void,
  ) {
    const range = sampleRange(buffer.sampleRate, buffer.length, start, end)
    this.from = range.from
    this.to = range.to
    this.position = range.from
    this.channels = []
    for (let c = 0; c < buffer.numberOfChannels; c++) this.channels.push(buffer.getChannelData(c))
    this.encoder = new AudioEncoder({
      output: (chunk, meta) => {
        try {
          onChunk(chunk, meta)
        } catch (err) {
          this.failed = err instanceof Error ? err : new Error('소리를 묶지 못했습니다.')
        }
      },
      error: (err) => {
        this.failed = new Error(`소리 인코더 오류: ${err.message}`)
      },
    })
    this.encoder.configure({ codec: plan.codec, sampleRate: plan.sampleRate, numberOfChannels: plan.channels, bitrate: plan.bitrate })
  }

  /** 구간 시작에서 seconds 초 지점까지의 소리를 인코더에 넣는다. */
  feedUntil(seconds: number) {
    if (this.failed) throw this.failed
    const target = Math.min(this.to, this.from + Math.round(seconds * this.plan.sampleRate))
    while (this.position < target) {
      const count = Math.min(BLOCK, target - this.position)
      const data = new AudioData({
        format: 'f32-planar',
        sampleRate: this.plan.sampleRate,
        numberOfFrames: count,
        numberOfChannels: this.plan.channels,
        timestamp: Math.round(((this.position - this.from) / this.plan.sampleRate) * 1_000_000),
        data: planarBlock(this.channels, this.position, count, this.plan.channels),
      })
      this.encoder.encode(data)
      data.close()
      this.position += count
    }
  }

  async finish() {
    this.feedUntil(Infinity)
    await this.encoder.flush()
    this.encoder.close()
    if (this.failed) throw this.failed
  }

  close() {
    try {
      if (this.encoder.state !== 'closed') this.encoder.close()
    } catch {
      // 이미 닫힘
    }
  }
}
