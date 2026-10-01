import { inpaint, type FillMode } from './inpaint'

export interface InpaintRequest {
  id: number
  rgba: ArrayBuffer
  mask: ArrayBuffer
  width: number
  height: number
  mode: FillMode
  grow: number
}

export type InpaintResponse =
  | { id: number; type: 'progress'; ratio: number }
  | { id: number; type: 'done'; rgba: ArrayBuffer }
  | { id: number; type: 'error'; message: string }

const scope = self as unknown as DedicatedWorkerGlobalScope

scope.onmessage = (e: MessageEvent<InpaintRequest>) => {
  const { id, width, height, mode, grow } = e.data
  try {
    const result = inpaint(
      { rgba: new Uint8ClampedArray(e.data.rgba), mask: new Uint8Array(e.data.mask), width, height, mode, grow },
      (ratio) => scope.postMessage({ id, type: 'progress', ratio } satisfies InpaintResponse),
    )
    const buffer = result.buffer as ArrayBuffer
    scope.postMessage({ id, type: 'done', rgba: buffer } satisfies InpaintResponse, [buffer])
  } catch (err) {
    scope.postMessage({ id, type: 'error', message: err instanceof Error ? err.message : String(err) } satisfies InpaintResponse)
  }
}
