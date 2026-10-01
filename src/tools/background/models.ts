/**
 * 배경을 자동으로 지우는 데 쓰는 모델 목록. 모두 상업적 이용이 가능한 허용 라이선스다(모델 카드에서 확인).
 * 실행기(@huggingface/transformers, onnxruntime-web)와 그 wasm 은 사이트에 함께 들어 있고,
 * 모델 파일만 처음 한 번 huggingface.co 에서 받아 브라우저에 저장한다.
 */

export type ModelKey = 'fast' | 'person' | 'precise'

export interface ModelSpec {
  key: ModelKey
  /** huggingface.co 저장소 */
  repo: string
  dtype: 'fp32'
  /** 내려받는 크기(바이트) */
  bytes: number
  license: string
  label: string
  note: string
  inputName: string
  outputName: string
  /** 숫자면 정사각 고정 입력, 'dynamic' 이면 짧은 변 512 · 32의 배수 */
  input: number | 'dynamic'
  mean: [number, number, number]
  std: [number, number, number]
  /** true 면 가장 밝은 값으로 나눠 0–1 로 맞춘다(아니면 255 로 나눈다) */
  scaleByMax: boolean
  /** 출력값을 0–1 로 맞추는 방법 */
  post: 'minmax' | 'none'
}

export const MODEL_HOST = 'huggingface.co'

export const MODELS: Record<ModelKey, ModelSpec> = {
  fast: {
    key: 'fast',
    repo: 'BritishWerewolf/U-2-Netp',
    dtype: 'fp32',
    bytes: 4_574_861,
    license: 'Apache-2.0',
    label: '빠르게',
    note: '가볍고 빠릅니다. 배경이 단순한 상품 사진에 알맞습니다.',
    inputName: 'input.1',
    outputName: '1959',
    input: 320,
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225],
    scaleByMax: true,
    post: 'minmax',
  },
  person: {
    key: 'person',
    repo: 'Xenova/modnet',
    dtype: 'fp32',
    bytes: 25_888_640,
    license: 'Apache-2.0',
    label: '인물',
    note: '사람 사진 전용입니다. 머리카락 같은 가는 경계를 부드럽게 땁니다.',
    inputName: 'input',
    outputName: 'output',
    input: 'dynamic',
    mean: [0.5, 0.5, 0.5],
    std: [0.5, 0.5, 0.5],
    scaleByMax: false,
    post: 'none',
  },
  precise: {
    key: 'precise',
    repo: 'BritishWerewolf/IS-Net',
    dtype: 'fp32',
    bytes: 178_648_008,
    license: 'Apache-2.0',
    label: '정밀하게',
    note: '윤곽이 복잡한 물건도 꼼꼼히 땁니다. 내려받는 양이 크고, 그래픽 가속이 없는 PC 에서는 한 장에 10초 넘게 걸립니다.',
    inputName: 'input_image',
    outputName: 'output_image',
    input: 1024,
    mean: [0.485, 0.456, 0.406],
    std: [1, 1, 1],
    scaleByMax: true,
    post: 'minmax',
  },
}

export const MODEL_ORDER: ModelKey[] = ['fast', 'person', 'precise']

/** 모델에 넣을 사진 크기 */
export function modelInputSize(spec: ModelSpec, width: number, height: number): { width: number; height: number } {
  if (spec.input !== 'dynamic') return { width: spec.input, height: spec.input }
  const k = 512 / Math.min(width, height)
  const snap = (v: number) => Math.max(160, Math.min(1024, Math.round((v * k) / 32) * 32))
  return { width: snap(width), height: snap(height) }
}

/** RGBA(0–255)를 모델 입력(채널 우선, 평균·표준편차 정규화)으로 바꾼다. */
export function toModelInput(spec: ModelSpec, rgba: Uint8ClampedArray, width: number, height: number): Float32Array {
  const n = width * height
  let scale = 255
  if (spec.scaleByMax) {
    let max = 1
    for (let i = 0; i < n * 4; i += 4) {
      if (rgba[i] > max) max = rgba[i]
      if (rgba[i + 1] > max) max = rgba[i + 1]
      if (rgba[i + 2] > max) max = rgba[i + 2]
    }
    scale = max
  }
  const out = new Float32Array(n * 3)
  for (let c = 0; c < 3; c++) {
    const mean = spec.mean[c]
    const std = spec.std[c]
    const base = c * n
    for (let i = 0; i < n; i++) out[base + i] = (rgba[i * 4 + c] / scale - mean) / std
  }
  return out
}

/** 모델 출력을 0–1 마스크로 맞춘다. */
export function fromModelOutput(spec: ModelSpec, data: ArrayLike<number>): Float32Array {
  const out = new Float32Array(data.length)
  if (spec.post === 'none') {
    for (let i = 0; i < out.length; i++) out[i] = Math.max(0, Math.min(1, data[i]))
    return out
  }
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < data.length; i++) {
    const v = data[i]
    if (v < min) min = v
    if (v > max) max = v
  }
  const range = max - min || 1
  for (let i = 0; i < out.length; i++) out[i] = (data[i] - min) / range
  return out
}
