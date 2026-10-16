/** 사방넷 주문서 읽기와 결과 엑셀 쓰기(exceljs 는 필요할 때 불러온다) */
import type { Worksheet } from 'exceljs'
import {
  buildOutput,
  cellValue,
  centerHeader,
  layoutCenter,
  looksLikeSabangnet,
  productSummary,
  SUMMARY_COLS,
  SUMMARY_WIDTHS,
  type OrderRow,
  type OutputSpec,
  type SourceSheet,
} from './logic'

const text = (v: unknown): string => {
  if (v == null) return ''
  if (typeof v === 'object') {
    const o = v as { text?: unknown; result?: unknown; richText?: Array<{ text: string }> }
    if (o.richText) return o.richText.map((r) => r.text).join('')
    return String(o.text ?? o.result ?? '')
  }
  return String(v)
}

/** 첫 시트에서 머리줄(‘주문번호’가 있는 줄)을 찾아 읽는다 */
function readSheet(ws: Worksheet): SourceSheet {
  let head = 0
  for (let r = 1; r <= Math.min(10, ws.rowCount) && !head; r++) {
    const vals: string[] = []
    ws.getRow(r).eachCell((c) => vals.push(text(c.value).trim()))
    if (vals.includes('주문번호')) head = r
  }
  if (!head) throw new Error('‘주문번호’ 머리줄을 찾지 못했습니다. 사방넷에서 내려받은 주문서(발주서) 엑셀인지 확인해 주세요.')
  const cols: string[] = []
  const at: Array<[number, string]> = []
  ws.getRow(head).eachCell((c, i) => {
    const h = text(c.value).trim()
    if (h && !cols.includes(h)) {
      cols.push(h)
      at.push([i, h])
    }
  })
  const bad = looksLikeSabangnet(cols)
  if (bad) throw new Error(bad)
  const rows: OrderRow[] = []
  for (let r = head + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const o: OrderRow = {}
    let any = false
    for (const [i, h] of at) {
      const v = cellValue(h, row.getCell(i).value)
      o[h] = v
      if (v != null && h !== 'NO') any = true
    }
    if (any) rows.push(o)
  }
  return { sheetName: ws.name, cols, rows }
}

export async function readSabangnet(file: File): Promise<SourceSheet> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.load(await file.arrayBuffer())
  } catch {
    throw new Error('엑셀(.xlsx)을 열지 못했습니다. 사방넷에서 받은 파일이 .xls 라면 엑셀에서 .xlsx 로 다시 저장해 주세요.')
  }
  const ws = wb.worksheets[0]
  if (!ws) throw new Error('시트가 없습니다.')
  return readSheet(ws)
}

/** 아무 엑셀이나 머리줄 + 줄로 읽기(송장번호 파일용) */
export async function readAnyTable(file: File): Promise<{ cols: string[]; rows: Array<Record<string, string>> }> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  const ws = wb.worksheets[0]
  if (!ws) throw new Error('시트가 없습니다.')
  let head = 0
  for (let r = 1; r <= Math.min(10, ws.rowCount) && !head; r++) {
    const vals: string[] = []
    ws.getRow(r).eachCell((c) => vals.push(text(c.value)))
    if (vals.some((v) => /송장/.test(v))) head = r
  }
  if (!head) throw new Error('‘송장번호’(또는 ‘운송장번호’) 칸이 있는 머리줄을 찾지 못했습니다.')
  const at: Array<[number, string]> = []
  ws.getRow(head).eachCell((c, i) => {
    // CJ 파일 머리줄은 '접수\r\n순서'처럼 줄바꿈이 섞여 있다
    const h = text(c.value).replace(/\s+/g, '')
    if (h && !at.some(([, x]) => x === h)) at.push([i, h])
  })
  const rows: Array<Record<string, string>> = []
  for (let r = head + 1; r <= ws.rowCount; r++) {
    const o: Record<string, string> = {}
    for (const [i, h] of at) o[h] = text(ws.getRow(r).getCell(i).value).trim()
    if (Object.values(o).some(Boolean)) rows.push(o)
  }
  return { cols: at.map(([, h]) => h), rows }
}

const FONT = { name: '맑은 고딕', size: 10 }
const BORDER = { top: { style: 'thin' as const }, left: { style: 'thin' as const }, bottom: { style: 'thin' as const }, right: { style: 'thin' as const } }

const HEAD_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF993300' } }
const HEAD_FONT = { ...FONT, bold: true, color: { argb: 'FFFFFFFF' } }
const THICK = { style: 'medium' as const }

/** A4 세로 · 좁은 여백 · 한 쪽 폭에 맞춤 · 머리줄 반복 · 머릿말 ‘2026.10.16 주문서 2차’ · 꼬릿말 ‘1/3’ */
function a4(ws: Worksheet, header: string, footer = '&C&10&P/&N') {
  ws.pageSetup = {
    paperSize: 9,
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    printTitlesRow: '1:1',
    // 엑셀 ‘좁게’ 여백(인치)
    margins: { left: 0.25, right: 0.25, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
  }
  ws.headerFooter = { oddHeader: `&C&B&12 ${header}`, oddFooter: footer }
}

/** 센터주문서: 주문서 탭(쪽마다 주문이 나뉘지 않게) + 출고제품 요약 탭 */
async function writeCenter(spec: OutputSpec, rows: OrderRow[], date: string, seq: number): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = '온비짱'
  const header = centerHeader(date, seq)

  // ── 주문서 ──
  const ws = wb.addWorksheet('주문서')
  a4(ws, header)
  spec.widths.forEach((w, i) => (ws.getColumn(i + 1).width = w))
  const layout = layoutCenter(rows)
  const table = buildOutput(spec, rows)
  // 주문자가 바뀌는 곳(각 주문자의 마지막 줄)마다 굵은 아랫줄
  const last = new Set<number>()
  let at = 0
  for (const g of layout.groups) {
    at += g.length
    last.add(at - 1)
  }
  table.forEach((vals, ri) => {
    const row = ws.addRow(vals)
    row.height = ri === 0 ? 24 : 18
    const i = ri - 1
    for (let ci = 1; ci <= vals.length; ci++) {
      const cell = row.getCell(ci)
      if (ri === 0) {
        cell.font = HEAD_FONT
        cell.fill = HEAD_FILL
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
        cell.border = BORDER
        continue
      }
      cell.font = FONT
      if (typeof cell.value !== 'number') cell.numFmt = '@'
      cell.alignment = { vertical: 'middle', shrinkToFit: true, horizontal: ci === 1 || ci === vals.length - 1 ? 'center' : undefined }
      cell.border = last.has(i) ? { ...BORDER, bottom: THICK } : BORDER
    }
  })
  // 쪽 나누기: 쪽의 마지막 주문 줄 다음에서(머리줄 1줄을 더한 행 번호)
  for (const end of layout.pageEnds.slice(0, -1)) ws.getRow(end + 1).addPageBreak()

  // ── 출고제품 요약 ──
  const sum = wb.addWorksheet('출고제품 요약')
  // 요약 탭은 쪽 번호 없이(주문서 탭 쪽 번호 1/2, 2/2 와 섞이지 않게)
  a4(sum, `${header} · 출고제품 요약`, '&C&10출고제품 요약(상위 20)')
  SUMMARY_WIDTHS.forEach((w, i) => (sum.getColumn(i + 1).width = w))
  const head = sum.addRow(SUMMARY_COLS)
  head.height = 24
  head.eachCell((c) => {
    c.font = HEAD_FONT
    c.fill = HEAD_FILL
    c.alignment = { horizontal: 'center', vertical: 'middle' }
    c.border = BORDER
  })
  productSummary(rows).forEach((p, i) => {
    const r = sum.addRow([p.rank, i + 1, p.name, p.option || null, p.qty, p.buyers, p.code || null])
    r.height = 20
    r.eachCell({ includeEmpty: true }, (c, ci) => {
      if (ci > SUMMARY_COLS.length) return
      c.font = ci === 1 || ci === 5 ? { ...FONT, bold: true } : FONT
      c.border = BORDER
      c.alignment = { vertical: 'middle', shrinkToFit: ci === 3, horizontal: ci === 3 || ci === 4 || ci === 7 ? 'left' : 'center' }
      if (ci === 5 || ci === 6) c.numFmt = '#,##0'
    })
  })
  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

/** 결과 파일 한 개(사방넷 발주서와 같은 모양: 갈색 머리줄, 가는 테두리, 글자 서식) */
export async function writeOutput(spec: OutputSpec, rows: OrderRow[], sheetName: string, batch?: { date: string; seq: number }): Promise<Blob> {
  if (spec.kind === 'warehouse' && batch) return writeCenter(spec, rows, batch.date, batch.seq)
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = '온비짱'
  const ws = wb.addWorksheet((sheetName || '주문서').replace(/[\\/?*[\]:]/g, '').slice(0, 31) || '주문서')
  const table = buildOutput(spec, rows)
  spec.widths.forEach((w, i) => (ws.getColumn(i + 1).width = w))
  table.forEach((vals, ri) => {
    const row = ws.addRow(vals)
    if (ri === 0) row.height = 30
    row.eachCell({ includeEmpty: true }, (cell, ci) => {
      if (ci > vals.length) return
      cell.border = BORDER
      if (ri === 0) {
        cell.font = { ...FONT, bold: true, color: { argb: 'FFFFFFFF' } }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF993300' } }
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
      } else {
        cell.font = FONT
        if (typeof cell.value !== 'number') cell.numFmt = '@'
      }
    })
  })
  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

/** 조회 결과를 엑셀로 */
export async function writeTable(sheetName: string, cols: string[], rows: Array<Array<string | number | null>>): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(sheetName.slice(0, 31))
  ws.addRow(cols).eachCell((c) => {
    c.font = { ...FONT, bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF993300' } }
    c.alignment = { horizontal: 'center', vertical: 'middle' }
  })
  for (const r of rows) ws.addRow(r).eachCell((c) => (c.font = FONT))
  cols.forEach((c, i) => (ws.getColumn(i + 1).width = Math.min(50, Math.max(8, c.length * 2 + 2))))
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
