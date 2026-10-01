/**
 * pdfjs-dist(v6) 불러오기·설정. 처음 PDF 를 열 때만 내려받는다.
 * 한글·일본어·중국어 PDF 에 필요한 CMap, 기본 글꼴, 이미지 해독용 wasm 은
 * node_modules 의 파일을 Vite 가 내주는 주소로 연결한다(외부 CDN 을 쓰지 않는다).
 */
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { ctx2d, isCanvasSizeSafe, makeCanvas } from '@/lib/image'
import type { Quarter } from './geometry'
import type { TextPiece } from './tables'

type UrlLoader = () => Promise<string>
const CMAPS = import.meta.glob('/node_modules/pdfjs-dist/cmaps/*.bcmap', { query: '?url', import: 'default', exhaustive: true }) as Record<string, UrlLoader>
const STANDARD_FONTS = import.meta.glob('/node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}', { query: '?url', import: 'default', exhaustive: true }) as Record<string, UrlLoader>
const WASM = import.meta.glob('/node_modules/pdfjs-dist/wasm/*.wasm', { query: '?url', import: 'default', exhaustive: true }) as Record<string, UrlLoader>

/** pdfjs 가 워커 대신 화면 쪽에 보조 파일을 요청할 때 쓰는 공급자 */
class LocalBinaryDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const table = kind === 'cMapUrl' ? CMAPS : kind === 'standardFontDataUrl' ? STANDARD_FONTS : kind === 'wasmUrl' ? WASM : null
    const key = table && Object.keys(table).find((k) => k.endsWith(`/${filename}`))
    if (!table || !key) throw new Error(`PDF 보조 파일을 찾을 수 없습니다: ${filename}`)
    const res = await fetch(await table[key]())
    if (!res.ok) throw new Error(`PDF 보조 파일을 불러오지 못했습니다: ${filename}`)
    return new Uint8Array(await res.arrayBuffer())
  }
}

type PdfjsModule = typeof import('pdfjs-dist')
let modulePromise: Promise<PdfjsModule> | null = null

export function loadPdfjs(): Promise<PdfjsModule> {
  modulePromise ??= import('pdfjs-dist').then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = workerUrl
    return lib
  })
  return modulePromise
}

export class PasswordCancelled extends Error {
  constructor() {
    super('암호 입력을 취소했습니다.')
  }
}

export interface OpenedPdf {
  pdf: PDFDocumentProxy
  /** 열 때 쓴 암호(암호가 없었으면 undefined) */
  password: string | undefined
  /** 암호화된 문서인지(열기 암호가 없어도 편집 제한만 걸린 문서가 있다) */
  encrypted: boolean
}

/**
 * PDF 를 연다. 암호가 걸려 있으면 askPassword 로 물어본다(null 을 돌려주면 취소).
 * data 는 pdfjs 워커로 넘어가므로 호출자가 따로 쓸 복사본을 갖고 있어야 한다.
 */
export async function openPdf(data: Uint8Array, askPassword: (wrong: boolean) => Promise<string | null>): Promise<OpenedPdf> {
  const lib = await loadPdfjs()
  const task = lib.getDocument({
    data,
    cMapUrl: 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: 'standard_fonts/',
    wasmUrl: 'wasm/',
    useWorkerFetch: false,
    BinaryDataFactory: LocalBinaryDataFactory,
    verbosity: lib.VerbosityLevel.ERRORS,
  })
  let password: string | undefined
  let cancelled = false
  task.onPassword = (update: (value: string | Error) => void, reason: number) => {
    askPassword(reason === lib.PasswordResponses.INCORRECT_PASSWORD).then((value) => {
      if (value === null) {
        cancelled = true
        update(new Error('cancelled'))
      } else {
        password = value
        update(value)
      }
    })
  }
  let pdf: PDFDocumentProxy
  try {
    pdf = await task.promise
  } catch (err) {
    if (cancelled) throw new PasswordCancelled()
    const name = (err as { name?: string } | null)?.name
    if (name === 'InvalidPDFException') throw new Error('PDF 파일이 손상되었거나 PDF 가 아닙니다.')
    if (name === 'PasswordException') throw new PasswordCancelled()
    throw new Error('PDF 를 열지 못했습니다. 파일이 손상되었을 수 있습니다.')
  }
  let encrypted = password !== undefined
  try {
    const meta = await pdf.getMetadata()
    if ((meta.info as { EncryptFilterName?: string | null }).EncryptFilterName) encrypted = true
  } catch {
    // 문서 정보가 없어도 쓰는 데는 문제없다
  }
  return { pdf, password, encrypted }
}

export interface RenderOptions {
  /** 1 = 72dpi */
  scale: number
  /** 사용자가 더한 회전(문서에 원래 있던 회전은 자동으로 반영된다) */
  rotation?: Quarter
  signal?: AbortSignal
}

/** 한 쪽을 캔버스에 그린다. 캔버스 한도를 넘으면 한도에 맞게 줄여 그린다. */
export async function renderPdfPage(pdf: PDFDocumentProxy, index: number, { scale, rotation = 0, signal }: RenderOptions): Promise<HTMLCanvasElement> {
  signal?.throwIfAborted()
  const page = await pdf.getPage(index + 1)
  const rot = (page.rotate + rotation) % 360
  let viewport = page.getViewport({ scale, rotation: rot })
  if (!isCanvasSizeSafe(Math.ceil(viewport.width), Math.ceil(viewport.height))) {
    const base = page.getViewport({ scale: 1, rotation: rot })
    const safe = Math.min(16384 / base.width, 16384 / base.height, Math.sqrt(120_000_000 / (base.width * base.height)))
    viewport = page.getViewport({ scale: Math.max(0.05, safe * 0.98), rotation: rot })
  }
  const canvas = makeCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  ctx2d(canvas) // 캔버스를 만들 수 없으면 여기서 알기 쉬운 오류가 난다
  // intent 'print': 화면용(display)은 requestAnimationFrame 에 맞춰 그리기 때문에, 긴 작업 중 다른 탭을 보고 있으면 멈춘다.
  const task = page.render({ canvas, viewport, intent: 'print' })
  const onAbort = () => task.cancel()
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    await task.promise
  } catch (err) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('취소했습니다.', 'AbortError')
    throw err
  } finally {
    signal?.removeEventListener('abort', onAbort)
    page.cleanup()
  }
  return canvas
}

/** 쪽의 보이는 크기(pt). 문서에 있던 회전 + 사용자가 더한 회전을 반영한다. */
export async function pdfPageSize(pdf: PDFDocumentProxy, index: number, rotation: Quarter = 0): Promise<{ width: number; height: number }> {
  const page = await pdf.getPage(index + 1)
  const vp = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 })
  return { width: vp.width, height: vp.height }
}

/** 쪽의 글자 조각을 보이는 좌표(왼쪽 위 원점, pt)로 돌려준다. */
export async function pageTextPieces(pdf: PDFDocumentProxy, index: number, rotation: Quarter = 0): Promise<{ pieces: TextPiece[]; width: number; height: number }> {
  const lib = await loadPdfjs()
  const page: PDFPageProxy = await pdf.getPage(index + 1)
  const viewport = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 })
  const content = await page.getTextContent()
  const pieces: TextPiece[] = []
  for (const item of content.items) {
    if (!('str' in item) || !item.str) continue
    const m = lib.Util.transform(viewport.transform, item.transform) as number[]
    const h = Math.hypot(m[2], m[3]) || item.height
    // 글자가 세로로 누운 조각(90도 회전 글자)은 표·문단 추정에서 뺀다
    if (Math.abs(m[1]) > Math.abs(m[0])) continue
    pieces.push({ str: item.str, x: m[4], y: m[5], w: item.width, h })
  }
  page.cleanup()
  return { pieces, width: viewport.width, height: viewport.height }
}
