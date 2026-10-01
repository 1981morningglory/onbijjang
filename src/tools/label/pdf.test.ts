import fs from 'node:fs'
import path from 'node:path'
import bwipjs from 'bwip-js'
import fontkit from '@pdf-lib/fontkit'
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib'
import { beforeAll, describe, expect, it } from 'vitest'
import { makeBarcode, setBarcodeLib } from './barcode'
import { DEFAULT_SERIAL, MM_PER_PT, cellRect, type LabelDoc, type LabelElement, type Measure } from './model'
import { buildLabelPdf, type PdfEnv } from './pdf'
import { DEFAULT_SHEET, SHEETS } from './sheets'

const measure: Measure = (text, size) => Array.from(text).length * size * 0.55 * MM_PER_PT
const env: PdfEnv = { measureFor: () => measure, barcode: makeBarcode }

const doc = (patch: Partial<LabelDoc> = {}): LabelDoc => ({
  version: 1,
  sheet: { ...DEFAULT_SHEET, radius: 0 },
  design: [],
  mode: 'same',
  copies: 0,
  table: { columns: [], rows: [] },
  repeat: 1,
  startCell: 0,
  skip: [],
  serial: DEFAULT_SERIAL,
  print: { offsetX: 0, offsetY: 0, cutLines: true },
  ...patch,
})

/** PDF 한 쪽의 그리기 명령을 글로 읽는다. */
async function pageContent(bytes: Uint8Array, index = 0) {
  const pdf = await PDFDocument.load(bytes)
  const page = pdf.getPage(index)
  const contents = page.node.Contents()
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => pdf.context.lookup(ref)) : [contents]
  const text = streams.map((s) => Buffer.from(decodePDFRawStream(s as PDFRawStream).decode()).toString('latin1')).join('\n')
  return { pdf, page, text }
}

/** 점 넷으로 된 닫힌 사각형(m l l l h + 그리기 명령)을 mm(왼쪽 위 기준)로 돌려준다. */
function rectsInMm(text: string, pageHpt: number) {
  const out: Array<{ x: number; y: number; w: number; h: number; op: string }> = []
  const re = /(-?[\d.]+) (-?[\d.]+) m\n(-?[\d.]+) (-?[\d.]+) l\n(-?[\d.]+) (-?[\d.]+) l\n(-?[\d.]+) (-?[\d.]+) l\nh\n(S|f\*|f|B|W)\n/g
  for (const m of text.matchAll(re)) {
    const n = m.slice(1, 9).map(Number)
    const xs = [n[0], n[2], n[4], n[6]].map((v) => v * MM_PER_PT)
    const ys = [n[1], n[3], n[5], n[7]].map((v) => (pageHpt - v) * MM_PER_PT)
    out.push({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), op: m[9] })
  }
  return out
}

beforeAll(() => setBarcodeLib(bwipjs))

describe('PDF 저장', () => {
  it('A4 크기(210×297mm)이고 칼선이 규격 위치에 온다', async () => {
    const d = doc()
    const { bytes, stats } = await buildLabelPdf(d, env)
    expect(stats.pages).toBe(1)
    const { pdf, page, text } = await pageContent(bytes)
    expect(pdf.getPageCount()).toBe(1)
    expect(page.getWidth() * MM_PER_PT).toBeCloseTo(210, 3)
    expect(page.getHeight() * MM_PER_PT).toBeCloseTo(297, 3)
    const rects = rectsInMm(text, page.getHeight()).filter((r) => r.op === 'S')
    expect(rects).toHaveLength(21)
    rects.forEach((r, i) => {
      const want = cellRect(d.sheet, i)
      expect(Math.abs(r.x - want.x), `칸 ${i} x`).toBeLessThan(0.01)
      expect(Math.abs(r.y - want.y), `칸 ${i} y`).toBeLessThan(0.01)
      expect(Math.abs(r.w - want.w), `칸 ${i} w`).toBeLessThan(0.01)
      expect(Math.abs(r.h - want.h), `칸 ${i} h`).toBeLessThan(0.01)
    })
  })

  it('사각 규격 22종 모두 칼선 위치가 맞는다', async () => {
    const rectSheets = SHEETS.filter((s) => s.shape === 'rect')
    expect(rectSheets).toHaveLength(22)
    for (const sheet of rectSheets) {
      const d = doc({ sheet: { ...sheet, radius: 0 } })
      const { bytes } = await buildLabelPdf(d, env)
      const { page, text } = await pageContent(bytes)
      const rects = rectsInMm(text, page.getHeight()).filter((r) => r.op === 'S')
      expect(rects, sheet.name).toHaveLength(sheet.cols * sheet.rows)
      rects.forEach((r, i) => {
        const want = cellRect(sheet, i)
        expect(Math.abs(r.x - want.x) + Math.abs(r.y - want.y) + Math.abs(r.w - want.w) + Math.abs(r.h - want.h), `${sheet.name} 칸 ${i}`).toBeLessThan(0.02)
      })
    }
  })

  it('위치 보정(mm)만큼 전체가 옮겨진다', async () => {
    const d = doc({ print: { offsetX: 1.5, offsetY: -0.7, cutLines: true } })
    const { bytes } = await buildLabelPdf(d, env)
    const { page, text } = await pageContent(bytes)
    const [first] = rectsInMm(text, page.getHeight()).filter((r) => r.op === 'S')
    const want = cellRect(d.sheet, 0)
    expect(first.x).toBeCloseTo(want.x + 1.5, 2)
    expect(first.y).toBeCloseTo(want.y - 0.7, 2)
  })

  it('라벨 내용이 시작 칸부터 제자리에, 여러 장으로 넘어간다', async () => {
    const box: LabelElement = { id: 'b', type: 'shape', shape: 'rect', fill: '#ff0000', stroke: null, strokeWidth: 0, radius: 0, x: 2, y: 3, w: 10, h: 5 }
    const d = doc({ design: [box], copies: 25, startCell: 19, print: { offsetX: 0, offsetY: 0, cutLines: false } })
    const { bytes, stats } = await buildLabelPdf(d, env)
    expect(stats).toMatchObject({ pages: 3, labels: 25 })
    const first = await pageContent(bytes, 0)
    const fills0 = rectsInMm(first.text, first.page.getHeight()).filter((r) => r.op === 'f')
    expect(fills0).toHaveLength(2)
    ;[19, 20].forEach((cell, i) => {
      const c = cellRect(d.sheet, cell)
      expect(fills0[i].x).toBeCloseTo(c.x + 2, 2)
      expect(fills0[i].y).toBeCloseTo(c.y + 3, 2)
      expect(fills0[i].w).toBeCloseTo(10, 2)
      expect(fills0[i].h).toBeCloseTo(5, 2)
    })
    const second = await pageContent(bytes, 1)
    expect(rectsInMm(second.text, second.page.getHeight()).filter((r) => r.op === 'f')).toHaveLength(21)
    const third = await pageContent(bytes, 2)
    const fills2 = rectsInMm(third.text, third.page.getHeight()).filter((r) => r.op === 'f')
    expect(fills2).toHaveLength(2)
    expect(fills2[1].x).toBeCloseTo(cellRect(d.sheet, 1).x + 2, 2)
    // 라벨마다 칸 크기로 잘라 그린다
    const clips = rectsInMm(first.text, first.page.getHeight()).filter((r) => r.op === 'W')
    expect(clips).toHaveLength(2)
    expect(clips[0]).toMatchObject({ w: expect.closeTo(63, 2), h: expect.closeTo(38, 2) })
  })

  it('바코드는 벡터로 들어가고 틀린 값은 건너뛴다', async () => {
    const code: LabelElement = { id: 'c', type: 'barcode', symbology: 'ean13', value: '{바코드}', showText: false, textSize: 8, color: '#000000', x: 5, y: 5, w: 38, h: 20 }
    const table = { columns: ['바코드'], rows: [['880123456789'], ['8801234567890']] }
    const d = doc({ design: [code], mode: 'data', table, print: { offsetX: 0, offsetY: 0, cutLines: false } })
    const { bytes, stats } = await buildLabelPdf(d, env)
    expect(stats.skippedBarcodes).toBe(1)
    const { page, text } = await pageContent(bytes)
    expect(text).toContain('f*')
    // 막대 30개가 한 경로에 이어져 있다 — 사각형마다 끊어 세기 위해 닫는 명령 뒤에 채움 표시를 끼운다.
    const split = text.replace(/h\n(?=-?[\d.]+ -?[\d.]+ m\n)/g, 'h\nf*\n')
    const bars = rectsInMm(split, page.getHeight()).filter((r) => r.op === 'f*')
    expect(bars).toHaveLength(30)
    const cell = cellRect(d.sheet, 0)
    // EAN-13 은 95칸 너비 — 첫 막대가 상자 왼쪽 끝, 마지막 막대가 오른쪽 끝에 닿는다
    expect(Math.min(...bars.map((b) => b.x))).toBeCloseTo(cell.x + 5, 1)
    expect(Math.max(...bars.map((b) => b.x + b.w))).toBeCloseTo(cell.x + 5 + 38, 1)
    for (const b of bars) {
      expect(b.y).toBeCloseTo(cell.y + 5, 2)
      expect(b.h).toBeCloseTo(20, 2)
    }
  })

  it('프리텐다드를 심어 한글을 글자로 넣는다', async () => {
    const dir = path.resolve('node_modules/pretendard/dist/public/static/alternative')
    const fonts = { regular: new Uint8Array(fs.readFileSync(path.join(dir, 'Pretendard-Regular.ttf'))), bold: new Uint8Array(fs.readFileSync(path.join(dir, 'Pretendard-Bold.ttf'))) }
    const text: LabelElement = { id: 't', type: 'text', text: '{이름} 님 귀하\nNo.{연번}', font: 'pretendard', size: 11, bold: true, align: 'center', valign: 'middle', color: '#14201a', shrink: false, x: 2, y: 2, w: 59, h: 34 }
    const table = { columns: ['이름'], rows: [['홍길동'], ['김온비']] }
    const d = doc({ design: [text], mode: 'data', table })
    const { bytes, stats } = await buildLabelPdf(d, { ...env, fonts, fontkit })
    expect(stats.rasterTexts).toBe(0)
    const { text: content } = await pageContent(bytes)
    // 라벨 2장 × 2줄
    expect((content.match(/ Tj\n/g) ?? []).length).toBe(4)
    // 글꼴은 쓰인 글자만 담아 작아야 한다(원본은 한 벌에 2.6MB)
    expect(bytes.length).toBeLessThan(200_000)
    // 글꼴이 없고 그림으로 바꿀 방법도 없으면 글자를 건너뛴다(오류는 아니다)
    const none = await buildLabelPdf(d, env)
    expect(none.stats.labels).toBe(2)
    fs.mkdirSync(path.resolve('node_modules/.cache'), { recursive: true })
    fs.writeFileSync(path.resolve('node_modules/.cache/label-test.pdf'), bytes)
  })
})
