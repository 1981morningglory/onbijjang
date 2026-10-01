/**
 * pdf-lib 로 넣은 서명 이미지가 pdfjs 로 다시 열었을 때 화면에서 놓은 자리에 그대로 있는지 확인한다.
 * 회전된 쪽, 원점이 0 이 아닌 자르기 상자, 변환을 닫지 않은 본문까지 실제 라이브러리로 왕복한다.
 */
import { deflateSync } from 'node:zlib'
import { concatTransformationMatrix, degrees, PDFDocument } from 'pdf-lib'
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { describe, expect, it } from 'vitest'
import { boxCorners, pdfImagePlacement, pdfViewSize, viewToPdfPoint, type Box, type PdfPageBox } from './geometry'

function crc32(bytes: Uint8Array): number {
  let c = ~0
  for (const b of bytes) {
    c ^= b
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return ~c >>> 0
}

/** 2×1 RGBA PNG */
function tinyPng(): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const body = new Uint8Array(4 + data.length)
    body.set(new TextEncoder().encode(type))
    body.set(data, 4)
    const out = new Uint8Array(12 + data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, data.length)
    out.set(body, 4)
    view.setUint32(8 + data.length, crc32(body))
    return out
  }
  const ihdr = new Uint8Array(13)
  const v = new DataView(ihdr.buffer)
  v.setUint32(0, 2)
  v.setUint32(4, 1)
  ihdr.set([8, 6, 0, 0, 0], 8)
  const raw = new Uint8Array([0, 255, 0, 0, 255, 0, 0, 255, 128])
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())]
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    png.set(p, at)
    at += p.length
  }
  return png
}

type Matrix = [number, number, number, number, number, number]
const multiply = (m: Matrix, n: Matrix): Matrix => [
  n[0] * m[0] + n[1] * m[2],
  n[0] * m[1] + n[1] * m[3],
  n[2] * m[0] + n[3] * m[2],
  n[2] * m[1] + n[3] * m[3],
  n[4] * m[0] + n[5] * m[2] + m[4],
  n[4] * m[1] + n[5] * m[3] + m[5],
]

async function openWithPdfjs(bytes: Uint8Array) {
  const doc = await getDocument({ data: bytes.slice(), useSystemFonts: false, verbosity: 0 }).promise
  const page = await doc.getPage(1)
  return { doc, page }
}

/** 페이지에 그려진 이미지들의 단위 사각형 → PDF 사용자 좌표 변환 행렬 */
async function imageMatrices(bytes: Uint8Array): Promise<{ matrices: Matrix[]; toView: (x: number, y: number) => number[] }> {
  const { doc, page } = await openWithPdfjs(bytes)
  const ops = await page.getOperatorList()
  const stack: Matrix[] = []
  let ctm: Matrix = [1, 0, 0, 1, 0, 0]
  const matrices: Matrix[] = []
  ops.fnArray.forEach((fn: number, i: number) => {
    if (fn === OPS.save) stack.push(ctm)
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm
    else if (fn === OPS.transform) ctm = multiply(ctm, ops.argsArray[i] as Matrix)
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) matrices.push(ctm)
  })
  const viewport = page.getViewport({ scale: 1 })
  const toView = (x: number, y: number) => viewport.convertToViewportPoint(x, y)
  await doc.loadingTask.destroy()
  return { matrices, toView }
}

async function makePdf(rotate: number, opts: { crop?: boolean; unbalanced?: boolean } = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([400, 600])
  if (opts.crop) page.setCropBox(50, 80, 300, 400)
  page.setRotation(degrees(rotate))
  page.drawRectangle({ x: 60, y: 90, width: 100, height: 40 })
  // q/Q 로 감싸지 않은 변환 — 일부 PDF 생성기가 이렇게 만든다
  if (opts.unbalanced) page.pushOperators(concatTransformationMatrix(0.5, 0, 0, -0.5, 13, 400))
  return pdf.save()
}

async function pageBox(bytes: Uint8Array): Promise<{ info: PdfPageBox; width: number; height: number }> {
  const { doc, page } = await openWithPdfjs(bytes)
  const viewport = page.getViewport({ scale: 1 })
  const info: PdfPageBox = { view: page.view as PdfPageBox['view'], rotate: page.rotate, userUnit: page.userUnit }
  const out = { info, width: viewport.width, height: viewport.height }
  await doc.loadingTask.destroy()
  return out
}

async function stamp(bytes: Uint8Array, info: PdfPageBox, box: Box): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false })
  const image = await pdf.embedPng(tinyPng())
  const place = pdfImagePlacement(info, box)
  pdf.getPages()[0].drawImage(image, { x: place.x, y: place.y, width: place.width, height: place.height, rotate: degrees(place.rotate), opacity: 0.8 })
  return pdf.save()
}

describe('pdfjs 가 알려 주는 좌표와 같은 계산', () => {
  for (const rotate of [0, 90, 180, 270]) {
    for (const crop of [false, true]) {
      it(`회전 ${rotate}도${crop ? ', 자르기 상자' : ''}`, async () => {
        const bytes = await makePdf(rotate, { crop })
        const { doc, page } = await openWithPdfjs(bytes)
        const viewport = page.getViewport({ scale: 1 })
        const info: PdfPageBox = { view: page.view as PdfPageBox['view'], rotate: page.rotate, userUnit: page.userUnit }
        const size = pdfViewSize(info)
        expect(size.width).toBeCloseTo(viewport.width, 6)
        expect(size.height).toBeCloseTo(viewport.height, 6)
        for (const [vx, vy] of [[0, 0], [37, 211], [viewport.width, viewport.height]]) {
          const mine = viewToPdfPoint(info, vx, vy)
          const theirs = viewport.convertToPdfPoint(vx, vy)
          expect(mine.x).toBeCloseTo(theirs[0], 6)
          expect(mine.y).toBeCloseTo(theirs[1], 6)
        }
        await doc.loadingTask.destroy()
      })
    }
  }
})

describe('저장한 PDF 를 다시 열면 서명이 놓은 자리에 있다', () => {
  const cases: Array<{ rotate: number; crop?: boolean; unbalanced?: boolean; rot: number }> = [
    { rotate: 0, rot: 0 },
    { rotate: 0, crop: true, rot: 20 },
    { rotate: 90, rot: 0 },
    { rotate: 90, crop: true, rot: -35 },
    { rotate: 180, crop: true, rot: 0 },
    { rotate: 270, rot: 90 },
    { rotate: 270, crop: true, rot: 12.5 },
    { rotate: 0, unbalanced: true, rot: 0 },
    { rotate: 90, crop: true, unbalanced: true, rot: 45 },
  ]
  for (const c of cases) {
    it(`쪽 회전 ${c.rotate}도${c.crop ? ', 자르기 상자' : ''}${c.unbalanced ? ', 닫지 않은 변환' : ''}, 서명 기울기 ${c.rot}도`, async () => {
      const original = await makePdf(c.rotate, c)
      const { info, width, height } = await pageBox(original)
      const box: Box = { cx: width * 0.62, cy: height * 0.3, w: 90, h: 36, rot: c.rot }
      const saved = await stamp(original, info, box)
      const { matrices, toView } = await imageMatrices(saved)
      expect(matrices).toHaveLength(1)
      const m = matrices[0]
      const apply = (x: number, y: number) => toView(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])
      // 이미지 단위 사각형: (0,0) 왼쪽 아래, (1,0) 오른쪽 아래, (1,1) 오른쪽 위, (0,1) 왼쪽 위
      const got = [apply(0, 1), apply(1, 1), apply(1, 0), apply(0, 0)]
      const want = boxCorners(box)
      got.forEach((p, i) => {
        expect(p[0]).toBeCloseTo(want[i].x, 3)
        expect(p[1]).toBeCloseTo(want[i].y, 3)
      })
    })
  }
})
