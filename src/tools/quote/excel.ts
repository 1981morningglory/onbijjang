/**
 * 엑셀(xlsx) 저장. 금액 칸은 수식으로 넣어 엑셀에서 수량·단가를 고쳐도 다시 계산된다.
 * 직인은 대표 칸 위에 그림으로, 사업자등록증·통장 사본은 따로 시트로 붙인다.
 */
import type { Borders, Cell, Fill, Worksheet } from 'exceljs'
import { loadImageElement } from '@/lib/image'
import { addDays, amountInWords, calcTotals, contactLine, dateKo, DOC_NAME, koreanAmount, type CompanyKit, type QuoteDoc } from './model'

const thin = { style: 'thin' as const, color: { argb: 'FF4A524D' } }
const hair = { style: 'hair' as const, color: { argb: 'FF8A928D' } }
const BORDER_ALL: Partial<Borders> = { top: thin, left: thin, bottom: thin, right: thin }
const BORDER_HAIR: Partial<Borders> = { top: hair, left: hair, bottom: hair, right: hair }
const MONEY = '#,##0'

const fill = (argb: string): Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })

interface Theme {
  line: string
  shade: string
  shadeStrong: string
  text: string
}
const QUOTE_THEME: Theme = { line: 'FF14201A', shade: 'FFEEF4F0', shadeStrong: 'FFDCEBE2', text: 'FF0B6B49' }
const LEDGER_THEME: Theme = { line: 'FF1F3F8F', shade: 'FFEAF0FB', shadeStrong: 'FFD7E2F6', text: 'FF16306E' }

function dataUrlToBase64(dataUrl: string) {
  return dataUrl.slice(dataUrl.indexOf(',') + 1)
}
const extOf = (dataUrl: string): 'png' | 'jpeg' => (dataUrl.startsWith('data:image/png') ? 'png' : 'jpeg')

async function naturalSize(src: string) {
  const img = await loadImageElement(src)
  return { w: img.naturalWidth, h: img.naturalHeight }
}

function style(c: Cell, o: { bold?: boolean; size?: number; color?: string; align?: 'left' | 'center' | 'right'; fill?: string; border?: Partial<Borders>; wrap?: boolean; numFmt?: string }) {
  c.font = { name: '맑은 고딕', size: o.size ?? 10, bold: o.bold, color: o.color ? { argb: o.color } : undefined }
  c.alignment = { horizontal: o.align ?? 'left', vertical: 'middle', wrapText: o.wrap ?? false }
  if (o.fill) c.fill = fill(o.fill)
  if (o.border) c.border = o.border
  if (o.numFmt) c.numFmt = o.numFmt
}

/** 칸을 합치고 값·서식을 넣는다. 합친 칸 전체에 테두리를 둘러야 엑셀에서 선이 끊기지 않는다. */
function put(ws: Worksheet, range: string, value: Cell['value'], o: Parameters<typeof style>[1] = {}) {
  const [a, b] = range.split(':')
  if (b && a !== b) ws.mergeCells(range)
  const cell = ws.getCell(a)
  cell.value = value
  style(cell, o)
  if (o.border && b) {
    const s = ws.getCell(a)
    const e = ws.getCell(b)
    for (let r = Number(s.row); r <= Number(e.row); r++) for (let c = Number(s.col); c <= Number(e.col); c++) {
      const cc = ws.getCell(r, c)
      cc.border = o.border
      if (o.fill) cc.fill = fill(o.fill)
    }
  }
  return cell
}

/** 행 높이(pt)·열 너비(문자 수)를 픽셀로 어림한다(그림 놓을 자리 계산용). */
const colPx = (w: number) => Math.round(w * 7 + 5)

export async function buildWorkbook(doc: QuoteDoc, kit: CompanyKit): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = '온비짱'
  wb.created = new Date()
  const theme = doc.type === 'quote' ? QUOTE_THEME : LEDGER_THEME
  const ws = wb.addWorksheet(DOC_NAME[doc.type], {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
    views: [{ showGridLines: false }],
  })
  const totals = calcTotals(doc)
  const c = kit.company
  const rows = totals.lines.filter((l) => l.filled)
  const seal = doc.showSeal ? kit.seals.find((s) => s.id === doc.sealId) ?? kit.seals[0] : undefined
  const contact = doc.showContact ? kit.contacts.find((k) => k.id === doc.contactId) ?? kit.contacts[0] : undefined
  const vatLabel = doc.vatMode === 'included' ? 'VAT 포함' : doc.vatMode === 'excluded' ? 'VAT 별도' : '면세'

  // 열: A 여백 · B 번호/월일 · C 품목 · D 규격 · E 수량 · F 단가 · G 공급가액 · H 세액 · I 합계 · J 비고
  const widths = [2, 7, 30, 10, 8, 12, 13, 11, 13, 14]
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w))
  const line = theme.line

  let r = 2
  ws.getRow(r).height = 36
  put(ws, `B${r}:J${r}`, doc.type === 'quote' ? '견   적   서' : '거 래 명 세 표', { bold: true, size: 22, align: 'center', color: doc.type === 'quote' ? 'FF14201A' : 'FFFFFFFF', fill: doc.type === 'quote' ? undefined : theme.line })
  r += 2

  // 왼쪽: 날짜·받는 곳 / 오른쪽: 공급자
  const supplier: Array<[string, string, string?, string?]> = [
    ['등록번호', c.bizNo],
    ['상호', c.name, '대표', c.ceo],
    ['주소', c.address],
    ['업태', c.bizType, '종목', c.bizItem],
    ['전화', c.tel, '팩스', c.fax],
  ]
  const top = r
  put(ws, `B${r}:D${r}`, dateKo(doc.date), { size: 10 })
  if (doc.docNo) put(ws, `B${r + 1}:D${r + 1}`, `${doc.type === 'quote' ? '견적번호' : 'No.'} ${doc.docNo}`, { size: 9, color: 'FF5B625E' })
  put(ws, `B${r + 2}:D${r + 2}`, `${doc.customer || ''}  귀중`, { bold: true, size: 14, border: { bottom: { style: 'medium', color: { argb: line } } } })
  if (doc.type === 'quote') {
    put(ws, `B${r + 3}:D${r + 3}`, '아래와 같이 견적합니다.', { size: 10 })
    if (doc.validDays > 0) put(ws, `B${r + 4}:D${r + 4}`, `유효기간 ${dateKo(addDays(doc.date, doc.validDays))}까지`, { size: 9, color: 'FF5B625E' })
  } else {
    put(ws, `B${r + 3}:D${r + 3}`, [doc.customerBizNo && `등록번호 ${doc.customerBizNo}`, doc.customerCeo && `대표 ${doc.customerCeo}`].filter(Boolean).join('  ·  '), { size: 9 })
    put(ws, `B${r + 4}:D${r + 4}`, doc.customerAddress, { size: 9 })
  }
  supplier.forEach((row, i) => {
    const rr = top + i
    ws.getRow(rr).height = 21
    put(ws, `E${rr}`, row[0], { size: 9, align: 'center', fill: theme.shade, border: BORDER_ALL, color: theme.text })
    if (row[2] !== undefined) {
      put(ws, `F${rr}:G${rr}`, row[1], { size: 10, bold: i === 1, border: BORDER_ALL })
      put(ws, `H${rr}`, row[2], { size: 9, align: 'center', fill: theme.shade, border: BORDER_ALL, color: theme.text })
      put(ws, `I${rr}:J${rr}`, row[3] ?? '', { size: 10, border: BORDER_ALL })
    } else {
      put(ws, `F${rr}:J${rr}`, row[1], { size: i === 0 ? 11 : 9, bold: i === 0, border: BORDER_ALL, wrap: true })
    }
  })
  r = top + supplier.length + 1

  // 합계 금액(한글) — 한국어 엑셀이면 NUMBERSTRING 으로 다시 계산, 아니면 저장 당시 값
  const firstItem = r + 3 // 합계금액 줄 · 품명 줄 · 표 머리 다음
  const lastItem = firstItem + Math.max(rows.length, doc.type === 'quote' ? 10 : 12) - 1
  const sumRow = lastItem + 1
  ws.getRow(r).height = 26
  put(ws, `B${r}:D${r}`, `합계금액 (${vatLabel})`, { bold: true, size: 11, fill: theme.shadeStrong, border: BORDER_ALL, color: theme.text })
  put(ws, `E${r}:J${r}`, { formula: `IFERROR("일금 "&NUMBERSTRING(I${sumRow},1)&"원정 (₩"&TEXT(I${sumRow},"#,##0")&")","${amountInWords(totals.total)}")`, result: amountInWords(totals.total) }, { bold: true, size: 12, align: 'right', fill: theme.shadeStrong, border: BORDER_ALL })
  r += 1
  if (doc.title.trim() && doc.type === 'quote') put(ws, `B${r}:J${r}`, `품명 : ${doc.title}`, { size: 10, bold: true })
  r += 1

  // 표 머리
  const head = [doc.type === 'quote' ? 'No' : '월/일', doc.type === 'quote' ? '비용항목' : '품목', '규격', '수량', `단가\n(${vatLabel})`, '공급가액', '세액', '합계', '비고']
  ws.getRow(r).height = 30
  head.forEach((h, i) => put(ws, `${String.fromCharCode(66 + i)}${r}`, h, { bold: true, size: 9.5, align: 'center', fill: theme.shade, border: BORDER_ALL, wrap: true }))
  r += 1
  for (let i = 0; i <= lastItem - firstItem; i++) {
    const rr = firstItem + i
    const row = rows[i]
    ws.getRow(rr).height = 21
    const it = row?.item
    const first = doc.type === 'quote' ? (row ? i + 1 : '') : row ? it!.day || doc.date.slice(5).replace('-', '/') : ''
    put(ws, `B${rr}`, first, { size: 9.5, align: 'center', border: BORDER_HAIR })
    put(ws, `C${rr}`, it?.name ?? '', { size: 10, border: BORDER_HAIR })
    put(ws, `D${rr}`, it?.spec ?? '', { size: 9.5, align: 'center', border: BORDER_HAIR })
    put(ws, `E${rr}`, it?.qty ?? null, { size: 10, align: 'right', border: BORDER_HAIR, numFmt: MONEY })
    put(ws, `F${rr}`, it?.unitPrice ?? null, { size: 10, align: 'right', border: BORDER_HAIR, numFmt: MONEY })
    const amt = `E${rr}*F${rr}`
    if (doc.vatMode === 'included') {
      put(ws, `I${rr}`, { formula: `ROUND(${amt},0)`, result: row?.total ?? 0 }, { size: 10, bold: true, align: 'right', border: BORDER_HAIR, numFmt: MONEY })
      put(ws, `G${rr}`, { formula: `ROUND(I${rr}/1.1,0)`, result: row?.supply ?? 0 }, { size: 10, align: 'right', border: BORDER_HAIR, numFmt: MONEY })
      put(ws, `H${rr}`, { formula: `I${rr}-G${rr}`, result: row?.tax ?? 0 }, { size: 10, align: 'right', border: BORDER_HAIR, numFmt: MONEY })
    } else if (doc.vatMode === 'excluded') {
      put(ws, `G${rr}`, { formula: `ROUND(${amt},0)`, result: row?.supply ?? 0 }, { size: 10, align: 'right', border: BORDER_HAIR, numFmt: MONEY })
      put(ws, `H${rr}`, { formula: `ROUND(G${rr}*0.1,0)`, result: row?.tax ?? 0 }, { size: 10, align: 'right', border: BORDER_HAIR, numFmt: MONEY })
      put(ws, `I${rr}`, { formula: `G${rr}+H${rr}`, result: row?.total ?? 0 }, { size: 10, bold: true, align: 'right', border: BORDER_HAIR, numFmt: MONEY })
    } else {
      put(ws, `G${rr}`, { formula: `ROUND(${amt},0)`, result: row?.supply ?? 0 }, { size: 10, align: 'right', border: BORDER_HAIR, numFmt: MONEY })
      put(ws, `H${rr}`, 0, { size: 10, align: 'right', border: BORDER_HAIR, numFmt: MONEY })
      put(ws, `I${rr}`, { formula: `G${rr}`, result: row?.total ?? 0 }, { size: 10, bold: true, align: 'right', border: BORDER_HAIR, numFmt: MONEY })
    }
    put(ws, `J${rr}`, it?.note ?? '', { size: 9, border: BORDER_HAIR })
  }
  r = sumRow
  ws.getRow(r).height = 23
  put(ws, `B${r}:D${r}`, '합   계', { bold: true, size: 10.5, align: 'center', fill: theme.shade, border: BORDER_ALL })
  ;(['E', 'G', 'H', 'I'] as const).forEach((col) =>
    put(ws, `${col}${r}`, { formula: `SUM(${col}${firstItem}:${col}${lastItem})`, result: col === 'E' ? totals.qty : col === 'G' ? totals.supply : col === 'H' ? totals.tax : totals.total }, { bold: true, size: 10.5, align: 'right', fill: theme.shade, border: BORDER_ALL, numFmt: MONEY }),
  )
  ;(['F', 'J'] as const).forEach((col) => put(ws, `${col}${r}`, '', { fill: theme.shade, border: BORDER_ALL }))
  r += 2

  // 기타사항·안내·담당자
  const notes = doc.notes.trim()
  if (notes || doc.type === 'quote') {
    const lines = Math.max(2, notes.split(/\r?\n/).length + 1)
    put(ws, `B${r}:J${r + lines - 1}`, `<기타사항>${notes ? `\n${notes}` : ''}`, { size: 10, wrap: true, border: BORDER_ALL })
    ws.getCell(`B${r}`).alignment = { vertical: 'top', horizontal: 'left', wrapText: true }
    r += lines + 1
  }
  const foot: string[] = []
  if (doc.type === 'quote' && doc.footnote.trim()) foot.push(...doc.footnote.trim().split(/\r?\n/))
  if (kit.bank.account && doc.attachBankbook) foot.push(`※ 입금 계좌: ${[kit.bank.bankName, kit.bank.account, kit.bank.holder && `예금주 ${kit.bank.holder}`].filter(Boolean).join(' ')}`)
  if (contact) foot.push(`※ 담당자: ${contactLine(contact)}`)
  foot.forEach((ln) => {
    put(ws, `B${r}:J${r}`, ln, { size: 10 })
    r += 1
  })
  r += 1
  if (doc.type === 'quote' && c.name) {
    ws.getRow(r).height = 30
    put(ws, `B${r}:J${r}`, c.name, { bold: true, size: 16, align: 'center' })
  } else if (doc.type === 'statement') {
    put(ws, `H${r}`, '인수자', { bold: true, size: 10, align: 'center', fill: theme.shade, border: BORDER_ALL })
    put(ws, `I${r}:J${r}`, '(인)', { size: 10, align: 'right', border: BORDER_ALL, color: 'FF8A97B8' })
  }
  ws.pageSetup.printArea = `A1:J${r + 1}`

  // 직인: '대표' 칸(I~J, 공급자 두 번째 줄) 오른쪽 위에 겹친다
  if (seal) {
    const id = wb.addImage({ base64: dataUrlToBase64(seal.dataUrl), extension: extOf(seal.dataUrl) })
    const leftPx = colPx(widths[8]) * 0.55
    ws.addImage(id, { tl: { col: 8 + leftPx / colPx(widths[8]), row: top - 1 + 1 - 0.55 }, ext: { width: 62, height: 62 }, editAs: 'oneCell' })
  }

  // 첨부 시트
  const attach = async (name: string, a: CompanyKit['registration']) => {
    if (!a?.pages.length) return
    const sheet = wb.addWorksheet(name, { pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1, horizontalCentered: true }, views: [{ showGridLines: false }] })
    sheet.getColumn(1).width = 2
    let rowAt = 1
    for (const src of a.pages) {
      const { w, h } = await naturalSize(src)
      const targetW = 700
      const targetH = Math.round((h / w) * targetW)
      const id = wb.addImage({ base64: dataUrlToBase64(src), extension: extOf(src) })
      sheet.addImage(id, { tl: { col: 1, row: rowAt }, ext: { width: targetW, height: targetH }, editAs: 'oneCell' })
      rowAt += Math.ceil(targetH / 20) + 2
    }
  }
  if (doc.attachRegistration) await attach('사업자등록증', kit.registration)
  if (doc.attachBankbook) await attach('통장사본', kit.bankbook)

  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

/** 테스트·디버그용: 한글 금액 */
export const _koreanAmount = koreanAmount
