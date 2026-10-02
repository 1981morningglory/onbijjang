import ortFactoryUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url'
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import { guidedUpsample } from './mask'
import { MODELS, fromModelOutput, toModelInput, type ModelKey } from './models'

/**
 * 배경 자동 지우기 계산. 화면이 멈추지 않도록 별도 작업자에서 돌린다.
 * 실행기(transformers.js → onnxruntime-web)는 처음 쓸 때만 불러온다.
 */

export type SegmentRequest =
  | { type: 'load'; id: number; model: ModelKey }
  | {
      type: 'run'
      id: number
      model: ModelKey
      /** 모델 입력 크기로 줄인 사진(RGBA) */
      input: ArrayBuffer
      inputWidth: number
      inputHeight: number
      /** 마스크를 만들 해상도의 사진(RGBA) — 경계를 다듬는 기준 */
      guide: ArrayBuffer
      width: number
      height: number
    }

export type SegmentResponse =
  | { type: 'progress'; id: number; percent: number; loaded: number; total: number }
  | { type: 'loaded'; id: number; accelerated: boolean }
  | { type: 'result'; id: number; mask: ArrayBuffer; accelerated: boolean }
  | { type: 'error'; id: number; stage: 'load' | 'run'; message: string }

type Transformers = typeof import('@huggingface/transformers')
type Model = Awaited<ReturnType<Transformers['AutoModel']['from_pretrained']>>

const scope = self as unknown as DedicatedWorkerGlobalScope
const post = (msg: SegmentResponse, transfer: Transferable[] = []) => scope.postMessage(msg, transfer)

let libPromise: Promise<Transformers> | null = null
function lib(): Promise<Transformers> {
  if (!libPromise) {
    libPromise = import('@huggingface/transformers').then((t) => {
      // wasm 실행 파일은 CDN 이 아니라 사이트에 함께 들어 있는 것을 쓴다.
      const wasm = t.env.backends.onnx.wasm
      if (wasm) wasm.wasmPaths = { mjs: new URL(ortFactoryUrl, import.meta.url).href, wasm: new URL(ortWasmUrl, import.meta.url).href }
      t.env.allowLocalModels = false
      return t
    })
    libPromise.catch(() => (libPromise = null))
  }
  return libPromise
}

async function hasGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
    return !!gpu && !!(await gpu.requestAdapter())
  } catch {
    return false
  }
}

interface Loaded {
  model: Model
  accelerated: boolean
}
const loaded = new Map<ModelKey, Promise<Loaded>>()
/** 그래픽 가속으로 실행하다 실패한 모델은 다음부터 일반 방식으로만 돌린다. */
const gpuBroken = new Set<ModelKey>()

function load(key: ModelKey, id: number): Promise<Loaded> {
  let p = loaded.get(key)
  if (!p) {
    p = (async () => {
      const t = await lib()
      const spec = MODELS[key]
      const progress_callback = (e: { status?: string; progress?: number; loaded?: number; total?: number; file?: string }) => {
        // 여러 파일을 합친 진행률(progress_total)이 있으면 그것을, 없으면 모델 파일의 진행률을 쓴다.
        if (e.status === 'progress_total' || (e.status === 'progress' && e.file?.endsWith('.onnx'))) {
          post({ type: 'progress', id, percent: Math.min(100, e.progress ?? 0), loaded: e.loaded ?? 0, total: e.total ?? spec.bytes })
        }
      }
      const useGpu = !gpuBroken.has(key) && (await hasGpu())
      if (useGpu) {
        try {
          const model = await t.AutoModel.from_pretrained(spec.repo, { dtype: spec.dtype, device: 'webgpu', progress_callback })
          return { model, accelerated: true }
        } catch (err) {
          // 내려받기 실패라면 일반 방식으로 다시 해도 똑같이 실패하므로 그대로 알린다.
          if (isNetworkError(err)) throw err
        }
      }
      const model = await t.AutoModel.from_pretrained(spec.repo, { dtype: spec.dtype, device: 'wasm', progress_callback })
      return { model, accelerated: false }
    })()
    loaded.set(key, p)
    p.catch(() => loaded.delete(key))
  }
  return p
}

function isNetworkError(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err)
  return /fetch|network|Could not locate file|Unauthorized|Forbidden|404|403|ERR_/i.test(m)
}

async function infer(key: ModelKey, entry: Loaded, input: Float32Array, w: number, h: number): Promise<Float32Array> {
  const t = await lib()
  const spec = MODELS[key]
  const tensor = new t.Tensor('float32', input, [1, 3, h, w])
  const out = await entry.model({ [spec.inputName]: tensor })
  const result = out[spec.outputName] ?? Object.values(out)[0]
  return fromModelOutput(spec, result.data as Float32Array)
}

scope.onmessage = async (e: MessageEvent<SegmentRequest>) => {
  const req = e.data
  let entry: Loaded
  try {
    entry = await load(req.model, req.id)
  } catch (err) {
    return post({ type: 'error', id: req.id, stage: 'load', message: err instanceof Error ? err.message : String(err) })
  }
  if (req.type === 'load') return post({ type: 'loaded', id: req.id, accelerated: entry.accelerated })

  try {
    const spec = MODELS[req.model]
    const input = toModelInput(spec, new Uint8ClampedArray(req.input), req.inputWidth, req.inputHeight)
    let coarse: Float32Array
    try {
      coarse = await infer(req.model, entry, input, req.inputWidth, req.inputHeight)
    } catch (err) {
      if (!entry.accelerated) throw err
      // 그래픽 가속에서 실패하면 일반 방식으로 한 번 더 시도한다.
      gpuBroken.add(req.model)
      loaded.delete(req.model)
      entry = await load(req.model, req.id)
      coarse = await infer(req.model, entry, input, req.inputWidth, req.inputHeight)
    }
    const mask = guidedUpsample(coarse, req.inputWidth, req.inputHeight, new Uint8ClampedArray(req.guide), req.width, req.height)
    const buffer = mask.buffer as ArrayBuffer
    post({ type: 'result', id: req.id, mask: buffer, accelerated: entry.accelerated }, [buffer])
  } catch (err) {
    post({ type: 'error', id: req.id, stage: 'run', message: err instanceof Error ? err.message : String(err) })
  }
}
