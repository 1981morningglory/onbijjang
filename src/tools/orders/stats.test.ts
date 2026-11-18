import { describe, expect, it } from 'vitest'
import { orderStats, region } from '../../../server/lib/orderStats.mjs'
import { change, dayKind, HOLIDAYS, niceScale, presetRange, won } from './stats'

const row = (o: Record<string, string | number | null>) => ({ 주문번호: '1', 쇼핑몰: '쿠팡', 수량: 1, 상품코드: 'A', 상품명: '플래너', 옵션: '블랙', 수취인주소: '서울특별시 강남구 테헤란로 1', 전화번호1: '010-1111-2222', 수취인명: '김', ...o })
const batches = [
  {
    id: 'b1',
    date: '2026-11-02', // 월
    cols: ['주문번호', '쇼핑몰', '수량', '결제금액'],
    rows: [
      row({ 주문번호: '1', 수량: 2, 결제금액: 20000 }),
      row({ 주문번호: '1', 상품코드: 'B', 상품명: '펜', 옵션: '단품', 수량: 1, 결제금액: 5000 }), // 같은 주문의 둘째 줄
      row({ 주문번호: '2', 쇼핑몰: '스마트스토어', 수취인주소: '경기도 수원시 장안구 정조로 1', 전화번호1: '010-3333-4444', 결제금액: 10000 }),
      row({ 주문번호: '3', 취소내용: '취소완료', 결제금액: 99999 }),
    ],
  },
  { id: 'b2', date: '2026-11-07', cols: ['주문번호'], rows: [row({ 주문번호: '9', 수취인주소: '부산광역시 해운대구 센텀중앙로 79', 전화번호1: '010-1111-2222' })] }, // 토, 같은 고객 재구매
  { id: 'b3', date: '2026-10-30', cols: ['주문번호'], rows: [row({ 주문번호: '7' })] }, // 기간 밖
]

describe('주문 통계', () => {
  const s = orderStats(batches, '2026-11-01', '2026-11-08')
  it('주문은 쇼핑몰+주문번호로 한 건, 취소는 빼고 따로 센다', () => {
    expect(s.totals.orders).toBe(3)
    expect(s.totals.lines).toBe(4)
    expect(s.totals.qty).toBe(5)
    expect(s.totals.cancelled).toBe(1)
    expect(s.totals.amount).toBe(35000)
    expect(s.totals.customers).toBe(2)
    expect(s.totals.repeatCustomers).toBe(1)
  })
  it('날짜·요일·거래처·상품·지역', () => {
    expect(s.daily).toHaveLength(8)
    // 11-02: 주문 2건, 줄 3개(주문 1의 두 줄 + 주문 2) — 취소 줄은 빼고
    expect(s.daily.find((d) => d.date === '2026-11-02')).toMatchObject({ orders: 2, lines: 3, qty: 4, amount: 35000 })
    expect(s.weekday[1]).toMatchObject({ orders: 2, days: 1 }) // 기간 안 월요일은 11-02 하루
    expect(s.weekday[1].lines).toBe(3)
    expect(s.weekday[6]).toMatchObject({ orders: 1, lines: 1 })
    expect(s.daily.reduce((n, d) => n + d.lines, 0)).toBe(s.totals.lines)
    expect(s.malls[0]).toMatchObject({ name: '쿠팡', orders: 2, lines: 3, qty: 4, amount: 25000 })
    expect(s.products[0]).toMatchObject({ code: 'A', qty: 4, orders: 3 })
    expect(s.regions.map((r) => r.name)).toEqual(expect.arrayContaining(['서울', '경기', '부산']))
    expect(s.cities.map((c) => c.name)).toContain('경기 수원시')
  })
  it('합계만(지난 기간 비교용)', () => {
    const t = orderStats(batches, '2026-10-24', '2026-10-31', { detail: false })
    expect(t.totals.orders).toBe(1)
    expect(t.totals.amount).toBeNull()
  })
  it('주소 → 시·도', () => {
    expect(region('충청남도 천안시 서북구 번영로 156').sido).toBe('충남')
    expect(region('(06236) 서울 강남구 테헤란로').city).toBe('서울 강남구')
    expect(region('세종특별자치시 한누리대로 2130')).toEqual({ sido: '세종', city: '세종' })
    expect(region('강원특별자치도 춘천시 중앙로 1').sido).toBe('강원')
    expect(region('전북특별자치도 전주시').sido).toBe('전북')
    expect(region('Somewhere').sido).toBe('기타')
  })
})

describe('대시보드 도우미', () => {
  it('기간 고르기', () => {
    expect(presetRange('month', '2026-11-18')).toEqual({ from: '2026-11-01', to: '2026-11-18' })
    expect(presetRange('30d', '2026-11-18')).toEqual({ from: '2026-10-20', to: '2026-11-18' })
    expect(presetRange('lastMonth', '2026-03-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
  })
  it('원 줄여 쓰기·변화율·눈금', () => {
    expect(won(8900)).toBe('8,900원')
    expect(won(45_600_000)).toBe('4,560만원')
    expect(won(123_000_000)).toBe('1억 2,300만원')
    expect(change(120, 100)).toBe(20)
    expect(change(5, 0)).toBeNull()
    expect(niceScale(87)).toEqual({ max: 100, step: 25 })
  })
})

describe('토·일·공휴일', () => {
  it('요일과 법정공휴일(대체공휴일 포함)', () => {
    expect(dayKind('2026-11-18')).toBe('weekday') // 수
    expect(dayKind('2026-11-21')).toBe('sat')
    expect(dayKind('2026-11-22')).toBe('sun')
    expect(dayKind('2026-10-03')).toBe('holiday') // 개천절(토요일이어도 공휴일)
    expect(dayKind('2026-10-05')).toBe('holiday') // 대체공휴일
    expect(HOLIDAYS['2026-05-01']).toBe('노동절')
    expect(HOLIDAYS['2026-07-17']).toBe('제헌절')
    expect(HOLIDAYS['2027-02-09']).toContain('대체공휴일')
  })
})
