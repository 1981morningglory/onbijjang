import wasmBinaryUrl from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'
import wasmLoaderUrl from '@mediapipe/tasks-vision/vision_wasm_internal.js?url'
import { ctx2d, makeCanvas } from '@/lib/image'
import { mergeDetections, tileGrid, type Box } from './regions'

/**
 * 얼굴 찾기 — MediaPipe FaceDetector(Apache-2.0).
 * 실행 파일(wasm)은 사이트에 함께 들어 있고(node_modules/@mediapipe/tasks-vision/wasm),
 * 얼굴 찾기 자료(BlazeFace short-range, Apache-2.0)만 처음 한 번 아래 주소에서 받는다.
 */
export const FACE_MODEL = {
  url: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
  host: 'storage.googleapis.com',
  bytes: 229_746,
}

type Detector = import('@mediapipe/tasks-vision').FaceDetector

let detector: Promise<Detector> | null = null

async function fetchModel(onProgress?: (percent: number) => void): Promise<Uint8Array> {
  let res: Response
  try {
    res = await fetch(FACE_MODEL.url)
  } catch {
    throw new Error(`얼굴 찾기 자료를 내려받지 못했습니다. 사내망에서 외부 주소(${FACE_MODEL.host})가 막혀 있을 수 있습니다. 영역을 직접 그려서 가려 주세요.`)
  }
  if (!res.ok || !res.body) throw new Error(`얼굴 찾기 자료를 내려받지 못했습니다(응답 ${res.status}). 잠시 뒤 다시 시도하거나 영역을 직접 그려 주세요.`)
  const total = Number(res.headers.get('content-length')) || FACE_MODEL.bytes
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.length
    onProgress?.(Math.min(100, (loaded / total) * 100))
  }
  const out = new Uint8Array(loaded)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

export function loadFaceDetector(onProgress?: (percent: number) => void): Promise<Detector> {
  if (!detector) {
    detector = (async () => {
      const [model, vision] = await Promise.all([fetchModel(onProgress), import('@mediapipe/tasks-vision')])
      // 준비 과정에서 라이브러리가 안내 문구("INFO: …")를 오류 통로로 내보낸다. 실제 오류와 섞이지 않게 그 줄만 걸러 낸다.
      const original = console.error
      console.error = (...args: unknown[]) => {
        if (typeof args[0] === 'string' && args[0].startsWith('INFO:')) return
        original(...args)
      }
      try {
        return await vision.FaceDetector.createFromOptions(
          { wasmLoaderPath: wasmLoaderUrl, wasmBinaryPath: wasmBinaryUrl },
          { baseOptions: { modelAssetBuffer: model, delegate: 'CPU' }, runningMode: 'IMAGE', minDetectionConfidence: 0.5 },
        )
      } catch (err) {
        throw new Error(`얼굴 찾기를 시작하지 못했습니다. 브라우저를 새로고침한 뒤 다시 시도해 주세요. (${err instanceof Error ? err.message : String(err)})`)
      } finally {
        // 첫 감지 때 한 번 더 나오는 안내 줄까지 지나간 뒤 되돌린다.
        setTimeout(() => (console.error = original), 3000)
      }
    })()
    // 실패하면 다음에 다시 시도할 수 있게 비운다.
    detector.catch(() => (detector = null))
  }
  return detector
}

export interface FaceBox extends Box {
  score: number
}

/**
 * 사진에서 얼굴 상자를 찾는다(원본 px 기준).
 * 이 자료는 가까이 찍힌 얼굴에 맞춰져 있어, 사진 전체와 함께 겹치는 조각으로도 나눠 찾아 작은 얼굴을 보완한다.
 */
export async function detectFaces(source: CanvasImageSource & { width: number; height: number }, onProgress?: (percent: number) => void, signal?: AbortSignal): Promise<FaceBox[]> {
  const det = await loadFaceDetector()
  const tiles = tileGrid(source.width, source.height)
  const found: FaceBox[] = []
  for (let i = 0; i < tiles.length; i++) {
    if (signal?.aborted) throw new DOMException('취소', 'AbortError')
    const t = tiles[i]
    // 조각을 긴 변 640px 이하로 줄여 넘긴다(감지기 입력은 더 작아 충분하다).
    const k = Math.min(1, 640 / Math.max(t.w, t.h))
    const canvas = makeCanvas(t.w * k, t.h * k)
    ctx2d(canvas).drawImage(source, t.x, t.y, t.w, t.h, 0, 0, canvas.width, canvas.height)
    const result = det.detect(canvas)
    for (const d of result.detections) {
      const b = d.boundingBox
      if (!b) continue
      const box = { x: t.x + b.originX / k, y: t.y + b.originY / k, w: b.width / k, h: b.height / k, score: d.categories[0]?.score ?? 0.5 }
      // 조각 가장자리에 걸려 잘린 상자는 믿지 않는다(겹치는 이웃 조각이 온전히 잡는다).
      const cut = i > 0 && ((box.x <= t.x + 1 && t.x > 0) || (box.y <= t.y + 1 && t.y > 0) || (box.x + box.w >= t.x + t.w - 1 && t.x + t.w < source.width) || (box.y + box.h >= t.y + t.h - 1 && t.y + t.h < source.height))
      if (!cut && box.w >= 8 && box.h >= 8) found.push(box)
    }
    onProgress?.(((i + 1) / tiles.length) * 100)
    // 조각 사이에 화면이 멈추지 않게 잠깐 양보한다.
    if (i % 6 === 5) await new Promise((r) => setTimeout(r))
  }
  return mergeDetections(found)
}
