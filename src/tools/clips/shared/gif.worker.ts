/// <reference lib="webworker" />
import { GifWriter } from './gifCore'
import type { QualityLevel } from './types'

export type GifWorkerRequest =
  | { type: 'init'; width: number; height: number; quality: QualityLevel }
  | { type: 'frame'; data: ArrayBuffer; delayMs: number }
  | { type: 'finish' }

export type GifWorkerResponse = { type: 'ack' } | { type: 'done'; data: ArrayBuffer; frames: number } | { type: 'error'; message: string }

const scope = self as unknown as DedicatedWorkerGlobalScope
let writer: GifWriter | null = null

scope.onmessage = (e: MessageEvent<GifWorkerRequest>) => {
  const msg = e.data
  try {
    if (msg.type === 'init') {
      writer = new GifWriter({ width: msg.width, height: msg.height, quality: msg.quality })
    } else if (msg.type === 'frame') {
      if (!writer) throw new Error('GIF 인코더가 준비되지 않았습니다.')
      writer.addFrame(new Uint8Array(msg.data), msg.delayMs)
      scope.postMessage({ type: 'ack' } satisfies GifWorkerResponse)
    } else if (msg.type === 'finish') {
      if (!writer) throw new Error('GIF 인코더가 준비되지 않았습니다.')
      const bytes = writer.finish()
      const frames = writer.frames
      writer = null
      const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      scope.postMessage({ type: 'done', data, frames } satisfies GifWorkerResponse, [data])
    }
  } catch (err) {
    scope.postMessage({ type: 'error', message: err instanceof Error ? err.message : 'GIF 를 만들지 못했습니다.' } satisfies GifWorkerResponse)
  }
}
