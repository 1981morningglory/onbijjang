/**
 * 체험단 선발 가이드(모닝글로리 5겹 화장지)에 따른 점수·순위·추천.
 *
 * [인스타그램 100] 팔로워 40(구간) · 살림·리빙·육아 적합성 25 · 제품 리뷰 표현력 20 · 지원동기 15
 * [네이버 블로그 100] 완료된 날짜 일평균 방문자 30(구간) · 제품 리뷰 품질 30 · 적합성 25 · 지원동기 15
 *
 * - 확인 안 된 항목은 null(빈칸). 0점으로 만들거나 100점으로 환산하지 않는다.
 * - 모든 항목이 확인된 지원자만 총점·정식 순위. 나머지는 '확인 항목 소계 / 확인된 배점 합계'.
 * - 같은 채널 안에서만 정렬한다. 동점 규칙은 채널마다 다르고, 마지막은 접수 순서.
 */
import type { Applicant } from './parse'

// ── 서버가 모아 오는 숫자 ─────────────────────────────────
export interface IgPost {
  caption: string
  permalink: string
  timestamp: string
  mediaType: string
}
export interface IgData {
  source: 'api' | 'page'
  personal?: boolean
  reason?: 'no-api' | 'personal'
  apiError?: string
  name: string
  followers: number | null
  /** 화면에 보인 그대로의 표기(예: 12.5K, 1.2만). API 로 읽으면 정확한 숫자 */
  followersRaw?: string
  /** 축약 표기를 환산한 근사값인지 */
  followersApprox?: boolean
  following: number | null
  mediaCount: number | null
  /** 최근 게시물(API 로 읽은 비즈니스·크리에이터 계정만) — 평가할 때 참고 */
  posts?: IgPost[]
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
  /** 서버가 읽은 때(ISO) */
  at?: string
}

/** AI 점수 초안(담당자가 적용해야 점수로 쓰인다). score 가 null 이면 AI 도 판단하지 못한 항목 */
export interface AiDraft {
  fit?: { score: number | null; reason: string }
  review?: { score: number | null; reason: string; url?: string; date?: string; recent?: boolean }
  motive?: { score: number | null; reason: string; keywords?: string[] }
  note?: string
  model?: string
  cost?: number
  at?: string
  error?: string
}

/** 사람이 확인해 적는 평가(서버에 저장, 팀이 함께 본다) */
export interface Eval {
  /** AI 점수 초안 */
  ai?: AiDraft
  /** 담당자가 AI 초안을 확인하고 적용했는지 */
  aiApplied?: boolean
  /** 살림·리빙·육아 콘텐츠 적합성 0~25 */
  fit?: number | null
  /** 리뷰 표현력(인스타 0~20) · 리뷰 품질(블로그 0~30) */
  review?: number | null
  /** 지원동기 0~15. 비워 두면 자동 판단 점수를 쓴다 */
  motive?: number | null
  reviewDate?: string
  reviewUrl?: string
  /** 리뷰가 아니라 최근 30일 게시물로 평가했는지 */
  reviewFallback?: boolean
  memo?: string
  /** 보류(계정 주소 불분명 등) */
  hold?: boolean
  /** 자동으로 못 읽었을 때 사람이 확인해 넣은 팔로워 수 */
  followers?: number | null
  followersRaw?: string
  /** 자동으로 못 읽었을 때 사람이 확인해 넣은 일평균 방문자 수 */
  visitors?: number | null
}

export const MAX = {
  ig: { followers: 40, fit: 25, review: 20, motive: 15 },
  blog: { visitors: 30, review: 30, fit: 25, motive: 15 },
} as const
export const TARGET = { ig: 60, blog: 70 } as const

// ── 구간 점수 ─────────────────────────────────────────────
/** 팔로워 → 40점 구간. 확인된 0명은 0점, 모르면 null */
export function followerScore(n: number | null | undefined): number | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null
  if (n <= 0) return 0
  if (n < 1000) return 8
  if (n < 3000) return 16
  if (n < 5000) return 24
  if (n < 10000) return 32
  return 40
}

/** 블로그 일평균 방문자 → 30점 구간. 확인된 0명은 0점, 모르면 null */
export function visitorScore(avg: number | null | undefined): number | null {
  if (typeof avg !== 'number' || !Number.isFinite(avg)) return null
  if (avg <= 0) return 0
  if (avg < 100) return 6
  if (avg < 300) return 12
  if (avg < 500) return 18
  if (avg < 1000) return 24
  return 30
}

/** 서버 시각(ISO) → 한국 날짜 YYYY-MM-DD */
export function kstDate(iso: string | undefined): string {
  const t = iso ? Date.parse(iso) : Date.now()
  return new Date((Number.isFinite(t) ? t : Date.now()) + 9 * 3600_000).toISOString().slice(0, 10)
}

/** 오늘(읽은 날)을 뺀, 완료된 날짜들의 방문자와 평균. 공개되지 않았으면 null */
export function completedVisitors(d: BlogData, readAt?: string): { days: Array<{ date: string; cnt: number }>; avg: number | null } {
  const today = kstDate(readAt)
  const days = d.visitors.filter((v) => v.date < today)
  if (!days.length) return { days, avg: null }
  return { days, avg: Math.round((days.reduce((s, v) => s + v.cnt, 0) / days.length) * 10) / 10 }
}

// ── 지원동기: 키워드와 자동 판단 ───────────────────────────
const MOTIVE_GROUPS: Array<{ name: string; words: RegExp }> = [
  { name: '제품', words: /화장지|휴지|두루마리|5겹|오겹|도톰|먼지|보풀|흡수|부드|모닝글로리/g },
  { name: '생활', words: /살림|리빙|육아|아이|아기|가족|엄마|주부|자취|집안|화장실|생활용품|인테리어|위생/g },
  { name: '리뷰 계획', words: /리뷰|후기|사진|영상|릴스|블로그|인스타|포스팅|콘텐츠|촬영|비교|장단점|솔직/g },
]
const STOP = new Set(['합니다', '있습니다', '싶습니다', '입니다', '그리고', '정말', '너무', '항상', '이번', '체험단', '지원', '선정', '되어', '하고', '해서', '저는', '제가'])

/** 지원동기 주요 키워드(최대 6개) */
export function motiveKeywords(text: string | undefined): string[] {
  const t = (text ?? '').replace(/\s+/g, ' ')
  // 제품·생활·리뷰 계획에서 고르게 뽑는다(한 무리만 6개를 다 차지하지 않게)
  const byGroup = MOTIVE_GROUPS.map((g) => [...new Set([...t.matchAll(g.words)].map((m) => m[0]))])
  const out: string[] = []
  for (let i = 0; out.length < 6 && byGroup.some((l) => l[i] !== undefined); i++) for (const l of byGroup) if (l[i] !== undefined && out.length < 6) out.push(l[i])
  if (out.length < 6) {
    // 사전에 없는 말 중 자주 나온 2글자 이상 명사 비슷한 말
    const counts = new Map<string, number>()
    for (const w of t.split(/[^가-힣A-Za-z0-9]+/)) if (w.length >= 2 && !STOP.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1)
    for (const [w] of [...counts].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1])) if (out.length < 6 && !out.some((o) => w.includes(o))) out.push(w)
  }
  return out.slice(0, 6)
}

/**
 * 지원동기 자동 판단(15점). 근거가 드러난 만큼 점수를 준다:
 * 내용이 있으면 3, 제품을 구체적으로 말하면 +3, 생활(살림·육아 등) 맥락 +3, 리뷰 계획 +3, 충분히 구체적(띄어쓰기 빼고 60자 이상) +3.
 * 비어 있으면 0. 담당자가 직접 점수를 적으면 그 점수를 쓴다.
 */
export function suggestMotive(text: string | undefined): { score: number; reasons: string[] } {
  const t = (text ?? '').trim()
  if (!t) return { score: 0, reasons: ['지원동기 없음'] }
  let score = 3
  const reasons: string[] = []
  for (const g of MOTIVE_GROUPS) {
    g.words.lastIndex = 0
    if (g.words.test(t)) {
      score += 3
      reasons.push(g.name)
    }
    g.words.lastIndex = 0
  }
  if (t.replace(/\s/g, '').length >= 60) {
    score += 3
    reasons.push('구체적')
  }
  return { score: Math.min(15, score), reasons }
}

// ── 지원자 한 명(계정 하나)의 평가 ─────────────────────────
export type EvalStatus = 'complete' | 'partial' | 'hold' | 'failed'

export interface Candidate {
  kind: 'ig' | 'blog'
  key: string
  /** 대표 신청서(가장 먼저 접수) */
  rep?: Applicant
  /** 같은 계정으로 더 낸 신청서 */
  dupes: Applicant[]
  data?: IgData | BlogData
  error?: string | null
  ev: Eval
  /** 팔로워(인스타) — 확인값 */
  followers: number | null
  followersRaw: string
  followersApprox: boolean
  /** 블로그 완료일 평균 방문자 */
  visitorsAvg: number | null
  visitorDays: Array<{ date: string; cnt: number }>
  visitorsHidden: boolean
  /** 항목 점수(null = 미확인) */
  scores: { base: number | null; fit: number | null; review: number | null; motive: number | null }
  motiveAuto: boolean
  keywords: string[]
  status: EvalStatus
  missing: string[]
  subtotal: number
  confirmedMax: number
  total: number | null
  rank: number | null
  submittedAt: string
  notes: string[]
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const clamp = (v: number | null, max: number) => (v == null ? null : Math.max(0, Math.min(max, v)))

/** 접수 순서 비교: 응답일시 → 행 번호 */
export function applicantOrder(a?: Applicant, b?: Applicant) {
  const sa = a?.submittedAt ?? ''
  const sb = b?.submittedAt ?? ''
  if (sa !== sb) return sa ? (sb ? sa.localeCompare(sb) : -1) : 1
  return (a?.row ?? Infinity) - (b?.row ?? Infinity)
}

export function buildCandidate(kind: 'ig' | 'blog', key: string, item: JobItem | undefined, people: Applicant[], ev: Eval = {}): Candidate {
  const sorted = [...people].sort(applicantOrder)
  const rep = sorted[0]
  const dupes = sorted.slice(1)
  const m = MAX[kind]
  const notes: string[] = []
  let followers: number | null = null
  let followersRaw = ''
  let followersApprox = false
  let visitorsAvg: number | null = null
  let visitorDays: Array<{ date: string; cnt: number }> = []
  let visitorsHidden = false
  let base: number | null = null

  if (kind === 'ig') {
    const d = item?.state === 'done' ? (item.data as IgData) : undefined
    followers = num(ev.followers) ?? num(d?.followers)
    followersRaw = num(ev.followers) != null ? ev.followersRaw || String(ev.followers) : d?.followersRaw ?? (d?.followers != null ? String(d.followers) : '')
    followersApprox = num(ev.followers) != null ? /[kKmM만천.]/.test(ev.followersRaw ?? '') : Boolean(d?.followersApprox)
    if (num(ev.followers) != null) notes.push('팔로워 수 직접 확인')
    if (followersApprox) notes.push(`팔로워 축약 표기(${followersRaw}) 환산 근사값`)
    base = followerScore(followers)
  } else {
    const d = item?.state === 'done' ? (item.data as BlogData) : undefined
    if (num(ev.visitors) != null) {
      visitorsAvg = num(ev.visitors)
      notes.push('방문자 수 직접 확인')
    } else if (d) {
      const c = completedVisitors(d, item?.at)
      visitorDays = c.days
      visitorsAvg = c.avg
      if (c.avg == null) {
        visitorsHidden = true
        notes.push('방문자 통계 미공개')
      }
    }
    base = visitorScore(visitorsAvg)
  }
  if (item?.state === 'fail') notes.push(`자동 확인 실패: ${item.error ?? ''}`.trim())

  const auto = suggestMotive(rep?.motive)
  const motiveSet = num(ev.motive) != null
  const scores = {
    base,
    fit: clamp(num(ev.fit), m.fit),
    review: clamp(num(ev.review), m.review),
    // 지원동기는 신청서 글이 있으면 자동 판단으로 채우고, 담당자가 적으면 그 점수
    motive: motiveSet ? clamp(num(ev.motive), m.motive) : rep?.motive !== undefined ? auto.score : null,
  }
  const baseLabel = kind === 'ig' ? '팔로워' : '방문자'
  const labels: Array<[keyof typeof scores, string, number]> = [
    ['base', baseLabel, kind === 'ig' ? MAX.ig.followers : MAX.blog.visitors],
    ['fit', '콘텐츠 적합성', m.fit],
    ['review', kind === 'ig' ? '리뷰 표현력' : '리뷰 품질', m.review],
    ['motive', '지원동기', m.motive],
  ]
  const missing = labels.filter(([k]) => scores[k] == null).map(([, l]) => l)
  const subtotal = labels.reduce((s, [k]) => s + (scores[k] ?? 0), 0)
  const confirmedMax = labels.reduce((s, [k, , mx]) => s + (scores[k] == null ? 0 : mx), 0)
  if (ev.reviewFallback) notes.push('제품 리뷰가 없어 최근 30일 게시물로 평가')
  if (dupes.length) notes.push(`중복 지원 ${dupes.length}건(대표: ${rep?.row ? `${rep.row}행` : '첫 신청'})`)
  if (ev.memo?.trim()) notes.push(ev.memo.trim())

  let status: EvalStatus = missing.length ? 'partial' : 'complete'
  if (ev.hold) status = 'hold'
  else if (item?.state === 'fail' && missing.length) status = 'failed'

  return {
    kind,
    key,
    rep,
    dupes,
    data: item?.data,
    error: item?.error,
    ev,
    followers,
    followersRaw,
    followersApprox,
    visitorsAvg,
    visitorDays,
    visitorsHidden,
    scores,
    motiveAuto: !motiveSet && rep?.motive !== undefined,
    keywords: motiveKeywords(rep?.motive),
    status,
    missing,
    subtotal,
    confirmedMax,
    total: status === 'complete' ? subtotal : null,
    rank: null,
    submittedAt: rep?.submittedAt ?? '',
    notes,
  }
}

// ── 정렬·순위 ─────────────────────────────────────────────
const desc = (a: number | null, b: number | null) => (b ?? -1) - (a ?? -1)

/** 정식 순위(평가 완료자만). 동점 규칙: 인스타 적합성→표현력→동기→팔로워 / 블로그 방문자평균→리뷰→적합성→동기, 그다음 접수 순서 */
export function compareCandidates(a: Candidate, b: Candidate): number {
  const byTotal = desc(a.total ?? a.subtotal, b.total ?? b.subtotal)
  if (byTotal) return byTotal
  const chain =
    a.kind === 'ig'
      ? [desc(a.scores.fit, b.scores.fit), desc(a.scores.review, b.scores.review), desc(a.scores.motive, b.scores.motive), desc(a.followers, b.followers)]
      : [desc(a.visitorsAvg, b.visitorsAvg), desc(a.scores.review, b.scores.review), desc(a.scores.fit, b.scores.fit), desc(a.scores.motive, b.scores.motive)]
  for (const c of chain) if (c) return c
  return applicantOrder(a.rep, b.rep) || a.key.localeCompare(b.key)
}

/** 평가 완료자 → 정식 순위, 그 뒤에 일부 미확인(소계 순)·보류·실패 */
export function rankCandidates(list: Candidate[]): Candidate[] {
  const complete = list.filter((c) => c.status === 'complete').sort(compareCandidates)
  complete.forEach((c, i) => (c.rank = i + 1))
  const partial = list.filter((c) => c.status === 'partial').sort((a, b) => b.confirmedMax - a.confirmedMax || b.subtotal - a.subtotal || applicantOrder(a.rep, b.rep))
  const rest = list.filter((c) => c.status === 'hold' || c.status === 'failed').sort((a, b) => applicantOrder(a.rep, b.rep))
  for (const c of [...partial, ...rest]) c.rank = null
  return [...complete, ...partial, ...rest]
}

// ── 추천 ──────────────────────────────────────────────────
export interface Recommendation {
  kind: 'ig' | 'blog'
  target: number
  picked: Candidate[]
  shortfall: number
  shortfallReason: string
  /** 블로그: 방문자만 미확인인 후보(리뷰+적합성+동기 70점 소계 순) */
  visitorUnknown: Candidate[]
  /** 부족분을 채우는 조건부 추천 */
  conditional: Candidate[]
}

export function recommend(kind: 'ig' | 'blog', ranked: Candidate[], target: number): Recommendation {
  const complete = ranked.filter((c) => c.status === 'complete')
  const picked = complete.slice(0, target)
  const shortfall = Math.max(0, target - picked.length)
  const partial = ranked.filter((c) => c.status === 'partial').length
  const hold = ranked.filter((c) => c.status === 'hold' || c.status === 'failed').length
  const shortfallReason = shortfall
    ? `평가 완료 ${complete.length}명으로 목표 ${target}명에 ${shortfall}명 부족 — 일부 항목 미확인 ${partial}명, 보류·확인 실패 ${hold}명`
    : ''
  let visitorUnknown: Candidate[] = []
  let conditional: Candidate[] = []
  if (kind === 'blog') {
    visitorUnknown = ranked
      .filter((c) => c.status === 'partial' && c.scores.base == null && c.scores.review != null && c.scores.fit != null && c.scores.motive != null)
      .sort((a, b) => b.subtotal - a.subtotal || desc(a.scores.review, b.scores.review) || desc(a.scores.fit, b.scores.fit) || desc(a.scores.motive, b.scores.motive) || applicantOrder(a.rep, b.rep))
    conditional = shortfall ? visitorUnknown.slice(0, shortfall) : []
  }
  return { kind, target, picked, shortfall, shortfallReason, visitorUnknown, conditional }
}

export const STATUS_LABEL: Record<EvalStatus, string> = { complete: '평가 완료', partial: '일부 미확인', hold: '보류', failed: '확인 실패' }

/** AI 초안 중 아직 빈 항목만 채우는 수정분(담당자가 적은 점수는 덮어쓰지 않는다) */
export function aiPatch(c: Pick<Candidate, 'ev' | 'motiveAuto'>): Eval | null {
  const ai = c.ev.ai
  if (!ai || ai.error) return null
  const p: Eval = {}
  if (c.ev.fit == null && ai.fit?.score != null) p.fit = ai.fit.score
  if (c.ev.review == null && ai.review?.score != null) {
    p.review = ai.review.score
    if (!c.ev.reviewUrl && ai.review.url) p.reviewUrl = ai.review.url
    if (!c.ev.reviewDate && ai.review.date) p.reviewDate = ai.review.date
    if (ai.review.recent) p.reviewFallback = true
  }
  if (c.ev.motive == null && ai.motive?.score != null) p.motive = ai.motive.score
  if (!Object.keys(p).length) return null
  return { ...p, aiApplied: true }
}
