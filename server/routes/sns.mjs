// 체험단 SNS 선발 — 주소 목록을 받아 서버가 천천히 돌며 숫자를 모은다.
//
// - 작업(job)은 데이터 폴더에 저장해 서버가 다시 켜져도 이어서 한다. 창을 닫아도 계속 돈다.
// - 블로그는 몇 분, 인스타그램은 공식 API 한도(시간당 약 200번)에 맞춰 한 계정에 약 19초씩.
// - 서버로는 SNS 아이디만 온다. 지원자 이름·연락처는 브라우저에만 있다.
// - 쓸 수 있는 사람: 관리자·스탭·직원 계정, 팀 코드로 들어온 사람(견적서와 같은 팀 코드), 사내망 모드.
import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { AI_MODEL, AiError, applyDraft, blogEvidence, checkKey, draftScores, igEvidence, makeClient, normalizeDraft, SYSTEM as AI_GUIDE, withReviewLink } from '../lib/ai.mjs'
import { BLOG_ID_RE, connectInstagram, fetchBlog, fetchIgApi, fetchIgPage, IG_USER_RE, resolveNaverMe, SnsError } from '../lib/sns.mjs'

const IG_API_GAP_MS = 19_000 // 시간당 약 190번
const IG_PAGE_GAP_MS = 6_000
const BLOG_GAP_MS = 400
const RATE_PAUSE_MS = 15 * 60_000
const CACHE_TTL_MS = 3 * 24 * 3600_000
const MAX_ITEMS = 3000
const JOB_ID_RE = /^[a-f0-9]{16}$/

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return fallback
    throw err
  }
}
async function writeJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
  await fsp.writeFile(tmp, JSON.stringify(value), 'utf8')
  await fsp.rename(tmp, file)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export default async function snsRoutes(app, ctx) {
  const { requireAdmin, isAdmin, currentUser, DATA_DIR, TRUSTED } = ctx
  const DIR = path.join(DATA_DIR, 'sns')
  const CONFIG = path.join(DIR, 'config.json')
  const CACHE = path.join(DIR, 'cache.json')
  const jobFile = (id) => path.join(DIR, 'jobs', `${id}.json`)

  let config = await readJson(CONFIG, null)
  // AI 점수 초안: Railway 변수 ANTHROPIC_API_KEY 가 있으면 그것, 없으면 관리자 화면에서 넣은 키
  const AI_FILE = path.join(DIR, 'ai.json')
  let aiSaved = await readJson(AI_FILE, null)
  const aiKey = () => process.env.ANTHROPIC_API_KEY || aiSaved?.apiKey || ''
  const cache = new Map(Object.entries(await readJson(CACHE, {})))
  const jobs = new Map()
  try {
    for (const f of await fsp.readdir(path.join(DIR, 'jobs'))) {
      if (!f.endsWith('.json')) continue
      const j = await readJson(path.join(DIR, 'jobs', f), null)
      if (j?.id) jobs.set(j.id, j)
    }
  } catch {
    // 아직 작업이 없다
  }

  async function allowed(req) {
    if (TRUSTED || isAdmin(req)) return true
    if (['member', 'staff', 'admin'].includes(currentUser?.(req)?.role)) return true
    return Boolean(await ctx.sessionTeam?.(req))
  }
  async function requireAllowed(req, res, next) {
    if (await allowed(req)) return next()
    res.status(401).json({ error: '직원 계정으로 로그인하거나 팀 코드로 들어와 주세요.' })
  }

  // ── 저장 ────────────────────────────────────────────────
  const dirty = new Set()
  let cacheDirty = false
  setInterval(async () => {
    for (const id of [...dirty]) {
      dirty.delete(id)
      const j = jobs.get(id)
      if (j) await writeJson(jobFile(id), j).catch(() => {})
    }
    if (cacheDirty) {
      cacheDirty = false
      const now = Date.now()
      for (const [k, v] of cache) if (now - v.at > CACHE_TTL_MS) cache.delete(k)
      await writeJson(CACHE, Object.fromEntries(cache)).catch(() => {})
    }
  }, 3000).unref()

  // ── 일꾼: 블로그 줄 · 인스타그램 줄 ─────────────────────
  const lane = { blog: { pauseUntil: 0, note: '' }, ig: { pauseUntil: 0, note: '' } }
  function nextItem(kind) {
    const list = [...jobs.values()].filter((j) => j.status === 'running').sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    for (const j of list) {
      const it = j.items.find((x) => x.kind === kind && x.state === 'wait')
      if (it) return { job: j, item: it }
    }
    return null
  }
  function finishIfDone(job) {
    if (job.status === 'running' && job.items.every((x) => x.state !== 'wait')) {
      job.status = 'done'
      job.finishedAt = new Date().toISOString()
    }
    dirty.add(job.id)
  }
  const fromCache = (key) => {
    const c = cache.get(key)
    return c && Date.now() - c.at < CACHE_TTL_MS ? c.data : null
  }

  async function runBlog() {
    for (;;) {
      const now = Date.now()
      if (lane.blog.pauseUntil > now) {
        await sleep(Math.min(lane.blog.pauseUntil - now, 30_000))
        continue
      }
      const next = nextItem('blog')
      if (!next) {
        await sleep(1500)
        continue
      }
      const { job, item } = next
      try {
        let id = item.key
        if (id.startsWith('naverme:')) id = await resolveNaverMe(id.slice(8))
        const cached = fromCache(`blog:${id}`)
        const data = cached ?? (await fetchBlog(id))
        if (!cached) {
          cache.set(`blog:${id}`, { at: Date.now(), data })
          cacheDirty = true
        }
        Object.assign(item, { state: 'done', id, data, error: null, at: new Date().toISOString() })
        lane.blog.note = ''
      } catch (err) {
        if (err.kind === 'rate' || err.kind === 'retry') {
          item.tries = (item.tries ?? 0) + 1
          if (item.tries >= 4) Object.assign(item, { state: 'fail', error: err.message })
          else if (err.kind === 'rate') {
            lane.blog.pauseUntil = Date.now() + 5 * 60_000
            lane.blog.note = '네이버가 잠시 쉬어 달라고 해서 5분 뒤 이어 합니다.'
          }
        } else Object.assign(item, { state: 'fail', error: err.message ?? String(err) })
      }
      finishIfDone(job)
      await sleep(BLOG_GAP_MS)
    }
  }

  async function runIg() {
    for (;;) {
      const now = Date.now()
      if (lane.ig.pauseUntil > now) {
        await sleep(Math.min(lane.ig.pauseUntil - now, 30_000))
        continue
      }
      const next = nextItem('ig')
      if (!next) {
        await sleep(1500)
        continue
      }
      const { job, item } = next
      const cached = fromCache(`ig:${item.key}`)
      // 캐시에 API 없이 읽은 결과만 있는데 지금 토큰이 있으면 API 로 다시 본다
      if (cached && !(cached.source === 'page' && config?.token && !cached.personal) && !item.fresh) {
        Object.assign(item, { state: 'done', data: cached, error: null, at: new Date().toISOString() })
        finishIfDone(job)
        continue
      }
      let gap = IG_PAGE_GAP_MS
      try {
        let data = null
        if (config?.token && config?.igUserId) {
          gap = IG_API_GAP_MS
          try {
            data = await fetchIgApi(item.key, config)
          } catch (err) {
            if (err.kind !== 'personal') throw err
            await sleep(1500)
            data = { ...(await fetchIgPage(item.key)), personal: true, reason: 'personal', apiError: err.message }
          }
        } else data = { ...(await fetchIgPage(item.key)), reason: 'no-api' }
        delete item.fresh
        cache.set(`ig:${item.key}`, { at: Date.now(), data })
        cacheDirty = true
        Object.assign(item, { state: 'done', data, error: null, at: new Date().toISOString() })
        lane.ig.note = ''
      } catch (err) {
        if (err.kind === 'rate') {
          lane.ig.pauseUntil = Date.now() + RATE_PAUSE_MS
          lane.ig.note = `${err.message}. ${new Date(lane.ig.pauseUntil).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' })}에 이어 합니다.`
        } else if (err.kind === 'token') {
          lane.ig.pauseUntil = Date.now() + 10 * 60_000
          lane.ig.note = `${err.message} — 관리자 화면 ‘SNS 연결’에서 토큰을 다시 넣어 주세요. 그동안 멈춰 있습니다.`
        } else if (err.kind === 'retry') {
          item.tries = (item.tries ?? 0) + 1
          if (item.tries >= 3) Object.assign(item, { state: 'fail', error: err.message })
        } else Object.assign(item, { state: 'fail', error: err.message ?? String(err) })
      }
      finishIfDone(job)
      await sleep(gap)
    }
  }
  // ── AI 점수 초안 일꾼(동시에 2명씩) ──
  const aiLane = { pauseUntil: 0, note: '' }
  const aiBusy = new Set()
  /** ‘수집하면서 AI 채점까지’로 만든 작업: 수집이 끝난 계정을 차례로 AI 줄에 세운다 */
  function feedAuto(j) {
    const auto = j.aiAuto
    if (!auto || auto.off) return
    j.aiQueue ??= []
    const queued = new Set(j.aiQueue.map((t) => `${t.kind}:${t.key}`))
    for (const it of j.items) {
      const id = `${it.kind}:${it.key}`
      if (it.state !== 'done' || queued.has(id) || j.evals?.[id]?.ai) continue
      const p = auto.people?.[id] ?? {}
      j.aiQueue.push({ kind: it.kind, key: it.key, motive: p.motive, reviewLink: it.kind === 'ig' ? p.reviewLink : undefined, autoApply: auto.autoApply })
      queued.add(id)
      dirty.add(j.id)
    }
  }
  function nextAi() {
    for (const j of [...jobs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      feedAuto(j)
      const q = j.aiQueue ?? []
      const i = q.findIndex((t) => !aiBusy.has(`${j.id}:${t.kind}:${t.key}`))
      if (i >= 0) return { job: j, target: q[i] }
    }
    return null
  }
  async function runAiOne(job, target) {
    const tag = `${job.id}:${target.kind}:${target.key}`
    aiBusy.add(tag)
    try {
      const it = job.items.find((x) => x.kind === target.kind && x.key === target.key)
      const now = Date.now()
      const evidence =
        target.kind === 'ig' ? await withReviewLink(await igEvidence(target.key, it?.data, now), target.reviewLink) : await blogEvidence(it?.id ?? target.key, it?.data, now)
      const draft = await draftScores(makeClient(aiKey()), { kind: target.kind, evidence, motive: target.motive })
      job.evals ??= {}
      const id = `${target.kind}:${target.key}`
      const ev = { ...(job.evals[id] ?? {}), ai: draft }
      // 맡길 때 ‘끝나면 바로 적용’을 골랐으면 적합성·리뷰 빈칸을 채운다
      job.evals[id] = target.autoApply ? applyDraft(ev, draft) : ev
      job.aiStats = { ...(job.aiStats ?? {}), done: (job.aiStats?.done ?? 0) + 1, cost: Math.round(((job.aiStats?.cost ?? 0) + draft.cost) * 10000) / 10000 }
      job.aiQueue = (job.aiQueue ?? []).filter((t) => !(t.kind === target.kind && t.key === target.key))
      aiLane.note = ''
    } catch (err) {
      if (err instanceof AiError && (err.kind === 'rate' || err.kind === 'auth')) {
        aiLane.pauseUntil = Date.now() + (err.kind === 'auth' ? 10 * 60_000 : 60_000)
        aiLane.note = err.message
      } else {
        job.evals ??= {}
        const id = `${target.kind}:${target.key}`
        job.evals[id] = { ...(job.evals[id] ?? {}), ai: { error: err.message ?? String(err), at: new Date().toISOString() } }
        job.aiStats = { ...(job.aiStats ?? {}), fail: (job.aiStats?.fail ?? 0) + 1 }
        job.aiQueue = (job.aiQueue ?? []).filter((t) => !(t.kind === target.kind && t.key === target.key))
      }
    } finally {
      aiBusy.delete(tag)
      dirty.add(job.id)
    }
  }
  async function runAi() {
    for (;;) {
      if (aiLane.pauseUntil > Date.now() || !aiKey() || aiBusy.size >= 2) {
        await sleep(1500)
        continue
      }
      const next = nextAi()
      if (!next) {
        await sleep(2000)
        continue
      }
      void runAiOne(next.job, next.target)
      await sleep(300)
    }
  }

  void runBlog()
  void runIg()
  void runAi()

  // ── 작업 API ────────────────────────────────────────────
  const brief = (j) => {
    const count = (kind, state) => j.items.filter((x) => x.kind === kind && (!state || x.state === state)).length
    return {
      id: j.id,
      title: j.title,
      createdAt: j.createdAt,
      finishedAt: j.finishedAt ?? null,
      status: j.status,
      ig: { total: count('ig'), done: count('ig', 'done'), fail: count('ig', 'fail') },
      blog: { total: count('blog'), done: count('blog', 'done'), fail: count('blog', 'fail') },
    }
  }
  const aiInfo = (j) => ({
    auto: Boolean(j.aiAuto && !j.aiAuto.off),
    // AI 채점까지 하는 작업에서 아직 수집 중이라 줄에 서지 않은 계정
    autoWaiting: j.aiAuto && !j.aiAuto.off && j.status === 'running' ? j.items.filter((x) => x.state === 'wait').length : 0,
    queued: (j.aiQueue ?? []).length,
    done: j.aiStats?.done ?? 0,
    fail: j.aiStats?.fail ?? 0,
    cost: j.aiStats?.cost ?? 0,
    note: aiLane.pauseUntil > Date.now() ? aiLane.note : '',
  })
  const laneInfo = () => ({
    ig: { paused: lane.ig.pauseUntil > Date.now(), note: lane.ig.note, gapMs: config?.token ? IG_API_GAP_MS : IG_PAGE_GAP_MS },
    blog: { paused: lane.blog.pauseUntil > Date.now(), note: lane.blog.note, gapMs: BLOG_GAP_MS },
  })

  app.get('/api/sns/status', async (req, res) => {
    const ok = await allowed(req)
    res.json({ allowed: ok, instagram: ok ? { connected: Boolean(config?.token), username: config?.igUsername ?? '', expiresAt: config?.expiresAt ?? null } : null, ai: ok ? { connected: Boolean(aiKey()), model: AI_MODEL } : null })
  })

  app.post('/api/sns/jobs', requireAllowed, async (req, res) => {
    const ig = Array.isArray(req.body?.instagram) ? req.body.instagram : []
    const blogs = Array.isArray(req.body?.blogs) ? req.body.blogs : []
    const igKeys = [...new Set(ig.map((v) => String(v).trim().replace(/^@/, '').toLowerCase()).filter((v) => IG_USER_RE.test(v)))]
    const blogKeys = [...new Set(blogs.map((v) => String(v).trim()).filter((v) => BLOG_ID_RE.test(v) || /^naverme:[a-z0-9]{3,20}$/i.test(v)).map((v) => (v.startsWith('naverme:') ? v : v.toLowerCase())))]
    if (!igKeys.length && !blogKeys.length) return res.status(400).json({ error: '읽을 수 있는 주소가 없습니다.' })
    if (igKeys.length + blogKeys.length > MAX_ITEMS) return res.status(400).json({ error: `한 번에 ${MAX_ITEMS}개까지 넣을 수 있습니다.` })
    const job = {
      id: crypto.randomBytes(8).toString('hex'),
      title: String(req.body?.title ?? '').slice(0, 80),
      createdAt: new Date().toISOString(),
      status: 'running',
      items: [...blogKeys.map((key) => ({ kind: 'blog', key, state: 'wait' })), ...igKeys.map((key) => ({ kind: 'ig', key, state: 'wait' }))],
    }
    // 수집하면서 AI 채점까지: 계정마다 지원동기·리뷰 링크(브라우저가 보낸다)를 받아 두고, 수집이 끝나는 대로 AI 줄에 세운다
    if (req.body?.ai && typeof req.body.ai === 'object') {
      if (!aiKey()) return res.status(400).json({ error: 'AI 키가 아직 없습니다. 관리자 화면 → ‘SNS 연결’에서 AI 키를 넣거나 ‘AI 채점까지’를 끄고 시작해 주세요.' })
      const ids = new Set(job.items.map((x) => `${x.kind}:${x.key}`))
      const people = {}
      for (const [id, v] of Object.entries(req.body.ai.people ?? {})) {
        if (!ids.has(id) || !v || typeof v !== 'object') continue
        people[id] = {
          motive: typeof v.motive === 'string' ? v.motive.slice(0, 3000) : undefined,
          reviewLink: typeof v.reviewLink === 'string' ? v.reviewLink.slice(0, 500) : undefined,
        }
      }
      job.aiAuto = { autoApply: req.body.ai.autoApply !== false, people }
    }
    jobs.set(job.id, job)
    await writeJson(jobFile(job.id), job)
    res.json({ job: brief(job) })
  })

  app.get('/api/sns/jobs', requireAllowed, (_req, res) => {
    const list = [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30).map(brief)
    res.json({ jobs: list, lanes: laneInfo() })
  })

  app.get('/api/sns/jobs/:id', requireAllowed, (req, res) => {
    const j = JOB_ID_RE.test(req.params.id) ? jobs.get(req.params.id) : null
    if (!j) return res.status(404).json({ error: '없는 작업입니다.' })
    res.json({ job: { ...brief(j), items: j.items, evals: j.evals ?? {}, ai: aiInfo(j) }, lanes: laneInfo() })
  })

  app.post('/api/sns/jobs/:id/stop', requireAllowed, (req, res) => {
    const j = JOB_ID_RE.test(req.params.id) ? jobs.get(req.params.id) : null
    if (!j) return res.status(404).json({ error: '없는 작업입니다.' })
    if (j.status === 'running') j.status = 'stopped'
    dirty.add(j.id)
    res.json({ job: brief(j) })
  })
  app.post('/api/sns/jobs/:id/resume', requireAllowed, (req, res) => {
    const j = JOB_ID_RE.test(req.params.id) ? jobs.get(req.params.id) : null
    if (!j) return res.status(404).json({ error: '없는 작업입니다.' })
    // 실패한 것도 다시 해 본다
    for (const it of j.items) if (it.state === 'fail') Object.assign(it, { state: 'wait', error: null, tries: 0 })
    j.status = 'running'
    delete j.finishedAt
    finishIfDone(j)
    res.json({ job: brief(j) })
  })
  /** API 연결 전에 팔로워만 읽은 인스타그램 계정을 API 로 다시 읽는다(반응까지) */
  app.post('/api/sns/jobs/:id/recheck', requireAllowed, (req, res) => {
    const j = JOB_ID_RE.test(req.params.id) ? jobs.get(req.params.id) : null
    if (!j) return res.status(404).json({ error: '없는 작업입니다.' })
    if (!config?.token) return res.status(400).json({ error: '인스타그램 API 가 아직 연결되지 않았습니다. 관리자 화면 ‘SNS 연결’에서 먼저 연결해 주세요.' })
    let n = 0
    for (const it of j.items) {
      if (it.kind !== 'ig' || it.state === 'wait') continue
      if (it.state === 'fail' || (it.data?.source === 'page' && !it.data?.personal)) {
        Object.assign(it, { state: 'wait', error: null, tries: 0, fresh: true })
        cache.delete(`ig:${it.key}`)
        n++
      }
    }
    cacheDirty = true
    if (n) {
      j.status = 'running'
      delete j.finishedAt
    }
    dirty.add(j.id)
    res.json({ job: brief(j), count: n })
  })
  /** 사람이 확인한 평가(적합성·리뷰·지원동기·메모·보류·직접 확인한 수치)를 계정별로 저장 */
  app.patch('/api/sns/jobs/:id/eval', requireAllowed, (req, res) => {
    const j = JOB_ID_RE.test(req.params.id) ? jobs.get(req.params.id) : null
    if (!j) return res.status(404).json({ error: '없는 작업입니다.' })
    const kind = req.body?.kind === 'blog' ? 'blog' : req.body?.kind === 'ig' ? 'ig' : null
    const key = typeof req.body?.key === 'string' ? req.body.key : ''
    if (!kind || !j.items.some((x) => x.kind === kind && (x.key === key || x.id === key))) return res.status(400).json({ error: '없는 계정입니다.' })
    const p = req.body?.patch ?? {}
    const score = (v, max) => (v === null ? null : typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v * 10) / 10)) : undefined)
    const count = (v) => (v === null ? null : typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v * 10) / 10 : undefined)
    const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : undefined)
    const bool = (v) => (typeof v === 'boolean' ? v : undefined)
    const clean = {
      fit: score(p.fit, 25),
      review: score(p.review, kind === 'ig' ? 20 : 30),
      motive: score(p.motive, 15),
      reviewDate: text(p.reviewDate, 10),
      reviewUrl: text(p.reviewUrl, 500),
      reviewFallback: bool(p.reviewFallback),
      memo: text(p.memo, 500),
      hold: bool(p.hold),
      aiApplied: bool(p.aiApplied),
      followers: count(p.followers),
      followersRaw: text(p.followersRaw, 20),
      visitors: count(p.visitors),
    }
    j.evals ??= {}
    const id = `${kind}:${key}`
    const next = { ...(j.evals[id] ?? {}) }
    for (const [k, v] of Object.entries(clean)) if (v !== undefined) next[k] = v
    next.by = typeof req.body?.by === 'string' ? req.body.by.slice(0, 30) : next.by
    next.at = new Date().toISOString()
    j.evals[id] = next
    dirty.add(j.id)
    res.json({ eval: next })
  })

  /** AI 점수 초안 맡기기: targets = [{ kind, key, motive?, reviewLink? }], autoApply(끝나면 빈칸에 바로 적용) (지원동기는 브라우저가 보낸다) */
  app.post('/api/sns/jobs/:id/ai', requireAllowed, (req, res) => {
    const j = JOB_ID_RE.test(req.params.id) ? jobs.get(req.params.id) : null
    if (!j) return res.status(404).json({ error: '없는 작업입니다.' })
    if (!aiKey()) return res.status(400).json({ error: 'AI 키가 아직 없습니다. 관리자 화면 → ‘SNS 연결’에서 AI 키를 넣어 주세요.' })
    const list = Array.isArray(req.body?.targets) ? req.body.targets.slice(0, 3000) : []
    j.aiQueue ??= []
    const queued = new Set(j.aiQueue.map((t) => `${t.kind}:${t.key}`))
    let n = 0
    for (const t of list) {
      const kind = t?.kind === 'blog' ? 'blog' : t?.kind === 'ig' ? 'ig' : null
      const key = typeof t?.key === 'string' ? t.key : ''
      if (!kind || queued.has(`${kind}:${key}`) || !j.items.some((x) => x.kind === kind && x.key === key && x.state === 'done')) continue
      j.aiQueue.push({
        kind,
        key,
        motive: typeof t.motive === 'string' ? t.motive.slice(0, 3000) : undefined,
        reviewLink: kind === 'ig' && typeof t.reviewLink === 'string' ? t.reviewLink.slice(0, 500) : undefined,
        autoApply: req.body?.autoApply === true,
      })
      queued.add(`${kind}:${key}`)
      n++
    }
    dirty.add(j.id)
    res.json({ queued: n, ai: aiInfo(j) })
  })
  /**
   * Max 요금제(Claude Code 대화)로 초안을 매길 때 쓰는 평가 자료 묶음.
   * 한 번에 25명까지: 공개 게시물 글과 사진 주소(사진은 받지 않음). 지원동기는 브라우저가 덧붙인다.
   */
  app.post('/api/sns/jobs/:id/ai-pack', requireAllowed, async (req, res) => {
    const j = JOB_ID_RE.test(req.params.id) ? jobs.get(req.params.id) : null
    if (!j) return res.status(404).json({ error: '없는 작업입니다.' })
    const list = (Array.isArray(req.body?.targets) ? req.body.targets : []).slice(0, 25)
    const now = Date.now()
    const out = []
    let i = 0
    const worker = async () => {
      while (i < list.length) {
        const t = list[i++]
        const kind = t?.kind === 'blog' ? 'blog' : t?.kind === 'ig' ? 'ig' : null
        const it = kind && j.items.find((x) => x.kind === kind && x.key === t.key && x.state === 'done')
        if (!it) continue
        try {
          const ev =
            kind === 'ig'
              ? await withReviewLink(await igEvidence(it.key, it.data, now, { download: false }), typeof t.reviewLink === 'string' ? t.reviewLink.slice(0, 500) : '', { download: false })
              : await blogEvidence(it.id ?? it.key, it.data, now, { download: false })
          out.push({ kind, key: it.key, account: kind === 'ig' ? `https://www.instagram.com/${it.key}/` : `https://blog.naver.com/${it.id ?? it.key}`, evidence: ev.text, images: ev.imageUrls })
        } catch (err) {
          out.push({ kind, key: it.key, error: err.message ?? String(err) })
        }
      }
    }
    await Promise.all([worker(), worker(), worker()])
    res.json({ items: out, guide: AI_GUIDE })
  })

  /** Claude Code 대화에서 매긴 초안 결과 넣기: items = [{ kind, key, fit, review, motive, note }] */
  app.post('/api/sns/jobs/:id/ai-import', requireAllowed, (req, res) => {
    const j = JOB_ID_RE.test(req.params.id) ? jobs.get(req.params.id) : null
    if (!j) return res.status(404).json({ error: '없는 작업입니다.' })
    const list = Array.isArray(req.body?.items) ? req.body.items.slice(0, 5000) : []
    j.evals ??= {}
    let n = 0
    const skipped = []
    for (const r of list) {
      const kind = r?.kind === 'blog' ? 'blog' : r?.kind === 'ig' ? 'ig' : null
      const key = typeof r?.key === 'string' ? r.key : ''
      if (!kind || !j.items.some((x) => x.kind === kind && x.key === key)) {
        skipped.push(`${r?.kind}:${r?.key}`)
        continue
      }
      const id = `${kind}:${key}`
      j.evals[id] = { ...(j.evals[id] ?? {}), ai: normalizeDraft(kind, r) }
      n++
    }
    j.aiStats = { ...(j.aiStats ?? {}), done: (j.aiStats?.done ?? 0) + n }
    dirty.add(j.id)
    res.json({ imported: n, skipped: skipped.slice(0, 20), skippedCount: skipped.length })
  })

  app.post('/api/sns/jobs/:id/ai/stop', requireAllowed, (req, res) => {
    const j = JOB_ID_RE.test(req.params.id) ? jobs.get(req.params.id) : null
    if (!j) return res.status(404).json({ error: '없는 작업입니다.' })
    j.aiQueue = []
    // 수집하면서 이어 가던 AI 채점도 멈춘다(다시 하려면 ‘AI 로 채점하기’)
    if (j.aiAuto) j.aiAuto.off = true
    dirty.add(j.id)
    res.json({ ai: aiInfo(j) })
  })

  app.delete('/api/sns/jobs/:id', requireAllowed, async (req, res) => {
    const id = req.params.id
    if (!JOB_ID_RE.test(id)) return res.status(400).json({ error: '작업 번호가 올바르지 않습니다.' })
    jobs.delete(id)
    dirty.delete(id)
    await fsp.rm(jobFile(id), { force: true })
    res.json({ ok: true })
  })

  // ── 관리자: 인스타그램 API 연결 ──────────────────────────
  // 토큰·시크릿은 화면에 다시 보내지 않는다
  const adminView = () => ({
    connected: Boolean(config?.token),
    igUsername: config?.igUsername ?? '',
    igUserId: config?.igUserId ?? '',
    pageName: config?.pageName ?? '',
    appId: config?.appId ?? '',
    hasAppSecret: Boolean(config?.appSecret),
    savedAt: config?.savedAt ?? null,
    expiresAt: config?.expiresAt ?? null,
  })
  app.get('/api/admin/sns', requireAdmin, (_req, res) => res.json(adminView()))
  app.put('/api/admin/sns', requireAdmin, async (req, res) => {
    const field = (k, max) => (typeof req.body?.[k] === 'string' ? req.body[k].trim().slice(0, max) : '')
    const token = field('token', 2000)
    const igUserId = field('igUserId', 40)
    const appId = field('appId', 40)
    // 시크릿을 비워 두면 전에 저장한 것을 그대로 쓴다(같은 앱일 때)
    const appSecret = field('appSecret', 200) || (appId && appId === config?.appId ? config?.appSecret ?? '' : '')
    if (token.length < 20) return res.status(400).json({ error: '액세스 토큰을 붙여 넣어 주세요.' })
    if (igUserId && !/^\d{5,30}$/.test(igUserId)) return res.status(400).json({ error: 'IG 계정 ID 는 숫자로만 된 값입니다(예: 17841400000000000).' })
    if (appId && !/^\d{5,30}$/.test(appId)) return res.status(400).json({ error: '앱 ID 는 숫자로만 된 값입니다.' })
    if (appSecret && !appId) return res.status(400).json({ error: '앱 시크릿을 쓰려면 앱 ID 도 넣어 주세요.' })
    try {
      const { exchanged, ...next } = await connectInstagram({ token, igUserId, appId, appSecret })
      config = { ...next, savedAt: new Date().toISOString() }
      await writeJson(CONFIG, config)
      lane.ig.pauseUntil = 0
      lane.ig.note = ''
      res.json({ ...adminView(), exchanged })
    } catch (err) {
      res.status(400).json({ error: err instanceof SnsError ? err.message : `확인하지 못했습니다: ${err.message}` })
    }
  })
  // ── 관리자: AI 키(점수 초안) ──
  app.get('/api/admin/ai', requireAdmin, (_req, res) => {
    res.json({ connected: Boolean(aiKey()), fromEnv: Boolean(process.env.ANTHROPIC_API_KEY), model: AI_MODEL, savedAt: aiSaved?.savedAt ?? null, hint: aiKey() ? `…${aiKey().slice(-4)}` : '' })
  })
  app.put('/api/admin/ai', requireAdmin, async (req, res) => {
    const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : ''
    if (apiKey.length < 20) return res.status(400).json({ error: 'AI 키를 붙여 넣어 주세요.' })
    try {
      await checkKey(apiKey)
    } catch (err) {
      return res.status(400).json({ error: err.message })
    }
    aiSaved = { apiKey, savedAt: new Date().toISOString() }
    await writeJson(AI_FILE, aiSaved)
    aiLane.pauseUntil = 0
    aiLane.note = ''
    res.json({ connected: true, fromEnv: Boolean(process.env.ANTHROPIC_API_KEY), model: AI_MODEL, savedAt: aiSaved.savedAt, hint: `…${apiKey.slice(-4)}` })
  })
  app.delete('/api/admin/ai', requireAdmin, async (_req, res) => {
    aiSaved = null
    await fsp.rm(AI_FILE, { force: true })
    res.json({ ok: true })
  })

  app.delete('/api/admin/sns', requireAdmin, async (_req, res) => {
    config = null
    await fsp.rm(CONFIG, { force: true })
    res.json({ ok: true })
  })
}
