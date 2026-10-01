import type { GifWorkerRequest, GifWorkerResponse } from './gif.worker'
import type { QualityLevel } from './types'
import { muxAnimatedWebp, type WebpFrame } from './webpMux'

/**
 * 프레임을 받아 파일 하나로 만드는 인코더의 공통 모양.
 * GIF·MP4·WebM·WebP 모두 같은 방식으로 쓴다: add 를 프레임 순서대로 부르고 finish 로 끝낸다.
 */
export interface FrameSink {
  /** 실제로 만들어지는 형식(MP4 를 골라도 브라우저에 따라 webm 이 될 수 있다) */
  readonly kind: 'gif' | 'mp4' | 'webm' | 'webp'
  readonly mime: string
  readonly ext: string
  /** 처리 대기 중인 프레임이 많아 지금 넣으면 밀리는 상태(실시간 녹화에서 프레임을 건너뛸 때 본다) */
  readonly busy: boolean
  /** 캔버스의 현재 내용을 timeMs 시각의 프레임으로 넣는다. 인코더가 밀려 있으면 기다린 뒤 끝난다. */
  add(canvas: HTMLCanvasElement, timeMs: number): Promise<void>
  /** endMs: 마지막 프레임이 끝나는 시각 */
  finish(endMs: number): Promise<Blob>
  /** 취소·정리. 여러 번 불러도 된다. */
  close(): void
}

export class AbortError extends Error {
  constructor() {
    super('취소했습니다.')
    this.name = 'AbortError'
  }
}

export function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

// ── GIF (워커에서 인코딩) ─────────────────────────────────
const GIF_MAX_IN_FLIGHT = 3

export function createGifSink(opts: { width: number; height: number; quality: QualityLevel }): FrameSink {
  const worker = new Worker(new URL('./gif.worker.ts', import.meta.url), { type: 'module' })
  const post = (msg: GifWorkerRequest, transfer: Transferable[] = []) => worker.postMessage(msg, transfer)
  let inFlight = 0
  let failed: Error | null = null
  let closed = false
  let waiters: Array<() => void> = []
  let onDone: ((blob: Blob) => void) | null = null
  let onFail: ((err: Error) => void) | null = null
  // 지연 시간은 다음 프레임 시각이 와야 정해지므로 한 장을 쥐고 있다가 보낸다.
  let held: { data: ArrayBuffer; timeMs: number } | null = null

  const wake = () => {
    const list = waiters
    waiters = []
    list.forEach((w) => w())
  }
  const fail = (err: Error) => {
    failed = err
    onFail?.(err)
    wake()
  }
  worker.onmessage = (e: MessageEvent<GifWorkerResponse>) => {
    const msg = e.data
    if (msg.type === 'ack') {
      inFlight--
      wake()
    } else if (msg.type === 'done') {
      onDone?.(new Blob([msg.data], { type: 'image/gif' }))
    } else {
      fail(new Error(msg.message))
    }
  }
  worker.onerror = (e) => fail(new Error(e.message || 'GIF 인코더를 시작하지 못했습니다.'))
  post({ type: 'init', ...opts })

  const flushHeld = (nextTimeMs: number) => {
    if (!held) return
    inFlight++
    post({ type: 'frame', data: held.data, delayMs: Math.max(20, nextTimeMs - held.timeMs) }, [held.data])
    held = null
  }

  return {
    kind: 'gif',
    mime: 'image/gif',
    ext: 'gif',
    get busy() {
      return inFlight >= GIF_MAX_IN_FLIGHT
    },
    async add(canvas, timeMs) {
      if (failed) throw failed
      if (closed) throw new AbortError()
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) throw new Error('캔버스를 읽지 못했습니다.')
      const image = ctx.getImageData(0, 0, opts.width, opts.height)
      flushHeld(timeMs)
      held = { data: image.data.buffer as ArrayBuffer, timeMs }
      while (inFlight >= GIF_MAX_IN_FLIGHT && !failed && !closed) await new Promise<void>((r) => waiters.push(r))
      if (failed) throw failed
      if (closed) throw new AbortError()
    },
    finish(endMs) {
      return new Promise<Blob>((resolve, reject) => {
        if (failed) return reject(failed)
        if (closed) return reject(new AbortError())
        onDone = (blob) => {
          closed = true
          worker.terminate()
          resolve(blob)
        }
        onFail = reject
        flushHeld(endMs)
        post({ type: 'finish' })
      })
    },
    close() {
      if (closed) return
      closed = true
      held = null
      worker.terminate()
      onFail?.(new AbortError())
      wake()
    },
  }
}

// ── 움직이는 WebP (프레임마다 브라우저의 WebP 인코더를 쓴다) ──
export function canEncodeWebp(): boolean {
  try {
    const c = document.createElement('canvas')
    c.width = c.height = 2
    return c.toDataURL('image/webp').startsWith('data:image/webp')
  } catch {
    return false
  }
}

export function createWebpSink(opts: { width: number; height: number; quality: QualityLevel }): FrameSink {
  const q = opts.quality === 'high' ? 0.9 : opts.quality === 'medium' ? 0.75 : 0.55
  const frames: WebpFrame[] = []
  const times: number[] = []
  let closed = false
  return {
    kind: 'webp',
    mime: 'image/webp',
    ext: 'webp',
    busy: false,
    async add(canvas, timeMs) {
      if (closed) throw new AbortError()
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', q))
      if (!blob || blob.type !== 'image/webp') throw new Error('이 브라우저는 WebP 저장을 지원하지 않습니다. GIF 나 MP4 로 바꿔 주세요.')
      const data = new Uint8Array(await blob.arrayBuffer())
      if (closed) throw new AbortError()
      frames.push({ data, durationMs: 0 })
      times.push(timeMs)
    },
    async finish(endMs) {
      if (closed) throw new AbortError()
      frames.forEach((f, i) => {
        f.durationMs = Math.max(10, Math.round((i + 1 < times.length ? times[i + 1] : endMs) - times[i]))
      })
      const bytes = muxAnimatedWebp(frames, opts.width, opts.height)
      closed = true
      frames.length = 0
      return new Blob([bytes], { type: 'image/webp' })
    },
    close() {
      closed = true
      frames.length = 0
    },
  }
}
