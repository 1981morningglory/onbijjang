/**
 * 그리기 명령(layout.ts)을 캔버스·PDF 로 그린다. 화면 미리보기(SVG)는 Preview.tsx.
 * image 명령은 칸 안에 원본 비율을 지켜(contain) 넣는다.
 */
import type { PDFDocument, PDFFont, PDFImage, PDFPage } from 'pdf-lib'
import boldFontUrl from 'pretendard/dist/public/static/alternative/Pretendard-Bold.ttf?url'
import regularFontUrl from 'pretendard/dist/public/static/alternative/Pretendard-Regular.ttf?url'
// 한글 글꼴 줄이기 오류를 고친 fontkit (PDF 도구와 같은 수정본을 쓴다)
import { fixedFontkit } from '@/tools/pdf/fontkit-fix'
import { canvasToBlob, ctx2d, loadImageElement, makeCanvas, type RasterFormat } from '@/lib/image'
import { containRect, FONT_FAMILY, PAGE_H, PAGE_W, PT, type Op, type Page } from './layout'

// ── 캔버스(이미지 저장용) ─────────────────────────────────
const imageCache = new Map<string, Promise<HTMLImageElement>>()
const loadImg = (src: string) => {
  let p = imageCache.get(src)
  if (!p) {
    p = loadImageElement(src)
    imageCache.set(src, p)
  }
  return p
}

export async function ensureFonts(texts: string[]) {
  const sample = [...new Set(texts.join(''))].join('').slice(0, 400) || '가A1'
  await Promise.all([document.fonts.load(`400 12px ${FONT_FAMILY}`, sample), document.fonts.load(`700 12px ${FONT_FAMILY}`, sample)]).catch(() => {})
}

export async function renderPageToCanvas(page: Page, dpi = 200): Promise<HTMLCanvasElement> {
  const pxPerMm = dpi / 25.4
  const canvas = makeCanvas(PAGE_W * pxPerMm, PAGE_H * pxPerMm)
  const ctx = ctx2d(canvas)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.scale(pxPerMm, pxPerMm)
  await ensureFonts(page.ops.flatMap((o) => (o.t === 'text' ? [o.text] : [])))
  for (const op of page.ops) await drawCanvasOp(ctx, op)
  return canvas
}

async function drawCanvasOp(ctx: CanvasRenderingContext2D, op: Op) {
  ctx.save()
  if (op.t === 'rect') {
    if (op.fill) {
      ctx.fillStyle = op.fill
      ctx.fillRect(op.x, op.y, op.w, op.h)
    }
    if (op.stroke) {
      ctx.strokeStyle = op.stroke
      ctx.lineWidth = op.lw ?? 0.2
      ctx.strokeRect(op.x, op.y, op.w, op.h)
    }
  } else if (op.t === 'line') {
    ctx.strokeStyle = op.color
    ctx.lineWidth = op.lw
    if (op.dash) ctx.setLineDash(op.dash)
    ctx.beginPath()
    ctx.moveTo(op.x1, op.y1)
    ctx.lineTo(op.x2, op.y2)
    ctx.stroke()
  } else if (op.t === 'text') {
    const sizeMm = op.size * PT
    ctx.font = `${op.weight === 'bold' ? 700 : 400} ${sizeMm}px ${FONT_FAMILY}`
    ctx.fillStyle = op.color
    ctx.textBaseline = 'alphabetic'
    if (op.spacing) {
      // 글자 사이를 벌린 제목: 한 글자씩 그린다
      const chars = [...op.text]
      const widths = chars.map((ch) => ctx.measureText(ch).width)
      const total = widths.reduce((s, w) => s + w, 0) + op.spacing * (chars.length - 1)
      let x = op.align === 'center' ? op.x - total / 2 : op.align === 'right' ? op.x - total : op.x
      chars.forEach((ch, i) => {
        ctx.fillText(ch, x, op.y)
        x += widths[i] + op.spacing!
      })
    } else {
      ctx.textAlign = op.align
      ctx.fillText(op.text, op.x, op.y)
    }
  } else if (op.t === 'image') {
    try {
      const img = await loadImg(op.src)
      const r = containRect(op.x, op.y, op.w, op.h, img.naturalWidth, img.naturalHeight, op.top)
      if (op.opacity != null) ctx.globalAlpha = op.opacity
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, r.x, r.y, r.w, r.h)
    } catch {
      // 깨진 이미지는 건너뛴다
    }
  }
  ctx.restore()
}

export async function pagesToImages(pages: Page[], format: RasterFormat, dpi = 200, onProgress?: (i: number) => void): Promise<Blob[]> {
  const out: Blob[] = []
  for (let i = 0; i < pages.length; i++) {
    const c = await renderPageToCanvas(pages[i], dpi)
    out.push(await canvasToBlob(c, format, 0.92))
    onProgress?.(i + 1)
  }
  return out
}

// ── PDF ───────────────────────────────────────────────────

const fontBytes: Partial<Record<'regular' | 'bold', Promise<Uint8Array>>> = {}
function loadFont(weight: 'regular' | 'bold') {
  fontBytes[weight] ??= fetch(weight === 'bold' ? boldFontUrl : regularFontUrl).then(async (r) => {
    if (!r.ok) throw new Error('PDF 에 넣을 글꼴을 불러오지 못했습니다.')
    return new Uint8Array(await r.arrayBuffer())
  })
  return fontBytes[weight]!
}

function hexToRgb01(hex: string) {
  const m = hex.replace('#', '')
  const n = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16)
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }
}

function dataUrlBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const bin = atob(base64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function pagesToPdf(pages: Page[], meta: { title: string; author: string }): Promise<Uint8Array> {
  const lib = await import('pdf-lib')
  const { PDFDocument, rgb } = lib
  const [fk, regularBytes, boldBytes] = await Promise.all([import('@pdf-lib/fontkit'), loadFont('regular'), loadFont('bold')])
  const doc = await PDFDocument.create()
  const { fontkit, safe } = fixedFontkit(fk.default, regularBytes)
  doc.registerFontkit(fontkit)
  const fonts = { regular: await doc.embedFont(regularBytes, { subset: safe }), bold: await doc.embedFont(boldBytes, { subset: safe }) }
  doc.setTitle(meta.title)
  doc.setAuthor(meta.author)
  doc.setCreator('온비짱')
  doc.setProducer('온비짱')

  const images = new Map<string, PDFImage>()
  const embedImage = async (src: string) => {
    let im = images.get(src)
    if (!im) {
      const bytes = dataUrlBytes(src)
      im = src.startsWith('data:image/png') ? await doc.embedPng(bytes) : await doc.embedJpg(bytes).catch(async () => doc.embedPng(await toPngBytes(src)))
      images.set(src, im)
    }
    return im
  }
  const sourcePdfs = new Map<string, PDFDocument>()

  for (const page of pages) {
    // 첨부가 원본 PDF 면 그 쪽을 그대로 복사한다(글자 선택이 되는 원본 품질)
    if (page.attachment?.pdfDataUrl) {
      let src = sourcePdfs.get(page.attachment.pdfDataUrl)
      if (!src) {
        src = await PDFDocument.load(dataUrlBytes(page.attachment.pdfDataUrl), { ignoreEncryption: true })
        sourcePdfs.set(page.attachment.pdfDataUrl, src)
      }
      if (page.attachment.pageIndex < src.getPageCount()) {
        const [copied] = await doc.copyPages(src, [page.attachment.pageIndex])
        doc.addPage(copied)
        continue
      }
    }
    const pdfPage = doc.addPage([PAGE_W / PT, PAGE_H / PT])
    for (const op of page.ops) await drawPdfOp(pdfPage, op, fonts, embedImage, rgb)
  }
  return doc.save()
}

async function toPngBytes(src: string): Promise<Uint8Array> {
  const img = await loadImageElement(src)
  const c = makeCanvas(img.naturalWidth, img.naturalHeight)
  ctx2d(c).drawImage(img, 0, 0)
  const blob = await canvasToBlob(c, 'image/png')
  return new Uint8Array(await blob.arrayBuffer())
}

async function drawPdfOp(
  page: PDFPage,
  op: Op,
  fonts: Record<'regular' | 'bold', PDFFont>,
  embedImage: (src: string) => Promise<PDFImage>,
  rgb: (r: number, g: number, b: number) => ReturnType<typeof import('pdf-lib').rgb>,
) {
  const X = (mm: number) => mm / PT
  const Y = (mm: number) => (PAGE_H - mm) / PT
  const color = (hex: string) => {
    const c = hexToRgb01(hex)
    return rgb(c.r, c.g, c.b)
  }
  if (op.t === 'rect') {
    page.drawRectangle({
      x: X(op.x),
      y: Y(op.y + op.h),
      width: X(op.w),
      height: X(op.h),
      color: op.fill ? color(op.fill) : undefined,
      borderColor: op.stroke ? color(op.stroke) : undefined,
      borderWidth: op.stroke ? X(op.lw ?? 0.2) : 0,
    })
  } else if (op.t === 'line') {
    page.drawLine({ start: { x: X(op.x1), y: Y(op.y1) }, end: { x: X(op.x2), y: Y(op.y2) }, thickness: X(op.lw), color: color(op.color), dashArray: op.dash?.map(X) })
  } else if (op.t === 'text') {
    const font = fonts[op.weight]
    const size = op.size
    const c = color(op.color)
    if (op.spacing) {
      const chars = [...op.text]
      const widths = chars.map((ch) => font.widthOfTextAtSize(ch, size))
      const sp = X(op.spacing)
      const total = widths.reduce((s, w) => s + w, 0) + sp * (chars.length - 1)
      let x = op.align === 'center' ? X(op.x) - total / 2 : op.align === 'right' ? X(op.x) - total : X(op.x)
      chars.forEach((ch, i) => {
        if (ch.trim()) page.drawText(ch, { x, y: Y(op.y), size, font, color: c })
        x += widths[i] + sp
      })
    } else {
      const w = font.widthOfTextAtSize(op.text, size)
      const x = op.align === 'center' ? X(op.x) - w / 2 : op.align === 'right' ? X(op.x) - w : X(op.x)
      page.drawText(op.text, { x, y: Y(op.y), size, font, color: c })
    }
  } else if (op.t === 'image') {
    try {
      const im = await embedImage(op.src)
      const r = containRect(op.x, op.y, op.w, op.h, im.width, im.height, op.top)
      page.drawImage(im, { x: X(r.x), y: Y(r.y + r.h), width: X(r.w), height: X(r.h), opacity: op.opacity })
    } catch {
      // 넣을 수 없는 이미지는 건너뛴다
    }
  }
}
