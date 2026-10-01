/**
 * 글자 인식(OCR) — tesseract.js. 인식 엔진은 사이트에 들어 있는 파일을 쓰고,
 * 언어 데이터만 처음 한 번 jsDelivr 에서 내려받아 브라우저에 보관한다.
 */
import type { PDFDocument } from 'pdf-lib'
import coreUrl from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url'
import coreSimdUrl from 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url'
import workerUrl from 'tesseract.js/dist/worker.min.js?url'
import { normalizeRotation, visualSize, visualToUser } from './geometry'

export type OcrLang = 'kor+eng' | 'kor' | 'eng'

/** 언어 데이터 안내(압축 크기). 출처: cdn.jsdelivr.net/npm/@tesseract.js-data/<언어>/4.0.0_best_int */
export const OCR_DATA = {
  kor: { bytes: 1_572_336, label: '한국어' },
  eng: { bytes: 2_952_873, label: '영어' },
} as const

export function ocrDownloadBytes(lang: OcrLang): number {
  return lang.split('+').reduce((sum, l) => sum + OCR_DATA[l as 'kor' | 'eng'].bytes, 0)
}

const STATUS: Record<string, string> = {
  'loading tesseract core': '인식 엔진 준비 중',
  'initializing tesseract': '인식 엔진 준비 중',
  'loading language traineddata': '언어 데이터 내려받는 중',
  'loaded language traineddata': '언어 데이터 준비 완료',
  'initializing api': '인식 엔진 준비 중',
  'recognizing text': '글자 읽는 중',
}

// WebAssembly SIMD 지원 여부(지원하면 훨씬 빠른 엔진을 쓴다)
function hasSimd(): boolean {
  try {
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]))
  } catch {
    return false
  }
}

export interface OcrPage {
  text: string
  /** 보이지 않는 글자만 들어 있는 한 쪽짜리 PDF (searchable PDF 를 만들 때만) */
  textPdf: Uint8Array | null
  confidence: number
}

export interface OcrEngine {
  recognize: (canvas: HTMLCanvasElement, wantPdf: boolean) => Promise<OcrPage>
  terminate: () => Promise<void>
}

export async function createOcr(lang: OcrLang, dpi: number, onStatus: (label: string, fraction: number | null) => void, signal?: AbortSignal): Promise<OcrEngine> {
  signal?.throwIfAborted()
  const { createWorker } = await import('tesseract.js')
  const absolute = (url: string) => new URL(url, window.location.href).href
  const worker = await createWorker(lang.split('+'), 1, {
    workerPath: absolute(workerUrl),
    corePath: absolute(hasSimd() ? coreSimdUrl : coreUrl),
    logger: (m: { status: string; progress: number }) => onStatus(STATUS[m.status] ?? '글자 읽는 중', m.status === 'recognizing text' || m.status === 'loading language traineddata' ? m.progress : null),
    errorHandler: () => {},
  }).catch((err: unknown) => {
    throw new Error(`글자 인식을 준비하지 못했습니다. 언어 데이터를 내려받으려면 인터넷 연결이 필요합니다. (${err instanceof Error ? err.message : String(err)})`)
  })
  const terminate = async () => {
    await worker.terminate().catch(() => {})
  }
  // 취소하면 엔진을 바로 끈다 — 진행 중이던 recognize 는 영영 끝나지 않으므로 호출한 쪽에서 abort 를 따로 본다.
  signal?.addEventListener('abort', () => void terminate(), { once: true })
  await worker.setParameters({ user_defined_dpi: String(Math.round(dpi)), preserve_interword_spaces: '1' })

  return {
    terminate,
    recognize: (canvas, wantPdf) =>
      new Promise<OcrPage>((resolve, reject) => {
        if (signal?.aborted) return reject(signal.reason)
        const onAbort = () => reject(signal!.reason ?? new DOMException('취소했습니다.', 'AbortError'))
        signal?.addEventListener('abort', onAbort, { once: true })
        worker
          .recognize(canvas, { pdfTitle: 'ocr', pdfTextOnly: true }, { text: true, pdf: wantPdf })
          .then(({ data }) => resolve({ text: data.text ?? '', textPdf: wantPdf && data.pdf ? new Uint8Array(data.pdf) : null, confidence: data.confidence }))
          .catch((err: unknown) => reject(err instanceof Error ? err : new Error('글자를 읽지 못했습니다.')))
          .finally(() => signal?.removeEventListener('abort', onAbort))
      }),
  }
}

/**
 * 인식한 글자 층(보이지 않는 글자만 있는 PDF 한 쪽)을 문서의 한 쪽 위에 겹친다.
 * 쪽 모양은 그대로 두고, 검색·복사만 되게 한다.
 */
export async function overlayTextLayer(doc: PDFDocument, pageIndex: number, textPdf: Uint8Array): Promise<void> {
  const { degrees } = await import('pdf-lib')
  const page = doc.getPage(pageIndex)
  const [layer] = await doc.embedPdf(textPdf, [0])
  const rotation = normalizeRotation(page.getRotation().angle)
  const box = page.getCropBox()
  const vis = visualSize(box, rotation)
  const origin = visualToUser(box, rotation, 0, 0)
  page.drawPage(layer, { x: origin.x, y: origin.y, xScale: vis.width / layer.width, yScale: vis.height / layer.height, rotate: degrees(origin.angle) })
}
