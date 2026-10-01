import coreUrl from 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url'
import workerUrl from 'tesseract.js/dist/worker.min.js?url'
import { ctx2d, makeCanvas } from '@/lib/image'
import type { OcrLine } from './detect-text'

/**
 * 글자 인식 — tesseract.js(Apache-2.0).
 * 실행 파일(작업 스크립트·wasm)은 사이트에 함께 들어 있고, 언어 자료(한국어·영어, Apache-2.0)만
 * 처음 한 번 아래 주소에서 받는다. 받은 자료는 브라우저에 저장되어 다음부터는 다시 받지 않는다.
 */
export const OCR_DATA = {
  host: 'cdn.jsdelivr.net',
  files: [
    { url: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/kor/4.0.0_best_int/kor.traineddata.gz', bytes: 1_572_336 },
    { url: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', bytes: 2_952_873 },
  ],
  bytes: 1_572_336 + 2_952_873,
}

/** 인식에 넘기는 사진의 긴 변 한도. 더 크면 줄여서 넘긴다(시간·메모리). */
const MAX_OCR_EDGE = 2600

type TWorker = import('tesseract.js').Worker

export interface OcrProgress {
  label: string
  /** 0–100, 알 수 없으면 null */
  value: number | null
}

let worker: Promise<TWorker> | null = null
let listener: ((p: OcrProgress) => void) | null = null

const absolute = (u: string) => new URL(u, location.href).href

function describe(status: string, progress: number): OcrProgress | null {
  if (status.includes('loading tesseract core') || status.includes('initializing tesseract')) return { label: '글자 인식 준비 중', value: null }
  if (status.includes('loading language')) return { label: '글자 인식 자료 받는 중', value: progress > 0 && progress < 1 ? progress * 100 : null }
  if (status.includes('initializing api')) return { label: '글자 인식 준비 중', value: null }
  if (status.includes('recognizing')) return { label: '글자 읽는 중', value: progress * 100 }
  return null
}

function loadWorker(): Promise<TWorker> {
  if (!worker) {
    worker = (async () => {
      const mod = await import('tesseract.js')
      const createWorker = mod.createWorker ?? (mod as unknown as { default: typeof mod }).default.createWorker
      try {
        return await createWorker(['kor', 'eng'], 1, {
          workerPath: absolute(workerUrl),
          corePath: absolute(coreUrl),
          logger: (m) => {
            const p = describe(m.status, m.progress)
            if (p) listener?.(p)
          },
          errorHandler: () => {},
        })
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        throw new Error(`글자 인식 자료를 내려받지 못했습니다. 사내망에서 외부 주소(${OCR_DATA.host})가 막혀 있을 수 있습니다. 가릴 곳을 직접 그려 주세요. (${detail.slice(0, 120)})`)
      }
    })()
    worker.catch(() => (worker = null))
  }
  return worker
}

/** 사진의 글자를 줄·낱말 단위로 읽는다. 좌표는 원본 px 기준. */
export async function recognizeLines(source: CanvasImageSource & { width: number; height: number }, onProgress: (p: OcrProgress) => void): Promise<OcrLine[]> {
  listener = onProgress
  try {
    onProgress({ label: '글자 인식 준비 중', value: null })
    const w = await loadWorker()
    const k = Math.min(1, MAX_OCR_EDGE / Math.max(source.width, source.height))
    const canvas = makeCanvas(source.width * k, source.height * k)
    const ctx = ctx2d(canvas)
    // 투명한 사진은 흰 바탕 위에서 읽는다.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
    const { data } = await w.recognize(canvas, {}, { blocks: true, text: false })
    const lines: OcrLine[] = []
    for (const block of data.blocks ?? []) {
      for (const para of block.paragraphs) {
        for (const line of para.lines) {
          const words = line.words
            .filter((word) => word.text.trim())
            .map((word) => ({ text: word.text.trim(), x0: word.bbox.x0 / k, y0: word.bbox.y0 / k, x1: word.bbox.x1 / k, y1: word.bbox.y1 / k }))
          if (words.length) lines.push({ words })
        }
      }
    }
    return lines
  } finally {
    listener = null
  }
}

/** 진행 중인 인식을 멈춘다(작업자를 종료하고 다음에 새로 만든다). */
export async function cancelOcr() {
  const w = worker
  worker = null
  listener = null
  try {
    await (await w)?.terminate()
  } catch {
    // 이미 종료되었거나 시작 전이면 무시
  }
}
