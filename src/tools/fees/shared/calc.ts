/**
 * 마켓 수수료 계산 — 순수 함수만 둔다(화면·저장과 무관).
 * 금액은 모두 원 단위 정수, 요율은 퍼센트(2.73 = 2.73%).
 */
import type { SmartstoreInflow, SmartstoreTier } from './rates/smartstore'

export type Rounding = 'floor' | 'ceil'
export type ShipMode = 'free' | 'paid' | 'cod'

/** 모든 마켓 계산기가 같이 쓰는 상품 입력 */
export interface Product {
  name: string
  /** 판매가(할인 전) */
  price: number
  /** 원가(매입가) */
  cost: number
  /** free: 무료배송 · paid: 고객이 배송비를 함께 결제 · cod: 착불(마켓을 거치지 않음) */
  shipMode: ShipMode
  /** 고객이 결제하는 배송비(유료배송일 때만 쓰인다) */
  buyerShipping: number
  /** 판매자가 실제로 내는 택배비 */
  shippingCost: number
}

export type LineKind = 'income' | 'fee' | 'cost'
export interface Line {
  key: string
  label: string
  /** 항상 0 이상. kind 가 fee·cost 면 빼는 금액 */
  amount: number
  kind: LineKind
  /** 계산 근거: "35,000원 × 10.8%" */
  basis?: string
}

export interface Monthly {
  orders: number
  /** 월 고정 이용료(서버 이용료 등) */
  fee: number
  feeLabel: string
  /** 주문 1건 이익 × 건수 − 월 고정 이용료 */
  profit: number
}

export interface CalcResult {
  lines: Line[]
  /** 들어오는 돈: 판매가 + 고객 결제 배송비 */
  income: number
  /** 마켓이 떼는 수수료 합계 */
  feeTotal: number
  /** 정산 예상액 = income − feeTotal − 판매자 부담 할인 */
  settlement: number
  /** 원가·택배비 등 판매자 지출 합계(할인 포함) */
  costTotal: number
  /** 주문 1건(상품 1개) 이익 */
  profit: number
  /** 이익 ÷ 판매가 × 100. 판매가가 0 이면 null */
  marginPct: number | null
  /** 요율이 비어 있어 0 으로 계산한 항목 이름 */
  missing: string[]
  monthly?: Monthly
}

const int = (n: number | null | undefined) => (Number.isFinite(n) ? Math.max(0, Math.round(n as number)) : 0)

/**
 * 금액 × 요율(%) 을 원 단위로 맞춘다.
 * 부동소수 오차로 1원이 틀어지지 않도록 요율을 1/1000 % 정수로 바꿔 정수끼리 계산한다.
 */
export function feeOf(amount: number, ratePct: number | null | undefined, rounding: Rounding = 'floor'): number {
  if (!ratePct || !Number.isFinite(ratePct) || ratePct <= 0) return 0
  const n = int(amount) * Math.round(ratePct * 1000)
  const rem = n % 100000
  const base = (n - rem) / 100000
  return rounding === 'ceil' && rem > 0 ? base + 1 : base
}

/** 부가세 10% 를 더한 요율 */
export const withVat = (ratePct: number | null, vat: boolean) => (ratePct == null ? null : vat ? Math.round(ratePct * 1.1 * 1000) / 1000 : ratePct)

const pctText = (rate: number | null) => (rate == null ? '요율 미입력' : `${trimPct(rate)}%`)
export const trimPct = (rate: number) => String(Math.round(rate * 1000) / 1000)
const money = (n: number) => `${new Intl.NumberFormat('ko-KR').format(n)}원`

interface Draft {
  lines: Line[]
  missing: string[]
}

function finish(d: Draft, price: number, monthly?: { on: boolean; orders: number; fee: number; label: string }): CalcResult {
  let income = 0
  let feeTotal = 0
  let costTotal = 0
  for (const l of d.lines) {
    if (l.kind === 'income') income += l.amount
    else if (l.kind === 'fee') feeTotal += l.amount
    else costTotal += l.amount
  }
  const discount = d.lines.filter((l) => l.key === 'discount').reduce((s, l) => s + l.amount, 0)
  const profit = income - feeTotal - costTotal
  const result: CalcResult = {
    lines: d.lines.filter((l) => l.amount > 0 || l.key === 'price' || l.key === 'cost'),
    income,
    feeTotal,
    settlement: income - feeTotal - discount,
    costTotal,
    profit,
    marginPct: price > 0 ? (profit / price) * 100 : null,
    missing: d.missing,
  }
  if (monthly?.on) {
    const orders = int(monthly.orders)
    result.monthly = { orders, fee: monthly.fee, feeLabel: monthly.label, profit: profit * orders - monthly.fee }
  }
  return result
}

/** 판매가·배송비·원가처럼 모든 마켓에 공통인 줄을 만든다. */
function baseLines(p: Product, opts: { shipping?: boolean } = {}): { lines: Line[]; price: number; paidShipping: number } {
  const price = int(p.price)
  const paidShipping = opts.shipping === false || p.shipMode !== 'paid' ? 0 : int(p.buyerShipping)
  const lines: Line[] = [{ key: 'price', label: '판매가', amount: price, kind: 'income' }]
  if (paidShipping) lines.push({ key: 'buyerShipping', label: '고객 결제 배송비', amount: paidShipping, kind: 'income' })
  return { lines, price, paidShipping }
}

function costLines(p: Product, opts: { shipping?: boolean } = {}): Line[] {
  const lines: Line[] = [{ key: 'cost', label: '원가', amount: int(p.cost), kind: 'cost' }]
  if (opts.shipping !== false) lines.push({ key: 'shippingCost', label: '택배비(판매자 지출)', amount: int(p.shippingCost), kind: 'cost' })
  return lines
}

/** 요율이 필요한데 비어 있으면 missing 에 적고 0 으로 계산한다. */
function rateFee(d: Draft, opts: { key: string; label: string; base: number; rate: number | null; rounding?: Rounding; baseLabel?: string }): void {
  if (opts.base <= 0) return
  if (opts.rate == null) {
    d.missing.push(opts.label)
    return
  }
  d.lines.push({
    key: opts.key,
    label: opts.label,
    amount: feeOf(opts.base, opts.rate, opts.rounding),
    kind: 'fee',
    basis: `${opts.baseLabel ?? money(opts.base)} × ${pctText(opts.rate)}`,
  })
}

// ── 스마트스토어 ──────────────────────────────────────────
export interface SmartstoreSettings {
  tier: SmartstoreTier
  /** 네이버페이 주문관리 수수료(%) — 등급별 */
  orderFee: Record<SmartstoreTier, number | null>
  inflow: SmartstoreInflow
  /** 판매 수수료(%) — 유입 경로별 */
  salesFee: Record<SmartstoreInflow, number | null>
  connect: boolean
  /** 쇼핑커넥트 수수료(%) */
  connectRate: number | null
}

/**
 * 주문관리 수수료는 결제 금액(판매가 + 고객 결제 배송비)에, 판매 수수료·쇼핑커넥트 수수료는 판매가에 매긴다.
 * 각 수수료는 원 미만 버림.
 */
export function calcSmartstore(p: Product, s: SmartstoreSettings): CalcResult {
  const { lines, price, paidShipping } = baseLines(p)
  const d: Draft = { lines, missing: [] }
  rateFee(d, { key: 'orderFee', label: '네이버페이 주문관리 수수료', base: price + paidShipping, rate: s.orderFee[s.tier] })
  rateFee(d, { key: 'salesFee', label: '판매 수수료', base: price, rate: s.salesFee[s.inflow] })
  if (s.connect) rateFee(d, { key: 'connectFee', label: '쇼핑커넥트 수수료', base: price, rate: s.connectRate })
  d.lines.push(...costLines(p))
  return finish(d, price)
}

// ── 쿠팡 마켓플레이스 ─────────────────────────────────────
export interface CoupangSettings {
  categoryId: string
  /** 카테고리 요율 대신 쓸 값. null 이면 카테고리 요율 */
  rateOverride: number | null
  /** 수수료에 부가세 10% 더하기 */
  vat: boolean
  /** 배송비 수수료율(%) */
  shipFeeRate: number | null
  /** 월 서비스 이용료 반영 */
  monthlyFee: boolean
  monthlyFeeAmount: number
  monthlyOrders: number
}

export function calcCoupang(p: Product, s: CoupangSettings, categoryRate: number): CalcResult {
  const { lines, price, paidShipping } = baseLines(p)
  const d: Draft = { lines, missing: [] }
  const rate = s.rateOverride ?? categoryRate
  rateFee(d, { key: 'salesFee', label: s.vat ? '판매 수수료(부가세 포함)' : '판매 수수료', base: price, rate: withVat(rate, s.vat) })
  rateFee(d, { key: 'shipFee', label: s.vat ? '배송비 수수료(부가세 포함)' : '배송비 수수료', base: paidShipping, rate: withVat(s.shipFeeRate, s.vat) })
  d.lines.push(...costLines(p))
  return finish(d, price, { on: s.monthlyFee, orders: s.monthlyOrders, fee: int(s.monthlyFeeAmount), label: '월 서비스 이용료' })
}

// ── 로켓그로스 ────────────────────────────────────────────
export interface RocketSettings {
  categoryId: string
  rateOverride: number | null
  vat: boolean
  sizeType: string
  /** 입출고비(개당) */
  fulfillFee: number | null
  /** 배송비(개당) */
  deliveryFee: number | null
  /** 입출고비·배송비·보관비·반품비에 부가세 10% 더하기 */
  logisticsVat: boolean
  /** 쿠팡 창고로 보내는 물류비 총액과 그때 보낸 수량 */
  inboundTotal: number
  inboundQty: number
  saver: boolean
  saverMonthly: number
  /** 세이버 구독료를 나눌 월 판매 수량 */
  monthlyUnits: number
  /** 예상 보관일 */
  storageDays: number
  /** 세이버가 아닐 때 무료 보관일 */
  freeStorageDays: number
  /** 세이버일 때 무료 보관일 */
  saverFreeStorageDays: number
  /** 무료 기간이 지난 뒤 개당 하루 보관비 */
  storageDailyFee: number
  /** 반품률(%) */
  returnRate: number
  returnPickupFee: number
  returnRestockFee: number
  /** 바코드 부착 등 부가서비스(개당) */
  extraFee: number
}

const vatAmount = (amount: number, vat: boolean) => (vat ? Math.floor((int(amount) * 11) / 10) : int(amount))

/** 로켓그로스는 쿠팡이 배송하므로 고객 배송비·택배비가 없다. 상품 1개 기준. */
export function calcRocket(p: Pick<Product, 'name' | 'price' | 'cost'>, s: RocketSettings, categoryRate: number): CalcResult {
  const product: Product = { ...p, shipMode: 'free', buyerShipping: 0, shippingCost: 0 }
  const { lines, price } = baseLines(product, { shipping: false })
  const d: Draft = { lines, missing: [] }
  const rate = s.rateOverride ?? categoryRate
  rateFee(d, { key: 'salesFee', label: s.vat ? '판매 수수료(부가세 포함)' : '판매 수수료', base: price, rate: withVat(rate, s.vat) })

  const vatNote = s.logisticsVat ? ' + 부가세' : ''
  if (s.fulfillFee == null) d.missing.push('입출고비')
  else d.lines.push({ key: 'fulfillFee', label: '입출고비', amount: vatAmount(s.fulfillFee, s.logisticsVat), kind: 'fee', basis: `개당 ${money(int(s.fulfillFee))}${vatNote}` })
  if (s.deliveryFee == null) d.missing.push('배송비')
  else d.lines.push({ key: 'deliveryFee', label: '배송비', amount: vatAmount(s.deliveryFee, s.logisticsVat), kind: 'fee', basis: `개당 ${money(int(s.deliveryFee))}${vatNote}` })

  const freeDays = s.saver ? int(s.saverFreeStorageDays) : int(s.freeStorageDays)
  const paidDays = Math.max(0, int(s.storageDays) - freeDays)
  if (paidDays > 0 && s.storageDailyFee > 0) {
    d.lines.push({
      key: 'storageFee',
      label: '보관비',
      amount: vatAmount(Math.floor(paidDays * s.storageDailyFee), s.logisticsVat),
      kind: 'fee',
      basis: `무료 ${freeDays}일 뒤 ${paidDays}일 × ${money(s.storageDailyFee)}${vatNote}`,
    })
  }
  if (!s.saver && s.returnRate > 0) {
    const perReturn = int(s.returnPickupFee) + int(s.returnRestockFee)
    d.lines.push({
      key: 'returnFee',
      label: '반품 회수·재입고비(예상)',
      amount: vatAmount(feeOf(perReturn, s.returnRate), s.logisticsVat),
      kind: 'fee',
      basis: `${money(perReturn)} × 반품률 ${trimPct(s.returnRate)}%${vatNote}`,
    })
  }
  if (s.saver && s.monthlyUnits > 0) {
    d.lines.push({
      key: 'saverFee',
      label: '세이버 구독료(개당 몫)',
      amount: Math.floor(int(s.saverMonthly) / int(s.monthlyUnits)),
      kind: 'fee',
      basis: `${money(int(s.saverMonthly))} ÷ 월 ${int(s.monthlyUnits)}개`,
    })
  }
  if (s.extraFee > 0) d.lines.push({ key: 'extraFee', label: '부가서비스', amount: vatAmount(s.extraFee, s.logisticsVat), kind: 'fee', basis: `개당${vatNote}` })

  d.lines.push({ key: 'cost', label: '원가', amount: int(p.cost), kind: 'cost' })
  if (s.inboundTotal > 0 && s.inboundQty > 0) {
    d.lines.push({
      key: 'inbound',
      label: '창고 입고 물류비(개당)',
      amount: Math.floor(int(s.inboundTotal) / int(s.inboundQty)),
      kind: 'cost',
      basis: `${money(int(s.inboundTotal))} ÷ ${int(s.inboundQty)}개`,
    })
  }
  return finish(d, price)
}

// ── G마켓 · 옥션 ──────────────────────────────────────────
export interface EsmSettings {
  categoryId: string
  rateOverride: number | null
  /** 선결제 배송비 이용료율(%) */
  shipFeeRate: number | null
  affiliate: boolean
  /** 제휴채널 프로모션 대행 이용료(%) */
  affiliateRate: number | null
  promo: boolean
  /** 프로모션 참여 이용료(%) */
  promoRate: number | null
  serverFee: boolean
  serverFeeAmount: number
  monthlyOrders: number
  rounding: Rounding
}

/**
 * 공식 식: (판매가 + 옵션) × 카테고리 이용료 + 선결제 배송비 × 3.3%.
 * 판매자 부담 할인은 이용료 기준(판매가)을 줄이지 않고 그대로 판매자 비용이 된다.
 */
export function calcEsm(p: Product, s: EsmSettings, categoryRate: number, extra: { discount?: number } = {}): CalcResult {
  const { lines, price, paidShipping } = baseLines(p)
  const d: Draft = { lines, missing: [] }
  const r = s.rounding
  rateFee(d, { key: 'salesFee', label: '카테고리 서비스 이용료', base: price, rate: s.rateOverride ?? categoryRate, rounding: r })
  rateFee(d, { key: 'shipFee', label: '선결제 배송비 이용료', base: paidShipping, rate: s.shipFeeRate, rounding: r })
  if (s.affiliate) rateFee(d, { key: 'affiliateFee', label: '제휴채널 이용료', base: price, rate: s.affiliateRate, rounding: r })
  if (s.promo) rateFee(d, { key: 'promoFee', label: '프로모션 참여 이용료', base: price, rate: s.promoRate, rounding: r })
  const discount = Math.min(int(extra.discount), price)
  if (discount) d.lines.push({ key: 'discount', label: '판매자 부담 할인', amount: discount, kind: 'cost' })
  d.lines.push(...costLines(p))
  return finish(d, price, { on: s.serverFee, orders: s.monthlyOrders, fee: int(s.serverFeeAmount), label: '월 서버 이용료' })
}

// ── 11번가 ────────────────────────────────────────────────
export interface ElevenstSettings {
  /** 카테고리 서비스 이용료율(%) */
  rate: number | null
  /** 선결제 배송비 서비스 이용료율(%) */
  shipFeeRate: number | null
  affiliate: boolean
  /** 제휴마케팅 대행비(%) — (판매가 + 선결제 배송비) 기준 */
  affiliateRate: number | null
  /** 쿠폰 할인액 중 판매자 부담 비율(%) */
  couponShare: number
  serverFee: boolean
  serverFeeAmount: number
  monthlyOrders: number
}

/**
 * 서비스 이용료는 할인 전 판매가 기준. 제휴마케팅 대행비는 (판매가 + 선결제 배송비) 기준.
 * 쿠폰 할인액(판매가 − 쿠폰 적용 후 금액)은 판매자 부담 비율만큼 비용으로 잡는다.
 */
export function calcElevenst(p: Product, s: ElevenstSettings, extra: { couponDiscount?: number } = {}): CalcResult {
  const { lines, price, paidShipping } = baseLines(p)
  const d: Draft = { lines, missing: [] }
  rateFee(d, { key: 'salesFee', label: '카테고리 서비스 이용료', base: price, rate: s.rate })
  rateFee(d, { key: 'shipFee', label: '선결제 배송비 이용료', base: paidShipping, rate: s.shipFeeRate })
  if (s.affiliate) {
    rateFee(d, {
      key: 'affiliateFee',
      label: '제휴마케팅 대행비',
      base: price + paidShipping,
      rate: s.affiliateRate,
      baseLabel: paidShipping ? `(판매가 + 배송비) ${money(price + paidShipping)}` : undefined,
    })
  }
  const couponDiscount = Math.min(int(extra.couponDiscount), price)
  if (couponDiscount) {
    const share = Math.min(100, Math.max(0, s.couponShare))
    d.lines.push({
      key: 'discount',
      label: '쿠폰 판매자 부담',
      amount: feeOf(couponDiscount, share),
      kind: 'cost',
      basis: `할인 ${money(couponDiscount)} × ${trimPct(share)}%`,
    })
  }
  d.lines.push(...costLines(p))
  return finish(d, price, { on: s.serverFee, orders: s.monthlyOrders, fee: int(s.serverFeeAmount), label: '월 서버 이용료' })
}

// ── 역산 ──────────────────────────────────────────────────
export type Target = { type: 'margin'; value: number } | { type: 'profit'; value: number }

const meets = (r: CalcResult, t: Target) => (t.type === 'margin' ? r.marginPct != null && r.marginPct >= t.value - 1e-9 : r.profit >= t.value)

/**
 * 목표 이익률(%) 또는 목표 이익액(원)을 만족하는 가장 낮은 판매가를 찾는다.
 * calcAt(판매가) 는 다른 입력을 그대로 두고 판매가만 바꿔 계산한 결과여야 한다.
 * 수수료 구조상 달성할 수 없으면 null.
 */
export function solvePrice(calcAt: (price: number) => CalcResult, target: Target, max = 1_000_000_000): number | null {
  if (!Number.isFinite(target.value)) return null
  if (!meets(calcAt(max), target)) return null
  let lo = 1
  let hi = max
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (meets(calcAt(mid), target)) hi = mid
    else lo = mid + 1
  }
  // 원 단위 버림 때문에 1~2원 아래에서도 조건을 만족할 수 있어 조금 더 내려가 본다.
  let best = lo
  for (let p = lo - 1; p >= Math.max(1, lo - 200); p--) {
    if (meets(calcAt(p), target)) best = p
  }
  return best
}

/** 10원·100원 단위로 올림 */
export const ceilTo = (n: number, unit: number) => Math.ceil(n / unit) * unit
