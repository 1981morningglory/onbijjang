import type { PDFFont, PDFImage, PDFOperator, PDFPage } from 'pdf-lib'
import type { BarcodeResult } from './barcode'
import {
  PT_PER_MM,
  barcodeBox,
  cellOutlineCmds,
  cellRect,
  cellsPerSheet,
  imageBox,
  labelsOnPage,
  layoutText,
  parsePath,
  planDoc,
  resolveText,
  roundRectCmds,
  shapeCmds,
  type FontId,
  type LabelDoc,
  type Measure,
  type PathCmd,
  type Rect,
  type Symbology,
  type TextEl,
  type TextLayout,
} from './model'

/**
 * 라벨 문서를 A4 PDF 로 만든다. 도형·바코드·칼선은 벡터, 프리텐다드 글자는 글꼴을 심은 벡터 글자,
 * 그 밖의 글꼴(또는 글꼴에 없는 글자)은 rasterText 가 만든 고해상도 그림으로 넣는다.
 * 좌표는 모두 mm 로 계산한 뒤 여기서만 pt 로 바꾼다(1mm = 72/25.4pt, y 는 아래에서 위로).
 */
export interface PdfEnv {
  /** 줄 나눔에 쓰는 글자 너비 재기 — 화면과 같은 함수를 넣어 줄이 똑같이 나뉘게 한다 */
  measureFor: (font: FontId, bold: boolean) => Measure
  barcode: (symbology: Symbology, value: string) => BarcodeResult
  /** 프리텐다드 TTF. 없으면 모든 글자를 rasterText 로 넣는다 */
  fonts?: { regular: Uint8Array; bold: Uint8Array } | null
  /** @pdf-lib/fontkit */
  fontkit?: unknown
  /** 글자 한 덩어리를 투명 PNG 로. box 는 라벨 좌표(mm) */
  rasterText?: (el: TextEl, layout: TextLayout) => Promise<{ png: Uint8Array; box: Rect } | null>
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
}

export interface PdfStats {
  pages: number
  labels: number
  /** 값이 맞지 않아 비워 둔 바코드 수 */
  skippedBarcodes: number
  /** 그림으로 넣은 글자 덩어리 수 */
  rasterTexts: number
}

function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [0, 0, 0]
  const n = parseInt(m[1], 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function dataUrlBytes(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const m = /^data:([^;,]+)[^,]*;base64,(.*)$/s.exec(dataUrl)
  if (!m) throw new Error('이미지 형식을 읽지 못했습니다.')
  const bin = atob(m[2])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { bytes, mime: m[1] }
}

interface SubsetLike {
  glyf: Array<{ length: number; constructor: unknown }>
  offset: number
  _addGlyph: (gid: number) => number
}

/**
 * @pdf-lib/fontkit 의 TrueType 부분 글꼴 만들기에는 결함이 있다: 글리프 자료를 원본 길이 그대로 이어 붙이고
 * 위치표(loca)는 2로 나눈 짧은 형식으로 쓰기 때문에, 길이가 홀수인 글리프가 하나라도 있으면 그 뒤 글리프가 어긋나
 * 글자가 빠진 채로 나온다. 프리텐다드 TTF 는 글리프의 44%가 홀수 길이다.
 * 글리프를 넣을 때마다 짝수 길이로 채워(0 한 바이트) 바로잡는다. 손댈 수 없으면 false.
 */
export function padSubsetGlyphs(font: PDFFont): boolean {
  const subset = (font as unknown as { embedder?: { subset?: SubsetLike } }).embedder?.subset
  if (!subset || typeof subset._addGlyph !== 'function') return false
  const original = subset._addGlyph
  subset._addGlyph = function (this: SubsetLike, gid: number) {
    const index = original.call(this, gid)
    const buffer = this.glyf[index]
    if (buffer && buffer.length % 2 === 1) {
      const Buf = buffer.constructor as { concat?: (list: unknown[]) => SubsetLike['glyf'][number]; alloc?: (n: number) => unknown }
      if (typeof Buf.concat !== 'function' || typeof Buf.alloc !== 'function') throw new Error('글꼴을 줄여 담지 못했습니다.')
      this.glyf[index] = Buf.concat([buffer, Buf.alloc(1)])
      this.offset += 1
    }
    return index
  }
  return true
}

export async function buildLabelPdf(doc: LabelDoc, env: PdfEnv): Promise<{ bytes: Uint8Array; stats: PdfStats }> {
  const lib = await import('pdf-lib')
  const { PDFDocument, PDFOperator: Op, PDFOperatorNames: Names, rgb } = lib
  const sheet = doc.sheet
  const pageWpt = sheet.pageW * PT_PER_MM
  const pageHpt = sheet.pageH * PT_PER_MM
  const ox = doc.print.offsetX
  const oy = doc.print.offsetY

  const pdf = await PDFDocument.create()
  pdf.setTitle('라벨')
  pdf.setCreator('온비짱 A4 라벨메이트')

  let regular: PDFFont | null = null
  let bold: PDFFont | null = null
  let charset: Set<number> | null = null
  if (env.fonts && env.fontkit) {
    pdf.registerFontkit(env.fontkit as Parameters<typeof pdf.registerFontkit>[0])
    const r = await pdf.embedFont(env.fonts.regular, { subset: true })
    const b = await pdf.embedFont(env.fonts.bold, { subset: true })
    // 부분 글꼴을 바로잡을 수 없으면(라이브러리 내부가 바뀐 경우) 글자를 심지 않고 그림으로 넣는다.
    if (padSubsetGlyphs(r) && padSubsetGlyphs(b)) {
      regular = r
      bold = b
      charset = new Set(r.getCharacterSet())
    }
  }
  const canEmbed = (text: string) => charset !== null && Array.from(text).every((ch) => ch === '\n' || charset!.has(ch.codePointAt(0)!))

  /** 용지 좌표(mm, 왼쪽 위 기준) → PDF 좌표(pt, 왼쪽 아래 기준) */
  const X = (mm: number) => (mm + ox) * PT_PER_MM
  const Y = (mm: number) => pageHpt - (mm + oy) * PT_PER_MM

  type Map2 = (x: number, y: number) => [number, number]
  const pathOps = (cmds: PathCmd[], map: Map2): PDFOperator[] =>
    cmds.map((c) => {
      if (c[0] === 'M') return lib.moveTo(...map(c[1], c[2]))
      if (c[0] === 'L') return lib.lineTo(...map(c[1], c[2]))
      if (c[0] === 'C') return lib.appendBezierCurve(...map(c[1], c[2]), ...map(c[3], c[4]), ...map(c[5], c[6]))
      return lib.closePath()
    })

  const images = new Map<string, PDFImage | null>()
  const embedImage = async (src: string): Promise<PDFImage | null> => {
    if (images.has(src)) return images.get(src)!
    let image: PDFImage | null = null
    try {
      const { bytes, mime } = dataUrlBytes(src)
      image = mime === 'image/jpeg' ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes)
    } catch {
      image = null
    }
    images.set(src, image)
    return image
  }
  const rasters = new Map<string, { image: PDFImage; box: Rect } | null>()

  const plan = planDoc(doc)
  const total = plan.labels.filter(Boolean).length
  const stats: PdfStats = { pages: plan.pages, labels: total, skippedBarcodes: 0, rasterTexts: 0 }
  const perSheet = cellsPerSheet(sheet)
  let done = 0

  const drawTextLines = (page: PDFPage, lines: string[], baselines: number[], font: PDFFont, sizePt: number, color: string, align: 'left' | 'center' | 'right', left: number, width: number, cell: Rect) => {
    const [r, g, b] = hexRgb(color)
    lines.forEach((line, i) => {
      if (line.trim() === '') return
      const lineW = font.widthOfTextAtSize(line, sizePt) / PT_PER_MM
      const x = align === 'left' ? left : align === 'center' ? left + (width - lineW) / 2 : left + width - lineW
      page.drawText(line, { x: X(cell.x + x), y: Y(cell.y + baselines[i]), size: sizePt, font, color: rgb(r, g, b) })
    })
  }

  for (let p = 0; p < plan.pages; p++) {
    const page = pdf.addPage([pageWpt, pageHpt])
    for (const { cell: cellIndex, label } of labelsOnPage(plan, p)) {
      if (env.signal?.aborted) throw new DOMException('취소했습니다.', 'AbortError')
      const cell = cellRect(sheet, cellIndex)
      const local: Map2 = (x, y) => [X(cell.x + x), Y(cell.y + y)]

      // 라벨 밖으로 나간 부분은 잘라 낸다.
      page.pushOperators(lib.pushGraphicsState())
      if (sheet.shape === 'cd') {
        for (const outline of cellOutlineCmds(sheet, { x: 0, y: 0, w: cell.w, h: cell.h })) page.pushOperators(...pathOps(outline, local))
        page.pushOperators(lib.clipEvenOdd(), lib.endPath())
      } else {
        page.pushOperators(...pathOps(roundRectCmds(0, 0, cell.w, cell.h, 0), local), lib.clip(), lib.endPath())
      }

      for (const el of doc.design) {
        if (el.type === 'shape') {
          const closed = el.shape !== 'line'
          const hasFill = closed && el.fill
          const hasStroke = el.stroke && el.strokeWidth > 0
          if (!hasFill && !hasStroke) continue
          const ops: PDFOperator[] = [lib.pushGraphicsState()]
          if (hasFill) ops.push(lib.setFillingRgbColor(...hexRgb(el.fill!)))
          if (hasStroke) ops.push(lib.setStrokingRgbColor(...hexRgb(el.stroke!)), lib.setLineWidth(el.strokeWidth * PT_PER_MM))
          ops.push(...pathOps(shapeCmds(el), local))
          ops.push(hasFill && hasStroke ? lib.fillAndStroke() : hasFill ? lib.fill() : lib.stroke())
          ops.push(lib.popGraphicsState())
          page.pushOperators(...ops)
        } else if (el.type === 'image') {
          const image = await embedImage(el.src)
          if (!image) continue
          const box = imageBox(el)
          page.pushOperators(lib.pushGraphicsState(), ...pathOps(roundRectCmds(el.x, el.y, el.w, el.h, 0), local), lib.clip(), lib.endPath())
          page.drawImage(image, { x: X(cell.x + el.x + box.x), y: Y(cell.y + el.y + box.y + box.h), width: box.w * PT_PER_MM, height: box.h * PT_PER_MM })
          page.pushOperators(lib.popGraphicsState())
        } else if (el.type === 'barcode') {
          const result = env.barcode(el.symbology, resolveText(el.value, label))
          if (!result.ok) {
            stats.skippedBarcodes++
            continue
          }
          const linear = result.def.kind === 'linear'
          const box = barcodeBox(el, result.geometry, linear)
          const sx = box.bars.w / result.geometry.w
          const sy = box.bars.h / result.geometry.h
          const map: Map2 = (x, y) => local(el.x + box.bars.x + x * sx, el.y + box.bars.y + y * sy)
          page.pushOperators(lib.pushGraphicsState(), lib.setFillingRgbColor(...hexRgb(el.color)), ...pathOps(parsePath(result.geometry.d), map), Op.of(Names.FillEvenOdd), lib.popGraphicsState())
          if (box.textBaseline !== null && regular && canEmbed(result.display)) {
            drawTextLines(page, [result.display], [el.y + box.textBaseline], regular, el.textSize, el.color, 'center', el.x, el.w, cell)
          }
        } else {
          const text = resolveText(el.text, label)
          if (text.trim() === '') continue
          const layout = layoutText({ text, w: el.w, h: el.h, size: el.size, valign: el.valign, shrink: el.shrink }, env.measureFor(el.font, el.bold))
          const font = el.bold ? bold : regular
          if (el.font === 'pretendard' && font && canEmbed(text)) {
            drawTextLines(page, layout.lines, layout.baselines.map((b) => el.y + b), font, layout.sizePt, el.color, el.align, el.x, el.w, cell)
            continue
          }
          if (!env.rasterText) continue
          const key = JSON.stringify([text, el.font, el.bold, el.size, el.align, el.valign, el.color, el.shrink, el.w, el.h])
          let raster = rasters.get(key)
          if (raster === undefined) {
            const made = await env.rasterText({ ...el, text }, layout)
            raster = made ? { image: await pdf.embedPng(made.png), box: { ...made.box, x: made.box.x - el.x, y: made.box.y - el.y } } : null
            rasters.set(key, raster)
            if (raster) stats.rasterTexts++
          }
          if (!raster) continue
          const b = raster.box
          page.drawImage(raster.image, { x: X(cell.x + el.x + b.x), y: Y(cell.y + el.y + b.y + b.h), width: b.w * PT_PER_MM, height: b.h * PT_PER_MM })
        }
      }
      page.pushOperators(lib.popGraphicsState())

      done++
      if (done % 25 === 0) {
        env.onProgress?.(done, total)
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }

    if (doc.print.cutLines) {
      const ops: PDFOperator[] = [lib.pushGraphicsState(), lib.setStrokingRgbColor(0.55, 0.55, 0.55), lib.setLineWidth(0.1 * PT_PER_MM)]
      const pageMap: Map2 = (x, y) => [X(x), Y(y)]
      for (let c = 0; c < perSheet; c++) {
        for (const outline of cellOutlineCmds(sheet, cellRect(sheet, c))) ops.push(...pathOps(outline, pageMap), lib.stroke())
      }
      ops.push(lib.popGraphicsState())
      page.pushOperators(...ops)
    }
  }
  env.onProgress?.(total, total)
  return { bytes: await pdf.save(), stats }
}
