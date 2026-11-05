/**
 * 로또 6/45 — 지난 당첨번호 분석과 추천 조합.
 *
 * 로또는 매 회 독립적인 무작위 추첨이라 어떤 계산으로도 1등 확률(1/8,145,060)을 바꿀 수 없다.
 * 그래서 이 추천은 ‘당첨 확률’이 아니라 다음 두 가지를 노린다(화면에도 그대로 밝힌다).
 *  1) 지난 1등 번호들이 보여 온 모양(합계·홀짝·고저·AC값·연속·구간)에 맞는, 흔히 나오는 꼴의 조합
 *  2) 사람들이 많이 고르는 꼴(생일 번호만, 등차수열, 같은 끝수…)을 피해 당첨 때 나눠 갖는 사람이 적은 조합
 * 번호마다의 무게(장기 빈도·최근 흐름·쉬어 간 회차)는 아주 약하게만 섞는다(통계적으로 의미가 거의 없기 때문).
 */

export interface Draw {
  round: number
  date: string
  numbers: number[]
  bonus: number
  /** 어디서 왔나: seed(기본 자료) · auto(동행복권 자동) · excel(엑셀) · manual(건별 입력) */
  src?: 'seed' | 'auto' | 'excel' | 'manual'
  /** 넣은 시각 */
  at?: string | null
}

/** 회차의 추첨일(토요일, 1회 2002-12-07부터 매주) */
export const roundDate = (round: number) => new Date(Date.UTC(2002, 11, 7) + (round - 1) * 7 * 86400e3).toISOString().slice(0, 10)

/** 자료 점검: 추첨일이 회차와 맞지 않는 줄(엑셀에서 회차가 밀려 들어간 경우를 잡는다) */
export function dateMismatches(draws: Draw[]): Draw[] {
  return draws.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date) && Math.abs(new Date(d.date).getTime() - new Date(roundDate(d.round)).getTime()) > 3 * 86400e3)
}

export const NUMS = Array.from({ length: 45 }, (_, i) => i + 1)
/** 동행복권 공 색: 1~10 노랑, 11~20 파랑, 21~30 빨강, 31~40 회색, 41~45 초록 */
export const ballColor = (n: number) => (n <= 10 ? '#f5b800' : n <= 20 ? '#3a9ad9' : n <= 30 ? '#e5484d' : n <= 40 ? '#8a8f98' : '#4caf50')

// ── 조합 수 ──────────────────────────────────────────────
export function comb(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  let r = 1
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i
  return Math.round(r)
}
export const TOTAL_COMBOS = comb(45, 6) // 8,145,060
/** 한 게임이 당첨번호 6개 중 k개를 맞힐 확률(초가기하분포) */
export const matchProb = (k: number) => (comb(6, k) * comb(39, 6 - k)) / TOTAL_COMBOS

// ── 기본 통계 ─────────────────────────────────────────────
export function frequency(draws: Draw[], bonus = false): number[] {
  const c = new Array(46).fill(0)
  for (const d of draws) {
    for (const n of d.numbers) c[n]++
    if (bonus) c[d.bonus]++
  }
  return c
}

/** 카이제곱 적합도 검정: 45개 번호가 고르게 나왔는가(p 가 크면 ‘무작위와 다르다고 볼 근거 없음’) */
export function chiSquare(draws: Draw[]): { stat: number; df: number; p: number } {
  const c = frequency(draws)
  const e = (draws.length * 6) / 45
  const stat = NUMS.reduce((s, n) => s + (c[n] - e) ** 2 / (e || 1), 0)
  const df = 44
  return { stat, df, p: chiSquareSurvival(stat, df) }
}
/** 카이제곱 위꼬리 확률(Wilson–Hilferty 근사) */
export function chiSquareSurvival(x: number, k: number): number {
  if (x <= 0) return 1
  const z = (Math.cbrt(x / k) - (1 - 2 / (9 * k))) / Math.sqrt(2 / (9 * k))
  return 1 - normalCdf(z)
}
function normalCdf(z: number): number {
  // Abramowitz–Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2)
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-(z * z) / 2)
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2
}

/** 번호마다 쉬어 간 회차: 지금 몇 회째 안 나왔나·평균 간격·가장 길었던 간격 */
export function gaps(draws: Draw[]): Array<{ n: number; current: number; average: number; longest: number }> {
  const sorted = [...draws].sort((a, b) => a.round - b.round)
  return NUMS.map((n) => {
    const at = sorted.filter((d) => d.numbers.includes(n)).map((d) => d.round)
    const last = sorted.at(-1)?.round ?? 0
    const diffs = at.slice(1).map((r, i) => r - at[i])
    return {
      n,
      current: at.length ? last - at.at(-1)! : sorted.length,
      average: diffs.length ? diffs.reduce((s, v) => s + v, 0) / diffs.length : 0,
      longest: diffs.length ? Math.max(...diffs) : 0,
    }
  })
}

/** 함께 가장 자주 나온 두 번호 */
export function topPairs(draws: Draw[], k = 10): Array<{ a: number; b: number; count: number }> {
  const m = new Map<number, number>()
  for (const d of draws)
    for (let i = 0; i < 6; i++)
      for (let j = i + 1; j < 6; j++) {
        const [a, b] = [d.numbers[i], d.numbers[j]].sort((x, y) => x - y)
        m.set(a * 100 + b, (m.get(a * 100 + b) ?? 0) + 1)
      }
  return [...m]
    .sort((x, y) => y[1] - x[1] || x[0] - y[0])
    .slice(0, k)
    .map(([key, count]) => ({ a: Math.floor(key / 100), b: key % 100, count }))
}

// ── 조합의 모양 ───────────────────────────────────────────
export interface Shape {
  sum: number
  odd: number
  /** 23 이상(고) 개수 */
  high: number
  /** 연속번호 쌍 수(예: 5·6) */
  consecutive: number
  /** 가장 긴 연속 길이 */
  run: number
  /** AC값(산술 복잡도): 서로 다른 차이 수 − 5. 0~10 */
  ac: number
  /** 10단위 구간(1~10, 11~20, …, 41~45)마다 개수 */
  sections: number[]
  /** 끝수(일의 자리)가 같은 번호가 가장 많은 수 */
  sameEnd: number
}
export function shapeOf(nums: number[]): Shape {
  const s = [...nums].sort((a, b) => a - b)
  const diffs = new Set<number>()
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) diffs.add(s[j] - s[i])
  let consecutive = 0
  let run = 1
  let cur = 1
  for (let i = 1; i < 6; i++) {
    if (s[i] - s[i - 1] === 1) {
      consecutive++
      cur++
      run = Math.max(run, cur)
    } else cur = 1
  }
  const sections = [0, 0, 0, 0, 0]
  for (const n of s) sections[Math.min(4, Math.floor((n - 1) / 10))]++
  const ends = new Map<number, number>()
  for (const n of s) ends.set(n % 10, (ends.get(n % 10) ?? 0) + 1)
  return {
    sum: s.reduce((a, b) => a + b, 0),
    odd: s.filter((n) => n % 2).length,
    high: s.filter((n) => n >= 23).length,
    consecutive,
    run,
    ac: diffs.size - 5,
    sections,
    sameEnd: Math.max(...ends.values()),
  }
}

/** 값 목록의 백분위수 */
export function quantile(values: number[], q: number): number {
  const s = [...values].sort((a, b) => a - b)
  if (!s.length) return 0
  const i = (s.length - 1) * q
  const lo = Math.floor(i)
  return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo)
}

/** 지난 당첨번호의 모양 분포(추천 거르기·그래프에 쓴다) */
export function shapeStats(draws: Draw[]) {
  const shapes = draws.map((d) => shapeOf(d.numbers))
  const count = (f: (s: Shape) => number, max: number) => {
    const c = new Array(max + 1).fill(0)
    for (const s of shapes) c[Math.min(max, f(s))]++
    return c
  }
  return {
    n: shapes.length,
    sums: shapes.map((s) => s.sum),
    sumBand: [quantile(shapes.map((s) => s.sum), 0.1), quantile(shapes.map((s) => s.sum), 0.9)] as [number, number],
    odd: count((s) => s.odd, 6),
    high: count((s) => s.high, 6),
    ac: count((s) => s.ac, 10),
    consecutive: count((s) => s.consecutive, 5),
    /** 바로 전 회 번호가 몇 개 다시 나왔나 */
    repeat: (() => {
      const c = new Array(7).fill(0)
      const sorted = [...draws].sort((a, b) => a.round - b.round)
      for (let i = 1; i < sorted.length; i++) c[sorted[i].numbers.filter((n) => sorted[i - 1].numbers.includes(n)).length]++
      return c
    })(),
  }
}

// ── 추천 ─────────────────────────────────────────────────
/** 같은 씨앗이면 같은 수열(이번 주 추천이 누구에게나 같도록) */
export function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface NumberWeight {
  n: number
  /** 최종 무게(평균 1) */
  weight: number
  longTerm: number
  recent: number
  gapScore: number
}

/**
 * 번호마다 무게: 세 가지 신호를 표준점수로 만들어 약하게 섞는다(무게는 0.85~1.15 안쪽).
 * - 장기 빈도(전체 회차, 베이즈 수축으로 평균 쪽으로 당김)
 * - 최근 흐름(지수 가중 이동평균, 반감기 약 26회)
 * - 쉬어 간 회차(지금 간격이 평균 간격에 비해 얼마나 긴가)
 */
export function numberWeights(draws: Draw[]): NumberWeight[] {
  const sorted = [...draws].sort((a, b) => a.round - b.round)
  const N = sorted.length || 1
  const freq = frequency(sorted)
  const decay = 0.974
  const ew = new Array(46).fill(0)
  sorted.forEach((d, i) => {
    const w = decay ** (N - 1 - i)
    for (const n of d.numbers) ew[n] += w
  })
  const g = gaps(sorted)
  const z = (arr: number[]) => {
    const m = arr.reduce((s, v) => s + v, 0) / arr.length
    const sd = Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length) || 1
    return arr.map((v) => (v - m) / sd)
  }
  const prior = 200 // 베이즈 수축 강도(가상 회차 수)
  const lt = z(NUMS.map((n) => (freq[n] + (prior * 6) / 45) / (N + prior)))
  const rc = z(NUMS.map((n) => ew[n]))
  const gp = z(g.map((x) => (x.average ? x.current / x.average : 0)))
  const raw = NUMS.map((_, i) => Math.exp(0.05 * lt[i] + 0.06 * rc[i] + 0.04 * Math.tanh(gp[i])))
  const mean = raw.reduce((s, v) => s + v, 0) / raw.length
  return NUMS.map((n, i) => ({ n, weight: raw[i] / mean, longTerm: lt[i], recent: rc[i], gapScore: gp[i] }))
}

/** 사람들이 많이 고르는 꼴이면 벌점(당첨 때 나눠 갖는 사람이 많아진다) */
export function popularity(nums: number[]): { penalty: number; reasons: string[] } {
  const s = [...nums].sort((a, b) => a - b)
  const reasons: string[] = []
  if (s.every((n) => n <= 31)) reasons.push('모두 31 이하(생일 번호)')
  if (s.every((n) => n <= 12) || s.filter((n) => n <= 12).length >= 5) reasons.push('12 이하가 많음(월 번호)')
  const d = s.slice(1).map((n, i) => n - s[i])
  if (d.every((x) => x === d[0])) reasons.push('일정한 간격(등차)')
  if (shapeOf(s).sameEnd >= 4) reasons.push('끝수가 같은 번호가 많음')
  if (s.filter((n) => n % 7 === 0).length >= 4 || s.filter((n) => n % 5 === 0).length >= 4) reasons.push('배수 위주')
  // 용지 같은 세로줄(7칸 배열에서 같은 열) 4개 이상
  const colsOnSlip = new Map<number, number>()
  for (const n of s) colsOnSlip.set((n - 1) % 7, (colsOnSlip.get((n - 1) % 7) ?? 0) + 1)
  if (Math.max(...colsOnSlip.values()) >= 4) reasons.push('용지 한 줄로 몰림')
  return { penalty: reasons.length, reasons }
}

export interface Pick {
  numbers: number[]
  shape: Shape
  score: number
  /** 이 조합이 맞춘 지난 회차 모양(설명용) */
  notes: string[]
}

/**
 * 추천 조합 만들기.
 * 1) 번호 무게로 6개를 뽑는 몬테카를로 표본을 많이 만든다
 * 2) 지난 당첨번호 대부분(가운데 80%)이 들어가는 모양만 남긴다
 * 3) 모양이 흔할수록·인기 꼴이 아닐수록 점수가 높다
 * 4) 서로 3개 이상 겹치지 않고 한 번호는 두 게임까지만 들어가게 점수 순으로 고른다
 */
export function recommend(draws: Draw[], opts: { games?: number; seed?: number; samples?: number; mode?: 'top' | 'spread' } = {}): Pick[] {
  const games = opts.games ?? 5
  const rnd = seeded(opts.seed ?? 1)
  const sorted = [...draws].sort((a, b) => a.round - b.round)
  if (sorted.length < 30) return []
  const w = numberWeights(sorted)
  const st = shapeStats(sorted)
  const past = new Set(sorted.map((d) => [...d.numbers].sort((a, b) => a - b).join(',')))
  const last = sorted.at(-1)!.numbers
  const logP = (hist: number[], v: number) => Math.log((hist[Math.min(v, hist.length - 1)] + 1) / (st.n + hist.length))
  const sumHist = (() => {
    const bins = new Map<number, number>()
    for (const s of st.sums) bins.set(Math.floor(s / 10), (bins.get(Math.floor(s / 10)) ?? 0) + 1)
    return (sum: number) => Math.log(((bins.get(Math.floor(sum / 10)) ?? 0) + 1) / (st.n + 30))
  })()
  const samples = opts.samples ?? 20000
  const cand = new Map<string, Pick>()
  for (let t = 0; t < samples; t++) {
    // 무게 비례로 겹치지 않게 6개
    const pool = [...w]
    const pick: number[] = []
    for (let k = 0; k < 6; k++) {
      const total = pool.reduce((s, x) => s + x.weight, 0)
      let r = rnd() * total
      let idx = 0
      for (; idx < pool.length - 1; idx++) {
        r -= pool[idx].weight
        if (r <= 0) break
      }
      pick.push(pool[idx].n)
      pool.splice(idx, 1)
    }
    pick.sort((a, b) => a - b)
    const key = pick.join(',')
    if (cand.has(key) || past.has(key)) continue
    const sh = shapeOf(pick)
    // 지난 1등 번호 대부분이 들어가는 범위만
    if (sh.sum < st.sumBand[0] || sh.sum > st.sumBand[1]) continue
    if (sh.odd < 2 || sh.odd > 4 || sh.high < 2 || sh.high > 4) continue
    if (sh.ac < 7 || sh.run > 2 || Math.max(...sh.sections) > 3) continue
    if (pick.filter((n) => last.includes(n)).length > 2) continue
    const pop = popularity(pick)
    const score =
      pick.reduce((s, n) => s + Math.log(w[n - 1].weight), 0) * 3 +
      sumHist(sh.sum) +
      logP(st.odd, sh.odd) +
      logP(st.high, sh.high) +
      logP(st.ac, sh.ac) +
      logP(st.consecutive, sh.consecutive) -
      pop.penalty * 1.5
    cand.set(key, { numbers: pick, shape: sh, score, notes: pop.reasons })
  }
  const ranked = [...cand.values()].sort((a, b) => b.score - a.score)
  const out: Pick[] = []
  // 다섯 게임이 고르게 퍼지도록: 서로 3개 이상 겹치지 않고, 한 번호는 두 게임까지만
  const used = new Map<number, number>()
  const fits = (c: Pick) => out.every((o) => o.numbers.filter((n) => c.numbers.includes(n)).length <= 2) && c.numbers.every((n) => (used.get(n) ?? 0) < 2)
  const take = (c: Pick) => {
    out.push(c)
    for (const n of c.numbers) used.set(n, (used.get(n) ?? 0) + 1)
  }
  if (opts.mode === 'spread') {
    // 사람마다 다른 추천: 점수 위쪽 25%(최소 300개) 안에서 점수에 비례한 확률로 뽑는다
    const pool = ranked.slice(0, Math.max(300, Math.floor(ranked.length * 0.25)))
    const top = pool[0]?.score ?? 0
    let left = pool.map((c) => ({ c, w: Math.exp((c.score - top) / 2) }))
    while (out.length < games && left.length) {
      left = left.filter((x) => fits(x.c))
      const total = left.reduce((sum, x) => sum + x.w, 0)
      if (!total) break
      let r = rnd() * total
      const hit = left.find((x) => (r -= x.w) <= 0) ?? left[left.length - 1]
      take(hit.c)
      left = left.filter((x) => x !== hit)
    }
  }
  for (const c of ranked) {
    if (out.length >= games) break
    if (!out.includes(c) && fits(c)) take(c)
  }
  return out
}

/** 이번 주 추천의 씨앗: 다음 회차 × 접속자 번호(같은 사람은 그 주 내내 같은 추천, 사람마다 다른 추천) */
export const weekSeed = (nextRound: number, visitor = 0) => (Math.imul(nextRound, 2654435761) ^ Math.imul(visitor | 0, 0x9e3779b1)) >>> 0

/** 이 브라우저(접속자)의 번호 — 처음 들어올 때 무작위로 정해 브라우저에 둔다 */
export function visitorId(): number {
  const KEY = 'onbijjang.lotto.visitor'
  try {
    const v = Number(localStorage.getItem(KEY))
    if (Number.isInteger(v) && v > 0) return v
    const n = (crypto.getRandomValues(new Uint32Array(1))[0] || 1) >>> 0
    localStorage.setItem(KEY, String(n))
    return n
  } catch {
    return (crypto.getRandomValues(new Uint32Array(1))[0] || 1) >>> 0
  }
}

/**
 * 되짚어 보기(백테스트): 지난 n회마다 그 전 회차까지만으로 추천을 만들어 실제 당첨번호와 몇 개 맞았는지.
 * 무작위로 고른 조합의 기대값과 나란히 보여 준다.
 */
export function backtest(draws: Draw[], n = 52, games = 5): { rounds: number; games: number; hits: number[]; avg: number; expectedAvg: number; expected: number[] } {
  const sorted = [...draws].sort((a, b) => a.round - b.round)
  const hits = new Array(7).fill(0)
  let total = 0
  let sum = 0
  const start = Math.max(60, sorted.length - n)
  for (let i = start; i < sorted.length; i++) {
    const picks = recommend(sorted.slice(0, i), { games, seed: weekSeed(sorted[i].round), samples: 4000 })
    for (const p of picks) {
      const m = p.numbers.filter((x) => sorted[i].numbers.includes(x)).length
      hits[m]++
      sum += m
      total++
    }
  }
  return {
    rounds: sorted.length - start,
    games: total,
    hits,
    avg: total ? sum / total : 0,
    expectedAvg: 0.8,
    expected: Array.from({ length: 7 }, (_, k) => matchProb(k) * total),
  }
}

/** 다음 회차 번호·추첨일(토요일): 1회 2002-12-07 */
export function nextDraw(latest: Draw | undefined): { round: number; date: string } {
  const round = (latest?.round ?? 0) + 1
  const base = Date.UTC(2002, 11, 7)
  const d = new Date(base + (round - 1) * 7 * 86400e3)
  return { round, date: d.toISOString().slice(0, 10) }
}

/**
 * 엑셀(시트의 줄들)에서 회차·번호 6개·보너스 읽기.
 * - 우리 양식(회차, 번호1~6, 보너스, 추첨일)과 동행복권 ‘회차별 당첨번호’ 엑셀(회차와 번호 사이에 추첨일·당첨금 칸)을 모두 읽는다
 * - 머리줄에 ‘회차’ 칸이 있으면 그 칸을, 없으면 번호 7개 앞의 첫 회차다운 정수를 회차로 본다
 * - 한 줄에서 1~45 사이 서로 다른 수 7개가 이어진 곳(마지막 7칸 우선)을 번호 6개 + 보너스로 본다
 */
export function parseLottoRows(rows: unknown[][], maxRound: number): Draw[] {
  const num = (c: unknown) => (typeof c === 'number' ? c : /^\s*\d+\s*$/.test(String(c ?? '')) ? Number(String(c).trim()) : NaN)
  let roundCol = -1
  const out = new Map<number, Draw>()
  for (const row of rows) {
    const cells = Array.isArray(row) ? row : []
    const head = cells.findIndex((c) => /^\s*회\s*차\s*$/.test(String(c ?? '')))
    if (head >= 0) {
      roundCol = head
      continue
    }
    const v = cells.map(num)
    let at = -1
    for (let i = v.length - 7; i >= 0; i--) {
      const seven = v.slice(i, i + 7)
      if (seven.every((x) => Number.isInteger(x) && x >= 1 && x <= 45) && new Set(seven).size === 7) {
        at = i
        break
      }
    }
    if (at < 0) continue
    const okRound = (x: number) => Number.isInteger(x) && x >= 1 && x <= maxRound
    const round = roundCol >= 0 && roundCol < at && okRound(v[roundCol]) ? v[roundCol] : v.slice(0, at).find(okRound)
    if (!round) continue
    const dateCell = cells.map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : String(c ?? ''))).find((c) => /\d{4}[.\-/]\s?\d{1,2}[.\-/]\s?\d{1,2}/.test(c))
    const date = dateCell ? dateCell.replace(/\s/g, '').replace(/[./]/g, '-').replace(/-(\d)(?=-|$)/g, '-0$1').slice(0, 10) : ''
    out.set(round, { round, date, numbers: v.slice(at, at + 6).sort((a, b) => a - b), bonus: v[at + 6] })
  }
  return [...out.values()].sort((a, b) => a.round - b.round)
}

/** 회차 목록을 ‘1196~1248, 1250’처럼 줄여 쓰기 */
export function rangesText(list: number[]): string {
  const s = [...list].sort((a, b) => a - b)
  const parts: string[] = []
  for (let i = 0; i < s.length; ) {
    let j = i
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++
    parts.push(j > i ? `${s[i]}~${s[j]}` : String(s[i]))
    i = j + 1
  }
  return parts.join(', ')
}
