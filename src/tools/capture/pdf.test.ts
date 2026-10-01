import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { buildPdf } from '../../../extension/capture/lib/pdf.js'
import { A4_PT, planPdfPages } from '../../../extension/capture/lib/plan.js'

async function jpeg(w: number, h: number, color: string) {
  return new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: color } }).jpeg().toBuffer())
}

describe('buildPdf', () => {
  it('다른 PDF 라이브러리(pdf-lib)가 읽을 수 있는 PDF 를 만든다', async () => {
    const width = 400
    const { pages: plan } = planPdfPages(width, 1300)
    const pages = await Promise.all(plan.map(async (p, i) => ({ jpeg: await jpeg(width, p.h, i % 2 ? '#0b7a53' : '#ffe55c'), pxW: width, pxH: p.h, pageW: A4_PT.width, pageH: A4_PT.height })))
    const bytes = buildPdf(pages, { title: '온비짱 캡처 시험', createdAt: Date.UTC(2026, 9, 1) })

    expect(new TextDecoder().decode(bytes.subarray(0, 8))).toBe('%PDF-1.4')
    expect(new TextDecoder().decode(bytes.subarray(bytes.length - 6))).toBe('%%EOF\n')

    const doc = await PDFDocument.load(bytes, { updateMetadata: false })
    expect(doc.getPageCount()).toBe(plan.length)
    expect(plan.length).toBe(3)
    for (const page of doc.getPages()) {
      expect(page.getWidth()).toBeCloseTo(A4_PT.width, 1)
      expect(page.getHeight()).toBeCloseTo(A4_PT.height, 1)
    }
    expect(doc.getTitle()).toBe('온비짱 캡처 시험')
    expect(doc.getProducer()).toBe('온비짱 캡처')
  })

  it('xref 표의 위치가 실제 객체 위치와 맞는다', async () => {
    const bytes = buildPdf([{ jpeg: await jpeg(10, 10, '#ffffff'), pxW: 10, pxH: 10, pageW: 100, pageH: 100 }])
    // 이진 데이터가 섞여 있어 바이트 위치가 글자 위치와 같도록 latin1 로 읽는다.
    const text = Buffer.from(bytes).toString('latin1')
    const xrefAt = Number(/startxref\n(\d+)\n%%EOF/.exec(text)![1])
    expect(text.slice(xrefAt, xrefAt + 4)).toBe('xref')
    const rows = text.slice(xrefAt).split('\n').slice(2).filter((l) => / n $/.test(l))
    expect(rows.length).toBe(6)
    rows.forEach((row, i) => {
      const at = Number(row.slice(0, 10))
      expect(text.slice(at, at + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`)
    })
  })

  it('이미지를 종이 맨 위에 붙이고, 쪽보다 짧은 마지막 장은 아래를 비운다', async () => {
    const bytes = buildPdf([{ jpeg: await jpeg(200, 100, '#000000'), pxW: 200, pxH: 100, pageW: 595.28, pageH: 841.89 }])
    const text = Buffer.from(bytes).toString('latin1')
    // 폭 595.28 에 맞추면 높이 297.64, 아래에서 544.25 띄운다
    expect(text).toContain('q 595.28 0 0 297.64 0 544.25 cm /Im0 Do Q')
    expect(text).toContain('/Width 200 /Height 100')
    expect(text).toContain('/Filter /DCTDecode')
  })

  it('크기를 따로 주면 그대로 쓴다(이미지 크기 그대로 한 쪽)', async () => {
    const bytes = buildPdf([{ jpeg: await jpeg(20, 10, '#000000'), pxW: 20, pxH: 10, pageW: 15, pageH: 7.5, drawW: 15, drawH: 7.5 }])
    const doc = await PDFDocument.load(bytes, { updateMetadata: false })
    expect(doc.getPage(0).getWidth()).toBeCloseTo(15)
    expect(doc.getPage(0).getHeight()).toBeCloseTo(7.5)
  })

  it('쪽이 없으면 오류', () => expect(() => buildPdf([])).toThrow())
})
