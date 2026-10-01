/**
 * pdfjs 준비 — 필요한 순간에만 불러온다.
 * 워커는 이 도구 전용으로 하나 만들고(전역 설정을 건드리지 않는다),
 * 한글 PDF 에 필요한 CMap·기본 글꼴·이미지 디코더(wasm)는 번들에 포함된 파일을 직접 건네준다.
 */
import type { PDFWorker } from 'pdfjs-dist'

type PdfJs = typeof import('pdfjs-dist')

// 빌드하면 파일명이 바뀌므로 "폴더 주소 + 파일명" 방식 대신 파일별 주소 표를 만든다.
const CMAPS = import.meta.glob('/node_modules/pdfjs-dist/cmaps/*.bcmap', { query: '?url&no-inline', import: 'default', eager: true, exhaustive: true }) as Record<string, string>
const FONTS = import.meta.glob('/node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}', { query: '?url&no-inline', import: 'default', eager: true, exhaustive: true }) as Record<string, string>
const WASM = import.meta.glob('/node_modules/pdfjs-dist/wasm/*.wasm', { query: '?url&no-inline', import: 'default', eager: true, exhaustive: true }) as Record<string, string>

function byFilename(map: Record<string, string>): Map<string, string> {
  const out = new Map<string, string>()
  for (const [path, url] of Object.entries(map)) out.set(path.slice(path.lastIndexOf('/') + 1), url)
  return out
}

const ASSETS: Record<string, Map<string, string>> = {
  cMapUrl: byFilename(CMAPS),
  standardFontDataUrl: byFilename(FONTS),
  wasmUrl: byFilename(WASM),
}

/** 번들에 들어 있는 보조 파일 수(확인용) */
export const bundledAssetCounts = () => ({ cmaps: ASSETS.cMapUrl.size, fonts: ASSETS.standardFontDataUrl.size, wasm: ASSETS.wasmUrl.size })

/** pdfjs 워커가 화면 쪽에 요청하는 보조 파일을 번들 주소에서 읽어 준다 */
class BundledBinaryDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const url = ASSETS[kind]?.get(filename)
    if (!url) throw new Error(`pdfjs 보조 파일이 없습니다: ${filename}`)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`pdfjs 보조 파일을 읽지 못했습니다: ${filename}`)
    return new Uint8Array(await res.arrayBuffer())
  }
}

let libPromise: Promise<PdfJs> | null = null
let worker: PDFWorker | null = null

export function loadPdfJs(): Promise<PdfJs> {
  libPromise ??= import('pdfjs-dist')
  return libPromise
}

/** getDocument 에 공통으로 넘길 설정 */
export async function pdfDocumentOptions() {
  const pdfjs = await loadPdfJs()
  if (!worker || worker.destroyed) {
    const port = new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), { type: 'module' })
    worker = pdfjs.PDFWorker.create({ port })
  }
  return {
    worker,
    BinaryDataFactory: BundledBinaryDataFactory,
    // 워커가 직접 내려받지 않고 위 BinaryDataFactory 에 요청하게 한다
    useWorkerFetch: false,
    cMapPacked: true,
  }
}
