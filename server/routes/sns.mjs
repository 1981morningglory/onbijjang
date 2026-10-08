// 체험단 SNS 선발 — 주소 목록을 받아 서버가 천천히 돌며 숫자를 모은다.
//
// - 작업(job)은 데이터 폴더에 저장해 서버가 다시 켜져도 이어서 한다. 창을 닫아도 계속 돈다.
// - 블로그는 몇 분, 인스타그램은 공식 API 한도(시간당 약 200번)에 맞춰 한 계정에 약 19초씩.
// - 서버로는 SNS 아이디만 온다. 지원자 이름·연락처는 브라우저에만 있다.
// - 쓸 수 있는 사람: 관리자·스탭·직원 계정, 팀 코드로 들어온 사람(견적서와 같은 팀 코드), 사내망 모드.
import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { BLOG_ID_RE, discoverIgAccount, fetchBlog, fetchIgApi, fetchIgPage, IG_USER_RE, resolveNaverMe, SnsError, tokenExpiry } from '../lib/sns.mjs'

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
      // 캐시에 개인 계정(페이지) 결과만 있는데 지금 토큰이 있으면 API 로 다시 본다
      if (cached && !(cached.source === 'page' && config?.token && !cached.personal)) {
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
            data = { ...(await fetchIgPage(item.key)), personal: true }
          }
        } else data = await fetchIgPage(item.key)
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
  void runBlog()
  void runIg()

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
  const laneInfo = () => ({
    ig: { paused: lane.ig.pauseUntil > Date.now(), note: lane.ig.note, gapMs: config?.token ? IG_API_GAP_MS : IG_PAGE_GAP_MS },
    blog: { paused: lane.blog.pauseUntil > Date.now(), note: lane.blog.note, gapMs: BLOG_GAP_MS },
  })

  app.get('/api/sns/status', async (req, res) => {
    const ok = await allowed(req)
    res.json({ allowed: ok, instagram: ok ? { connected: Boolean(config?.token), username: config?.igUsername ?? '', expiresAt: config?.expiresAt ?? null } : null })
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
    res.json({ job: { ...brief(j), items: j.items }, lanes: laneInfo() })
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
  app.delete('/api/sns/jobs/:id', requireAllowed, async (req, res) => {
    const id = req.params.id
    if (!JOB_ID_RE.test(id)) return res.status(400).json({ error: '작업 번호가 올바르지 않습니다.' })
    jobs.delete(id)
    dirty.delete(id)
    await fsp.rm(jobFile(id), { force: true })
    res.json({ ok: true })
  })

  // ── 관리자: 인스타그램 API 연결 ──────────────────────────
  app.get('/api/admin/sns', requireAdmin, (_req, res) => {
    res.json({ connected: Boolean(config?.token), igUsername: config?.igUsername ?? '', pageName: config?.pageName ?? '', savedAt: config?.savedAt ?? null, expiresAt: config?.expiresAt ?? null })
  })
  app.put('/api/admin/sns', requireAdmin, async (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : ''
    if (token.length < 20) return res.status(400).json({ error: '액세스 토큰을 붙여 넣어 주세요.' })
    try {
      const acc = await discoverIgAccount(token)
      const expiresAt = await tokenExpiry(token)
      config = { token, ...acc, expiresAt, savedAt: new Date().toISOString() }
      await writeJson(CONFIG, config)
      lane.ig.pauseUntil = 0
      lane.ig.note = ''
      res.json({ connected: true, igUsername: acc.igUsername, pageName: acc.pageName, expiresAt, savedAt: config.savedAt })
    } catch (err) {
      res.status(400).json({ error: err instanceof SnsError ? err.message : `확인하지 못했습니다: ${err.message}` })
    }
  })
  app.delete('/api/admin/sns', requireAdmin, async (_req, res) => {
    config = null
    await fsp.rm(CONFIG, { force: true })
    res.json({ ok: true })
  })
}
