// 주문 통계 대시보드 — 화면에서 쓰는 형태·기간·숫자 글자(서버 server/lib/orderStats.mjs 가 계산한다)

export interface Totals {
  orders: number
  lines: number
  qty: number
  amount: number | null
  cancelled: number
  customers: number
  repeatCustomers: number
  malls?: number
  products?: number
  batches: number
  days: number
}
export interface DayStat {
  date: string
  orders: number
  qty: number
  amount: number
}
export interface WeekdayStat extends Omit<DayStat, 'date'> {
  dow: number
  days: number
}
export interface NamedStat {
  name: string
  orders: number
  qty: number
  amount: number
}
export interface ProductStat extends NamedStat {
  code: string
  option: string
}
export interface Stats {
  from: string
  to: string
  today: string
  firstDate: string | null
  hasAmount: boolean
  totals: Totals
  prev: { from: string; to: string; totals: Totals }
  daily: DayStat[]
  weekday: WeekdayStat[]
  malls: NamedStat[]
  products: ProductStat[]
  regions: NamedStat[]
  cities: NamedStat[]
}
export type Metric = 'orders' | 'qty' | 'amount'
export const METRIC_LABEL: Record<Metric, string> = { orders: '주문건수', qty: '판매수량', amount: '매출액' }
export const METRIC_UNIT: Record<Metric, string> = { orders: '건', qty: '개', amount: '원' }

export type Preset = 'month' | '30d' | 'lastMonth' | '7d' | 'year' | 'custom'
export const PRESETS: { value: Preset; label: string }[] = [
  { value: 'month', label: '이번 달' },
  { value: '30d', label: '최근 30일' },
  { value: '7d', label: '최근 7일' },
  { value: 'lastMonth', label: '지난달' },
  { value: 'year', label: '올해' },
  { value: 'custom', label: '직접 고르기' },
]

/** 오늘(한국 날짜) */
export const kstToday = (now = Date.now()) => new Date(now + 9 * 3600e3).toISOString().slice(0, 10)
export function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400e3) + 1

/** 기간 고르기 → { from, to } */
export function presetRange(p: Exclude<Preset, 'custom'>, today = kstToday()) {
  const month = today.slice(0, 8)
  switch (p) {
    case 'month':
      return { from: `${month}01`, to: today }
    case '30d':
      return { from: addDays(today, -29), to: today }
    case '7d':
      return { from: addDays(today, -6), to: today }
    case 'lastMonth': {
      const end = addDays(`${month}01`, -1)
      return { from: `${end.slice(0, 8)}01`, to: end }
    }
    case 'year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today }
  }
}

const n0 = new Intl.NumberFormat('ko-KR')
export const fmt = (n: number) => n0.format(Math.round(n))
/** 원 단위 줄여 쓰기: 1억 2,300만원 · 4,560만원 · 8,900원 */
export function won(n: number) {
  const v = Math.round(n)
  if (Math.abs(v) >= 1e8) {
    const eok = Math.floor(v / 1e8)
    const man = Math.round((v % 1e8) / 1e4)
    return `${fmt(eok)}억${man ? ` ${fmt(man)}만` : ''}원`
  }
  if (Math.abs(v) >= 1e5) return `${fmt(Math.round(v / 1e4))}만원`
  return `${fmt(v)}원`
}
export const metricText = (m: Metric, v: number) => (m === 'amount' ? won(v) : `${fmt(v)}${METRIC_UNIT[m]}`)

/** 지난 기간 대비 변화율(%) — 지난 기간이 0이면 null */
export function change(now: number | null | undefined, before: number | null | undefined) {
  if (now == null || before == null || !before) return null
  return Math.round(((now - before) / before) * 1000) / 10
}

export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
/** 월요일부터 */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]

/** 그래프 눈금: 0부터 보기 좋은 최댓값과 눈금 간격 */
export function niceScale(max: number, ticks = 4) {
  if (max <= 0) return { max: ticks, step: 1 }
  const raw = max / ticks
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow
  return { max: Math.ceil(max / step) * step, step }
}

/** 날짜 짧게: 11.18(수) */
export const shortDay = (date: string) => `${Number(date.slice(5, 7))}.${Number(date.slice(8, 10))}(${WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]})`
