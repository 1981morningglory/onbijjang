/**
 * Word·Excel → PDF.
 * - 브라우저 안: docx 는 mammoth 로 내용(문단·제목·목록·표·그림)을 읽고, xlsx 는 표로 읽어
 *   직접 A4 쪽에 다시 앉힌다. 원본의 글꼴·색·단·머리말 같은 꾸밈은 옮기지 않는다.
 * - 브라우저 인쇄: 같은 내용을 인쇄 화면으로 띄워 "PDF 로 저장"을 고르게 한다.
 * - 서버 변환(선택): 온비짱 서버의 LibreOffice 로 원본 모양 그대로 바꾼다. 이 경우에만 파일이 서버로 간다.
 */
import type { PDFDocument, PDFFont, PDFImage, PDFPage } from 'pdf-lib'
import { ApiError, api } from '@/lib/api'
import { extOf } from '@/lib/files'
import { A4, MM, PX_TO_PT } from './geometry'
import { embedKoreanFont, supportedText } from './ops'
import { breathe } from './store'

// ── 내용 모델 ─────────────────────────────────────────────
interface Run {
  text: string
  bold: boolean
}
type Block =
  | { kind: 'text'; runs: Run[]; size: number; indent: number; bullet: string | null; before: number; after: number }
  | { kind: 'table'; rows: Run[][]; size: number }
  | { kind: 'image'; src: string }

export interface OfficeContent {
  blocks: Block[]
  /** 인쇄 화면용 HTML(위험한 요소를 걸러낸 것) */
  html: string
  landscape: boolean
  notes: string[]
}

const HEADING_SIZE: Record<string, number> = { H1: 20, H2: 16, H3: 14, H4: 12, H5: 11, H6: 11 }
const BODY_SIZE = 10.5

// ── docx 읽기 ─────────────────────────────────────────────
export async function readDocx(file: File): Promise<OfficeContent> {
  const mammoth = await import('mammoth')
  let html: string
  try {
    html = (await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() })).value
  } catch {
    throw new Error('Word 문서를 읽지 못했습니다. .docx 파일인지, 암호가 걸려 있지 않은지 확인해 주세요.')
  }
  const dom = new DOMParser().parseFromString(html, 'text/html')
  sanitize(dom.body)
  const blocks: Block[] = []
  collectBlocks(dom.body, blocks, 0)
  if (!blocks.length) throw new Error('문서에서 옮길 내용을 찾지 못했습니다.')
  return { blocks, html: dom.body.innerHTML, landscape: false, notes: [] }
}

const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'BASE', 'SVG', 'MATH', 'VIDEO', 'AUDIO'])

/** 문서에서 온 HTML 은 믿지 않는다: 실행될 수 있는 것과 바깥 주소를 모두 뺀다. */
function sanitize(root: HTMLElement) {
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (DROP_TAGS.has(el.tagName.toUpperCase())) {
      el.remove()
      continue
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      const value = attr.value.trim()
      if (name === 'src') {
        if (!/^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i.test(value)) el.removeAttribute(attr.name)
      } else if (name === 'href') {
        if (!/^(https?:|mailto:)/i.test(value)) el.removeAttribute(attr.name)
      } else if (name !== 'colspan' && name !== 'rowspan' && name !== 'alt') {
        el.removeAttribute(attr.name)
      }
    }
  }
}

function inlineRuns(node: Node, bold: boolean, out: Run[], images: string[]) {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? ''
      if (text) out.push({ text, bold })
    } else if (child instanceof HTMLElement) {
      const tag = child.tagName
      if (tag === 'BR') out.push({ text: '\n', bold })
      else if (tag === 'IMG') {
        const src = child.getAttribute('src')
        if (src) images.push(src)
      } else inlineRuns(child, bold || tag === 'STRONG' || tag === 'B', out, images)
    }
  }
}

function collectBlocks(root: Node, blocks: Block[], indent: number) {
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? '').trim()
      if (text) blocks.push({ kind: 'text', runs: [{ text, bold: false }], size: BODY_SIZE, indent, bullet: null, before: 0, after: 6 })
      continue
    }
    if (!(node instanceof HTMLElement)) continue
    const tag = node.tagName
    if (tag in HEADING_SIZE || tag === 'P') {
      const runs: Run[] = []
      const images: string[] = []
      inlineRuns(node, tag !== 'P', runs, images)
      const size = HEADING_SIZE[tag] ?? BODY_SIZE
      if (runs.some((r) => r.text.trim())) blocks.push({ kind: 'text', runs, size, indent, bullet: null, before: tag === 'P' ? 0 : size * 0.6, after: tag === 'P' ? 6 : size * 0.4 })
      for (const src of images) blocks.push({ kind: 'image', src })
    } else if (tag === 'UL' || tag === 'OL') {
      let n = 0
      for (const li of Array.from(node.children)) {
        if (li.tagName !== 'LI') continue
        n++
        const runs: Run[] = []
        const images: string[] = []
        // 목록 항목 안의 글(하위 목록 제외)
        const own = li.cloneNode(true) as HTMLElement
        for (const sub of Array.from(own.querySelectorAll('ul,ol'))) sub.remove()
        inlineRuns(own, false, runs, images)
        if (runs.some((r) => r.text.trim())) blocks.push({ kind: 'text', runs, size: BODY_SIZE, indent: indent + 1, bullet: tag === 'UL' ? '•' : `${n}.`, before: 0, after: 3 })
        for (const src of images) blocks.push({ kind: 'image', src })
        for (const sub of Array.from(li.children)) if (sub.tagName === 'UL' || sub.tagName === 'OL') collectBlocks(wrap(sub), blocks, indent + 1)
      }
    } else if (tag === 'TABLE') {
      const rows: Run[][] = []
      for (const tr of Array.from(node.querySelectorAll('tr'))) {
        if (tr.closest('table') !== node) continue // 표 안의 표는 바깥 칸의 글로만 다룬다
        const cells: Run[] = []
        for (const cell of Array.from(tr.children)) {
          if (cell.tagName !== 'TD' && cell.tagName !== 'TH') continue
          const parts = Array.from(cell.querySelectorAll('p,li,h1,h2,h3,h4,h5,h6')).map((p) => (p.textContent ?? '').trim()).filter(Boolean)
          const text = parts.length ? parts.join('\n') : (cell.textContent ?? '').trim()
          cells.push({ text, bold: cell.tagName === 'TH' || (cell.querySelector('strong,b') !== null && (cell.querySelector('strong,b')!.textContent ?? '').trim() === text) })
          const spanned = Number(cell.getAttribute('colspan') ?? 1)
          for (let i = 1; i < spanned && i < 50; i++) cells.push({ text: '', bold: false })
        }
        if (cells.length) rows.push(cells)
      }
      if (rows.length) blocks.push({ kind: 'table', rows, size: 9.5 })
    } else if (tag === 'IMG') {
      const src = node.getAttribute('src')
      if (src) blocks.push({ kind: 'image', src })
    } else {
      collectBlocks(node, blocks, indent)
    }
  }
}

function wrap(el: Element): Node {
  const holder = document.createElement('div')
  holder.appendChild(el.cloneNode(true))
  return holder
}

// ── xlsx 읽기 ─────────────────────────────────────────────
const MAX_SHEET_ROWS = 3000
const MAX_SHEET_COLS = 40

export async function readXlsx(file: File): Promise<OfficeContent> {
  const XLSX = await import('xlsx')
  let book: import('xlsx').WorkBook
  try {
    book = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
  } catch {
    throw new Error('Excel 문서를 읽지 못했습니다. .xlsx 파일인지, 암호가 걸려 있지 않은지 확인해 주세요.')
  }
  const blocks: Block[] = []
  const notes: string[] = []
  const htmlParts: string[] = []
  let maxCols = 0
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name]
    if (!sheet) continue
    let rows = (XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }) as unknown[][]).map((row) => row.map((v) => (v == null ? '' : String(v))))
    while (rows.length && rows[rows.length - 1].every((c) => c.trim() === '')) rows.pop()
    let cols = Math.max(0, ...rows.map((row) => row.reduce((last, c, i) => (c.trim() !== '' ? i + 1 : last), 0)))
    if (!rows.length || !cols) continue
    if (rows.length > MAX_SHEET_ROWS) {
      notes.push(`‘${name}’ 시트는 ${MAX_SHEET_ROWS.toLocaleString('ko-KR')}행까지만 옮겼습니다(전체 ${rows.length.toLocaleString('ko-KR')}행).`)
      rows = rows.slice(0, MAX_SHEET_ROWS)
    }
    if (cols > MAX_SHEET_COLS) {
      notes.push(`‘${name}’ 시트는 ${MAX_SHEET_COLS}열까지만 옮겼습니다(전체 ${cols}열).`)
      cols = MAX_SHEET_COLS
    }
    maxCols = Math.max(maxCols, cols)
    const table = rows.map((row) => Array.from({ length: cols }, (_, c) => ({ text: row[c] ?? '', bold: false })))
    blocks.push({ kind: 'text', runs: [{ text: name, bold: true }], size: 13, indent: 0, bullet: null, before: blocks.length ? 14 : 0, after: 6 })
    blocks.push({ kind: 'table', rows: table, size: cols > 10 ? 7.5 : 9 })
    htmlParts.push(`<h2>${escapeHtml(name)}</h2><table>${table.map((row) => `<tr>${row.map((c) => `<td>${escapeHtml(c.text)}</td>`).join('')}</tr>`).join('')}</table>`)
  }
  if (!blocks.length) throw new Error('내용이 있는 시트를 찾지 못했습니다.')
  return { blocks, html: htmlParts.join(''), landscape: maxCols > 6, notes }
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)

// ── PDF 로 앉히기 ─────────────────────────────────────────
const CJK = 'ᄀ-ᇿ⺀-鿿가-힯豈-﫿＀-￯'
const TOKEN_RE = new RegExp(`\\n|[ \\t]+|[${CJK}]|[^\\s${CJK}]+`, 'g')

interface Segment {
  text: string
  bold: boolean
  width: number
}

class Typesetter {
  private widths = new Map<string, number>()
  constructor(
    private regular: PDFFont,
    private bold: PDFFont,
  ) {}

  font(bold: boolean): PDFFont {
    return bold ? this.bold : this.regular
  }

  width(text: string, bold: boolean, size: number): number {
    const key = (bold ? 'b' : 'r') + text
    let w = this.widths.get(key)
    if (w === undefined) {
      w = this.font(bold).widthOfTextAtSize(text, 1)
      this.widths.set(key, w)
    }
    return w * size
  }

  /** 줄바꿈: 한글·한자는 글자마다, 그 밖은 낱말마다 끊는다. 너무 긴 낱말은 글자 단위로 자른다. */
  wrap(runs: Run[], size: number, maxWidth: number): Segment[][] {
    const lines: Segment[][] = [[]]
    let lineWidth = 0
    const push = (text: string, bold: boolean, width: number) => {
      const line = lines[lines.length - 1]
      const last = line[line.length - 1]
      if (last && last.bold === bold) {
        last.text += text
        last.width += width
      } else line.push({ text, bold, width })
      lineWidth += width
    }
    const newLine = () => {
      lines.push([])
      lineWidth = 0
    }
    for (const run of runs) {
      const text = keepBreaks(run.text, this.font(run.bold))
      for (const token of text.match(TOKEN_RE) ?? []) {
        if (token === '\n') {
          newLine()
          continue
        }
        const isSpace = /^[ \t]+$/.test(token)
        const w = this.width(isSpace ? ' ' : token, run.bold, size)
        if (isSpace) {
          if (lineWidth > 0 && lineWidth + w <= maxWidth) push(' ', run.bold, w)
          continue
        }
        if (lineWidth + w <= maxWidth) {
          push(token, run.bold, w)
        } else if (w <= maxWidth) {
          newLine()
          push(token, run.bold, w)
        } else {
          for (const ch of token) {
            const cw = this.width(ch, run.bold, size)
            if (lineWidth + cw > maxWidth && lineWidth > 0) newLine()
            push(ch, run.bold, cw)
          }
        }
      }
    }
    // 줄 끝 공백 정리
    for (const line of lines) {
      const last = line[line.length - 1]
      if (last && last.text.endsWith(' ')) {
        last.text = last.text.trimEnd()
        last.width = 0
      }
    }
    return lines
  }
}

/** 글꼴에 없는 글자를 빼되, 줄바꿈은 그대로 둔다. */
function keepBreaks(text: string, font: PDFFont): string {
  return text
    .split(/\r?\n/)
    .map((part) => supportedText(font, part))
    .join('\n')
}

export interface OfficePdfResult {
  doc: PDFDocument
  pages: number
  notes: string[]
}

export async function officeToPdf(content: OfficeContent, signal?: AbortSignal, onProgress?: (fraction: number) => void): Promise<OfficePdfResult> {
  const { PDFDocument, rgb } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  const type = new Typesetter(await embedKoreanFont(doc, 'regular'), await embedKoreanFont(doc, 'bold'))
  const pageW = content.landscape ? A4.h : A4.w
  const pageH = content.landscape ? A4.w : A4.h
  const margin = (content.landscape ? 12 : 20) * MM
  const contentW = pageW - margin * 2
  const bottom = margin
  const ink = rgb(0.1, 0.1, 0.1)
  const rule = rgb(0.6, 0.6, 0.6)
  const notes = [...content.notes]
  let skippedImages = 0

  let page: PDFPage = doc.addPage([pageW, pageH])
  let y = pageH - margin
  const newPage = () => {
    page = doc.addPage([pageW, pageH])
    y = pageH - margin
  }
  const drawLine = (segments: Segment[], x: number, baseline: number, size: number) => {
    let cx = x
    for (const seg of segments) {
      if (seg.text.trim()) page.drawText(seg.text, { x: cx, y: baseline, size, font: type.font(seg.bold), color: ink })
      cx += seg.width || type.width(seg.text, seg.bold, size)
    }
  }

  for (let b = 0; b < content.blocks.length; b++) {
    signal?.throwIfAborted()
    const block = content.blocks[b]
    if (block.kind === 'text') {
      const lineH = block.size * 1.5
      const left = margin + block.indent * 16
      const lines = type.wrap(block.runs, block.size, pageW - margin - left)
      y -= block.before
      lines.forEach((line, i) => {
        if (y - lineH < bottom) newPage()
        if (i === 0 && block.bullet) page.drawText(supportedText(type.font(false), block.bullet), { x: left - 13, y: y - block.size, size: block.size, font: type.font(false), color: ink })
        drawLine(line, left, y - block.size, block.size)
        y -= lineH
      })
      y -= block.after
    } else if (block.kind === 'image') {
      let image: PDFImage | null = null
      try {
        const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(block.src)
        if (m) {
          const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0))
          image = m[1].toLowerCase() === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
        }
      } catch {
        image = null
      }
      if (!image) {
        skippedImages++
        continue
      }
      const maxH = (pageH - margin * 2) * 0.9
      const s = Math.min(1, contentW / (image.width * PX_TO_PT), maxH / (image.height * PX_TO_PT))
      const w = image.width * PX_TO_PT * s
      const h = image.height * PX_TO_PT * s
      if (y - h < bottom) newPage()
      page.drawImage(image, { x: margin, y: y - h, width: w, height: h })
      y -= h + 8
    } else {
      // 표: 열 너비는 내용 길이에 비례, 칸 안에서 줄바꿈, 쪽을 넘으면 줄 단위로 나눠 잇는다.
      const pad = 3
      const size = block.size
      const lineH = size * 1.4
      const cols = Math.max(...block.rows.map((r) => r.length))
      const natural = Array.from({ length: cols }, (_, c) => Math.min(220, Math.max(24, ...block.rows.slice(0, 200).map((r) => (r[c] ? Math.max(...r[c].text.split('\n').map((t) => type.width(supportedText(type.font(r[c].bold), t), r[c].bold, size))) : 0))) + pad * 2 + 2))
      const total = natural.reduce((a, v) => a + v, 0)
      const widths = total > contentW ? natural.map((w) => (w / total) * contentW) : natural
      y -= 2
      for (let r = 0; r < block.rows.length; r++) {
        if (r % 50 === 49) {
          signal?.throwIfAborted()
          await breathe()
        }
        const row = block.rows[r]
        const cellLines = widths.map((w, c) => (row[c]?.text ? type.wrap([row[c]], size, Math.max(8, w - pad * 2)) : [[]]))
        let from = 0
        const most = Math.max(...cellLines.map((l) => l.length))
        while (from < most) {
          let room = Math.floor((y - bottom - pad * 2) / lineH)
          if (room < 1) {
            newPage()
            room = Math.floor((y - bottom - pad * 2) / lineH)
          }
          const count = Math.min(room, most - from)
          const rowH = count * lineH + pad * 2
          let x = margin
          for (let c = 0; c < cols; c++) {
            page.drawRectangle({ x, y: y - rowH, width: widths[c], height: rowH, borderColor: rule, borderWidth: 0.5 })
            const lines = cellLines[c].slice(from, from + count)
            lines.forEach((line, i) => drawLine(line, x + pad, y - pad - size - i * lineH, size))
            x += widths[c]
          }
          y -= rowH
          from += count
        }
      }
      y -= 10
    }
    onProgress?.((b + 1) / content.blocks.length)
    if (b % 20 === 19) await breathe()
  }
  if (skippedImages) notes.push(`그림 ${skippedImages}개는 형식을 지원하지 않아 빠졌습니다(PNG·JPG 만 넣습니다).`)
  doc.setProducer('온비짱')
  doc.setCreator('온비짱')
  return { doc, pages: doc.getPageCount(), notes }
}

// ── 브라우저 인쇄 ─────────────────────────────────────────
/**
 * 내용을 숨은 인쇄 화면에 띄우고 브라우저 인쇄 창을 연다. 사용자가 "PDF 로 저장"을 고르면 된다.
 * 인쇄 화면은 스크립트를 실행할 수 없는 샌드박스 프레임이다.
 */
export function printContent(content: OfficeContent, title: string): void {
  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-same-origin allow-modals')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  frame.srcdoc = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
@page { size: A4 ${content.landscape ? 'landscape' : 'portrait'}; margin: ${content.landscape ? 12 : 20}mm; }
body { font-family: 'Pretendard Variable', Pretendard, 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif; font-size: 10.5pt; line-height: 1.6; color: #111; margin: 0; }
h1 { font-size: 20pt; } h2 { font-size: 16pt; } h3 { font-size: 14pt; } h4, h5, h6 { font-size: 12pt; }
h1, h2, h3, h4, h5, h6 { margin: 0.8em 0 0.4em; break-after: avoid; }
p { margin: 0 0 0.5em; }
table { border-collapse: collapse; width: 100%; margin: 0.5em 0 1em; font-size: 9.5pt; }
td, th { border: 0.5pt solid #777; padding: 2pt 4pt; vertical-align: top; text-align: left; }
tr { break-inside: avoid; }
img { max-width: 100%; height: auto; }
</style></head><body>${content.html}</body></html>`
  frame.onload = () => {
    const win = frame.contentWindow
    if (!win) return frame.remove()
    const cleanup = () => setTimeout(() => frame.remove(), 500)
    win.addEventListener('afterprint', cleanup, { once: true })
    win.focus()
    win.print()
    setTimeout(() => frame.remove(), 10 * 60_000)
  }
  document.body.appendChild(frame)
}

// ── 서버 변환(선택 기능) ──────────────────────────────────
export interface ConvertStatus {
  available: boolean
  maxBytes: number
  extensions: string[]
}

/** 서버에 LibreOffice 가 있어 변환할 수 있는지. 서버가 없거나 기능이 없으면 available=false. */
export async function fetchConvertStatus(): Promise<ConvertStatus> {
  try {
    const s = await api<Partial<ConvertStatus>>('/convert/status')
    return { available: s.available === true, maxBytes: typeof s.maxBytes === 'number' ? s.maxBytes : 100 * 1024 * 1024, extensions: Array.isArray(s.extensions) ? s.extensions : [] }
  } catch {
    return { available: false, maxBytes: 0, extensions: [] }
  }
}

/** 파일을 온비짱 서버로 보내 PDF 로 바꿔 받는다. 이 도구에서 파일이 기기 밖으로 나가는 유일한 경로. */
export async function convertOnServer(file: File, signal?: AbortSignal): Promise<Blob> {
  const form = new FormData()
  // 파일 이름은 보내지 않는다 — 서버는 확장자만 알면 된다.
  form.append('file', file, `document.${extOf(file.name)}`)
  let res: Response
  try {
    res = await fetch('/api/convert/office-to-pdf', { method: 'POST', body: form, credentials: 'same-origin', signal })
  } catch (err) {
    if (signal?.aborted) throw err
    throw new ApiError(0, '서버에 연결할 수 없습니다. 잠시 후 다시 시도하거나 ‘이 기기에서 변환’을 써 주세요.')
  }
  if (!res.ok) {
    let message = `서버 변환에 실패했습니다 (${res.status}).`
    try {
      const json = (await res.json()) as { error?: string }
      if (json.error) message = json.error
    } catch {
      // JSON 이 아니면 기본 문구를 쓴다
    }
    throw new ApiError(res.status, message)
  }
  const blob = await res.blob()
  if (blob.size < 100) throw new Error('서버가 빈 결과를 돌려주었습니다. 문서를 열 수 있는지 확인해 주세요.')
  return new Blob([blob], { type: 'application/pdf' })
}
