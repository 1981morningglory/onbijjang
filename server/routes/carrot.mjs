// 당근 — 힉스필드 API 로 이미지·영상을 만드는 생성기(스탭 이상).
//
// - 키: Railway 변수 HF_CREDENTIALS(키ID:비밀값) 또는 HF_API_KEY_ID + HF_API_KEY_SECRET → 없으면 관리자 화면에서 넣은 키(carrot/key.json).
// - 만든 결과는 로그인한 계정별로 데이터 폴더(carrot/files/<계정>/)에 내려받아 두고, 7일이 지나면 서버가 지운다.
// - 전체마스터(관리자)는 모든 계정의 라이브러리와 사용 용량을 볼 수 있다. 개인별 용량 제한은 두지 않는다.
// - ‘대화로 생성’은 체험단 선발과 같은 Claude 키로 프롬프트를 함께 다듬고, 생성은 사람이 버튼을 눌러야 시작한다.
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { AI_MODEL, makeClient } from '../lib/ai.mjs'
import { CATALOG, MODEL_BY_KEY, KEEP_DAYS, hfError, extFor, isExpired, outputUrls, planRequest, usageByOwner } from '../lib/carrot.mjs'

// 시험할 때만 HF_BASE_URL 로 가짜 서버를 가리킨다
const HF = process.env.HF_BASE_URL || 'https://api.higgsfield.ai'
const TERMINAL = new Set(['completed', 'failed', 'nsfw', 'canceled'])
const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_UPLOAD = 20 * 1024 * 1024
/** 한 요청을 기다리는 최대 시간(영상은 오래 걸린다) */
const MAX_WAIT_MS = 40 * 60e3

export default async function carrotRoutes(app, ctx) {
  const { requireAdmin, requireStaff, isAdmin, currentUser, DATA_DIR } = ctx
  const DIR = path.join(DATA_DIR, 'carrot')
  const FILES = path.join(DIR, 'files')
  const JOBS_FILE = path.join(DIR, 'jobs.json')
  const KEY_FILE = path.join(DIR, 'key.json')
  fs.mkdirSync(FILES, { recursive: true })

  const readJson = async (f, fb) => {
    try {
      return JSON.parse(await fsp.readFile(f, 'utf8'))
    } catch {
      return fb
    }
  }
  const writeJson = async (f, v) => {
    const tmp = `${f}.${process.pid}.tmp`
    await fsp.writeFile(tmp, JSON.stringify(v), 'utf8')
    await fsp.rename(tmp, f)
  }

  // ── 키 ──
  let saved = await readJson(KEY_FILE, null)
  const envCred = () => process.env.HF_CREDENTIALS || (process.env.HF_API_KEY_ID && process.env.HF_API_KEY_SECRET ? `${process.env.HF_API_KEY_ID}:${process.env.HF_API_KEY_SECRET}` : '')
  const credentials = () => envCred() || saved?.credentials || ''

  /** 힉스필드 호출. 실패하면 한국어 메시지를 가진 오류 */
  async function hf(pathname, { method = 'GET', body, idem, cred = credentials(), timeout = 30000 } = {}) {
    if (!cred) throw Object.assign(new Error('힉스필드 API 키가 아직 연결되지 않았습니다. 관리자에게 연결을 부탁해 주세요.'), { status: 0 })
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeout)
    try {
      const url = /^https?:\/\//.test(pathname) ? pathname : `${HF}${pathname}`
      const res = await fetch(url, {
        method,
        headers: { Authorization: `Key ${cred}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(idem ? { 'Idempotency-Key': idem } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      })
      const text = await res.text()
      let json = null
      try {
        json = text ? JSON.parse(text) : null
      } catch {
        // 아래에서 처리
      }
      if (!res.ok) throw Object.assign(new Error(hfError(res.status, json?.detail ?? text.slice(0, 200))), { status: res.status })
      return json
    } catch (err) {
      if (err.name === 'AbortError') throw Object.assign(new Error('힉스필드 응답이 늦습니다. 잠시 뒤 다시 해 주세요.'), { status: 0 })
      if (err.status !== undefined) throw err
      throw Object.assign(new Error(`힉스필드에 연결하지 못했습니다: ${err.message}`), { status: 0 })
    } finally {
      clearTimeout(t)
    }
  }

  // ── 라이브러리(작업 목록) ──
  /** @type {any[]} */
  let jobs = await readJson(JOBS_FILE, [])
  let saving = Promise.resolve()
  const save = () => (saving = saving.then(() => writeJson(JOBS_FILE, jobs)).catch((e) => console.error('[당근] 저장 실패', e.message)))

  const me = (req) => {
    const u = currentUser(req)
    return u ? { owner: u.id, ownerName: u.name || u.username, ownerUsername: u.username } : { owner: 'master', ownerName: '전체마스터', ownerUsername: 'admin' }
  }
  const okName = (s) => /^[a-z0-9]{1,40}$/.test(s)
  const fileUrl = (owner, file) => `/api/carrot/file/${owner}/${file}`
  const view = (j) => ({
    id: j.id,
    owner: j.owner,
    ownerName: j.ownerName,
    kind: j.kind,
    model: j.model,
    modelLabel: MODEL_BY_KEY[j.model]?.label ?? j.model,
    prompt: j.prompt,
    options: j.options,
    count: j.count,
    refs: j.refs ?? [],
    start: j.start ?? null,
    end: j.end ?? null,
    status: j.status,
    error: j.error ?? null,
    usd: j.usd ?? null,
    createdAt: j.createdAt,
    doneAt: j.doneAt ?? null,
    expiresAt: new Date(Date.parse(j.createdAt) + KEEP_DAYS * 864e5).toISOString(),
    items: (j.items ?? []).map((it) => ({ type: it.type, url: fileUrl(j.owner, it.file), size: it.size, name: it.file })),
  })

  // ── 결과 기다리기 ──
  async function download(job, url, type, n) {
    const res = await fetch(url)
    if (!res.ok || !res.body) throw new Error(`결과 파일을 받지 못했습니다(${res.status})`)
    const ext = extFor(res.headers.get('content-type'), url, type)
    const dir = path.join(FILES, job.owner)
    await fsp.mkdir(dir, { recursive: true })
    const file = `${job.id}-${n}.${ext}`
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(path.join(dir, file)))
    const { size } = await fsp.stat(path.join(dir, file))
    return { file, type: ext === 'mp4' || ext === 'mov' || ext === 'webm' ? 'video' : ext === 'mp3' || ext === 'wav' ? 'audio' : 'image', size }
  }
  function settle(job) {
    if (!job.requests.every((r) => TERMINAL.has(r.status))) return
    job.items = job.items ?? []
    job.status = job.items.length ? 'done' : job.requests.some((r) => r.status === 'nsfw') ? 'nsfw' : 'failed'
    const bad = job.requests.filter((r) => r.status !== 'completed')
    if (bad.length) {
      const nsfw = bad.some((r) => r.status === 'nsfw')
      job.error = `${bad.length}개는 ${nsfw ? '내용 검수에 걸려 만들지 못했습니다(비용은 돌려받습니다)' : `실패했습니다${bad[0].error ? `: ${bad[0].error}` : ''}`}`
    }
    job.doneAt = new Date().toISOString()
  }
  let polling = false
  async function pollOnce() {
    if (polling) return
    polling = true
    try {
      let changed = false
      for (const job of jobs) {
        if (job.status !== 'running') continue
        for (const r of job.requests) {
          if (TERMINAL.has(r.status)) continue
          if (Date.now() - Date.parse(job.createdAt) > MAX_WAIT_MS) {
            r.status = 'failed'
            r.error = '너무 오래 걸려 기다리기를 멈췄습니다'
            changed = true
            continue
          }
          try {
            const s = await hf(r.statusUrl ?? `/requests/${r.id}/status`, { timeout: 20000 })
            if (s?.status && s.status !== r.status) {
              r.status = s.status
              changed = true
            }
            if (s?.status === 'completed') {
              const outs = outputUrls(s)
              if (!outs.length) {
                r.status = 'failed'
                r.error = '결과 주소가 없습니다'
              }
              for (const o of outs) {
                try {
                  job.items = [...(job.items ?? []), await download(job, o.url, o.type, (job.items?.length ?? 0) + 1)]
                } catch (err) {
                  r.error = err.message
                }
              }
            } else if (s?.status === 'failed') r.error = typeof s.error === 'string' ? s.error.slice(0, 160) : ''
          } catch (err) {
            // 키 오류는 끝으로, 연결 문제는 다음 차례에 다시
            if (err.status === 401 || err.status === 404) {
              r.status = 'failed'
              r.error = err.message
              changed = true
            }
          }
        }
        const before = job.status
        settle(job)
        if (job.status !== before) changed = true
      }
      if (changed) await save()
    } finally {
      polling = false
    }
  }
  const timer = setInterval(() => pollOnce().catch(() => {}), 3000)
  timer.unref?.()

  // ── 7일 지난 결과 지우기 ──
  async function cleanup() {
    const now = Date.now()
    const old = jobs.filter((j) => isExpired(j, now) && j.status !== 'running')
    if (old.length) {
      for (const j of old) for (const it of j.items ?? []) await fsp.rm(path.join(FILES, j.owner, it.file), { force: true })
      jobs = jobs.filter((j) => !old.includes(j))
      await save()
      console.log(`[당근] 보관 기간(${KEEP_DAYS}일)이 지난 작업 ${old.length}개를 지웠습니다`)
    }
    // 목록에 없는 파일(중간에 끊긴 내려받기 등)도 정리
    const known = new Set(jobs.flatMap((j) => (j.items ?? []).map((it) => `${j.owner}/${it.file}`)))
    for (const owner of await fsp.readdir(FILES).catch(() => [])) {
      for (const f of await fsp.readdir(path.join(FILES, owner)).catch(() => [])) {
        const full = path.join(FILES, owner, f)
        const st = await fsp.stat(full).catch(() => null)
        if (st && !known.has(`${owner}/${f}`) && now - st.mtimeMs > 6 * 3600e3) await fsp.rm(full, { force: true })
      }
    }
  }
  if (process.env.NODE_ENV !== 'test') {
    setTimeout(() => cleanup().catch(() => {}), 10_000)
    setInterval(() => cleanup().catch(() => {}), 3600e3).unref?.()
  }

  // ── 비용 어림(힉스필드 estimate, 비용 없음) ──
  const estCache = new Map()
  async function estimate(endpoint, input) {
    const key = `${endpoint}|${JSON.stringify(input)}`
    const hit = estCache.get(key)
    if (hit && Date.now() - hit.at < 10 * 60e3) return hit.usd
    const r = await hf(`/estimate/${endpoint}`, { method: 'POST', body: input, timeout: 10000 })
    const usd = Number(r?.usd)
    if (!Number.isFinite(usd)) return null
    estCache.set(key, { usd, at: Date.now() })
    if (estCache.size > 500) estCache.delete(estCache.keys().next().value)
    return usd
  }

  // ── 화면용 API ──
  app.get('/api/carrot/models', requireStaff, (req, res) => {
    res.json({ connected: Boolean(credentials()), keepDays: KEEP_DAYS, isAdmin: isAdmin(req), me: me(req), models: CATALOG.models, chat: Boolean(process.env.ANTHROPIC_API_KEY || fs.existsSync(path.join(DATA_DIR, 'sns', 'ai.json'))) })
  })

  /** 레퍼런스·프레임 올리기: { data: 'data:image/png;base64,…' } 또는 { job, index }(라이브러리 결과) → 힉스필드 공개 주소 */
  app.post('/api/carrot/upload', requireStaff, async (req, res) => {
    try {
      let buf
      let type
      if (typeof req.body?.data === 'string') {
        const m = /^data:([a-z/+-]+);base64,(.+)$/s.exec(req.body.data)
        if (!m) return res.status(400).json({ error: '이미지 파일을 읽지 못했습니다.' })
        type = m[1] === 'image/jpg' ? 'image/jpeg' : m[1]
        buf = Buffer.from(m[2], 'base64')
      } else {
        const job = jobs.find((j) => j.id === req.body?.job)
        const it = job?.items?.[Number(req.body?.index) || 0]
        if (!job || !it || it.type !== 'image') return res.status(404).json({ error: '그 결과를 찾지 못했습니다.' })
        if (job.owner !== me(req).owner && !isAdmin(req)) return res.status(403).json({ error: '내 라이브러리의 결과만 쓸 수 있습니다.' })
        buf = await fsp.readFile(path.join(FILES, job.owner, it.file))
        const ext = it.file.split('.').pop()
        type = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
      }
      if (!UPLOAD_TYPES.includes(type)) return res.status(400).json({ error: 'JPG·PNG·WEBP·GIF 이미지만 올릴 수 있습니다.' })
      if (buf.length > MAX_UPLOAD) return res.status(400).json({ error: '이미지는 20MB 까지 올릴 수 있습니다.' })
      const up = await hf('/files/generate-upload-url', { method: 'POST', body: { content_type: type } })
      const put = await fetch(up.upload_url, { method: 'PUT', headers: up.upload_headers ?? { 'Content-Type': type }, body: buf })
      if (!put.ok) return res.status(502).json({ error: `이미지를 힉스필드에 올리지 못했습니다(${put.status}).` })
      res.json({ url: up.public_url })
    } catch (err) {
      res.status(err.status === 0 ? 503 : 400).json({ error: err.message })
    }
  })

  app.post('/api/carrot/estimate', requireStaff, async (req, res) => {
    try {
      const plan = planRequest(req.body)
      const one = await estimate(plan.endpoint, plan.input)
      res.json({ usd: one == null ? null : Math.round(one * plan.count * 1000) / 1000 })
    } catch {
      res.json({ usd: null })
    }
  })

  app.post('/api/carrot/generate', requireStaff, async (req, res) => {
    let plan
    try {
      plan = planRequest(req.body)
    } catch (err) {
      return res.status(400).json({ error: err.message })
    }
    if (!credentials()) return res.status(503).json({ error: '힉스필드 API 키가 아직 연결되지 않았습니다. 관리자에게 연결을 부탁해 주세요.' })
    const who = me(req)
    const job = {
      id: crypto.randomBytes(8).toString('hex'),
      ...who,
      kind: plan.model.kind,
      model: plan.model.key,
      endpoint: plan.endpoint,
      prompt: String(req.body.prompt ?? '').trim().slice(0, 4000),
      options: req.body.options ?? {},
      count: plan.count,
      refs: plan.input.image_urls ?? (plan.input.image_url && plan.model.kind === 'image' ? [plan.input.image_url] : []),
      start: plan.model.kind === 'video' ? (plan.input.image_url ?? plan.input.first_frame_url ?? null) : null,
      end: plan.input.end_image_url ?? plan.input.last_image_url ?? plan.input.last_frame_url ?? null,
      status: 'running',
      requests: [],
      items: [],
      createdAt: new Date().toISOString(),
    }
    const results = await Promise.allSettled(Array.from({ length: plan.count }, () => hf(`/${plan.endpoint}`, { method: 'POST', body: plan.input, idem: crypto.randomUUID() })))
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value?.request_id) job.requests.push({ id: r.value.request_id, statusUrl: r.value.status_url, status: r.value.status ?? 'queued' })
    }
    if (!job.requests.length) {
      const reason = results.find((r) => r.status === 'rejected')?.reason
      return res.status(reason?.status === 0 ? 503 : 400).json({ error: reason?.message ?? '생성을 시작하지 못했습니다.' })
    }
    if (job.requests.length < plan.count) job.error = `${plan.count - job.requests.length}개는 시작하지 못했습니다`
    estimate(plan.endpoint, plan.input)
      .then((usd) => {
        if (usd != null) {
          job.usd = Math.round(usd * job.requests.length * 1000) / 1000
          save()
        }
      })
      .catch(() => {})
    jobs.push(job)
    await save()
    setTimeout(() => pollOnce().catch(() => {}), 1500)
    res.json({ job: view(job) })
  })

  /** 내 라이브러리(관리자는 ?owner=all 또는 계정 ID) */
  app.get('/api/carrot/jobs', requireStaff, (req, res) => {
    const who = me(req)
    const admin = isAdmin(req)
    const want = typeof req.query.owner === 'string' ? req.query.owner : ''
    const list = jobs.filter((j) => (admin && want === 'all' ? true : admin && want ? j.owner === want : j.owner === who.owner))
    const owners = admin ? usageByOwner(jobs).map((u) => ({ owner: u.owner, name: u.name, username: u.username, jobs: u.jobs })) : undefined
    res.json({ jobs: list.map(view), owners, running: list.some((j) => j.status === 'running') })
  })

  app.get('/api/carrot/file/:owner/:file', requireStaff, (req, res) => {
    const { owner, file } = req.params
    if (!okName(owner) || !/^[a-z0-9]{16}-\d{1,2}\.[a-z0-9]{2,4}$/.test(file)) return res.status(400).json({ error: '잘못된 주소입니다.' })
    if (owner !== me(req).owner && !isAdmin(req)) return res.status(403).json({ error: '다른 사람의 결과는 볼 수 없습니다.' })
    const full = path.join(FILES, owner, file)
    if (!fs.existsSync(full)) return res.status(404).json({ error: '파일이 없습니다(보관 기간이 지났을 수 있습니다).' })
    if (req.query.download) res.setHeader('Content-Disposition', `attachment; filename="carrot-${file}"`)
    res.setHeader('Cache-Control', 'private, max-age=86400')
    res.sendFile(full)
  })

  app.delete('/api/carrot/jobs/:job', requireStaff, async (req, res) => {
    const job = jobs.find((j) => j.id === req.params.job)
    if (!job) return res.status(404).json({ error: '이미 지워졌습니다.' })
    if (job.owner !== me(req).owner && !isAdmin(req)) return res.status(403).json({ error: '내 결과만 지울 수 있습니다.' })
    for (const it of job.items ?? []) await fsp.rm(path.join(FILES, job.owner, it.file), { force: true })
    jobs = jobs.filter((j) => j !== job)
    await save()
    res.json({ ok: true })
  })

  // ── 대화로 생성(Claude) ──
  const aiKey = async () => process.env.ANTHROPIC_API_KEY || (await readJson(path.join(DATA_DIR, 'sns', 'ai.json'), null))?.apiKey || ''
  const modelLines = CATALOG.models
    .map((m) => {
      const f = Object.values(m.fields)[0]
      const ar = f.aspect_ratio?.enum ? ` 비율:${f.aspect_ratio.enum.join('/')}` : ''
      const du = f.duration ? ` 길이(초):${f.duration.enum ? f.duration.enum.join('/') : `${f.duration.min}~${f.duration.max}`}` : ''
      return `- ${m.key} | ${m.kind === 'image' ? '이미지' : '영상'} | ${m.label}${m.note ? ` (${m.note})` : ''}${ar}${du}`
    })
    .join('\n')
  const SYSTEM = `당신은 온비짱의 '당근' 생성기 도우미입니다. 사용자와 한국어로 짧게 대화하며 이미지·영상 생성 프롬프트를 함께 다듬습니다.
- 사용자가 원하는 결과가 충분히 구체적이면 바로 생성안을 내고(ready=true), 부족하면 꼭 필요한 것만 한두 가지 묻습니다(ready=false).
- 생성안의 prompt 는 모델이 잘 알아듣도록 장면·피사체·구도·조명·스타일·카메라 움직임(영상)을 구체적으로, 영어로 씁니다. 화면에 들어갈 글자가 있으면 그 글자는 원래 언어 그대로 따옴표로 넣습니다.
- 모델은 아래 목록의 key 만 씁니다. 사용자가 고른 모델이 있으면 그대로 두고, 맞지 않을 때만 바꾸고 이유를 말합니다.
- 비율·길이는 그 모델이 받는 값만 씁니다. 개수(count)는 이미지 1~4, 영상 1.
- reply 는 사용자에게 보일 한국어 답(2~4문장). 생성은 사용자가 '이대로 생성'을 눌러야 시작된다는 점을 기억하세요.
- 불법·성인·실존 인물 사칭·타인 저작물 복제 요청은 정중히 거절합니다.

[모델 목록]
${modelLines}`
  const CHAT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
      reply: { type: 'string' },
      ready: { type: 'boolean' },
      model: { type: 'string' },
      prompt: { type: 'string' },
      aspect_ratio: { type: 'string' },
      duration: { type: 'integer' },
      count: { type: 'integer' },
    },
    required: ['reply', 'ready', 'model', 'prompt', 'aspect_ratio', 'duration', 'count'],
  }
  app.post('/api/carrot/chat', requireStaff, async (req, res) => {
    const key = await aiKey()
    if (!key) return res.status(503).json({ error: 'Claude 키가 없어 대화로 생성을 쓸 수 없습니다. 관리자 화면 SNS 연결에서 AI 키를 넣어 주세요.' })
    const history = (Array.isArray(req.body?.messages) ? req.body.messages : [])
      .slice(-20)
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.text ?? '').slice(0, 4000) }))
      .filter((m) => m.content)
    if (!history.length || history[history.length - 1].role !== 'user') return res.status(400).json({ error: '메시지를 적어 주세요.' })
    while (history[0]?.role === 'assistant') history.shift()
    const c = req.body?.context ?? {}
    const ctxText = `[지금 화면] 탭: ${c.kind === 'video' ? '영상' : '이미지'} · 고른 모델: ${MODEL_BY_KEY[c.model]?.key ?? '없음'} · 레퍼런스 ${Number(c.refs) || 0}장${c.start ? ' · 시작 프레임 있음' : ''}${c.end ? ' · 끝 프레임 있음' : ''}`
    history[history.length - 1] = { role: 'user', content: `${ctxText}\n\n${history[history.length - 1].content}` }
    try {
      const client = makeClient(key)
      const msg = await client.messages.create({
        model: AI_MODEL,
        max_tokens: 4000,
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        output_config: { effort: 'low', format: { type: 'json_schema', schema: CHAT_SCHEMA } },
        messages: history,
      })
      if (msg.stop_reason === 'refusal') return res.json({ reply: '이 요청은 도와드리기 어렵습니다. 다른 내용으로 말씀해 주세요.', proposal: null })
      const out = JSON.parse(msg.content.find((b) => b.type === 'text')?.text ?? '{}')
      const model = MODEL_BY_KEY[out.model] ?? MODEL_BY_KEY[c.model]
      const proposal = out.ready && model && out.prompt ? { model: model.key, kind: model.kind, prompt: String(out.prompt).slice(0, 4000), aspect_ratio: out.aspect_ratio || undefined, duration: out.duration || undefined, count: model.kind === 'video' ? 1 : Math.max(1, Math.min(4, out.count || 1)) } : null
      res.json({ reply: String(out.reply ?? '').slice(0, 2000), proposal })
    } catch (err) {
      res.status(502).json({ error: `대화 응답을 받지 못했습니다: ${err.message}` })
    }
  })

  // ── 관리자: 키와 사용량 ──
  const adminState = () => ({ connected: Boolean(credentials()), fromEnv: Boolean(envCred()), savedAt: saved?.savedAt ?? null, hint: credentials() ? `${credentials().split(':')[0].slice(0, 6)}…` : '' })
  app.get('/api/admin/carrot', requireAdmin, (_req, res) => res.json(adminState()))
  app.put('/api/admin/carrot', requireAdmin, async (req, res) => {
    const id = String(req.body?.keyId ?? '').trim()
    const secret = String(req.body?.secret ?? '').trim()
    const cred = id && secret ? `${id}:${secret}` : String(req.body?.credentials ?? '').trim()
    if (!/^[^:\s]{8,}:[^:\s]{8,}$/.test(cred)) return res.status(400).json({ error: '키 ID 와 비밀값을 모두 넣어 주세요.' })
    try {
      // 비용이 들지 않는 어림 요청으로 키 확인
      await hf('/estimate/z-image/turbo', { method: 'POST', body: { prompt: 'key check' }, cred, timeout: 15000 })
    } catch (err) {
      if (err.status === 401) return res.status(400).json({ error: '키가 맞지 않습니다. 키 ID 와 비밀값을 다시 확인해 주세요.' })
      if (err.status === 0) return res.status(400).json({ error: err.message })
      // 403(잔액)·404(모델) 등은 키 자체는 맞다
    }
    saved = { credentials: cred, savedAt: new Date().toISOString() }
    await fsp.mkdir(DIR, { recursive: true })
    await writeJson(KEY_FILE, saved)
    res.json(adminState())
  })
  app.delete('/api/admin/carrot', requireAdmin, async (_req, res) => {
    saved = null
    await fsp.rm(KEY_FILE, { force: true })
    res.json(adminState())
  })
  app.get('/api/admin/carrot/usage', requireAdmin, async (_req, res) => {
    const users = usageByOwner(jobs)
    let hfUsage = null
    if (credentials()) {
      try {
        const end = new Date()
        const start = new Date(end.getTime() - 30 * 864e5)
        const q = new URLSearchParams({ start: start.toISOString(), end: end.toISOString(), timeframe: 'month', bound_to_timeframe: 'false', limit: '100' })
        const r = await hf(`/models/usage?${q}`, { timeout: 15000 })
        const rows = (r?.time_series ?? []).flatMap((b) => b.results ?? [])
        const byModel = new Map()
        for (const x of rows) {
          const cur = byModel.get(x.model) ?? { model: x.model, quantity: 0, cost: 0 }
          cur.quantity += Number(x.quantity) || 0
          cur.cost += Number(x.cost) || 0
          byModel.set(x.model, cur)
        }
        const list = [...byModel.values()].sort((a, b) => b.cost - a.cost)
        hfUsage = { days: 30, usd: Math.round(list.reduce((s, x) => s + x.cost, 0) * 100) / 100, models: list }
      } catch (err) {
        hfUsage = { error: err.message }
      }
    }
    res.json({ keepDays: KEEP_DAYS, users, totalBytes: users.reduce((s, u) => s + u.bytes, 0), totalJobs: jobs.length, running: jobs.filter((j) => j.status === 'running').length, hf: hfUsage })
  })
}
