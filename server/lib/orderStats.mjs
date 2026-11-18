// 주문서만들기 — 통계 대시보드 계산(서버 라우트 server/routes/orders.mjs 와 시험이 함께 쓴다)
//
// 저장한 주문서(차수)의 줄을 기간으로 모아 숫자만 돌려준다(고객 이름·연락처·주소는 내보내지 않는다).
// - 주문 1건 = 쇼핑몰 + 주문번호. 같은 주문의 여러 줄(상품)은 한 건으로 센다.
// - 취소(취소내용이 [취소요청]·[취소완료])된 줄은 통계에서 빼고, 취소 건수로만 센다.
// - 날짜는 주문서 날짜(차수의 날짜). 요일도 그 날짜로.
// - 매출: 주문서에 결제금액(주문금액·총금액·판매금액) 칸이 있을 때만.

export const AMOUNT_RE = /결제\s*금액|주문\s*금액|총\s*금액|판매\s*금액|결제액/
const DATE_RE = /^20\d{2}-\d{2}-\d{2}$/
const str = (v) => (v == null ? '' : String(v).trim())
const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const n = Number(str(v).replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}
const digits = (v) => str(v).replace(/\D/g, '')

/** 시·도 이름 맞추기(주소 첫 낱말) */
const SIDO = [
  ['서울', /^서울/],
  ['부산', /^부산/],
  ['대구', /^대구/],
  ['인천', /^인천/],
  ['광주', /^광주(광역시|시)?$/],
  ['대전', /^대전/],
  ['울산', /^울산/],
  ['세종', /^세종/],
  ['경기', /^경기/],
  ['강원', /^강원/],
  ['충북', /^(충북|충청북)/],
  ['충남', /^(충남|충청남)/],
  ['전북', /^(전북|전라북)/],
  ['전남', /^(전남|전라남)/],
  ['경북', /^(경북|경상북)/],
  ['경남', /^(경남|경상남)/],
  ['제주', /^제주/],
]
export const REGIONS = SIDO.map(([n]) => n)

/** 주소 → { sido, city } — 모르는 주소는 sido '기타' */
export function region(address) {
  const words = str(address).replace(/^\(?\d{5}\)?\s*/, '').split(/\s+/).filter(Boolean)
  const first = words[0] ?? ''
  const hit = SIDO.find(([, re]) => re.test(first))
  if (!hit) return { sido: '기타', city: '' }
  const sido = hit[0]
  // 세종은 시·군·구가 없다. 경기 수원시 장안구 → ‘경기 수원시’
  const second = sido === '세종' ? '' : (words[1] ?? '')
  const city = /[시군구]$/.test(second) ? `${sido} ${second}` : sido
  return { sido, city }
}

/** 날짜 더하기(YYYY-MM-DD) */
export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400e3) + 1
const dow = (date) => new Date(`${date}T00:00:00Z`).getUTCDay()

const top = (map, key, n) => [...map.values()].sort((a, b) => b[key] - a[key] || (a.name ?? '').localeCompare(b.name ?? '')).slice(0, n)

/**
 * 기간 통계. batches: 저장한 차수들 [{ id, date, cols, rows }]
 * opts.detail=false 이면 합계(totals)만 — 지난 기간 비교용
 */
export function orderStats(batches, from, to, opts = {}) {
  const detail = opts.detail !== false
  const inRange = batches.filter((b) => DATE_RE.test(b.date) && b.date >= from && b.date <= to)
  const hasAmount = inRange.some((b) => b.cols?.some((c) => AMOUNT_RE.test(c)))

  const orders = new Map() // 주문 → { date, amount, qty, customer }
  const cancelled = new Set()
  const malls = new Map()
  const products = new Map()
  const regions = new Map()
  const cities = new Map()
  const customers = new Map() // 고객 → 주문 수
  let lines = 0
  let qty = 0
  let amount = 0

  for (const b of inRange) {
    const amountCol = b.cols?.find((c) => AMOUNT_RE.test(c)) ?? null
    b.rows.forEach((r, i) => {
      const mall = str(r['쇼핑몰']) || '(쇼핑몰 없음)'
      const orderKey = `${mall}|${str(r['주문번호']) || `${b.id}:${i}`}`
      if (str(r['취소내용'])) {
        cancelled.add(orderKey)
        return
      }
      const q = Number(r['수량']) || 0
      const a = amountCol ? num(r[amountCol]) : 0
      lines++
      qty += q
      amount += a
      const isNew = !orders.has(orderKey)
      const phone = [digits(r['전화번호1']), digits(r['전화번호2'])].find((p) => p.length >= 8)
      const customer = phone ?? `${str(r['수취인명'])}|${str(r['수취인주소'])}`
      const o = orders.get(orderKey) ?? { date: b.date, qty: 0, amount: 0, customer }
      o.qty += q
      o.amount += a
      orders.set(orderKey, o)
      if (isNew) customers.set(customer, (customers.get(customer) ?? 0) + 1)
      if (!detail) return

      const m = malls.get(mall) ?? { name: mall, orders: 0, qty: 0, amount: 0 }
      if (isNew) m.orders++
      m.qty += q
      m.amount += a
      malls.set(mall, m)

      const code = str(r['상품코드'])
      const name = str(r['상품명']) || str(r['상품명(수집/삭제)']) || '(상품명 없음)'
      const option = str(r['옵션'])
      const pk = code || `${name}|${option}`
      const p = products.get(pk) ?? { code, name, option, qty: 0, orders: new Set(), amount: 0 }
      p.name = name
      p.option = option
      p.qty += q
      p.orders.add(orderKey)
      p.amount += a
      products.set(pk, p)

      const { sido, city } = region(r['수취인주소'])
      const g = regions.get(sido) ?? { name: sido, orders: new Set(), qty: 0, amount: 0 }
      g.orders.add(orderKey)
      g.qty += q
      g.amount += a
      regions.set(sido, g)
      if (city && sido !== '기타') {
        const c = cities.get(city) ?? { name: city, orders: new Set(), qty: 0, amount: 0 }
        c.orders.add(orderKey)
        c.qty += q
        c.amount += a
        cities.set(city, c)
      }
    })
  }

  const totals = {
    orders: orders.size,
    lines,
    qty,
    amount: hasAmount ? amount : null,
    cancelled: [...cancelled].filter((k) => !orders.has(k)).length,
    customers: customers.size,
    repeatCustomers: [...customers.values()].filter((n) => n >= 2).length,
    malls: detail ? malls.size : undefined,
    products: detail ? products.size : undefined,
    batches: inRange.length,
    days: new Set(inRange.map((b) => b.date)).size,
  }
  if (!detail) return { from, to, hasAmount, totals }

  // 날짜별(빈 날도 0으로)
  const byDate = new Map()
  for (let d = from; d <= to; d = addDays(d, 1)) byDate.set(d, { date: d, orders: 0, qty: 0, amount: 0 })
  for (const o of orders.values()) {
    const x = byDate.get(o.date)
    if (!x) continue
    x.orders++
    x.qty += o.qty
    x.amount += o.amount
  }
  // 요일별(일 0 … 토 6) + 기간 안 그 요일 날 수(하루 평균용)
  const weekday = Array.from({ length: 7 }, (_, i) => ({ dow: i, orders: 0, qty: 0, amount: 0, days: 0 }))
  for (const x of byDate.values()) {
    const w = weekday[dow(x.date)]
    w.days++
    w.orders += x.orders
    w.qty += x.qty
    w.amount += x.amount
  }
  const flat = (x) => ({ ...x, orders: x.orders instanceof Set ? x.orders.size : x.orders })
  return {
    from,
    to,
    hasAmount,
    totals,
    daily: [...byDate.values()],
    weekday,
    malls: top(malls, 'orders', 30),
    products: [...products.values()].map(flat).sort((a, b) => b.qty - a.qty || b.orders - a.orders).slice(0, 30),
    regions: [...regions.values()].map(flat).sort((a, b) => b.orders - a.orders),
    cities: [...cities.values()].map(flat).sort((a, b) => b.orders - a.orders).slice(0, 12),
  }
}
