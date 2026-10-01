/** pdf-lib 로 하는 일: 쪽 모아 새 PDF 만들기, 쪽 번호·워터마크, 압축, 암호 걸기/풀기. */
import type { PDFDocument, PDFFont, PDFPage } from 'pdf-lib'
import boldFontUrl from 'pretendard/dist/public/static/alternative/Pretendard-Bold.ttf?url'
import regularFontUrl from 'pretendard/dist/public/static/alternative/Pretendard-Regular.ttf?url'
import { canvasToBlob, fitWithin, hexToRgb, loadBitmap, makeCanvas, ctx2d, resizeCanvas } from '@/lib/image'
import { MM, fitImagePage, normalizeRotation, visualSize, visualToUser, type PaperSettings } from './geometry'
import { pdfPageSize, renderPdfPage } from './pdfjs'
import { formatPageNumber, type NumberFormat } from './ranges'
import { itemSize, renderItem } from './render'
import { breathe, onSourceRemoved, type ImageSource, type PageItem, type PdfSource, type Source } from './store'

const pdfLib = () => import('pdf-lib')

/** Uint8Array 를 PDF 파일로 */
export function pdfFile(bytes: Uint8Array, name: string): File {
  return new File([bytes as unknown as BlobPart], name, { type: 'application/pdf', lastModified: Date.now() })
}

// ── 원본 PDF 를 pdf-lib 문서로(원본마다 한 번만 읽는다) ──
const editDocs = new Map<string, Promise<PDFDocument | null>>()
onSourceRemoved((source) => editDocs.delete(source.id))

function editDoc(source: PdfSource): Promise<PDFDocument | null> {
  if (!source.editable) return Promise.resolve(null)
  let p = editDocs.get(source.id)
  if (!p) {
    p = (async () => {
      const { PDFDocument } = await pdfLib()
      try {
        return await PDFDocument.load(source.editBytes ?? (await source.file.arrayBuffer()), { updateMetadata: false })
      } catch {
        return null // 구조가 깨진 문서 — 쪽을 그림으로 바꿔 넣는다
      }
    })()
    editDocs.set(source.id, p)
  }
  return p
}

export type ImageQuality = 'high' | 'small'

export interface BuildContext {
  sources: Record<string, Source>
  paper: PaperSettings
  /** 사진을 PDF 에 넣을 때: high 는 원본에 가깝게, small 은 긴 변 2400px·JPG 로 줄인다 */
  imageQuality?: ImageQuality
  signal?: AbortSignal
  onProgress?: (done: number, total: number) => void
}

export interface BuildResult {
  doc: PDFDocument
  /** 원본 구조를 복사하지 못해 그림으로 넣은 쪽 수 */
  rasterized: number
}

/** 쪽 목록을 순서대로 모아 새 PDF 문서를 만든다(회전 반영). 병합·분할·회전 저장의 바탕. */
export async function buildPdf(items: PageItem[], ctx: BuildContext): Promise<BuildResult> {
  const { PDFDocument, degrees } = await pdfLib()
  const out = await PDFDocument.create()
  let rasterized = 0

  // 같은 원본의 쪽은 한 번에 복사해야 글꼴 같은 공유 자원이 중복되지 않는다.
  const copied = new Map<string, PDFPage>()
  const bySource = new Map<string, PageItem[]>()
  for (const item of items) {
    if (ctx.sources[item.sourceId]?.kind !== 'pdf') continue
    const list = bySource.get(item.sourceId)
    if (list) list.push(item)
    else bySource.set(item.sourceId, [item])
  }
  for (const [sourceId, list] of bySource) {
    ctx.signal?.throwIfAborted()
    const doc = await editDoc(ctx.sources[sourceId] as PdfSource)
    if (!doc) continue
    const pages = await out.copyPages(doc, list.map((i) => i.index))
    list.forEach((item, k) => copied.set(item.id, pages[k]))
    await breathe()
  }

  let done = 0
  for (const item of items) {
    ctx.signal?.throwIfAborted()
    const source = ctx.sources[item.sourceId]
    if (!source) continue
    const page = copied.get(item.id)
    if (page) {
      out.addPage(page)
      if (item.rotation) page.setRotation(degrees(normalizeRotation(page.getRotation().angle + item.rotation)))
    } else if (source.kind === 'pdf') {
      rasterized++
      const canvas = await renderPdfPage(source.pdf, item.index, { scale: 150 / 72, rotation: item.rotation, signal: ctx.signal })
      const size = await pdfPageSize(source.pdf, item.index, item.rotation)
      const img = await out.embedJpg(await (await canvasToBlob(canvas, 'image/jpeg', 0.85)).arrayBuffer())
      out.addPage([size.width, size.height]).drawImage(img, { x: 0, y: 0, width: size.width, height: size.height })
    } else {
      await addImagePage(out, source, ctx.paper, ctx.imageQuality ?? 'high', item.rotation)
    }
    ctx.onProgress?.(++done, items.length)
    if (done % 8 === 0 || !page) await breathe()
  }
  out.setProducer('온비짱')
  out.setCreator('온비짱')
  return { doc: out, rasterized }
}

async function addImagePage(out: PDFDocument, source: ImageSource, paper: PaperSettings, quality: ImageQuality, rotation: number) {
  const { degrees } = await pdfLib()
  // 캔버스에서 새로 만들어 넣는다 — 촬영 위치 같은 메타정보가 PDF 에 따라 들어가지 않는다.
  const bmp = await loadBitmap(source.file)
  const limit = quality === 'small' ? 2400 : 8000
  const fit = fitWithin(bmp.width, bmp.height, limit)
  let canvas: HTMLCanvasElement
  if (fit.scale < 1) canvas = resizeCanvas(bmp, fit.width, fit.height)
  else {
    canvas = makeCanvas(bmp.width, bmp.height)
    ctx2d(canvas).drawImage(bmp, 0, 0)
  }
  bmp.close()
  const keepPng = quality === 'high' && source.file.type === 'image/png'
  const blob = await canvasToBlob(canvas, keepPng ? 'image/png' : 'image/jpeg', quality === 'small' ? 0.8 : 0.92)
  const bytes = await blob.arrayBuffer()
  const img = keepPng ? await out.embedPng(bytes) : await out.embedJpg(bytes)
  const place = fitImagePage(source.width, source.height, paper)
  const page = out.addPage([place.pageW, place.pageH])
  page.drawImage(img, { x: place.x, y: place.y, width: place.w, height: place.h })
  if (rotation) page.setRotation(degrees(rotation))
}

export async function savePdf(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save({ useObjectStreams: true })
}

// ── 한글 글꼴 ─────────────────────────────────────────────
const fontBytes: Partial<Record<'regular' | 'bold', Promise<ArrayBuffer>>> = {}

function loadFontBytes(weight: 'regular' | 'bold'): Promise<ArrayBuffer> {
  fontBytes[weight] ??= fetch(weight === 'bold' ? boldFontUrl : regularFontUrl).then((res) => {
    if (!res.ok) throw new Error('한글 글꼴을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.')
    return res.arrayBuffer()
  })
  fontBytes[weight]!.catch(() => delete fontBytes[weight])
  return fontBytes[weight]!
}

/** 한글이 들어 있는 글꼴(Pretendard)을 쓰는 글자만 골라 문서에 넣는다. */
export async function embedKoreanFont(doc: PDFDocument, weight: 'regular' | 'bold' = 'regular'): Promise<PDFFont> {
  const fontkit = (await import('@pdf-lib/fontkit')).default
  doc.registerFontkit(fontkit)
  return doc.embedFont(await loadFontBytes(weight), { subset: true })
}

const charsets = new WeakMap<PDFFont, Set<number>>()
/** 글꼴에 없는 글자(일부 한자·그림 문자)는 빼고 돌려준다 — 빈 네모로 찍히는 것을 막는다. */
export function supportedText(font: PDFFont, text: string): string {
  let set = charsets.get(font)
  if (!set) {
    set = new Set(font.getCharacterSet())
    charsets.set(font, set)
  }
  let out = ''
  for (const ch of text.replace(/[\t\r\n ]/g, ' ')) if (set.has(ch.codePointAt(0)!)) out += ch
  return out
}

// ── 쪽 번호 · 워터마크 글자 ───────────────────────────────
export interface NumberOptions {
  enabled: boolean
  vertical: 'top' | 'bottom'
  horizontal: 'left' | 'center' | 'right'
  start: number
  format: NumberFormat
  size: number
  marginMm: number
  /** 첫 쪽(표지)에는 번호를 찍지 않는다 */
  skipFirst: boolean
}

export interface MarkOptions {
  enabled: boolean
  text: string
  /** 5–100 */
  opacity: number
  color: string
  diagonal: boolean
  /** 쪽 너비(대각선이면 대각선 길이)에 대한 글자 폭 비율 20–90 */
  widthPct: number
}

export async function stampPdf(doc: PDFDocument, numbers: NumberOptions, mark: MarkOptions, signal?: AbortSignal): Promise<void> {
  const { degrees, rgb } = await pdfLib()
  const pages = doc.getPages()
  const regular = numbers.enabled ? await embedKoreanFont(doc, 'regular') : null
  const bold = mark.enabled ? await embedKoreanFont(doc, 'bold') : null
  const markText = bold ? supportedText(bold, mark.text).trim() : ''
  if (mark.enabled && !markText) throw new Error('워터마크 글자를 입력해 주세요. 넣을 수 없는 글자(일부 한자·그림 문자)만 있으면 찍히지 않습니다.')
  const { r, g, b } = hexToRgb(mark.color)
  const numbered = numbers.skipFirst ? pages.length - 1 : pages.length
  const last = numbers.start + numbered - 1

  for (let i = 0; i < pages.length; i++) {
    signal?.throwIfAborted()
    const page = pages[i]
    const rotation = normalizeRotation(page.getRotation().angle)
    const box = page.getCropBox()
    const vis = visualSize(box, rotation)

    if (bold && markText) {
      const theta = mark.diagonal ? Math.atan2(vis.height, vis.width) : 0
      const span = (mark.diagonal ? Math.hypot(vis.width, vis.height) : vis.width) * (mark.widthPct / 100)
      const size = Math.max(6, Math.min(span / bold.widthOfTextAtSize(markText, 1), vis.height * 0.3))
      const tw = bold.widthOfTextAtSize(markText, size)
      const th = size * 0.72 // 대문자 높이쯤
      const vx = vis.width / 2 - (Math.cos(theta) * tw) / 2 + (Math.sin(theta) * th) / 2
      const vy = vis.height / 2 - (Math.sin(theta) * tw) / 2 - (Math.cos(theta) * th) / 2
      const u = visualToUser(box, rotation, vx, vy)
      page.drawText(markText, { x: u.x, y: u.y, size, font: bold, color: rgb(r / 255, g / 255, b / 255), opacity: Math.max(0.05, Math.min(1, mark.opacity / 100)), rotate: degrees((theta * 180) / Math.PI + u.angle) })
    }

    if (regular && !(numbers.skipFirst && i === 0)) {
      const n = numbers.start + (numbers.skipFirst ? i - 1 : i)
      const label = supportedText(regular, formatPageNumber(numbers.format, n, last))
      const size = numbers.size
      const margin = numbers.marginMm * MM
      const w = regular.widthOfTextAtSize(label, size)
      const vx = numbers.horizontal === 'left' ? margin : numbers.horizontal === 'right' ? vis.width - margin - w : (vis.width - w) / 2
      const vy = numbers.vertical === 'bottom' ? margin : vis.height - margin - size * 0.72
      const u = visualToUser(box, rotation, vx, vy)
      page.drawText(label, { x: u.x, y: u.y, size, font: regular, color: rgb(0.1, 0.1, 0.1), rotate: degrees(u.angle) })
    }
    if (i % 20 === 19) await breathe()
  }
}

// ── 압축: 쪽을 그림으로 다시 만든다 ───────────────────────
export async function rasterPdf(items: PageItem[], ctx: BuildContext, dpi: number, quality: number): Promise<PDFDocument> {
  const { PDFDocument } = await pdfLib()
  const out = await PDFDocument.create()
  let done = 0
  for (const item of items) {
    ctx.signal?.throwIfAborted()
    const source = ctx.sources[item.sourceId]
    if (!source) continue
    const canvas = await renderItem(item, source, { dpi, paper: ctx.paper, signal: ctx.signal })
    const size = await itemSize(item, source, ctx.paper)
    const img = await out.embedJpg(await (await canvasToBlob(canvas, 'image/jpeg', quality)).arrayBuffer())
    out.addPage([size.width, size.height]).drawImage(img, { x: 0, y: 0, width: size.width, height: size.height })
    ctx.onProgress?.(++done, items.length)
    await breathe()
  }
  out.setProducer('온비짱')
  out.setCreator('온비짱')
  return out
}

// ── 암호 ──────────────────────────────────────────────────
export interface ProtectOptions {
  password: string
  allowPrint: boolean
  allowCopy: boolean
  algorithm: 'AES-256' | 'AES-128'
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 열기 암호를 건다(AES). pdf-lib 는 암호화를 지원하지 않아, 암호화를 구현한 MIT 라이선스 갈래(@cantoo/pdf-lib)를 이 일에만 쓴다.
 * 권한을 바꿀 수 있는 소유자 암호는 무작위로 만들어 버린다(열기 암호로는 제한을 풀 수 없게).
 */
export async function encryptPdf(bytes: Uint8Array, opts: ProtectOptions): Promise<Uint8Array> {
  const { PDFDocument } = await import('@cantoo/pdf-lib')
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  doc.encrypt({
    userPassword: opts.password,
    ownerPassword: randomSecret(),
    algorithm: opts.algorithm,
    permissions: {
      printing: opts.allowPrint ? 'highResolution' : false,
      copying: opts.allowCopy,
      modifying: false,
      annotating: false,
      fillingForms: true,
      contentAccessibility: true,
      documentAssembly: false,
    },
  })
  return doc.save()
}

/** 암호화된 PDF 를 풀어, 쪽을 복사할 수 있는 보통 PDF 로 만든다. 풀 수 없는 방식이면 오류. */
export async function decryptPdf(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const { PDFDocument } = await import('@cantoo/pdf-lib')
  const src = await PDFDocument.load(bytes, { password, updateMetadata: false })
  const out = await PDFDocument.create()
  const pages = await out.copyPages(src, src.getPageIndices())
  for (const page of pages) out.addPage(page)
  return out.save()
}
