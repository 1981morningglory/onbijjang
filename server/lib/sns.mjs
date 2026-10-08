// 체험단 선발 — SNS 숫자 읽기(서버 쪽, 순수 함수 + 가져오기).
// - 네이버 블로그: 방문자 그래프(최근 5일)와 이웃 수. 로그인 없이 공개된 값.
// - 인스타그램: Meta 공식 Graph API 의 Business Discovery(비즈니스·크리에이터 계정만).
//   개인 계정은 공개 프로필 페이지의 소개 문구에서 팔로워 수만 읽는다.

import crypto from 'node:crypto'

export const GRAPH = 'https://graph.facebook.com/v23.0'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'

export const BLOG_ID_RE = /^[a-z0-9_-]{2,40}$/i
export const IG_USER_RE = /^[a-z0-9._]{1,30}$/i

/** "1,205" · "12.5K" · "1.2M" · "1.5만" → 숫자 */
export function parseCount(text) {
  const t = String(text ?? '').trim().replace(/,/g, '')
  const m = /^([\d.]+)\s*([kKmM만천]?)/.exec(t)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  const mul = { k: 1e3, K: 1e3, m: 1e6, M: 1e6, 만: 1e4, 천: 1e3 }[m[2]] ?? 1
  return Math.round(n * mul)
}

/** 인스타그램 프로필 페이지의 og:description → { followers, following, posts } */
export function parseIgOg(html) {
  const m = /<meta[^>]+property="og:description"[^>]+content="([^"]*)"/i.exec(html) ?? /<meta[^>]+content="([^"]*)"[^>]+property="og:description"/i.exec(html)
  if (!m) return null
  const desc = m[1].replace(/&#x[0-9a-f]+;|&#\d+;|&\w+;/gi, ' ')
  const f = /([\d.,]+\s*[kKmM만천]?)\s*(?:Followers|팔로워)/i.exec(desc)
  if (!f) return null
  const g = /([\d.,]+\s*[kKmM만천]?)\s*(?:Following|팔로잉)/i.exec(desc)
  const p = /([\d.,]+\s*[kKmM만천]?)\s*(?:Posts|게시물)/i.exec(desc)
  return { followers: parseCount(f[1]), following: g ? parseCount(g[1]) : null, posts: p ? parseCount(p[1]) : null }
}

/** 네이버 방문자 그래프 XML → [{ date, cnt }] (보통 5일, 마지막은 오늘) */
export function parseVisitors(xml) {
  const out = []
  for (const m of String(xml).matchAll(/<visitorcnt\s+id="(\d{8})"\s+cnt="(\d+)"/g)) out.push({ date: `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6)}`, cnt: Number(m[2]) })
  return out
}

/** Business Discovery 결과 → 우리가 쓰는 숫자 */
export function summarizeIg(bd, now = Date.now()) {
  const media = Array.isArray(bd?.media?.data) ? bd.media.data.slice(0, 10) : []
  const likes = media.map((m) => (typeof m.like_count === 'number' ? m.like_count : 0))
  const comments = media.map((m) => (typeof m.comments_count === 'number' ? m.comments_count : 0))
  const n = media.length
  const avg = (a) => (n ? Math.round((a.reduce((s, v) => s + v, 0) / n) * 10) / 10 : null)
  const month = 30 * 24 * 3600 * 1000
  const times = media.map((m) => Date.parse(m.timestamp)).filter(Number.isFinite)
  return {
    source: 'api',
    name: bd?.name ?? '',
    followers: typeof bd?.followers_count === 'number' ? bd.followers_count : null,
    following: typeof bd?.follows_count === 'number' ? bd.follows_count : null,
    mediaCount: typeof bd?.media_count === 'number' ? bd.media_count : null,
    postsRead: n,
    avgLikes: avg(likes),
    avgComments: avg(comments),
    avgEngagement: n ? avg(likes.map((v, i) => v + comments[i])) : null,
    hiddenLikes: media.some((m) => typeof m.like_count !== 'number'),
    reels: media.filter((m) => m.media_product_type === 'REELS').length,
    posts30d: times.filter((t) => now - t <= month).length,
    lastPostAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
  }
}

export class SnsError extends Error {
  constructor(message, kind = 'fail', extra = {}) {
    super(message)
    this.kind = kind // 'fail' 이 계정만 실패 · 'rate' 잠시 쉬어야 함 · 'token' 토큰 문제
    Object.assign(this, extra)
  }
}

async function fetchText(url, opts = {}, timeoutMs = 15000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal, redirect: opts.redirect ?? 'follow' })
    return { res, text: opts.redirect === 'manual' ? '' : await res.text() }
  } catch (err) {
    throw new SnsError(err.name === 'AbortError' ? '응답이 늦어 건너뜀' : `연결 실패: ${err.message}`, 'retry')
  } finally {
    clearTimeout(timer)
  }
}

/** naver.me 짧은 주소 → 블로그 아이디 */
export async function resolveNaverMe(code) {
  const { res } = await fetchText(`https://naver.me/${encodeURIComponent(code)}`, { redirect: 'manual', headers: { 'User-Agent': UA } })
  const loc = res.headers.get('location') ?? ''
  const id = blogIdFromUrl(loc)
  if (!id) throw new SnsError('짧은 주소가 블로그로 이어지지 않음')
  return id
}

export function blogIdFromUrl(u) {
  const s = String(u ?? '')
  const q = /[?&]blogId=([a-z0-9_-]+)/i.exec(s)
  if (q) return q[1]
  const m = /(?:m\.)?blog\.naver\.com\/([a-z0-9_-]+)/i.exec(s)
  if (m && !/^(PostView|PostList|prologue|BlogHome)/i.test(m[1])) return m[1]
  const me = /([a-z0-9_-]+)\.blog\.me/i.exec(s)
  return me ? me[1] : null
}

/** 네이버 블로그 하나 읽기 */
export async function fetchBlog(blogId) {
  const headers = { 'User-Agent': UA, Referer: `https://m.blog.naver.com/${blogId}` }
  const [info, vis] = await Promise.all([
    fetchText(`https://m.blog.naver.com/api/blogs/${encodeURIComponent(blogId)}`, { headers }),
    fetchText(`https://blog.naver.com/NVisitorgp4Ajax.naver?blogId=${encodeURIComponent(blogId)}`, { headers: { ...headers, Referer: `https://blog.naver.com/${blogId}` } }),
  ])
  if (info.res.status === 429 || vis.res.status === 429) throw new SnsError('네이버가 잠시 쉬어 달라고 함', 'rate')
  let j = null
  try {
    j = JSON.parse(info.text)
  } catch {
    // 아래에서 처리
  }
  const r = j?.result
  if (!j?.isSuccess || !r) throw new SnsError('블로그를 찾을 수 없음(주소 확인)')
  const visitors = parseVisitors(vis.text)
  const avg = visitors.length ? Math.round((visitors.reduce((s, v) => s + v.cnt, 0) / visitors.length) * 10) / 10 : null
  return {
    name: r.blogName ?? '',
    nick: r.nickName ?? '',
    visitors,
    avgVisitors: avg,
    neighbors: typeof r.subscriberCount === 'number' ? r.subscriberCount : null,
    totalVisitors: typeof r.totalVisitorCount === 'number' ? r.totalVisitorCount : null,
    directory: r.blogDirectoryName ?? '',
    powerBlog: Boolean(r.powerBlog || r.isPowerBlogBadgeDisplay),
  }
}

/** Graph API 오류 → 어떤 종류인지 */
export function classifyGraphError(status, body) {
  const e = body?.error ?? {}
  const code = Number(e.code)
  if (status === 429 || [4, 17, 32, 613, 80002].includes(code)) return new SnsError('인스타그램 API 사용 한도에 닿아 잠시 쉼', 'rate')
  if (code === 190 || code === 102 || (code === 10 && /permission/i.test(e.message ?? '')) || code === 200) return new SnsError(`토큰 문제: ${e.message ?? '확인 필요'}`, 'token')
  // 110 / 100(2207013 등): 비즈니스·크리에이터 계정이 아니거나 없는 아이디
  if (code === 110 || code === 100 || code === 24) return new SnsError('비즈니스·크리에이터 계정이 아님', 'personal')
  return new SnsError(e.message ? `인스타그램 API: ${e.message}` : `인스타그램 API 응답 ${status}`)
}

const BD_FIELDS = 'username,name,followers_count,follows_count,media_count,media.limit(10){like_count,comments_count,timestamp,media_type,media_product_type}'

/** 앱 시크릿이 있으면 appsecret_proof 를 붙인다(앱 설정 '앱 시크릿 필요'가 켜져 있어도 되도록) */
function authQuery(token, appSecret) {
  const proof = appSecret ? `&appsecret_proof=${crypto.createHmac('sha256', appSecret).update(token).digest('hex')}` : ''
  return `access_token=${encodeURIComponent(token)}${proof}`
}
async function graphGet(pathQuery, { token, appSecret }, timeoutMs = 20000) {
  const { res, text } = await fetchText(`${GRAPH}/${pathQuery}${pathQuery.includes('?') ? '&' : '?'}${authQuery(token, appSecret)}`, {}, timeoutMs)
  let body = null
  try {
    body = JSON.parse(text)
  } catch {
    // 아래에서 처리
  }
  if (!res.ok || body?.error) throw classifyGraphError(res.status, body)
  return body
}

/** Business Discovery 로 한 계정 읽기 */
export async function fetchIgApi(username, cred) {
  const body = await graphGet(`${cred.igUserId}?fields=${encodeURIComponent(`business_discovery.username(${username}){${BD_FIELDS}}`)}`, cred)
  if (!body?.business_discovery) throw new SnsError('비즈니스·크리에이터 계정이 아님', 'personal')
  return summarizeIg(body.business_discovery)
}

/** 개인 계정: 공개 프로필 페이지에서 팔로워 수만 */
export async function fetchIgPage(username) {
  const { res, text } = await fetchText(`https://www.instagram.com/${encodeURIComponent(username)}/`, { headers: { 'User-Agent': 'facebookexternalhit/1.1', 'Accept-Language': 'en-US,en;q=0.8' } })
  if (res.status === 429) throw new SnsError('인스타그램이 잠시 쉬어 달라고 함', 'rate')
  if (res.status === 404) throw new SnsError('없는 계정(주소 확인)')
  const og = parseIgOg(text)
  if (!og || og.followers == null) throw new SnsError('공개 프로필에서 팔로워 수를 읽지 못함(비공개 계정이거나 주소 오류)')
  return { source: 'page', name: '', followers: og.followers, following: og.following, mediaCount: og.posts, postsRead: 0, avgLikes: null, avgComments: null, avgEngagement: null, hiddenLikes: false, reels: null, posts30d: null, lastPostAt: null }
}

/** 토큰으로 연결된 인스타그램 비즈니스 계정 찾기 */
export async function discoverIgAccount(cred) {
  // 사용자 토큰: 관리하는 페이지들 중 인스타그램이 연결된 것
  try {
    const pages = await graphGet('me/accounts?fields=name,instagram_business_account{id,username}&limit=100', cred)
    const hit = (pages.data ?? []).find((p) => p.instagram_business_account?.id)
    if (hit) return { igUserId: hit.instagram_business_account.id, igUsername: hit.instagram_business_account.username ?? '', pageName: hit.name ?? '' }
  } catch (err) {
    if (err.kind === 'token') throw err
  }
  // 페이지 토큰
  const me = await graphGet('me?fields=name,instagram_business_account{id,username}', cred)
  if (me.instagram_business_account?.id) return { igUserId: me.instagram_business_account.id, igUsername: me.instagram_business_account.username ?? '', pageName: me.name ?? '' }
  throw new SnsError('이 토큰으로는 연결된 인스타그램 비즈니스 계정을 찾지 못했습니다. ‘IG 계정 ID’ 칸에 계정 ID 를 넣거나, 토큰 권한(instagram_basic, pages_show_list, pages_read_engagement, business_management)을 확인해 주세요.', 'token')
}

/** 짧은 토큰(1시간) → 60일 토큰. 앱 ID·시크릿이 있어야 한다 */
export async function exchangeLongLived(token, appId, appSecret) {
  const { res, text } = await fetchText(`${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appSecret)}&fb_exchange_token=${encodeURIComponent(token)}`)
  let body = null
  try {
    body = JSON.parse(text)
  } catch {
    // 아래에서 처리
  }
  if (!res.ok || body?.error || !body?.access_token) throw classifyGraphError(res.status, body)
  return body.access_token
}

/** 토큰 만료일(알 수 있으면). 앱 ID·시크릿이 있으면 앱 토큰으로 확인한다 */
export async function tokenExpiry(token, appId, appSecret) {
  try {
    const checker = appId && appSecret ? `${appId}|${appSecret}` : token
    const { text } = await fetchText(`${GRAPH}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(checker)}`)
    const d = JSON.parse(text)?.data
    if (!d) return null
    if (d.expires_at === 0) return 'never'
    return d.expires_at ? new Date(d.expires_at * 1000).toISOString() : null
  } catch {
    return null
  }
}

/**
 * 관리자가 넣은 값으로 연결을 확인하고 저장할 설정을 만든다.
 * - IG… 로 시작하는 토큰(인스타그램 로그인 방식)은 다른 계정 조회(Business Discovery)를 못 한다.
 * - 앱 ID·시크릿이 있으면 60일 토큰으로 바꾸고, 모든 호출에 appsecret_proof 를 붙인다.
 * - IG 계정 ID 가 있으면 그대로 쓰고, 없으면 토큰으로 찾는다.
 * - 끝으로 우리 계정을 Business Discovery 로 한 번 읽어 실제로 되는지 본다.
 */
export async function connectInstagram({ token, igUserId, appId, appSecret }) {
  if (/^IG/i.test(token)) throw new SnsError('IG… 로 시작하는 토큰은 ‘인스타그램 로그인’ 방식이라 다른 사람 계정을 읽을 수 없습니다. 페이스북 로그인 방식(EAA… 로 시작) 토큰을 넣어 주세요(관리자 화면 오른쪽 순서 4~5번).', 'token')
  let tok = token
  let exchanged = false
  if (appId && appSecret) {
    try {
      tok = await exchangeLongLived(token, appId, appSecret)
      exchanged = tok !== token
    } catch (err) {
      if (err.kind === 'token' && /secret|client_id|app/i.test(err.message)) throw new SnsError(`앱 ID·앱 시크릿을 확인해 주세요: ${err.message}`, 'token')
      // 이미 바꿀 수 없는 토큰이면 그대로 쓴다
    }
  }
  const cred = { token: tok, appSecret: appSecret || undefined }
  let acc
  if (igUserId) {
    const b = await graphGet(`${encodeURIComponent(igUserId)}?fields=id,username,name`, cred)
    acc = { igUserId: String(b.id ?? igUserId), igUsername: b.username ?? '', pageName: b.name ?? '' }
  } else acc = await discoverIgAccount(cred)
  if (acc.igUsername) {
    try {
      await fetchIgApi(acc.igUsername, { ...cred, igUserId: acc.igUserId })
    } catch (err) {
      if (err.kind === 'token' || err.kind === 'personal') throw new SnsError(`계정은 찾았지만 다른 계정 조회(Business Discovery)가 막혀 있습니다: ${err.message}. 토큰 권한과 계정이 비즈니스·크리에이터인지 확인해 주세요.`, 'token')
    }
  }
  const expiresAt = await tokenExpiry(tok, appId, appSecret)
  return { token: tok, appId: appId || '', appSecret: appSecret || '', ...acc, expiresAt, exchanged }
}
