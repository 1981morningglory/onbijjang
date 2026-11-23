// 로켓발주입고관리 — 엑셀(SKU합계 + 상품목록) 만들기와 저장 전 자체 검증
// 원래 아티팩트는 xlsx-js-style + JSZip 으로 인쇄 설정을 XML 에 직접 넣었다. exceljs 는 서식·행 높이·인쇄 설정·
// 수동 페이지 나누기를 직접 지원하므로 같은 결과를 그대로 만든다(시트 순서: 1 SKU합계, 2 상품목록).
import type { Worksheet } from 'exceljs'
import { ea, group, layoutProducts, productItems, type Group, type PoRow } from './logic'

/** 회계 서식(0 은 ‘-’) */
const ACC = '_-* #,##0_-;\\-* #,##0_-;_-* "-"_-;_-@_-'
export const SKU_HEAD = ['SKU ID', '상품명', '바코드', '센터수', '발주수량', '확정수량', '미확정수량', '발주금액(VAT별도)', '확정금액(VAT별도)', '미확정금액(VAT별도)']

export interface BuiltExcel {
  data: ArrayBuffer
  filename: string
  /** 검증 통과 문구 */
  verified: string
  pages: number
  listRows: number
}

/**
 * view: 필터를 적용한 원본 행 · skus: SKU합계에 넣을 SKU(화면 검색어 반영) · searching: 검색어가 있는가(합계 대조 생략)
 * 검증에 실패하면 Error(사람이 읽는 이유) — 저장하지 않는다
 */
export async function buildExcel(view: PoRow[], skus: Group[], searching: boolean): Promise<BuiltExcel> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()

  // ── 1. SKU합계: 확정금액 많은 순, 맨 아래 합계 ─────────
  const G = [...skus].sort((a, b) => b.camt - a.camt)
  const ws = wb.addWorksheet('SKU합계')
  // 열 너비는 원래 아티팩트 파일과 같은 실제 값(문자 수 + 여백)
  ws.columns = [11, 52, 15, 7, 10, 10, 10, 16, 16, 16].map((w) => ({ width: w + 0.83203125 }))
  ws.addRow(SKU_HEAD)
  for (const g of G) ws.addRow([isNaN(+g.k) || g.k === '' ? g.k : +g.k, g.name, String(g.bc), g.ctrs.size, g.q, g.c, g.short, g.amt, g.camt, g.samt])
  const tot = G.reduce((a, g) => ({ q: a.q + g.q, c: a.c + g.c, amt: a.amt + g.amt, camt: a.camt + g.camt }), { q: 0, c: 0, amt: 0, camt: 0 })
  ws.addRow(['합계', '', '', '', tot.q, tot.c, tot.q - tot.c, tot.amt, tot.camt, tot.amt - tot.camt])
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: G.length + 1, column: SKU_HEAD.length } }
  for (let R = 2; R <= G.length + 2; R++) for (let C = 5; C <= 10; C++) ws.getCell(R, C).numFmt = '#,##0'

  // ── 2. 상품목록: 센터·SKU 합침, 43줄 페이지, 센터마다 빈 줄 2 + 머리글 ─────
  const { lines, breaks } = layoutProducts(productItems(view))
  const ps = wb.addWorksheet('상품목록', {
    pageSetup: { paperSize: 9, orientation: 'portrait', scale: 62, fitToPage: false, horizontalCentered: true, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } },
  })
  ps.columns = [11.83203125, 17.83203125, 91.43359375, 10.83203125, 22.234375].map((width) => ({ width }))
  styleList(ps, lines)
  for (const b of breaks) ps.getRow(b).addPageBreak()

  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer

  // ── 저장 전 자체 검증: 만든 파일을 다시 읽어 원본과 대조 ─────
  const verified = await verify(buf, view, searching)
  const dues = [...new Set(view.map((r) => r.due))].sort()
  return { data: buf, filename: `쿠팡_SKU합계_입고${dues.join('_')}.xlsx`, verified, pages: breaks.length + 1, listRows: lines.filter((l) => l.kind === 'd').length }
}

/** 맑은 고딕 12pt, 가운데 정렬, 얇은 테두리, 머리글 #C0C0C0, 숫자 회계 서식, 행 높이 28(빈 줄은 테두리 없음) */
function styleList(ps: Worksheet, lines: ReturnType<typeof layoutProducts>['lines']) {
  const thin = { style: 'thin' as const, color: { argb: 'FF000000' } }
  const border = { top: thin, bottom: thin, left: thin, right: thin }
  lines.forEach((line, i) => {
    const row = ps.getRow(i + 1)
    row.height = 28
    if (line.kind === 'b') return
    for (let C = 1; C <= 5; C++) {
      const cell = row.getCell(C)
      const v = line.cells[C - 1]
      cell.value = v === undefined ? '' : v
      cell.font = { name: '맑은 고딕', size: 12 }
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
      cell.border = border
      if (line.kind === 'h') cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC0C0C0' } }
      else if (C >= 4) cell.numFmt = ACC
    }
  })
}

const cellText = (v: unknown): string => {
  if (v == null) return ''
  if (typeof v === 'object') {
    const o = v as { text?: unknown; result?: unknown; richText?: Array<{ text: string }> }
    if (o.richText) return o.richText.map((r) => r.text).join('')
    return String(o.text ?? o.result ?? '')
  }
  return String(v)
}

/** 만든 엑셀을 다시 읽어 (센터, 바코드)별 수량·상품명과 SKU합계 합계를 원본과 맞춰 본다 */
export async function verify(buf: ArrayBuffer, view: PoRow[], searching: boolean): Promise<string> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  const key = (c: string, b: string) => `${c}\u0001${b}`
  const exp = new Map<string, number>()
  const nm = new Map<string, string>()
  for (const r of view) {
    exp.set(key(r.ctr, r.bc), (exp.get(key(r.ctr, r.bc)) || 0) + r.q)
    nm.set(key(r.ctr, r.bc), r.name)
  }
  const bad: string[] = []
  const got = new Map<string, number>()
  const ps = wb.getWorksheet('상품목록')
  const ws = wb.getWorksheet('SKU합계')
  if (!ps || !ws) throw new Error('검증 실패로 저장하지 않았어요: 시트를 찾지 못했어요.')
  ps.eachRow((row) => {
    const ctr = cellText(row.getCell(1).value)
    if (!ctr || ctr === '물류센터') return
    const bc = cellText(row.getCell(2).value)
    const k = key(ctr, bc)
    if (!exp.has(k)) bad.push(`상품목록에 원본에 없는 행: ${ctr} ${bc}`)
    else if (nm.get(k) !== cellText(row.getCell(3).value)) bad.push(`상품명 불일치: ${bc}`)
    got.set(k, (got.get(k) || 0) + Number(row.getCell(4).value))
  })
  for (const [k, v] of exp) if (got.get(k) !== v) bad.push(`수량 불일치: ${k.replace('\u0001', ' ')}`)
  const T = group(view, () => '1')[0] ?? { q: 0, c: 0 }
  let total: unknown[] | null = null
  ws.eachRow((row) => {
    if (cellText(row.getCell(1).value) === '합계') total = [row.getCell(5).value, row.getCell(6).value]
  })
  const t = total as unknown[] | null
  if (!searching && (!t || t[0] !== T.q || t[1] !== T.c)) bad.push('SKU합계 합계 불일치')
  if (bad.length) throw new Error(`검증 실패로 저장하지 않았어요: ${bad.slice(0, 2).join(' / ')}`)
  return `검증 완료 · 원본 ${view.length}행, 발주수량 ${ea(T.q)}개가 엑셀과 일치해요`
}
