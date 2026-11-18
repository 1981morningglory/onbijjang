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
  /** 주문줄수(상품 줄 수) */
  lines: number
  qty: number
  amount: number
}
export interface WeekdayStat extends Omit<DayStat, 'date'> {
  dow: number
  days: number
  /** 그 요일 중 주문이 1건이라도 있던 날 수(하루 평균의 분모) */
  active: number
}
export interface NamedStat {
  name: string
  orders: number
  lines: number
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
export type Metric = 'orders' | 'lines' | 'qty' | 'amount'
export const METRIC_LABEL: Record<Metric, string> = { orders: '주문건수', lines: '주문줄수', qty: '판매수량', amount: '매출액' }
export const METRIC_UNIT: Record<Metric, string> = { orders: '건', lines: '줄', qty: '개', amount: '원' }

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

/**
 * 법정공휴일(관공서의 공휴일에 관한 규정 · 대체공휴일·선거일·임시공휴일 포함). 음력 명절과 대체공휴일은 해마다 달라 날짜로 적는다.
 * 2026-05-01 부터 노동절·제헌절이 공휴일. 새해 월력요항이 나오면 이어서 적는다.
 */
export const HOLIDAYS: Record<string, string> = {
  // 2024
  '2024-01-01': '신정', '2024-02-09': '설날 연휴', '2024-02-10': '설날', '2024-02-11': '설날 연휴', '2024-02-12': '대체공휴일(설날)', '2024-03-01': '삼일절', '2024-04-10': '국회의원 선거', '2024-05-05': '어린이날', '2024-05-06': '대체공휴일(어린이날)', '2024-05-15': '부처님오신날', '2024-06-06': '현충일', '2024-08-15': '광복절', '2024-09-16': '추석 연휴', '2024-09-17': '추석', '2024-09-18': '추석 연휴', '2024-10-01': '국군의날(임시공휴일)', '2024-10-03': '개천절', '2024-10-09': '한글날', '2024-12-25': '성탄절',
  // 2025
  '2025-01-01': '신정', '2025-01-27': '임시공휴일', '2025-01-28': '설날 연휴', '2025-01-29': '설날', '2025-01-30': '설날 연휴', '2025-03-01': '삼일절', '2025-03-03': '대체공휴일(삼일절)', '2025-05-05': '어린이날·부처님오신날', '2025-05-06': '대체공휴일', '2025-06-03': '대통령 선거', '2025-06-06': '현충일', '2025-08-15': '광복절', '2025-10-03': '개천절', '2025-10-05': '추석 연휴', '2025-10-06': '추석', '2025-10-07': '추석 연휴', '2025-10-08': '대체공휴일(추석)', '2025-10-09': '한글날', '2025-12-25': '성탄절',
  // 2026
  '2026-01-01': '신정', '2026-02-16': '설날 연휴', '2026-02-17': '설날', '2026-02-18': '설날 연휴', '2026-03-01': '삼일절', '2026-03-02': '대체공휴일(삼일절)', '2026-05-01': '노동절', '2026-05-05': '어린이날', '2026-05-24': '부처님오신날', '2026-05-25': '대체공휴일(부처님오신날)', '2026-06-03': '지방선거', '2026-06-06': '현충일', '2026-07-17': '제헌절', '2026-08-15': '광복절', '2026-08-17': '대체공휴일(광복절)', '2026-09-24': '추석 연휴', '2026-09-25': '추석', '2026-09-26': '추석 연휴', '2026-10-03': '개천절', '2026-10-05': '대체공휴일(개천절)', '2026-10-09': '한글날', '2026-12-25': '성탄절',
  // 2027
  '2027-01-01': '신정', '2027-02-06': '설날 연휴', '2027-02-07': '설날', '2027-02-08': '설날 연휴', '2027-02-09': '대체공휴일(설날)', '2027-03-01': '삼일절', '2027-05-01': '노동절', '2027-05-03': '대체공휴일(노동절)', '2027-05-05': '어린이날', '2027-05-13': '부처님오신날', '2027-06-06': '현충일', '2027-07-17': '제헌절', '2027-07-19': '대체공휴일(제헌절)', '2027-08-15': '광복절', '2027-08-16': '대체공휴일(광복절)', '2027-09-14': '추석 연휴', '2027-09-15': '추석', '2027-09-16': '추석 연휴', '2027-10-03': '개천절', '2027-10-04': '대체공휴일(개천절)', '2027-10-09': '한글날', '2027-10-11': '대체공휴일(한글날)', '2027-12-25': '성탄절', '2027-12-27': '대체공휴일(성탄절)',
}
export type DayKind = 'weekday' | 'sat' | 'sun' | 'holiday'
/** 그날이 평일·토요일·일요일·공휴일 중 무엇인지(공휴일이 토요일이어도 공휴일로) */
export function dayKind(date: string): DayKind {
  if (HOLIDAYS[date]) return 'holiday'
  const d = new Date(`${date}T00:00:00Z`).getUTCDay()
  return d === 0 ? 'sun' : d === 6 ? 'sat' : 'weekday'
}
