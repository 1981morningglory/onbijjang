import { describe, expect, it } from 'vitest'
import {
  calcCoupang, calcElevenst, calcEsm, calcRocket, calcSmartstore, ceilTo, feeOf, solvePrice,
  type CalcResult, type Product, type Target,
} from './calc'
import { COUPANG_CATEGORIES } from './rates/coupang'
import { AUCTION_CATEGORIES, GMARKET_CATEGORIES } from './rates/esm'
import { ROCKET_SIZES } from './rates/rocket'
import {
  bestMarket, calcAllMarkets, DEFAULT_COUPANG, DEFAULT_ELEVENST, DEFAULT_ESM, DEFAULT_ROCKET, DEFAULT_SETTINGS, DEFAULT_SMARTSTORE,
  findCategory, matchCategory, searchCategories, type AllSettings,
} from './settings'

// 테스트용 요율은 계산 검증을 위한 임의 값이다(공식 요율이 아님).
const product: Product = { name: '텀블러', price: 19800, cost: 8500, shipMode: 'paid', buyerShipping: 3000, shippingCost: 3000 }
const free: Product = { ...product, shipMode: 'free' }
const smart = { ...DEFAULT_SMARTSTORE, orderFee: { ...DEFAULT_SMARTSTORE.orderFee, micro: 1.98 }, salesFee: { naver: 2.73, marketing: 0.91 } }
const line = (r: CalcResult, key: string) => r.lines.find((l) => l.key === key)?.amount

describe('feeOf — 원 단위 맞춤', () => {
  it('원 미만은 버린다', () => {
    expect(feeOf(19800, 2.73)).toBe(540) // 540.54
    expect(feeOf(22800, 1.98)).toBe(451) // 451.44
    expect(feeOf(999, 0.1)).toBe(0) // 0.999
  })
  it('올림 방식이면 원 미만을 올린다', () => {
    expect(feeOf(19850, 13, 'ceil')).toBe(2581) // 2580.5
    expect(feeOf(19850, 13, 'floor')).toBe(2580)
    expect(feeOf(999, 0.1, 'ceil')).toBe(1)
  })
  it('딱 떨어지는 금액은 올림이든 버림이든 같다', () => {
    expect(feeOf(19800, 13, 'ceil')).toBe(2574)
    expect(feeOf(19800, 13, 'floor')).toBe(2574)
    expect(feeOf(3000, 3.3, 'ceil')).toBe(99)
  })
  it('부동소수 오차로 1원이 틀어지지 않는다', () => {
    expect(feeOf(10000, 4.35)).toBe(435)
    expect(feeOf(35000, 3.3)).toBe(1155)
    expect(feeOf(10000, 2.73)).toBe(273)
    expect(feeOf(1000000, 0.07)).toBe(700)
  })
  it('요율이 없거나 0 이면 0원', () => {
    expect(feeOf(10000, null)).toBe(0)
    expect(feeOf(10000, 0)).toBe(0)
    expect(feeOf(0, 10)).toBe(0)
  })
})

describe('스마트스토어', () => {
  it('유료배송: 주문관리 수수료는 배송비 포함 결제액에, 판매 수수료는 판매가에', () => {
    const r = calcSmartstore(product, smart)
    expect(line(r, 'orderFee')).toBe(451)
    expect(line(r, 'salesFee')).toBe(540)
    expect(r.feeTotal).toBe(991)
    expect(r.income).toBe(22800)
    expect(r.settlement).toBe(21809)
    expect(r.profit).toBe(10309)
    expect(r.marginPct).toBeCloseTo((10309 / 19800) * 100, 6)
    expect(r.missing).toEqual([])
  })
  it('무료배송: 배송비를 받지 않아 수수료 기준이 줄고 택배비는 그대로 나간다', () => {
    const r = calcSmartstore(free, smart)
    expect(line(r, 'buyerShipping')).toBeUndefined()
    expect(line(r, 'orderFee')).toBe(392) // 19,800 × 1.98% = 392.04
    expect(r.profit).toBe(19800 - 392 - 540 - 8500 - 3000)
    expect(r.profit).toBeLessThan(calcSmartstore(product, smart).profit)
  })
  it('마케팅 링크 유입이면 판매 수수료가 낮아진다', () => {
    const r = calcSmartstore(product, { ...smart, inflow: 'marketing' })
    expect(line(r, 'salesFee')).toBe(180) // 19,800 × 0.91% = 180.18
  })
  it('쇼핑커넥트를 켜면 판매가 기준 수수료가 더해진다', () => {
    const r = calcSmartstore(product, { ...smart, connect: true, connectRate: 5 })
    expect(line(r, 'connectFee')).toBe(990)
    expect(r.feeTotal).toBe(991 + 990)
  })
  it('기본 설정은 요율이 비어 있어 "입력 필요"로 표시된다', () => {
    const r = calcSmartstore(product, DEFAULT_SMARTSTORE)
    expect(r.missing).toEqual(['네이버페이 주문관리 수수료', '판매 수수료'])
    expect(r.feeTotal).toBe(0)
  })
})

describe('쿠팡 마켓플레이스', () => {
  const kitchen = findCategory(COUPANG_CATEGORIES, '주방용품 > 기본 수수료')
  it('부가세를 더하면 10.8% → 11.88%', () => {
    const r = calcCoupang(product, { ...DEFAULT_COUPANG, vat: true, shipFeeRate: 3 }, kitchen.rate)
    expect(line(r, 'salesFee')).toBe(2352) // 19,800 × 11.88% = 2,352.24
    expect(line(r, 'shipFee')).toBe(99) // 3,000 × 3.3%
    expect(r.profit).toBe(22800 - 2352 - 99 - 8500 - 3000)
  })
  it('부가세를 더하지 않으면 표의 요율 그대로', () => {
    const r = calcCoupang(product, { ...DEFAULT_COUPANG, vat: false, shipFeeRate: 3 }, kitchen.rate)
    expect(line(r, 'salesFee')).toBe(2138) // 2,138.4
    expect(line(r, 'shipFee')).toBe(90)
  })
  it('무료배송이면 배송비 수수료가 없고, 배송비 수수료율이 비어 있어도 문제 삼지 않는다', () => {
    const r = calcCoupang(free, DEFAULT_COUPANG, kitchen.rate)
    expect(line(r, 'shipFee')).toBeUndefined()
    expect(r.missing).toEqual([])
  })
  it('유료배송인데 배송비 수수료율이 비어 있으면 알려 준다', () => {
    expect(calcCoupang(product, DEFAULT_COUPANG, kitchen.rate).missing).toEqual(['배송비 수수료(부가세 포함)'])
  })
  it('직접 고친 요율이 카테고리 요율보다 먼저다', () => {
    const r = calcCoupang(free, { ...DEFAULT_COUPANG, vat: false, rateOverride: 5 }, kitchen.rate)
    expect(line(r, 'salesFee')).toBe(990)
  })
  it('월 서비스 이용료는 주문 1건 이익과 따로 월 이익에서 뺀다', () => {
    const r = calcCoupang(free, { ...DEFAULT_COUPANG, vat: false, monthlyFee: true, monthlyOrders: 50 }, kitchen.rate)
    expect(r.monthly).toEqual({ orders: 50, fee: 55000, feeLabel: '월 서비스 이용료', profit: r.profit * 50 - 55000 })
  })
})

describe('로켓그로스', () => {
  const base = { ...DEFAULT_ROCKET, vat: true, fulfillFee: 650, deliveryFee: 1250, inboundTotal: 30000, inboundQty: 100, storageDays: 70, storageDailyFee: 5, returnRate: 5, returnPickupFee: 1000, returnRestockFee: 500 }
  const item = { name: '텀블러', price: 19800, cost: 8500 }
  it('세이버 없이: 30일 넘는 보관일과 반품 예상 비용을 넣는다', () => {
    const r = calcRocket(item, base, 10.8)
    expect(line(r, 'salesFee')).toBe(2352)
    expect(line(r, 'storageFee')).toBe(200) // (70 − 30)일 × 5원
    expect(line(r, 'returnFee')).toBe(75) // 1,500원 × 5%
    expect(line(r, 'inbound')).toBe(300)
    expect(line(r, 'saverFee')).toBeUndefined()
    expect(r.profit).toBe(19800 - 2352 - 650 - 1250 - 200 - 75 - 8500 - 300)
  })
  it('세이버: 60일 무료 보관, 반품비 없음, 구독료는 월 판매 수량으로 나눈다', () => {
    const r = calcRocket(item, { ...base, saver: true, monthlyUnits: 100 }, 10.8)
    expect(line(r, 'storageFee')).toBe(50) // (70 − 60)일 × 5원
    expect(line(r, 'returnFee')).toBeUndefined()
    expect(line(r, 'saverFee')).toBe(990)
    expect(r.profit).toBe(19800 - 2352 - 650 - 1250 - 50 - 990 - 8500 - 300)
  })
  it('물류 요금에 부가세를 더할 수 있다', () => {
    const r = calcRocket(item, { ...base, logisticsVat: true }, 10.8)
    expect(line(r, 'fulfillFee')).toBe(715)
    expect(line(r, 'deliveryFee')).toBe(1375)
  })
  it('입출고비·배송비 기본값은 비어 있다(공개 요금표가 없어 직접 입력)', () => {
    expect(calcRocket(item, DEFAULT_ROCKET, 10.8).missing).toEqual(['입출고비', '배송비'])
  })
  it('사이즈 유형은 여섯 가지이고 기준이 커지는 순서다', () => {
    expect(ROCKET_SIZES.map((s) => s.label)).toEqual(['극소형', '소형', '중형', '대형1', '대형2', '특대형'])
    for (let i = 1; i < ROCKET_SIZES.length; i++) {
      expect(ROCKET_SIZES[i].maxSumCm).toBeGreaterThan(ROCKET_SIZES[i - 1].maxSumCm)
      expect(ROCKET_SIZES[i].maxKg).toBeGreaterThan(ROCKET_SIZES[i - 1].maxKg)
    }
  })
})

describe('G마켓 · 옥션', () => {
  const p: Product = { ...product, price: 19850 }
  it('서비스 이용료는 원 단위에서 올린다(공식 가이드), 선결제 배송비는 3.3%', () => {
    const r = calcEsm(p, DEFAULT_ESM, 13)
    expect(line(r, 'salesFee')).toBe(2581) // 2,580.5 → 올림
    expect(line(r, 'shipFee')).toBe(99)
    expect(r.profit).toBe(22850 - 2581 - 99 - 8500 - 3000)
  })
  it('버림으로 바꾸면 1원 차이가 난다', () => {
    expect(line(calcEsm(p, { ...DEFAULT_ESM, rounding: 'floor' }, 13), 'salesFee')).toBe(2580)
  })
  it('무료배송과 착불은 배송비 이용료가 없다', () => {
    expect(line(calcEsm({ ...p, shipMode: 'free' }, DEFAULT_ESM, 13), 'shipFee')).toBeUndefined()
    const cod = calcEsm({ ...p, shipMode: 'cod', shippingCost: 0 }, DEFAULT_ESM, 13)
    expect(line(cod, 'shipFee')).toBeUndefined()
    expect(cod.income).toBe(19850)
    expect(cod.profit).toBe(19850 - 2581 - 8500)
  })
  it('판매자 부담 할인은 이용료 기준을 줄이지 않고 그대로 비용이 된다', () => {
    const r = calcEsm(p, DEFAULT_ESM, 13, { discount: 1000 })
    expect(line(r, 'salesFee')).toBe(2581)
    expect(line(r, 'discount')).toBe(1000)
    expect(r.settlement).toBe(22850 - 2581 - 99 - 1000)
    expect(r.profit).toBe(calcEsm(p, DEFAULT_ESM, 13).profit - 1000)
  })
  it('제휴채널 이용료는 판매가의 2%', () => {
    expect(line(calcEsm(p, { ...DEFAULT_ESM, affiliate: true }, 13), 'affiliateFee')).toBe(397)
  })
  it('프로모션을 켰는데 요율이 없으면 알려 준다', () => {
    expect(calcEsm(p, { ...DEFAULT_ESM, promo: true }, 13).missing).toEqual(['프로모션 참여 이용료'])
  })
  it('월 서버 이용료는 주문 1건 이익과 구분해 월 이익에서 뺀다', () => {
    const r = calcEsm(p, { ...DEFAULT_ESM, serverFee: true, monthlyOrders: 120 }, 13)
    expect(r.monthly?.fee).toBe(55000)
    expect(r.monthly?.profit).toBe(r.profit * 120 - 55000)
    expect(r.profit).toBe(calcEsm(p, DEFAULT_ESM, 13).profit)
  })
})

describe('11번가', () => {
  const p: Product = { ...product, price: 20000 }
  const s = { ...DEFAULT_ELEVENST, rate: 12, shipFeeRate: 3.3 }
  it('서비스 이용료는 할인 전 판매가 기준, 쿠폰은 판매자 부담 비율만큼 비용', () => {
    const r = calcElevenst(p, { ...s, couponShare: 60 }, { couponDiscount: 2000 })
    expect(line(r, 'salesFee')).toBe(2400)
    expect(line(r, 'shipFee')).toBe(99)
    expect(line(r, 'discount')).toBe(1200)
    expect(r.profit).toBe(23000 - 2400 - 99 - 1200 - 8500 - 3000)
  })
  it('제휴마케팅 대행비는 (판매가 + 선결제 배송비)의 2%', () => {
    expect(line(calcElevenst(p, { ...s, affiliate: true }), 'affiliateFee')).toBe(460)
    expect(line(calcElevenst({ ...p, shipMode: 'free' }, { ...s, affiliate: true }), 'affiliateFee')).toBe(400)
  })
  it('월 서버 이용료 77,000원', () => {
    const r = calcElevenst(p, { ...s, serverFee: true, monthlyOrders: 10 })
    expect(r.monthly?.profit).toBe(r.profit * 10 - 77000)
  })
  it('카테고리 요율 기본값은 비어 있다', () => {
    expect(calcElevenst({ ...p, shipMode: 'free' }, DEFAULT_ELEVENST).missing).toEqual(['카테고리 서비스 이용료'])
  })
})

describe('역산 — 목표 이익에 필요한 판매가', () => {
  const kitchen = 10.8
  const cases: Array<[string, (price: number) => CalcResult]> = [
    ['스마트스토어', (price) => calcSmartstore({ ...product, price }, smart)],
    ['쿠팡', (price) => calcCoupang({ ...product, price }, { ...DEFAULT_COUPANG, shipFeeRate: 3 }, kitchen)],
    ['로켓그로스', (price) => calcRocket({ name: '', price, cost: 8500 }, { ...DEFAULT_ROCKET, fulfillFee: 650, deliveryFee: 1250 }, kitchen)],
    ['G마켓', (price) => calcEsm({ ...product, price }, { ...DEFAULT_ESM, affiliate: true }, 13, { discount: 500 })],
    ['11번가', (price) => calcElevenst({ ...product, price }, { ...DEFAULT_ELEVENST, rate: 12, shipFeeRate: 3.3, affiliate: true }, { couponDiscount: 1000 })],
  ]
  const targets: Target[] = [
    { type: 'margin', value: 20 },
    { type: 'margin', value: 35.5 },
    { type: 'profit', value: 5000 },
    { type: 'profit', value: 0 },
  ]
  const value = (r: CalcResult, t: Target) => (t.type === 'margin' ? (r.marginPct ?? -Infinity) : r.profit)

  for (const [name, calcAt] of cases) {
    for (const t of targets) {
      it(`${name}: ${t.type === 'margin' ? `이익률 ${t.value}%` : `이익 ${t.value}원`} — 찾은 판매가를 다시 넣으면 목표를 만족하고 1원 낮추면 모자란다`, () => {
        const price = solvePrice(calcAt, t)
        expect(price).not.toBeNull()
        expect(value(calcAt(price!), t)).toBeGreaterThanOrEqual(t.value)
        expect(value(calcAt(price! - 1), t)).toBeLessThan(t.value)
      })
    }
  }
  it('수수료율보다 높은 이익률은 달성할 수 없어 null', () => {
    expect(solvePrice(cases[1][1], { type: 'margin', value: 95 })).toBeNull()
  })
  it('원가도 수수료도 없으면 1원부터 목표를 만족한다', () => {
    const zero = (price: number) => calcSmartstore({ ...free, price, cost: 0, shippingCost: 0 }, { ...smart, orderFee: { ...smart.orderFee, micro: 0 }, salesFee: { naver: 0, marketing: 0 } })
    expect(solvePrice(zero, { type: 'margin', value: 50 })).toBe(1)
  })
  it('10원·100원 단위 올림', () => {
    expect(ceilTo(12341, 10)).toBe(12350)
    expect(ceilTo(12341, 100)).toBe(12400)
    expect(ceilTo(12300, 100)).toBe(12300)
  })
})

describe('여섯 마켓 비교', () => {
  const all: AllSettings = {
    ...DEFAULT_SETTINGS,
    smartstore: smart,
    coupang: { ...DEFAULT_COUPANG, shipFeeRate: 3 },
    rocket: { ...DEFAULT_ROCKET, fulfillFee: 650, deliveryFee: 1250 },
    elevenst: { ...DEFAULT_ELEVENST, rate: 12, shipFeeRate: 3.3 },
  }
  it('여섯 마켓을 정해진 순서로 계산하고 가장 남는 곳을 고른다', () => {
    const results = calcAllMarkets(product, all)
    expect(results.map((r) => r.market)).toEqual(['smartstore', 'coupang', 'rocket', 'gmarket', 'auction', 'elevenst'])
    const best = bestMarket(results)
    const top = Math.max(...results.map((r) => r.result.profit))
    expect(results.find((r) => r.market === best)?.result.profit).toBe(top)
  })
  it('주요 요율이 비어 있는 마켓은 "가장 남는 곳" 후보에서 뺀다', () => {
    const results = calcAllMarkets(product, DEFAULT_SETTINGS)
    const smart = results.find((r) => r.market === 'smartstore')!
    expect(smart.result.missing.length).toBeGreaterThan(0)
    expect(smart.result.blocked).toBe(true)
    expect(['coupang', 'gmarket', 'auction']).toContain(bestMarket(results))
  })
  it('배송비 수수료처럼 작은 요율만 비면 0원으로 계산하고 비교에는 남긴다', () => {
    const paid = { ...product, shipMode: 'paid' as const, buyerShipping: 3000 }
    const coupang = calcAllMarkets(paid, DEFAULT_SETTINGS).find((r) => r.market === 'coupang')!
    expect(coupang.result.missing.some((m) => m.includes('배송비 수수료'))).toBe(true)
    expect(coupang.result.blocked).toBe(false)
  })
  it('카테고리 이름을 주면 마켓마다 가장 가까운 카테고리 요율을 쓴다', () => {
    const results = calcAllMarkets(product, all, '모니터')
    expect(results.find((r) => r.market === 'coupang')?.rate).toBe(4.5)
    expect(results.find((r) => r.market === 'gmarket')?.rate).toBe(7)
    expect(results.find((r) => r.market === 'auction')?.category).toBe('모니터/프린터 > 전체')
  })
})

describe('요율 데이터', () => {
  const lists = { 쿠팡: COUPANG_CATEGORIES, G마켓: GMARKET_CATEGORIES, 옥션: AUCTION_CATEGORIES }
  for (const [name, list] of Object.entries(lists)) {
    it(`${name}: 카테고리 id 가 겹치지 않고 요율이 0~20% 사이다`, () => {
      expect(new Set(list.map((c) => c.id)).size).toBe(list.length)
      for (const c of list) {
        expect(c.rate).toBeGreaterThan(0)
        expect(c.rate).toBeLessThanOrEqual(20)
      }
    })
  }
  it('공식 표에서 옮긴 값 몇 개를 다시 확인한다', () => {
    expect(findCategory(COUPANG_CATEGORIES, '식품 > 면/라면').rate).toBe(10.9)
    expect(findCategory(COUPANG_CATEGORIES, '가전디지털 > 컴퓨터주변기기 > 모니터').rate).toBe(4.5)
    expect(findCategory(COUPANG_CATEGORIES, '패션 > 쥬얼리 > 순금/골드바/돌반지').rate).toBe(4)
    expect(findCategory(GMARKET_CATEGORIES, '상품권 > 전체').rate).toBe(1)
    expect(findCategory(GMARKET_CATEGORIES, '도서음반/e교육 > 전체').rate).toBe(15)
    expect(findCategory(AUCTION_CATEGORIES, '도서/교육/음반 > 전체').rate).toBe(15)
    expect(findCategory(AUCTION_CATEGORIES, '가공식품 > 수산가공식품').rate).toBe(12)
  })
  it('쿠팡 표의 요율 범위는 4%~10.9%', () => {
    const rates = COUPANG_CATEGORIES.map((c) => c.rate)
    expect(Math.min(...rates)).toBe(4)
    expect(Math.max(...rates)).toBe(10.9)
  })
  it('카테고리 검색', () => {
    expect(matchCategory(GMARKET_CATEGORIES, '주방용품')?.id).toBe('주방용품 > 전체')
    expect(matchCategory(COUPANG_CATEGORIES, '모니터')?.rate).toBe(4.5)
    expect(matchCategory(COUPANG_CATEGORIES, '없는분류xyz')).toBeNull()
    expect(matchCategory(COUPANG_CATEGORIES, '  ')).toBeNull()
    expect(searchCategories(AUCTION_CATEGORIES, '자동차').length).toBeGreaterThan(3)
  })
})
