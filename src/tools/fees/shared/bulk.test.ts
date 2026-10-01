import { describe, expect, it } from 'vitest'
import { buildRows, calcBulk, guessMapping, parseMoney, parseTable, toCsv, toExportTable } from './bulk'
import { DEFAULT_COUPANG, DEFAULT_SETTINGS, type AllSettings } from './settings'

const all: AllSettings = { ...DEFAULT_SETTINGS, coupang: { ...DEFAULT_COUPANG, shipFeeRate: 3 } }

describe('붙여넣은 표 읽기', () => {
  it('엑셀에서 복사한 탭 구분 표', () => {
    const rows = parseTable('상품명\t판매가\t원가\t배송비\n텀블러\t19,800\t8,500\t3,000\r\n머그컵\t12000\t4000\t3000\n\n')
    expect(rows).toEqual([
      ['상품명', '판매가', '원가', '배송비'],
      ['텀블러', '19,800', '8,500', '3,000'],
      ['머그컵', '12000', '4000', '3000'],
    ])
  })
  it('따옴표로 감싼 칸 안의 줄바꿈과 따옴표', () => {
    const rows = parseTable('"텀블러\n500ml"\t19800\n"12"" 모니터"\t250000')
    expect(rows).toEqual([
      ['텀블러\n500ml', '19800'],
      ['12" 모니터', '250000'],
    ])
  })
  it('탭이 없으면 쉼표로 나눈다', () => {
    expect(parseTable('텀블러,"19,800",8500')).toEqual([['텀블러', '19,800', '8500']])
  })
  it('금액 읽기', () => {
    expect(parseMoney('19,800원')).toBe(19800)
    expect(parseMoney('₩ 3,000')).toBe(3000)
    expect(parseMoney('1200.6')).toBe(1201)
    expect(parseMoney(4500)).toBe(4500)
    expect(parseMoney('무료')).toBeNull()
    expect(parseMoney('')).toBeNull()
    expect(parseMoney('-500')).toBeNull()
  })
})

describe('열 짐작', () => {
  it('머리글 이름으로 열을 찾는다(순서가 달라도)', () => {
    const g = guessMapping([
      ['카테고리', '원가', '상품명', '배송비', '판매가'],
      ['주방용품', '8500', '텀블러', '3000', '19800'],
    ])
    expect(g.hasHeader).toBe(true)
    expect(g.mapping).toEqual({ category: 0, cost: 1, name: 2, shipping: 3, price: 4 })
  })
  it('머리글이 없으면 상품명·판매가·원가·배송비·카테고리 순서로 본다', () => {
    const g = guessMapping([['텀블러', '19800', '8500', '3000']])
    expect(g.hasHeader).toBe(false)
    expect(g.mapping).toEqual({ name: 0, price: 1, cost: 2, shipping: 3, category: -1 })
  })
})

describe('일괄 계산', () => {
  const rows = parseTable('상품명\t판매가\t원가\t배송비\t카테고리\n텀블러\t19,800\t8,500\t3,000\t주방용품\n모니터\t250000\t200000\t0\t모니터\n오류행\t가격미정\t100\t0\t')
  const { hasHeader, mapping } = guessMapping(rows)

  it('유료배송이면 배송비 열을 고객 결제 배송비와 택배비 양쪽에 쓴다', () => {
    const built = buildRows(rows, mapping, hasHeader, 'paid')
    expect(built).toHaveLength(3)
    expect(built[0].product).toEqual({ name: '텀블러', price: 19800, cost: 8500, shipMode: 'paid', buyerShipping: 3000, shippingCost: 3000 })
    expect(built[0].line).toBe(2)
    expect(built[2].error).toBe('판매가를 숫자로 읽지 못했습니다')
  })
  it('무료배송이면 배송비 열은 판매자가 내는 택배비로만 쓴다', () => {
    const built = buildRows(rows, mapping, hasHeader, 'free')
    expect(built[0].product.buyerShipping).toBe(0)
    expect(built[0].product.shippingCost).toBe(3000)
  })
  it('행마다 카테고리 열로 마켓별 요율을 고르고 가장 남는 마켓을 표시한다', () => {
    const results = calcBulk(buildRows(rows, mapping, hasHeader, 'paid'), all)
    const tumbler = results[0]
    expect(tumbler.markets.find((m) => m.market === 'coupang')?.rate).toBe(10.8)
    expect(tumbler.markets.find((m) => m.market === 'gmarket')?.rate).toBe(13)
    const monitor = results[1]
    expect(monitor.markets.find((m) => m.market === 'coupang')?.rate).toBe(4.5)
    expect(monitor.markets.find((m) => m.market === 'gmarket')?.rate).toBe(7)
    expect(monitor.best).not.toBeNull()
    expect(results[2].markets).toEqual([])
    expect(results[2].best).toBeNull()
  })
  it('내보내기 표: 머리글 + 상품 수만큼, 요율이 비어 있는 마켓 칸은 빈칸', () => {
    const table = toExportTable(calcBulk(buildRows(rows, mapping, hasHeader, 'paid'), all))
    expect(table).toHaveLength(4)
    expect(table[0].slice(0, 5)).toEqual(['상품명', '판매가', '원가', '배송비', '카테고리'])
    expect(table[0]).toHaveLength(5 + 6 * 2 + 3)
    for (const row of table) expect(row).toHaveLength(table[0].length)
    const smartstoreProfit = table[0].indexOf('스마트스토어 이익')
    expect(table[1][smartstoreProfit]).toBe('')
    const coupangProfit = table[0].indexOf('쿠팡 이익')
    expect(typeof table[1][coupangProfit]).toBe('number')
    expect(String(table[1][table[0].length - 1])).toContain('요율 미입력')
    expect(table[3][table[0].length - 1]).toBe('판매가를 숫자로 읽지 못했습니다')
  })
  it('CSV 는 BOM 으로 시작하고 쉼표·따옴표가 든 칸을 감싼다', () => {
    const csv = toCsv([['상품명', '판매가'], ['12" 모니터, 신형', 250000]])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv.slice(1)).toBe('상품명,판매가\r\n"12"" 모니터, 신형",250000')
  })
})
