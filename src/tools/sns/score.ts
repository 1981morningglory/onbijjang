/**
 * 순위 매기기. 숫자마다 '지원자 안에서의 위치(백분위, 0~1)'를 구해 가중치를 곱한다.
 * 백분위를 쓰면 팔로워가 아주 많은 몇 사람 때문에 나머지 점수가 모두 0 근처로 눌리지 않는다.
 *
 * - 인스타그램: 팔로워 60 + 최근 게시물 10개 평균 반응(좋아요+댓글) 40
 *   반응을 못 읽은 계정(개인 계정)은 반응 점수 자리에 팔로워 백분위를 대신 쓰고 표시한다.
 * - 블로그: 최근 5일 평균 방문자 70 + 이웃 수 30
 */

export interface IgData {
  source: 'api' | 'page'
  personal?: boolean
  /** 반응을 못 읽은 까닭: API 연결 전에 모음 · 개인 계정 */
  reason?: 'no-api' | 'personal'
  apiError?: string
  name: string
  followers: number | null
  following: number | null
  mediaCount: number | null
  postsRead: number
  avgLikes: number | null
  avgComments: number | null
  avgEngagement: number | null
  hiddenLikes: boolean
  reels: number | null
  posts30d: number | null
  lastPostAt: string | null
}

export interface BlogData {
  name: string
  nick: string
  visitors: Array<{ date: string; cnt: number }>
  avgVisitors: number | null
  neighbors: number | null
  totalVisitors: number | null
  directory: string
  powerBlog: boolean
}

export interface JobItem {
  kind: 'ig' | 'blog'
  key: string
  id?: string
  state: 'wait' | 'done' | 'fail'
  data?: IgData | BlogData
  error?: string | null
}

export const WEIGHTS = { ig: { followers: 60, engagement: 40 }, blog: { visitors: 70, neighbors: 30 } } as const

/** 값들의 백분위(같은 값은 같은 백분위). 한 명뿐이면 1 */
export function percentiles(values: number[]): number[] {
  const n = values.length
  if (n <= 1) return values.map(() => 1)
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
  const out = new Array<number>(n)
  let i = 0
  while (i < n) {
    let j = i
    while (j + 1 < n && order[j + 1].v === order[i].v) j++
    const avgRank = (i + j) / 2
    for (let k = i; k <= j; k++) out[order[k].i] = avgRank / (n - 1)
    i = j + 1
  }
  return out
}

const r1 = (v: number) => Math.round(v * 10) / 10

/** 반응(좋아요·댓글)을 못 읽은 까닭. 예전 작업은 reason 이 없어 source 로 짐작한다 */
export function igMissingReason(d: IgData): 'no-api' | 'personal' | null {
  if (d.source === 'api') return null
  return d.reason ?? (d.personal ? 'personal' : 'no-api')
}
export const MISSING_LABEL = { 'no-api': 'API 연결 전 수집', personal: '개인 계정' } as const

export interface IgRow {
  key: string
  data: IgData
  followerScore: number
  engagementScore: number
  total: number
  /** 반응을 못 읽어 팔로워로 대신했는지 */
  substituted: boolean
  /** 참여율(%) = 평균 반응 ÷ 팔로워 */
  engagementRate: number | null
  rank: number
}

export function rankIg(items: Array<{ key: string; data: IgData }>): IgRow[] {
  const valid = items.filter((x) => typeof x.data.followers === 'number')
  const fp = percentiles(valid.map((x) => x.data.followers!))
  const withEng = valid.map((x, i) => ({ i, e: x.data.avgEngagement })).filter((x): x is { i: number; e: number } => typeof x.e === 'number')
  const ep = percentiles(withEng.map((x) => x.e))
  const engPct = new Map(withEng.map((x, k) => [x.i, ep[k]]))
  const rows = valid.map((x, i) => {
    const substituted = !engPct.has(i)
    const followerScore = r1(WEIGHTS.ig.followers * fp[i])
    const engagementScore = r1(WEIGHTS.ig.engagement * (substituted ? fp[i] : engPct.get(i)!))
    const f = x.data.followers!
    return {
      key: x.key,
      data: x.data,
      followerScore,
      engagementScore,
      total: r1(followerScore + engagementScore),
      substituted,
      engagementRate: !substituted && f > 0 ? Math.round(((x.data.avgEngagement ?? 0) / f) * 10000) / 100 : null,
      rank: 0,
    }
  })
  rows.sort((a, b) => b.total - a.total || (b.data.followers ?? 0) - (a.data.followers ?? 0) || a.key.localeCompare(b.key))
  rows.forEach((r, i) => (r.rank = i + 1))
  return rows
}

export interface BlogRow {
  key: string
  data: BlogData
  visitorScore: number
  neighborScore: number
  total: number
  rank: number
}

export function rankBlog(items: Array<{ key: string; data: BlogData }>): BlogRow[] {
  const valid = items.filter((x) => typeof x.data.avgVisitors === 'number' || typeof x.data.neighbors === 'number')
  const vp = percentiles(valid.map((x) => x.data.avgVisitors ?? 0))
  const np = percentiles(valid.map((x) => x.data.neighbors ?? 0))
  const rows = valid.map((x, i) => {
    const visitorScore = r1(WEIGHTS.blog.visitors * vp[i])
    const neighborScore = r1(WEIGHTS.blog.neighbors * np[i])
    return { key: x.key, data: x.data, visitorScore, neighborScore, total: r1(visitorScore + neighborScore), rank: 0 }
  })
  rows.sort((a, b) => b.total - a.total || (b.data.avgVisitors ?? 0) - (a.data.avgVisitors ?? 0) || a.key.localeCompare(b.key))
  rows.forEach((r, i) => (r.rank = i + 1))
  return rows
}
