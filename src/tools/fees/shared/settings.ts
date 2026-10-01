/**
 * 마켓별 요율 설정의 기본값과 저장 위치.
 * 개별 계산기와 "마켓 수수료 비교"가 같은 설정을 쓰도록 마켓마다 저장 키를 하나만 둔다.
 */
import { usePersistentState } from '@/lib/hooks'
import {
  calcCoupang, calcElevenst, calcEsm, calcRocket, calcSmartstore,
  type CalcResult, type CoupangSettings, type ElevenstSettings, type EsmSettings, type Product, type RocketSettings, type SmartstoreSettings,
} from './calc'
import { COUPANG_CATEGORIES, COUPANG_DEFAULT_CATEGORY, COUPANG_META, COUPANG_MONTHLY_FEE, COUPANG_SHIPPING_FEE, COUPANG_VAT_ON_FEE } from './rates/coupang'
import { ELEVENST_AFFILIATE_FEE, ELEVENST_CATEGORY_FEE, ELEVENST_META, ELEVENST_SERVER_FEE, ELEVENST_SHIPPING_FEE } from './rates/elevenst'
import {
  AUCTION_CATEGORIES, AUCTION_META, ESM_AFFILIATE_FEE, ESM_DEFAULT_CATEGORY, ESM_PROMO_FEE, ESM_SERVER_FEE, ESM_SHIPPING_FEE, GMARKET_CATEGORIES, GMARKET_META,
} from './rates/esm'
import { ROCKET_DELIVERY_FEE, ROCKET_FREE_STORAGE_DAYS, ROCKET_FULFILL_FEE, ROCKET_META, ROCKET_SAVER_MONTHLY } from './rates/rocket'
import { SMARTSTORE_CONNECT_FEE, SMARTSTORE_META, SMARTSTORE_ORDER_FEE, SMARTSTORE_SALES_FEE } from './rates/smartstore'
import type { CategoryRate, RateMeta } from './rates/types'

export const MARKETS = ['smartstore', 'coupang', 'rocket', 'gmarket', 'auction', 'elevenst'] as const
export type MarketId = (typeof MARKETS)[number]

export const MARKET_LABEL: Record<MarketId, string> = {
  smartstore: '스마트스토어',
  coupang: '쿠팡',
  rocket: '로켓그로스',
  gmarket: 'G마켓',
  auction: '옥션',
  elevenst: '11번가',
}

export const MARKET_META: Record<MarketId, RateMeta> = {
  smartstore: SMARTSTORE_META,
  coupang: COUPANG_META,
  rocket: ROCKET_META,
  gmarket: GMARKET_META,
  auction: AUCTION_META,
  elevenst: ELEVENST_META,
}

/** 계산기 도구 id (registry.ts) */
export const MARKET_TOOL_ID: Record<MarketId, string> = {
  smartstore: 'smartstore',
  coupang: 'coupang',
  rocket: 'rocket-margin',
  gmarket: 'gmarket',
  auction: 'auction',
  elevenst: 'elevenst',
}

export const MARKET_CATEGORIES: Partial<Record<MarketId, CategoryRate[]>> = {
  coupang: COUPANG_CATEGORIES,
  rocket: COUPANG_CATEGORIES,
  gmarket: GMARKET_CATEGORIES,
  auction: AUCTION_CATEGORIES,
}

export const DEFAULT_SMARTSTORE: SmartstoreSettings = {
  tier: 'micro',
  orderFee: {
    micro: SMARTSTORE_ORDER_FEE.micro.value,
    small1: SMARTSTORE_ORDER_FEE.small1.value,
    small2: SMARTSTORE_ORDER_FEE.small2.value,
    small3: SMARTSTORE_ORDER_FEE.small3.value,
    general: SMARTSTORE_ORDER_FEE.general.value,
  },
  inflow: 'naver',
  salesFee: { naver: SMARTSTORE_SALES_FEE.naver.value, marketing: SMARTSTORE_SALES_FEE.marketing.value },
  connect: false,
  connectRate: SMARTSTORE_CONNECT_FEE.value,
}

export const DEFAULT_COUPANG: CoupangSettings = {
  categoryId: COUPANG_DEFAULT_CATEGORY,
  rateOverride: null,
  vat: COUPANG_VAT_ON_FEE.value,
  shipFeeRate: COUPANG_SHIPPING_FEE.value,
  monthlyFee: false,
  monthlyFeeAmount: COUPANG_MONTHLY_FEE.value ?? 0,
  monthlyOrders: 100,
}

export const DEFAULT_ROCKET: RocketSettings = {
  categoryId: COUPANG_DEFAULT_CATEGORY,
  rateOverride: null,
  vat: COUPANG_VAT_ON_FEE.value,
  sizeType: 's',
  fulfillFee: ROCKET_FULFILL_FEE.value,
  deliveryFee: ROCKET_DELIVERY_FEE.value,
  logisticsVat: false,
  inboundTotal: 0,
  inboundQty: 0,
  saver: false,
  saverMonthly: ROCKET_SAVER_MONTHLY.value ?? 0,
  monthlyUnits: 100,
  storageDays: 0,
  freeStorageDays: ROCKET_FREE_STORAGE_DAYS.base,
  saverFreeStorageDays: ROCKET_FREE_STORAGE_DAYS.saver,
  storageDailyFee: 0,
  returnRate: 0,
  returnPickupFee: 0,
  returnRestockFee: 0,
  extraFee: 0,
}

export const DEFAULT_ESM: EsmSettings = {
  categoryId: ESM_DEFAULT_CATEGORY,
  rateOverride: null,
  shipFeeRate: ESM_SHIPPING_FEE.value,
  affiliate: false,
  affiliateRate: ESM_AFFILIATE_FEE.value,
  promo: false,
  promoRate: ESM_PROMO_FEE.value,
  serverFee: false,
  serverFeeAmount: ESM_SERVER_FEE.value ?? 0,
  monthlyOrders: 100,
  rounding: 'ceil',
}

export const DEFAULT_ELEVENST: ElevenstSettings = {
  rate: ELEVENST_CATEGORY_FEE.value,
  shipFeeRate: ELEVENST_SHIPPING_FEE.value,
  affiliate: false,
  affiliateRate: ELEVENST_AFFILIATE_FEE.value,
  couponShare: 100,
  serverFee: false,
  serverFeeAmount: ELEVENST_SERVER_FEE.value ?? 0,
  monthlyOrders: 100,
}

export interface AllSettings {
  smartstore: SmartstoreSettings
  coupang: CoupangSettings
  rocket: RocketSettings
  gmarket: EsmSettings
  auction: EsmSettings
  elevenst: ElevenstSettings
}

export const DEFAULT_SETTINGS: AllSettings = {
  smartstore: DEFAULT_SMARTSTORE,
  coupang: DEFAULT_COUPANG,
  rocket: DEFAULT_ROCKET,
  gmarket: DEFAULT_ESM,
  auction: DEFAULT_ESM,
  elevenst: DEFAULT_ELEVENST,
}

const settingsKey = (market: MarketId) => `onbijjang:fees:settings-${market}`

/** 마켓 하나의 요율 설정(이 브라우저에 저장). 개별 계산기와 비교 도구가 같이 쓴다. */
export function useMarketSettings<M extends MarketId>(market: M) {
  const [settings, setSettings] = usePersistentState<AllSettings[M]>(settingsKey(market), DEFAULT_SETTINGS[market])
  const patch = (next: Partial<AllSettings[M]>) => setSettings((prev) => ({ ...prev, ...next }))
  const reset = () => setSettings(DEFAULT_SETTINGS[market])
  return { settings, patch, reset }
}

// ── 카테고리 ──────────────────────────────────────────────
export function findCategory(list: CategoryRate[], id: string): CategoryRate {
  return list.find((c) => c.id === id) ?? list[0]
}

const norm = (s: string) => s.toLowerCase().replace(/[\s/·,>()-]+/g, '')

/** 검색어에 맞는 카테고리를 찾는다. 이름이 정확히 같은 것 > 이름이 검색어로 시작 > 경로에 포함 순. */
export function searchCategories(list: CategoryRate[], query: string, limit = 60): CategoryRate[] {
  const q = norm(query)
  if (!q) return list.slice(0, limit)
  const scored: Array<{ c: CategoryRate; score: number }> = []
  for (const c of list) {
    const names = c.path.map(norm)
    const leaf = names[names.length - 1]
    const isBase = c.path.length === 2 && (c.path[1] === '전체' || c.path[1] === '기본 수수료')
    const top = names[0]
    let score = 0
    if (isBase && top === q) score = 100
    else if (!isBase && leaf === q) score = 95
    else if (names.some((n) => n === q)) score = 85
    else if (isBase && top.startsWith(q)) score = 75
    else if (!isBase && leaf.startsWith(q)) score = 70
    else if (isBase && top.includes(q)) score = 60
    else if (names.some((n) => n.includes(q))) score = 50
    else if (!isBase && q.includes(leaf) && leaf.length >= 2) score = 40
    else if (isBase && q.includes(top) && top.length >= 2) score = 35
    if (score) scored.push({ c, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((s) => s.c)
}

/** 검색어에 가장 잘 맞는 카테고리 하나. 없으면 null */
export function matchCategory(list: CategoryRate[], query: string): CategoryRate | null {
  return query.trim() ? (searchCategories(list, query, 1)[0] ?? null) : null
}

// ── 여섯 마켓 한 번에 계산 ────────────────────────────────
export interface MarketResult {
  market: MarketId
  label: string
  result: CalcResult
  /** 적용한 카테고리 이름(있는 마켓만) */
  category?: string
  /** 판매 수수료율(%) — 표에 보여 주기 위한 값 */
  rate: number | null
}

const CATEGORY_MARKETS = ['coupang', 'rocket', 'gmarket', 'auction'] as const

/**
 * 카테고리 이름(검색어)에 가장 가까운 카테고리를 마켓마다 찾아 설정에 넣는다.
 * 못 찾은 마켓은 설정에서 고른 카테고리를 그대로 쓴다. 검색어가 없으면 설정을 그대로 돌려준다.
 */
export function resolveCategories(all: AllSettings, categoryQuery: string): AllSettings {
  if (!categoryQuery.trim()) return all
  const next = { ...all }
  for (const market of CATEGORY_MARKETS) {
    const matched = matchCategory(MARKET_CATEGORIES[market]!, categoryQuery)
    if (!matched) continue
    if (market === 'coupang') next.coupang = { ...all.coupang, categoryId: matched.id, rateOverride: null }
    else if (market === 'rocket') next.rocket = { ...all.rocket, categoryId: matched.id, rateOverride: null }
    else next[market] = { ...all[market], categoryId: matched.id, rateOverride: null }
  }
  return next
}

/** 마켓 하나를 설정대로 계산한다(카테고리는 설정에 들어 있는 것을 쓴다). */
export function calcMarket(market: MarketId, p: Product, all: AllSettings): MarketResult {
  const label = MARKET_LABEL[market]
  switch (market) {
    case 'smartstore': {
      const s = all.smartstore
      const rates = [s.orderFee[s.tier], s.salesFee[s.inflow], s.connect ? s.connectRate : 0]
      return { market, label, result: calcSmartstore(p, s), rate: rates.some((r) => r == null) ? null : rates.reduce<number>((a, b) => a + (b ?? 0), 0) }
    }
    case 'coupang': {
      const c = findCategory(COUPANG_CATEGORIES, all.coupang.categoryId)
      return { market, label, result: calcCoupang(p, all.coupang, c.rate), category: c.path.join(' > '), rate: all.coupang.rateOverride ?? c.rate }
    }
    case 'rocket': {
      const c = findCategory(COUPANG_CATEGORIES, all.rocket.categoryId)
      return { market, label, result: calcRocket(p, all.rocket, c.rate), category: c.path.join(' > '), rate: all.rocket.rateOverride ?? c.rate }
    }
    case 'gmarket':
    case 'auction': {
      const c = findCategory(MARKET_CATEGORIES[market]!, all[market].categoryId)
      return { market, label, result: calcEsm(p, all[market], c.rate), category: c.path.join(' > '), rate: all[market].rateOverride ?? c.rate }
    }
    case 'elevenst':
      return { market, label, result: calcElevenst(p, all.elevenst), rate: all.elevenst.rate }
  }
}

/**
 * 한 상품을 여섯 마켓 설정으로 계산한다.
 * categoryQuery 가 있으면 카테고리 표가 있는 마켓은 그 이름에 가장 가까운 카테고리 요율을 쓴다(못 찾으면 설정의 카테고리).
 */
export function calcAllMarkets(p: Product, all: AllSettings, categoryQuery = ''): MarketResult[] {
  const resolved = resolveCategories(all, categoryQuery)
  return MARKETS.map((market) => calcMarket(market, p, resolved))
}

/** 요율이 모두 채워진 마켓 중 이익이 가장 큰 곳. 없으면 null */
export function bestMarket(results: MarketResult[]): MarketId | null {
  let best: MarketResult | null = null
  for (const r of results) {
    if (r.result.missing.length) continue
    if (!best || r.result.profit > best.result.profit) best = r
  }
  return best?.market ?? null
}

export const EMPTY_PRODUCT: Product = { name: '', price: 0, cost: 0, shipMode: 'paid', buyerShipping: 0, shippingCost: 0 }
export const EXAMPLE_PRODUCT: Product = { name: '스테인리스 텀블러 500ml', price: 19800, cost: 8500, shipMode: 'paid', buyerShipping: 3000, shippingCost: 3000 }
