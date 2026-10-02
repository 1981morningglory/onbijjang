/**
 * 견적서·거래명세서를 A4 위의 그리기 명령(mm 단위)으로 만든다.
 * 화면 미리보기(SVG)·이미지(캔버스)·PDF 가 모두 이 결과를 그대로 그리므로, 보이는 대로 저장된다.
 */
import {
  addDays,
  amountInWords,
  calcTotals,
  contactLine,
  dateKo,
  DOC_TITLE,
  styleOf,
  won,
  type CompanyKit,
  type LineCalc,
  type QuoteDoc,
} from './model'

export const PAGE_W = 210
export const PAGE_H = 297
export const PT = 25.4 / 72 // 1pt 를 mm 로

export type Weight = 'regular' | 'bold'
export type Op =
  | { t: 'text'; x: number; y: number; text: string; size: number; weight: Weight; color: string; align: 'left' | 'center' | 'right'; spacing?: number }
  | { t: 'rect'; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; lw?: number }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; color: string; lw: number; dash?: number[] }
  | { t: 'image'; x: number; y: number; w: number; h: number; src: string; opacity?: number; top?: boolean }

export interface Page {
  ops: Op[]
  /** 첨부 쪽: PDF 로 저장할 때 원본 PDF 쪽을 그대로 붙일 수 있다 */
  attachment?: { kind: 'registration' | 'bankbook'; pdfDataUrl?: string; pageIndex: number }
}

/** 글자 너비 재기(mm). 화면에서는 캔버스로 잰다. */
export type Measure = (text: string, sizePt: number, weight: Weight) => number

let measureCanvas: CanvasRenderingContext2D | null = null
export const FONT_FAMILY = "'Pretendard Variable', Pretendard, 'Malgun Gothic', sans-serif"
export const canvasMeasure: Measure = (text, size, weight) => {
  measureCanvas ??= document.createElement('canvas').getContext('2d')
  const ctx = measureCanvas!
  ctx.font = `${weight === 'bold' ? 700 : 400} ${size}px ${FONT_FAMILY}`
  // px 로 잰 값을 pt 크기 기준 mm 로 바꾼다(글자 크기를 px 로 둬도 비율은 같다).
  return ctx.measureText(text).width * PT
}

// ── 그리기 도우미 ─────────────────────────────────────────
class Pen {
  ops: Op[] = []
  constructor(private measure: Measure) {}
  text(text: string, x: number, y: number, o: { size?: number; weight?: Weight; color?: string; align?: 'left' | 'center' | 'right'; spacing?: number } = {}) {
    if (!text) return
    this.ops.push({ t: 'text', x, y, text, size: o.size ?? 9, weight: o.weight ?? 'regular', color: o.color ?? INK, align: o.align ?? 'left', spacing: o.spacing })
  }
  rect(x: number, y: number, w: number, h: number, o: { fill?: string; stroke?: string; lw?: number } = {}) {
    this.ops.push({ t: 'rect', x, y, w, h, ...o })
  }
  line(x1: number, y1: number, x2: number, y2: number, color = INK, lw = 0.2, dash?: number[]) {
    this.ops.push({ t: 'line', x1, y1, x2, y2, color, lw, dash })
  }
  image(src: string, x: number, y: number, w: number, h: number, opacity?: number, top?: boolean) {
    this.ops.push({ t: 'image', x, y, w, h, src, opacity, top })
  }
  width(text: string, size: number, weight: Weight = 'regular') {
    return this.measure(text, size, weight)
  }
  /**
   * 칸(w×h) 안에 글자를 넣는다. 넓으면 작게(최소 minSize), 그래도 넓으면 두 줄, 그래도 넘치면 … 으로 줄인다.
   * y 는 칸의 위쪽. 세로 가운데 정렬.
   */
  fit(text: string, x: number, y: number, w: number, h: number, o: { size?: number; weight?: Weight; color?: string; align?: 'left' | 'center' | 'right'; pad?: number; minSize?: number } = {}) {
    const t = text.trim()
    if (!t) return
    const pad = o.pad ?? 1.6
    const avail = Math.max(1, w - pad * 2)
    const weight = o.weight ?? 'regular'
    let size = o.size ?? 9
    const min = o.minSize ?? Math.min(size, 6.5)
    while (size > min && this.width(t, size, weight) > avail) size -= 0.25
    const tx = o.align === 'right' ? x + w - pad : o.align === 'center' ? x + w / 2 : x + pad
    const lineH = size * PT * 1.25
    if (this.width(t, size, weight) <= avail) {
      this.text(t, tx, y + h / 2 + (size * PT) * 0.35, { ...o, size, weight })
      return
    }
    const lines = wrap(t, avail, (s) => this.width(s, size, weight))
    const maxLines = Math.max(1, Math.floor((h - 0.6) / lineH))
    const shown = lines.slice(0, maxLines)
    if (lines.length > maxLines) shown[maxLines - 1] = ellipsize(shown[maxLines - 1], avail, (s) => this.width(s, size, weight))
    const top = y + h / 2 - (shown.length * lineH) / 2
    shown.forEach((ln, i) => this.text(ln, tx, top + i * lineH + lineH * 0.78, { ...o, size, weight }))
  }
}

/** 글자 너비에 맞춰 줄을 나눈다. 띄어쓰기에서 먼저 끊고, 한 낱말이 너무 길면 글자 단위로 끊는다. */
export function wrap(text: string, maxW: number, width: (s: string) => number): string[] {
  const out: string[] = []
  for (const para of text.split(/\r?\n/)) {
    if (!para.trim()) {
      out.push('')
      continue
    }
    let line = ''
    for (const word of para.split(/(\s+)/)) {
      const next = line + word
      if (width(next.trimEnd()) <= maxW) {
        line = next
        continue
      }
      if (line.trim()) out.push(line.trimEnd())
      line = word.trimStart()
      while (width(line) > maxW && line.length > 1) {
        let cut = line.length - 1
        while (cut > 1 && width(line.slice(0, cut)) > maxW) cut--
        out.push(line.slice(0, cut))
        line = line.slice(cut)
      }
    }
    if (line.trim()) out.push(line.trimEnd())
  }
  return out
}

function ellipsize(s: string, maxW: number, width: (s: string) => number): string {
  let t = s
  while (t.length > 1 && width(`${t}…`) > maxW) t = t.slice(0, -1)
  return `${t}…`
}

// ── 색 ────────────────────────────────────────────────────
const INK = '#1a1d1b'
const MUTED = '#5b625e'
const QUOTE = { line: '#14201a', accent: '#0b6b49', shade: '#eef4f0', shadeStrong: '#dcebe2' }
const LEDGER = { line: '#1f3f8f', text: '#16306e', shade: '#eaf0fb', shadeStrong: '#d7e2f6' }

export interface LayoutInput {
  doc: QuoteDoc
  kit: CompanyKit
  measure: Measure
}

export function buildPages({ doc, kit, measure }: LayoutInput): Page[] {
  const pages = doc.type === 'quote' ? quotePages(doc, kit, measure) : statementPages(doc, kit, measure)
  return [...pages, ...attachmentPages(doc, kit, measure)]
}

/** 표에 넣을 줄: 채워진 줄 + 빈 줄로 최소 줄 수를 채운다 */
function rowsFor(lines: LineCalc[], minRows: number): Array<LineCalc | null> {
  const filled = lines.filter((l) => l.filled)
  const rows: Array<LineCalc | null> = [...filled]
  while (rows.length < minRows) rows.push(null)
  return rows
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out.length ? out : [[]]
}

// ── 견적서 ────────────────────────────────────────────────
function quotePages(doc: QuoteDoc, kit: CompanyKit, measure: Measure): Page[] {
  const totals = calcTotals(doc)
  const c = kit.company
  const seal = doc.showSeal ? kit.seals.find((s) => s.id === doc.sealId) ?? kit.seals[0] : undefined
  const contact = doc.showContact ? kit.contacts.find((k) => k.id === doc.contactId) ?? kit.contacts[0] : undefined
  const hasSpec = doc.items.some((i) => i.spec.trim())
  const vatLabel = doc.vatMode === 'included' ? '(VAT 포함)' : doc.vatMode === 'excluded' ? '(VAT 별도)' : '(면세)'

  // 표 칸: 번호 · 품목 · (규격) · 수량 · 단가 · 공급가액 · 세액 · 합계 · 비고
  const L = 15
  const R = PAGE_W - 15
  const colsDef = [
    { key: 'no', label: 'No', w: 8 },
    { key: 'name', label: '비용항목', w: hasSpec ? 40 : 56 },
    ...(hasSpec ? [{ key: 'spec', label: '규격', w: 16 }] : []),
    { key: 'qty', label: '수량', w: 12 },
    { key: 'price', label: `단가\n${vatLabel}`, w: 21 },
    { key: 'supply', label: '공급가액', w: 21 },
    { key: 'tax', label: '세액', w: 17 },
    { key: 'total', label: '합계', w: 22 },
    { key: 'note', label: '비고', w: 0 },
  ]
  const used = colsDef.reduce((s, k) => s + k.w, 0)
  colsDef[colsDef.length - 1].w = R - L - used
  const cols: Array<{ key: string; label: string; w: number; x: number }> = []
  let cx = L
  for (const k of colsDef) {
    cols.push({ ...k, x: cx })
    cx += k.w
  }

  const allRows = rowsFor(totals.lines, 10)
  const FIRST = 14
  const NEXT = 30
  const chunks = allRows.length <= FIRST ? [allRows] : [allRows.slice(0, FIRST), ...chunk(allRows.slice(FIRST), NEXT)]
  const pageCount = chunks.length

  return chunks.map((rows, pi) => {
    const p = new Pen(measure)
    const first = pi === 0
    const last = pi === pageCount - 1
    // 바깥 이중 테두리
    p.rect(10, 10, PAGE_W - 20, PAGE_H - 20, { stroke: QUOTE.line, lw: 0.7 })
    p.rect(11.2, 11.2, PAGE_W - 22.4, PAGE_H - 22.4, { stroke: QUOTE.line, lw: 0.2 })

    let y = 18
    p.text(DOC_TITLE.quote, PAGE_W / 2, y + 9, { size: 26, weight: 'bold', align: 'center', spacing: 2, color: QUOTE.line })
    y += 14
    p.line(PAGE_W / 2 - 34, y, PAGE_W / 2 + 34, y, QUOTE.accent, 0.6)
    p.line(PAGE_W / 2 - 34, y + 1, PAGE_W / 2 + 34, y + 1, QUOTE.accent, 0.2)
    if (pageCount > 1) p.text(`${pi + 1} / ${pageCount}`, R, 18, { size: 7.5, align: 'right', color: MUTED })

    if (first) {
      y += 7
      // 왼쪽: 받는 곳
      const lx = L
      p.text(dateKo(doc.date), lx, y + 4, { size: 9.5 })
      if (doc.docNo) p.text(`견적번호 ${doc.docNo}`, lx, y + 9.5, { size: 8, color: MUTED })
      const custY = y + 21
      const cust = doc.customer.trim() || '고객사명'
      p.fit(cust, lx, custY - 7, 70, 9, { size: 15, weight: 'bold', pad: 0, minSize: 9, color: doc.customer.trim() ? INK : '#b9bfbb' })
      p.text('귀중', lx + 72, custY, { size: 10.5 })
      p.line(lx, custY + 2, lx + 82, custY + 2, QUOTE.line, 0.35)
      p.text('아래와 같이 견적합니다.', lx, custY + 10, { size: 9.5 })
      if (doc.validDays > 0) p.text(`유효기간  ${dateKo(addDays(doc.date, doc.validDays))}까지 (${doc.validDays}일)`, lx, custY + 16, { size: 8, color: MUTED })

      // 오른쪽: 공급자
      const bx = 103
      const bw = R - bx
      const rowH = 7.2
      const rowsInfo: Array<[string, string, string?, string?]> = [
        ['등록번호', c.bizNo],
        ['상호', c.name, '대표', c.ceo],
        ['주소', c.address],
        ['업태', c.bizType, '종목', c.bizItem],
        ['전화', c.tel, '팩스', c.fax],
      ]
      const by = y
      p.rect(bx - 7, by, 7, rowH * rowsInfo.length, { fill: QUOTE.shadeStrong, stroke: QUOTE.line, lw: 0.3 })
      ;['공', '급', '자'].forEach((ch, i) => p.text(ch, bx - 3.5, by + (rowH * rowsInfo.length) / 2 - 5 + i * 5 + 1.6, { size: 9, weight: 'bold', align: 'center', color: QUOTE.accent }))
      rowsInfo.forEach((r, i) => {
        const ry = by + i * rowH
        const labW = 15
        p.rect(bx, ry, labW, rowH, { fill: QUOTE.shade, stroke: QUOTE.line, lw: 0.2 })
        p.fit(r[0], bx, ry, labW, rowH, { size: 8, align: 'center', color: MUTED, pad: 0.5 })
        if (r[2] !== undefined) {
          const half = (bw - labW * 2) / 2
          const vx1 = bx + labW
          p.rect(vx1, ry, half - 2, rowH, { stroke: QUOTE.line, lw: 0.2 })
          p.fit(r[1], vx1, ry, half - 2, rowH, { size: i === 1 ? 9 : 8.5, weight: i === 1 ? 'bold' : 'regular' })
          const lx2 = vx1 + half - 2
          p.rect(lx2, ry, labW, rowH, { fill: QUOTE.shade, stroke: QUOTE.line, lw: 0.2 })
          p.fit(r[2], lx2, ry, labW, rowH, { size: 8, align: 'center', color: MUTED, pad: 0.5 })
          p.rect(lx2 + labW, ry, half + 2, rowH, { stroke: QUOTE.line, lw: 0.2 })
          // 대표 칸은 이름 오른쪽에 직인이 들어갈 자리를 남긴다
          p.fit(r[3] ?? '', lx2 + labW, ry, i === 1 && seal ? half + 2 - 14 : half + 2, rowH, { size: 9 })
          if (i === 1 && seal) {
            // 대표 이름 끝에 살짝 걸치게, 표 밖으로 나가지 않게
            const s = 16
            p.image(seal.dataUrl, R - s - 0.6, ry + rowH / 2 - s / 2, s, s, 0.92)
          }
        } else {
          p.rect(bx + labW, ry, bw - labW, rowH, { stroke: QUOTE.line, lw: 0.2 })
          p.fit(r[1], bx + labW, ry, bw - labW, rowH, { size: i === 0 ? 10 : 8.5, weight: i === 0 ? 'bold' : 'regular' })
        }
      })
      y = by + rowH * rowsInfo.length + 7

      // 합계 금액 띠
      p.rect(L, y, R - L, 11, { fill: QUOTE.shadeStrong, stroke: QUOTE.line, lw: 0.4 })
      p.text(`합계금액 ${vatLabel}`, L + 3, y + 7, { size: 9.5, weight: 'bold', color: QUOTE.accent })
      p.fit(amountInWords(totals.total), L + 42, y, R - L - 45, 11, { size: 12, weight: 'bold', align: 'right', pad: 0 })
      y += 15
      if (doc.title.trim()) {
        p.text('품명', L, y + 3.5, { size: 9, color: MUTED })
        p.fit(doc.title, L + 10, y - 1, R - L - 10, 6, { size: 10, weight: 'bold', pad: 0 })
        y += 7
      }
    } else {
      y += 8
      p.text(`${doc.customer || ''} 귀중 · 앞 장에서 이어짐`, L, y, { size: 8.5, color: MUTED })
      y += 4
    }

    // 표 머리
    const headH = 10
    cols.forEach((col) => {
      p.rect(col.x, y, col.w, headH, { fill: QUOTE.shade, stroke: QUOTE.line, lw: 0.25 })
      const parts = col.label.split('\n')
      parts.forEach((ln, i) => p.text(ln, col.x + col.w / 2, y + headH / 2 + (i - (parts.length - 1) / 2) * 3.6 + 1.3, { size: i ? 6.5 : 8.5, weight: i ? 'regular' : 'bold', align: 'center', color: i ? MUTED : INK }))
    })
    p.line(L, y, R, y, QUOTE.line, 0.5)
    y += headH
    const rowH = first ? 8 : 8.2
    const startNo = pi === 0 ? 0 : FIRST + (pi - 1) * NEXT
    rows.forEach((row, ri) => {
      cols.forEach((col) => p.rect(col.x, y, col.w, rowH, { stroke: QUOTE.line, lw: 0.15 }))
      if (row) {
        const it = row.item
        const cell = (key: string, text: string, align: 'left' | 'right' | 'center' = 'right', weight: 'regular' | 'bold' = 'regular') => {
          const col = cols.find((k) => k.key === key)
          if (col) p.fit(text, col.x, y, col.w, rowH, { size: 8.5, align, weight })
        }
        cell('no', String(startNo + ri + 1), 'center')
        cell('name', it.name, 'left')
        cell('spec', it.spec, 'center')
        cell('qty', it.qty == null ? '' : won(it.qty))
        cell('price', it.unitPrice == null ? '' : won(it.unitPrice))
        cell('supply', won(row.supply))
        cell('tax', won(row.tax))
        cell('total', won(row.total), 'right', 'bold')
        cell('note', it.note, 'left')
      }
      y += rowH
    })
    if (last) {
      // 합계 줄
      const sumH = 9
      cols.forEach((col) => p.rect(col.x, y, col.w, sumH, { fill: QUOTE.shade, stroke: QUOTE.line, lw: 0.25 }))
      const nameCol = cols.find((k) => k.key === 'name')!
      p.fit('합  계', cols[0].x, y, nameCol.x + nameCol.w - cols[0].x, sumH, { size: 9.5, weight: 'bold', align: 'center' })
      const put = (key: string, v: string) => {
        const col = cols.find((k) => k.key === key)!
        p.fit(v, col.x, y, col.w, sumH, { size: 8.5, weight: 'bold', align: 'right' })
      }
      put('qty', won(totals.qty))
      put('supply', won(totals.supply))
      put('tax', won(totals.tax))
      put('total', won(totals.total))
      p.line(L, y, R, y, QUOTE.line, 0.5)
      y += sumH + 6

      // 기타사항
      const noteLines = doc.notes.trim() ? wrap(doc.notes.trim(), R - L - 6, (s) => p.width(s, 8.5)) : []
      const boxH = Math.max(16, 9 + noteLines.length * 4.4)
      p.rect(L, y, R - L, boxH, { stroke: QUOTE.line, lw: 0.25 })
      p.text('<기타사항>', L + 3, y + 5.5, { size: 8.5, weight: 'bold', color: QUOTE.accent })
      noteLines.slice(0, 12).forEach((ln, i) => p.text(ln, L + 3, y + 10.5 + i * 4.4, { size: 8.5 }))
      y += boxH + 5
      const foot: string[] = []
      if (doc.footnote.trim()) foot.push(...doc.footnote.trim().split(/\r?\n/))
      if (kit.bank.account && doc.attachBankbook) foot.push(`※ 입금 계좌: ${[kit.bank.bankName, kit.bank.account, kit.bank.holder && `예금주 ${kit.bank.holder}`].filter(Boolean).join(' ')}`)
      if (contact) foot.push(`※ 담당자: ${contactLine(contact)}`)
      foot.forEach((ln) => {
        const ls = wrap(ln, R - L - 2, (s) => p.width(s, 8.5))
        ls.forEach((l2) => {
          p.text(l2, L + 1, y + 3, { size: 8.5, color: INK })
          y += 4.6
        })
      })
      // 바닥: 회사 이름
      if (c.name) p.text(c.name, PAGE_W / 2, PAGE_H - 19, { size: 14, weight: 'bold', align: 'center', spacing: 0.9, color: QUOTE.line })
    }
    return { ops: p.ops }
  })
}

// ── 거래명세서 ────────────────────────────────────────────
/**
 * 장부 느낌의 파란 선 양식. 한 장에 2부(위: 공급받는자 보관용 · 아래: 공급자 보관용)를 기본으로 하고,
 * 끄면 한 장에 크게 한 부를 찍는다. 품목이 많으면 다음 장으로 넘어간다.
 */
function statementPages(doc: QuoteDoc, kit: CompanyKit, measure: Measure): Page[] {
  if (styleOf(doc) === 'shipment') return shipmentPages(doc, kit, measure)
  const totals = calcTotals(doc)
  const filled = totals.lines.filter((l) => l.filled)
  const perCopy = doc.twoCopies ? 8 : 22
  const groups = chunk(filled, perCopy)
  return groups.map((rows, gi) => {
    const p = new Pen(measure)
    const isLast = gi === groups.length - 1
    const pageInfo = groups.length > 1 ? `${gi + 1} / ${groups.length}` : ''
    if (doc.twoCopies) {
      const half = PAGE_H / 2
      statementCopy(p, doc, kit, rows, isLast ? totals : null, { top: 9, height: half - 13, copyLabel: '공급받는자 보관용', rowCount: perCopy, pageInfo })
      p.line(8, half, PAGE_W - 8, half, '#9aa6c2', 0.25, [2, 1.5])
      p.text('자르는 선', PAGE_W - 9, half - 1.2, { size: 6, align: 'right', color: '#9aa6c2' })
      statementCopy(p, doc, kit, rows, isLast ? totals : null, { top: half + 4, height: half - 13, copyLabel: '공급자 보관용', rowCount: perCopy, pageInfo })
    } else {
      statementCopy(p, doc, kit, rows, isLast ? totals : null, { top: 12, height: PAGE_H - 24, copyLabel: '', rowCount: perCopy, pageInfo })
    }
    return { ops: p.ops }
  })
}

function statementCopy(
  p: Pen,
  doc: QuoteDoc,
  kit: CompanyKit,
  rows: LineCalc[],
  totals: ReturnType<typeof calcTotals> | null,
  o: { top: number; height: number; copyLabel: string; rowCount: number; pageInfo: string },
) {
  const C = LEDGER
  const L = 12
  const R = PAGE_W - 12
  const W = R - L
  const big = !doc.twoCopies
  const c = kit.company
  const seal = doc.showSeal ? kit.seals.find((s) => s.id === doc.sealId) ?? kit.seals[0] : undefined
  const contact = doc.showContact ? kit.contacts.find((k) => k.id === doc.contactId) ?? kit.contacts[0] : undefined
  let y = o.top

  // 머리: 제목 · 보관용 · 날짜/번호
  p.rect(L, y, W, big ? 15 : 12, { fill: C.line })
  p.text(DOC_TITLE.statement, L + W / 2, y + (big ? 10.4 : 8.6), { size: big ? 20 : 16, weight: 'bold', align: 'center', color: '#ffffff', spacing: 1.2 })
  if (o.copyLabel) p.text(`(${o.copyLabel})`, R - 3, y + (big ? 9.8 : 7.9), { size: 8, align: 'right', color: '#dbe6ff' })
  p.text(dateKo(doc.date), L + 3, y + (big ? 9.8 : 7.9), { size: 8.5, color: '#ffffff' })
  y += big ? 15 : 12
  if (doc.docNo || o.pageInfo) p.text([doc.docNo && `No. ${doc.docNo}`, o.pageInfo].filter(Boolean).join('   '), R - 2, y + 3.6, { size: 7, align: 'right', color: C.text })
  y += big ? 6 : 5

  // 공급자 | 공급받는자
  const boxH = big ? 36 : 29
  const halfW = (W - 3) / 2
  partyBox(p, L, y, halfW, boxH, '공급자', [
    ['등록번호', c.bizNo],
    ['상호', c.name, '성명', c.ceo],
    ['주소', c.address],
    ['업태', c.bizType, '종목', c.bizItem],
  ], seal?.dataUrl, LEDGER_PARTY)
  partyBox(p, L + halfW + 3, y, halfW, boxH, '공급받는자', [
    ['등록번호', doc.customerBizNo],
    ['상호', doc.customer, '성명', doc.customerCeo],
    ['주소', doc.customerAddress],
    ['', doc.title ? `품명: ${doc.title}` : ''],
  ], undefined, LEDGER_PARTY)
  y += boxH + 3

  // 합계 띠
  const vatNote = doc.vatMode === 'included' ? '부가세 포함' : doc.vatMode === 'excluded' ? '부가세 포함(별도 계산)' : '면세'
  const t = totals
  p.rect(L, y, W, 9, { fill: C.shadeStrong, stroke: C.line, lw: 0.35 })
  p.text('합계금액', L + 3, y + 6, { size: 9, weight: 'bold', color: C.text })
  p.fit(t ? `${amountInWords(t.total)}  · ${vatNote}` : '다음 장에 합계', L + 22, y, W - 25, 9, { size: 10.5, weight: 'bold', align: 'right', pad: 0, color: C.text })
  y += 12

  // 품목 표
  const cols = [
    { key: 'day', label: '월/일', w: 13 },
    { key: 'name', label: '품목', w: 52 },
    { key: 'spec', label: '규격', w: 18 },
    { key: 'qty', label: '수량', w: 13 },
    { key: 'price', label: '단가', w: 20 },
    { key: 'supply', label: '공급가액', w: 23 },
    { key: 'tax', label: '세액', w: 19 },
    { key: 'note', label: '비고', w: 0 },
  ]
  cols[cols.length - 1].w = W - cols.reduce((s, k) => s + k.w, 0)
  let cx = L
  const placed = cols.map((k) => {
    const r = { ...k, x: cx }
    cx += k.w
    return r
  })
  const headH = 6.5
  placed.forEach((col) => {
    p.rect(col.x, y, col.w, headH, { fill: C.shade, stroke: C.line, lw: 0.25 })
    p.fit(col.label, col.x, y, col.w, headH, { size: 7.8, weight: 'bold', align: 'center', color: C.text, pad: 0.4 })
  })
  y += headH
  const rowH = big ? 8.4 : 6.2
  for (let i = 0; i < o.rowCount; i++) {
    const row = rows[i]
    placed.forEach((col) => p.rect(col.x, y, col.w, rowH, { stroke: C.line, lw: 0.12 }))
    if (row) {
      const it = row.item
      const cell = (key: string, text: string, align: 'left' | 'right' | 'center' = 'right') => {
        const col = placed.find((k) => k.key === key)!
        p.fit(text, col.x, y, col.w, rowH, { size: big ? 8.5 : 7.8, align })
      }
      cell('day', it.day || doc.date.slice(5).replace('-', '/'), 'center')
      cell('name', it.name, 'left')
      cell('spec', it.spec, 'center')
      cell('qty', it.qty == null ? '' : won(it.qty))
      cell('price', it.unitPrice == null ? '' : won(it.unitPrice))
      cell('supply', won(row.supply))
      cell('tax', won(row.tax))
      cell('note', it.note, 'left')
    }
    y += rowH
  }
  // 소계 줄
  const sumH = big ? 8 : 6.2
  placed.forEach((col) => p.rect(col.x, y, col.w, sumH, { fill: C.shade, stroke: C.line, lw: 0.25 }))
  const nameEnd = placed[1].x + placed[1].w
  p.fit(t ? '계' : '소계(다음 장 이어짐)', L, y, nameEnd - L, sumH, { size: 8, weight: 'bold', align: 'center', color: C.text })
  const sum = t ?? { qty: rows.reduce((s, r) => s + (r.item.qty ?? 0), 0), supply: rows.reduce((s, r) => s + r.supply, 0), tax: rows.reduce((s, r) => s + r.tax, 0) }
  const put = (key: string, v: string) => {
    const col = placed.find((k) => k.key === key)!
    p.fit(v, col.x, y, col.w, sumH, { size: big ? 8.5 : 7.8, weight: 'bold', align: 'right' })
  }
  put('qty', won(sum.qty))
  put('supply', won(sum.supply))
  put('tax', won(sum.tax))
  y += sumH
  p.rect(L, o.top, W, y - o.top, { stroke: C.line, lw: 0.6 })

  // 아래: 비고·담당자·인수자
  y += 2.5
  const footLines: string[] = []
  // 2부일 때는 세 줄만 들어가므로 담당자·계좌를 먼저 둔다
  if (contact) footLines.push(`담당자: ${contactLine(contact)}`)
  if (kit.bank.account && doc.attachBankbook) footLines.push(`입금 계좌: ${[kit.bank.bankName, kit.bank.account, kit.bank.holder && `예금주 ${kit.bank.holder}`].filter(Boolean).join(' ')}`)
  if (doc.notes.trim()) footLines.push(...doc.notes.trim().split(/\r?\n/))
  const signW = 46
  const avail = W - signW - 4
  const maxLines = big ? 6 : 3
  const wrapped = footLines.flatMap((ln) => wrap(ln, avail, (s) => p.width(s, 7.6))).slice(0, maxLines)
  wrapped.forEach((ln, i) => p.text(ln, L + 1, y + 3 + i * 3.8, { size: 7.6, color: C.text }))
  p.rect(R - signW, y, signW, 9, { stroke: C.line, lw: 0.3 })
  p.rect(R - signW, y, 12, 9, { fill: C.shade, stroke: C.line, lw: 0.3 })
  p.text('인수자', R - signW + 6, y + 5.8, { size: 7.8, weight: 'bold', align: 'center', color: C.text })
  p.text('(인)', R - 3, y + 5.8, { size: 7.5, align: 'right', color: '#8a97b8' })
}

interface PartyTheme {
  line: string
  text: string
  shade: string
  shadeStrong: string
  stamp: string
}
const LEDGER_PARTY: PartyTheme = { line: LEDGER.line, text: LEDGER.text, shade: LEDGER.shade, shadeStrong: LEDGER.shadeStrong, stamp: '#8a97b8' }
const QUOTE_PARTY: PartyTheme = { line: QUOTE.line, text: QUOTE.accent, shade: QUOTE.shade, shadeStrong: QUOTE.shadeStrong, stamp: '#8d9690' }

function partyBox(p: Pen, x: number, y: number, w: number, h: number, label: string, rows: Array<[string, string, string?, string?]>, sealSrc: string | undefined, C: PartyTheme) {
  const tagW = 6.5
  p.rect(x, y, tagW, h, { fill: C.shadeStrong, stroke: C.line, lw: 0.3 })
  const chars = [...label]
  const step = Math.min(5, (h - 4) / chars.length)
  chars.forEach((ch, i) => p.text(ch, x + tagW / 2, y + h / 2 - (chars.length * step) / 2 + i * step + step * 0.72, { size: 8, weight: 'bold', align: 'center', color: C.text }))
  const rowH = h / rows.length
  const labW = 13
  rows.forEach((r, i) => {
    const ry = y + i * rowH
    const bx = x + tagW
    const bw = w - tagW
    if (r[0]) {
      p.rect(bx, ry, labW, rowH, { fill: C.shade, stroke: C.line, lw: 0.2 })
      p.fit(r[0], bx, ry, labW, rowH, { size: 7, align: 'center', color: C.text, pad: 0.3 })
    }
    const vx = r[0] ? bx + labW : bx
    if (r[2] !== undefined) {
      const restW = bw - labW * 2
      const v1 = restW * 0.58
      p.rect(vx, ry, v1, rowH, { stroke: C.line, lw: 0.2 })
      p.fit(r[1], vx, ry, v1, rowH, { size: 8.4, weight: 'bold' })
      p.rect(vx + v1, ry, labW, rowH, { fill: C.shade, stroke: C.line, lw: 0.2 })
      p.fit(r[2], vx + v1, ry, labW, rowH, { size: 7, align: 'center', color: C.text, pad: 0.3 })
      const sx = vx + v1 + labW
      const sw = restW - v1
      p.rect(sx, ry, sw, rowH, { stroke: C.line, lw: 0.2 })
      const isName = r[2] === '성명'
      p.fit(r[3] ?? '', sx, ry, isName ? sw - 9 : sw, rowH, { size: 8.2 })
      if (isName && sealSrc) {
        const s = Math.min(13, rowH * 1.9)
        p.image(sealSrc, sx + sw - s - 0.4, ry + rowH / 2 - s / 2, s, s, 0.92)
      } else if (isName && label === '공급받는자' && r[1]) {
        p.text('(인)', sx + sw - 1.5, ry + rowH / 2 + 1.2, { size: 6.8, align: 'right', color: C.stamp })
      }
    } else {
      const vw = bw - (r[0] ? labW : 0)
      p.rect(vx, ry, vw, rowH, { stroke: C.line, lw: 0.2 })
      p.fit(r[1], vx, ry, vw, rowH, { size: i === 0 ? 9 : 7.8, weight: i === 0 ? 'bold' : 'regular' })
    }
  })
}

// ── 거래명세서: 출고 양식 ─────────────────────────────────
/**
 * 회사에서 쓰던 출고용 거래명세서 모양(품번·BOX수·내품수량·출고수량, 아래 인수증)을
 * 견적서와 같은 선·색·제목 꾸밈과 회사 자료(공급자 정보·직인·로고)로 그린다.
 */
const SHIP_ROWS = 18
const qtyFmt = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 })
const numText = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? qtyFmt.format(v) : '')

function shipmentPages(doc: QuoteDoc, kit: CompanyKit, measure: Measure): Page[] {
  const totals = calcTotals(doc)
  const filled = totals.lines.filter((l) => l.filled)
  const groups = chunk(filled, SHIP_ROWS)
  const c = kit.company
  const seal = doc.showSeal ? kit.seals.find((s) => s.id === doc.sealId) ?? kit.seals[0] : undefined
  const contact = doc.showContact ? kit.contacts.find((k) => k.id === doc.contactId) ?? kit.contacts[0] : undefined
  const L = 15
  const R = PAGE_W - 15
  const W = R - L
  const amountLabel = doc.vatMode === 'exempt' ? '금액' : '금액\n(VAT 포함)'
  const priceLabel = doc.vatMode === 'excluded' ? '단가\n(VAT 별도)' : '단가'

  const colsDef = [
    { key: 'seq', label: 'SEQ.', w: 9 },
    { key: 'itemNo', label: '품  번', w: 20 },
    { key: 'name', label: '품  명', w: 44 },
    { key: 'spec', label: '규격', w: 24 },
    { key: 'boxes', label: 'BOX수', w: 12 },
    { key: 'perBox', label: '내품수량', w: 14 },
    { key: 'qty', label: '출고수량', w: 15 },
    { key: 'price', label: priceLabel, w: 18 },
    { key: 'total', label: amountLabel, w: 0 },
  ]
  colsDef[colsDef.length - 1].w = W - colsDef.reduce((s, k) => s + k.w, 0)
  let cx = L
  const cols = colsDef.map((k) => {
    const r = { ...k, x: cx }
    cx += k.w
    return r
  })
  const col = (key: string) => cols.find((k) => k.key === key)!

  return groups.map((rows, gi) => {
    const p = new Pen(measure)
    const last = gi === groups.length - 1
    // 바깥 이중 테두리(견적서와 같게)
    p.rect(10, 10, PAGE_W - 20, PAGE_H - 20, { stroke: QUOTE.line, lw: 0.7 })
    p.rect(11.2, 11.2, PAGE_W - 22.4, PAGE_H - 22.4, { stroke: QUOTE.line, lw: 0.2 })

    let y = 18
    p.text('거 래 명 세 서', PAGE_W / 2, y + 9, { size: 24, weight: 'bold', align: 'center', spacing: 1.6, color: QUOTE.line })
    y += 14
    p.line(PAGE_W / 2 - 40, y, PAGE_W / 2 + 40, y, QUOTE.accent, 0.6)
    p.line(PAGE_W / 2 - 40, y + 1, PAGE_W / 2 + 40, y + 1, QUOTE.accent, 0.2)
    y += 8
    const pageInfo = groups.length > 1 ? `   (${gi + 1} / ${groups.length})` : ''
    p.text(`No.  ${doc.docNo}${pageInfo}`, L + 1, y, { size: 9 })
    p.text(`출고일   ${dateKo(doc.date)}`, R - 1, y, { size: 9, align: 'right' })
    y += 3

    // 공급자 | 공급받는자
    const boxH = 32
    const halfW = (W - 3) / 2
    partyBox(p, L, y, halfW, boxH, '공급자', [
      ['등록번호', c.bizNo],
      ['상호', c.name, '성명', c.ceo],
      ['주소', c.address],
      ['업태', c.bizType, '종목', c.bizItem],
    ], seal?.dataUrl, QUOTE_PARTY)
    partyBox(p, L + halfW + 3, y, halfW, boxH, '공급받는자', [
      ['등록번호', doc.customerBizNo],
      ['상호', doc.customer, '성명', doc.customerCeo],
      ['주소', doc.customerAddress],
      ['업태', doc.customerBizType ?? '', '종목', doc.customerBizItem ?? ''],
    ], undefined, QUOTE_PARTY)
    y += boxH + 4

    // 품목 표
    const headH = 8
    cols.forEach((k) => {
      p.rect(k.x, y, k.w, headH, { fill: QUOTE.shade, stroke: QUOTE.line, lw: 0.25 })
      const parts = k.label.split('\n')
      parts.forEach((ln, i) => p.text(ln, k.x + k.w / 2, y + headH / 2 + (i - (parts.length - 1) / 2) * 3.2 + 1.2, { size: i ? 6 : 7.8, weight: i ? 'regular' : 'bold', align: 'center', color: i ? MUTED : INK }))
    })
    p.line(L, y, R, y, QUOTE.line, 0.5)
    y += headH
    const rowH = 7
    for (let i = 0; i < SHIP_ROWS; i++) {
      const row = rows[i]
      cols.forEach((k) => p.rect(k.x, y, k.w, rowH, { stroke: QUOTE.line, lw: 0.15 }))
      if (row) {
        const it = row.item
        const cell = (key: string, text: string, align: 'left' | 'right' | 'center' = 'right', weight: Weight = 'regular') => {
          const k = col(key)
          p.fit(text, k.x, y, k.w, rowH, { size: 8.2, align, weight, pad: 1.2, minSize: 5.5 })
        }
        cell('seq', String(gi * SHIP_ROWS + i + 1), 'center')
        cell('itemNo', it.itemNo ?? '', 'center')
        cell('name', it.name, 'left')
        cell('spec', it.spec, 'center')
        cell('boxes', numText(it.boxes))
        cell('perBox', numText(it.perBox))
        cell('qty', numText(it.qty))
        cell('price', it.unitPrice == null ? '' : won(it.unitPrice))
        cell('total', won(row.total), 'right', 'bold')
      }
      y += rowH
    }
    p.line(L, y, R, y, QUOTE.line, 0.5)
    y += 4

    // 비고 | 공급가액계·부가가치세·합계
    const sumRowH = 7
    const sumH = sumRowH * 3
    const tagW = 9
    const valW = 30
    const labW = 30
    const noteW = W - tagW - labW - valW
    p.rect(L, y, tagW, sumH, { fill: QUOTE.shadeStrong, stroke: QUOTE.line, lw: 0.3 })
    ;['비', '고'].forEach((ch, i) => p.text(ch, L + tagW / 2, y + sumH / 2 - 2.5 + i * 6 + 1.4, { size: 8.5, weight: 'bold', align: 'center', color: QUOTE.accent }))
    p.rect(L + tagW, y, noteW, sumH, { stroke: QUOTE.line, lw: 0.3 })
    const noteLines: string[] = []
    if (!last) noteLines.push('다음 장에 이어집니다.')
    if (doc.notes.trim()) noteLines.push(...doc.notes.trim().split(/\r?\n/))
    if (kit.bank.account && doc.attachBankbook) noteLines.push(`입금 계좌: ${[kit.bank.bankName, kit.bank.account, kit.bank.holder && `예금주 ${kit.bank.holder}`].filter(Boolean).join(' ')}`)
    if (contact) noteLines.push(`담당자: ${contactLine(contact)}`)
    noteLines
      .flatMap((ln) => wrap(ln, noteW - 4, (s2) => p.width(s2, 7.6)))
      .slice(0, 5)
      .forEach((ln, i) => p.text(ln, L + tagW + 2, y + 4.4 + i * 3.7, { size: 7.6 }))
    const sums: Array<[string, string]> = [
      ['공 급 가 액 계', last ? won(totals.supply) : ''],
      ['부 가 가 치 세', last ? won(totals.tax) : ''],
      ['합          계', last ? won(totals.total) : ''],
    ]
    sums.forEach(([lab, v], i) => {
      const ry = y + i * sumRowH
      const lx = R - valW - labW
      p.rect(lx, ry, labW, sumRowH, { fill: i === 2 ? QUOTE.shadeStrong : QUOTE.shade, stroke: QUOTE.line, lw: 0.25 })
      p.fit(lab, lx, ry, labW, sumRowH, { size: 8, weight: 'bold', align: 'center', color: i === 2 ? QUOTE.accent : INK, pad: 0.5 })
      p.rect(R - valW, ry, valW, sumRowH, { stroke: QUOTE.line, lw: 0.25 })
      p.fit(v, R - valW, ry, valW, sumRowH, { size: i === 2 ? 9.5 : 8.6, weight: i === 2 ? 'bold' : 'regular', align: 'right', pad: 1.6 })
    })
    p.rect(L, y, W, sumH, { stroke: QUOTE.line, lw: 0.5 })
    y += sumH

    // 인수증(마지막 장)
    if (last) {
      y += 5
      p.line(L - 2, y, R + 2, y, '#8d9690', 0.25, [2, 1.2])
      p.text('자르는 선', R + 2, y - 1, { size: 5.5, align: 'right', color: '#8d9690' })
      y += 7.5
      p.text('인   수   증', PAGE_W / 2, y, { size: 11, weight: 'bold', align: 'center', spacing: 1, color: QUOTE.line })
      y += 3
      const rh = 7.5
      const rc = [16, 50, 26, 36, 22]
      const restW = W - rc.reduce((s2, v) => s2 + v, 0)
      const xs = rc.reduce<number[]>((acc, w) => [...acc, acc[acc.length - 1] + w], [L])
      const rowsR: Array<[string, string, string, string]> = [
        ['인 수 자', '거래명세서번호', doc.docNo, ''],
        ['인 계 자', '거래처', doc.customer, won(totals.total)],
      ]
      rowsR.forEach(([who, lab, val, money], i) => {
        const ry = y + i * rh
        p.rect(xs[0], ry, rc[0], rh, { fill: QUOTE.shade, stroke: QUOTE.line, lw: 0.25 })
        p.fit(who, xs[0], ry, rc[0], rh, { size: 8, weight: 'bold', align: 'center', pad: 0.5 })
        p.rect(xs[1], ry, rc[1], rh, { stroke: QUOTE.line, lw: 0.25 })
        p.text('(서명)', xs[1] + rc[1] - 1.6, ry + rh / 2 + 1.2, { size: 7, align: 'right', color: MUTED })
        p.rect(xs[2], ry, rc[2], rh, { fill: QUOTE.shade, stroke: QUOTE.line, lw: 0.25 })
        p.fit(lab, xs[2], ry, rc[2], rh, { size: 7.6, weight: 'bold', align: 'center', pad: 0.5 })
        p.rect(xs[3], ry, rc[3], rh, { stroke: QUOTE.line, lw: 0.25 })
        p.fit(val, xs[3], ry, rc[3], rh, { size: 8, pad: 1.2, minSize: 5.5 })
        p.rect(xs[4], ry, rc[4], rh, { fill: QUOTE.shade, stroke: QUOTE.line, lw: 0.25 })
        p.fit(i === 0 ? '총수량(박스)' : '총금액', xs[4], ry, rc[4], rh, { size: 7.6, weight: 'bold', align: 'center', pad: 0.5 })
        p.rect(xs[5], ry, restW, rh, { stroke: QUOTE.line, lw: 0.25 })
        if (i === 0) {
          // 출고수량 | BOX 수
          const mid = xs[5] + restW * 0.58
          p.line(mid, ry + 1, mid, ry + rh - 1, '#8d9690', 0.2, [0.8, 0.6])
          p.fit(numText(totals.qty), xs[5], ry, mid - xs[5], rh, { size: 8.4, weight: 'bold', align: 'right', pad: 1.4 })
          p.fit(totals.boxes ? numText(totals.boxes) : '', mid, ry, xs[5] + restW - mid, rh, { size: 7.4, align: 'right', pad: 1.2, color: MUTED })
        } else {
          p.fit(money, xs[5], ry, restW, rh, { size: 8.6, weight: 'bold', align: 'right', pad: 1.4 })
        }
      })
      p.rect(L, y, W, rh * 2, { stroke: QUOTE.line, lw: 0.5 })
    }

    // 바닥: 문구 · 로고
    const footY = PAGE_H - 17
    if (c.slogan.trim()) p.text(c.slogan.trim(), L + 1, footY, { size: 7.5, color: MUTED })
    if (kit.logo) p.image(kit.logo, R - 27, footY - 5.6, 27, 7.2)
    else if (c.name) p.text(c.name, R, footY, { size: 11, weight: 'bold', align: 'right', color: QUOTE.line })
    return { ops: p.ops }
  })
}

// ── 첨부 쪽 ───────────────────────────────────────────────
function attachmentPages(doc: QuoteDoc, kit: CompanyKit, measure: Measure): Page[] {
  const out: Page[] = []
  const add = (kind: 'registration' | 'bankbook', title: string) => {
    const a = kind === 'registration' ? kit.registration : kit.bankbook
    if (!a || !a.pages.length) return
    a.pages.forEach((src, i) => {
      const p = new Pen(measure)
      p.text(a.pages.length > 1 ? `${title} (${i + 1}/${a.pages.length})` : title, 15, 17, { size: 10, weight: 'bold', color: MUTED })
      p.line(15, 20, PAGE_W - 15, 20, '#c9cfcb', 0.25)
      p.image(src, 15, 25, PAGE_W - 30, PAGE_H - 40, undefined, true)
      out.push({ ops: p.ops, attachment: { kind, pdfDataUrl: a.pdfDataUrl, pageIndex: i } })
    })
  }
  if (doc.attachRegistration) add('registration', '첨부. 사업자등록증')
  if (doc.attachBankbook) add('bankbook', '첨부. 통장 사본')
  return out
}

/**
 * 이미지 칸(w×h)에 원본 비율을 지켜 넣을 위치. 그리는 쪽에서 원본 크기를 알게 된 뒤 쓴다.
 */
export function containRect(boxX: number, boxY: number, boxW: number, boxH: number, imgW: number, imgH: number, top = false) {
  const s = Math.min(boxW / imgW, boxH / imgH)
  const w = imgW * s
  const h = imgH * s
  return { x: boxX + (boxW - w) / 2, y: top ? boxY : boxY + (boxH - h) / 2, w, h }
}
