import { describe, expect, it } from 'vitest'
import { buildExcel, verify } from './excel'
import { big, filterRows, layoutProducts, PAGE_ROWS, parseCSV, productItems, readPo, skuGroups, summarize, type PoRow } from './logic'

const HEAD = '발주번호,발주유형,발주현황,SKU ID,SKU 이름,SKU Barcode,물류센터,입고예정일,발주일,발주수량,확정수량,입고수량,매입유형,면세여부,생산연도,제조일자,유통(소비)기한,매입가,공급가,부가세,총발주 매입금,입고금액,Xdock'
const line = (po: string, sku: string, name: string, bc: string, ctr: string, q: number, c: number, buy: number, sup: number | '', due = '2026-11-20', type = '일반발주') =>
  [po, type, '발주확정', sku, `"${name.replace(/"/g, '""')}"`, bc, ctr, due, '2026-11-12 10:00:00', q, c, 0, '직매입', '과세', '', '', '', buy, sup, sup === '' ? '' : buy - sup, q * buy, 0, 'N'].join(',')

describe('발주서 읽기', () => {
  it('따옴표·쉼표·"" 가 든 상품명, 글자 섞인 바코드, 공급가 없으면 매입가/1.1', () => {
    const text = [HEAD, line('1', '100', '젤펜, 3개입 "한정"', 'R2149001', '인천4', 10, 8, 1100, 1000), line('2', '200', '노트', '8801', '고양1', 5, 5, 2200, '')].join('\r\n')
    const { rows, error } = readPo(text)
    expect(error).toBeUndefined()
    expect(rows[0]).toMatchObject({ name: '젤펜, 3개입 "한정"', bc: 'R2149001', q: 10, c: 8, p: 1000, amt: 10000, camt: 8000 })
    expect(rows[1].p).toBe(2000) // round(2200 / 1.1)
    expect(parseCSV('a,"b\nc"\n')).toEqual([['a', 'b\nc']])
  })
  it('필수 열이 없으면 멈춘다', () => {
    expect(readPo('주문번호,상품\n1,2').error).toContain('쿠팡 발주서 형식이 아니에요')
  })
})

/** 센터 n곳, 센터마다 상품 k개짜리 시험 행 */
function make(centers: Array<[string, number]>): PoRow[] {
  const out: string[] = [HEAD]
  let po = 0
  for (const [ctr, k] of centers) for (let i = 0; i < k; i++) out.push(line(String(++po), `S${i}`, `상품 ${String(i).padStart(3, '0')}`, `B${i}`, ctr, 100 - (i % 50), i % 7 ? 100 - (i % 50) : 0, 1100, 1000))
  return readPo(out.join('\n')).rows
}

describe('상품목록 배치(인쇄)', () => {
  it('같은 센터·같은 SKU 는 합치고, 상품 적은 센터부터·센터 안은 수량 많은 순', () => {
    const rows = [...make([['인천4', 3], ['고양1', 1]]), ...make([['인천4', 1]])] // 인천4 S0 이 두 번
    const items = productItems(rows)
    expect(items.map((x) => x.ctr)).toEqual(['고양1', '인천4', '인천4', '인천4'])
    expect(items.find((x) => x.ctr === '인천4' && x.bc === 'B0')!.q).toBe(200)
    expect(items.filter((x) => x.ctr === '인천4').map((x) => x.q)).toEqual([200, 99, 98])
  })
  it('센터 이름 순은 엑셀과 같게(인천14 가 인천4 보다 앞)', () => {
    expect(productItems(make([['인천4', 2], ['인천14', 2]])).map((x) => x.ctr)).toEqual(['인천14', '인천14', '인천4', '인천4'])
  })
  it('한 페이지 43줄 이하, 페이지는 머리글·빈 줄로 시작, 센터가 바뀌면 빈 줄 2 + 머리글', () => {
    const { lines, breaks } = layoutProducts(productItems(make([['A', 5], ['B', 30], ['C', 60], ['D', 41], ['E', 42], ['F', 43], ['G', 2]])))
    const starts = [0, ...breaks]
    const ends = [...breaks, lines.length]
    starts.forEach((s, i) => {
      expect(ends[i] - s).toBeLessThanOrEqual(PAGE_ROWS)
      expect(lines[s].kind).not.toBe('d')
    })
    let prev = ''
    lines.forEach((l, i) => {
      if (l.kind !== 'd') return
      const ctr = String(l.cells[0])
      if (prev && ctr !== prev) expect([lines[i - 3].kind, lines[i - 2].kind, lines[i - 1].kind]).toEqual(['b', 'b', 'h'])
      prev = ctr
    })
    // 상품 42개를 넘는 센터는 늘 새 페이지 맨 위에서
    const firstOf = (c: string) => lines.findIndex((l) => l.kind === 'd' && l.cells[0] === c) - 1
    expect(starts).toContain(firstOf('F'))
    expect(starts).toContain(firstOf('C'))
  })
})

describe('요약·SKU 합계', () => {
  it('필터·검색·정렬', () => {
    const rows = readPo([HEAD, line('1', '1', '가', 'b1', 'X', 10, 5, 1100, 1000), line('2', '2', '나', 'b2', 'X', 20, 20, 2200, 2000, '2026-11-27', '긴급발주')].join('\n')).rows
    expect(filterRows(rows, '2026-11-27', '')).toHaveLength(1)
    expect(skuGroups(rows, '', 'short')[0].k).toBe('1')
    expect(skuGroups(rows, 'b2', 'camt').map((g) => g.k)).toEqual(['2'])
    const s = summarize(rows)
    expect(s.T).toMatchObject({ q: 30, c: 25, amt: 50000, camt: 45000, samt: 5000 })
    expect(s.S.map((g) => g.k)).toEqual(['1'])
    expect(big(123_456_789)).toBe('1억 2,346만원')
  })
})

describe('엑셀', () => {
  it('만든 파일을 다시 읽어 원본과 맞는지 검증하고, 시트·인쇄 설정이 양식대로', async () => {
    const rows = make([['인천4', 50], ['고양1', 3]])
    const x = await buildExcel(rows, skuGroups(rows, '', 'q'), false)
    expect(x.verified).toContain(`원본 ${rows.length}행`)
    expect(x.filename).toBe('쿠팡_SKU합계_입고2026-11-20.xlsx')
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(x.data)
    expect(wb.worksheets.map((w) => w.name)).toEqual(['SKU합계', '상품목록'])
    const ps = wb.getWorksheet('상품목록')!
    expect(ps.pageSetup).toMatchObject({ paperSize: 9, scale: 62, orientation: 'portrait', horizontalCentered: true })
    expect(ps.getRow(1).height).toBe(28)
    expect(ps.getCell('A1').fill).toMatchObject({ fgColor: { argb: 'FFC0C0C0' } })
    // SKU합계는 확정금액 많은 순 + 합계
    const ws = wb.getWorksheet('SKU합계')!
    const camt = [] as number[]
    ws.eachRow((r, i) => i > 1 && r.getCell(1).value !== '합계' && camt.push(Number(r.getCell(9).value)))
    expect(camt).toEqual([...camt].sort((a, b) => b - a))
  })
  it('엑셀 값이 원본과 다르면 저장하지 않는다', async () => {
    const rows = make([['인천4', 3]])
    const x = await buildExcel(rows, skuGroups(rows, '', 'camt'), false)
    const changed = rows.map((r, i) => (i === 0 ? { ...r, q: r.q + 1 } : r))
    await expect(verify(x.data, changed, false)).rejects.toThrow('검증 실패')
  })
})
