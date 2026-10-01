import { pickVideoCodec } from './capabilities'
import { AbortError, type FrameSink } from './sinks'

export interface VideoSinkOptions {
  width: number
  height: number
  fps: number
  bitrate: number
  /** 예상 길이(초). 큰 파일은 메모리를 덜 쓰는 방식으로 묶는다. */
  expectedSeconds?: number
}

interface MuxerLike {
  addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void
  finalize(): void
  target: { buffer: ArrayBuffer }
}

/**
 * WebCodecs 로 H.264 를 인코딩해 MP4 로 묶는다. H.264 인코더가 없는 브라우저에서는 VP9/VP8 + WebM.
 * 둘 다 안 되면 null — 호출하는 쪽에서 안내한다.
 */
export async function createVideoSink(opts: VideoSinkOptions): Promise<FrameSink | null> {
  const { width, height, fps, bitrate } = opts
  if (width % 2 || height % 2) throw new Error('영상 크기는 짝수여야 합니다.')
  const choice = await pickVideoCodec(width, height, fps, bitrate)
  if (!choice) return null

  let muxer: MuxerLike
  if (choice.container === 'mp4') {
    const { Muxer, ArrayBufferTarget } = await import('mp4-muxer')
    // 200MB 를 넘길 것 같으면 재생 정보를 파일 끝에 두어 메모리를 한 벌만 쓴다.
    const big = (bitrate * (opts.expectedSeconds ?? 0)) / 8 > 200 * 1024 * 1024
    muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width, height, frameRate: fps }, fastStart: big ? false : 'in-memory' })
  } else {
    const { Muxer, ArrayBufferTarget } = await import('webm-muxer')
    muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: choice.codec.startsWith('vp09') ? 'V_VP9' : 'V_VP8', width, height, frameRate: fps } })
  }

  let failed: Error | null = null
  let closed = false
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      try {
        muxer.addVideoChunk(chunk, meta)
      } catch (err) {
        failed = err instanceof Error ? err : new Error('영상을 묶지 못했습니다.')
      }
    },
    error: (err) => {
      failed = new Error(`영상 인코더 오류: ${err.message}`)
    },
  })
  encoder.configure({
    codec: choice.codec,
    width,
    height,
    bitrate,
    framerate: fps,
    latencyMode: 'quality',
    ...(choice.container === 'mp4' ? { avc: { format: 'avc' as const } } : {}),
  })

  const keyEvery = Math.max(1, Math.round(fps * 2))
  let count = 0
  let lastUs = -1
  const QUEUE_LIMIT = 8

  const waitForRoom = () =>
    new Promise<void>((resolve) => {
      // 인코더가 한 장 처리할 때마다 오는 dequeue 로 깨운다(타이머는 가려진 탭에서 느려진다).
      const done = () => {
        encoder.removeEventListener('dequeue', done)
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(done, 500)
      encoder.addEventListener('dequeue', done)
    })

  return {
    kind: choice.container,
    mime: choice.container === 'mp4' ? 'video/mp4' : 'video/webm',
    ext: choice.container,
    get busy() {
      return encoder.state === 'configured' && encoder.encodeQueueSize >= QUEUE_LIMIT
    },
    async add(canvas, timeMs) {
      if (failed) throw failed
      if (closed) throw new AbortError()
      // 시각은 반드시 앞 프레임보다 커야 한다.
      const us = Math.max(lastUs + 1, Math.round(timeMs * 1000))
      lastUs = us
      const frame = new VideoFrame(canvas, { timestamp: us, duration: Math.round(1_000_000 / fps) })
      try {
        encoder.encode(frame, { keyFrame: count % keyEvery === 0 })
      } finally {
        frame.close()
      }
      count++
      while (!failed && !closed && encoder.encodeQueueSize >= QUEUE_LIMIT) await waitForRoom()
      if (failed) throw failed
      if (closed) throw new AbortError()
    },
    async finish() {
      if (failed) throw failed
      if (closed) throw new AbortError()
      if (!count) throw new Error('프레임이 없습니다.')
      await encoder.flush()
      if (failed) throw failed
      encoder.close()
      closed = true
      muxer.finalize()
      return new Blob([muxer.target.buffer], { type: choice.container === 'mp4' ? 'video/mp4' : 'video/webm' })
    },
    close() {
      if (closed) return
      closed = true
      try {
        if (encoder.state !== 'closed') encoder.close()
      } catch {
        // 이미 닫힌 인코더
      }
    },
  }
}
