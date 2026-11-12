// 당근 — 힉스필드 MCP 로 이미지·영상·오디오를 만드는 생성기(스탭 이상). 회사 힉스필드 구독 크레딧을 쓴다(추가 결제 없음).
//
// - 연결: 관리자 화면 ‘당근 연결’에서 회사 힉스필드 계정으로 한 번 로그인(server/lib/hfmcp.mjs).
// - 만든 결과는 로그인한 계정별로 데이터 폴더(carrot/files/<계정>/)에 내려받아 두고, 7일이 지나면 서버가 지운다.
// - 전체마스터(관리자)는 모든 계정의 라이브러리와 사용 용량·크레딧을 볼 수 있다. 개인별 제한은 두지 않는다.
// - ‘대화로 생성’은 체험단 선발과 같은 Claude 키로 프롬프트를 함께 다듬고, 생성은 사람이 버튼을 눌러야 시작한다.
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { AI_MODEL, makeClient } from '../lib/ai.mjs'
import { KEEP_DAYS, SNAPSHOT, TERMINAL, canBrowse, canSeePrompt, canView, cleanAccess, extFor, isExpired, jobIds, jobResult, koreanToolError, lastSubscriptionGrant, nextRenewal, normalizeModels, planRequest, toolError, typeOfExt, usageByOwner } from '../lib/carrot.mjs'
import { createHfMcp } from '../lib/hfmcp.mjs'

const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_UPLOAD = 20 * 1024 * 1024
/** 한 작업을 기다리는 최대 시간(영상은 오래 걸린다) */
const MAX_WAIT_MS = 60 * 60e3
const CONTEXT = 'Team member creating marketing images and videos in the company internal generator.'

export default async function carrotRoutes(app, ctx) {
  const { requireAdmin, requireStaff, isAdmin, currentUser, DATA_DIR } = ctx
  const DIR = path.join(DATA_DIR, 'carrot')
  const FILES = path.join(DIR, 'files')
  const JOBS_FILE = path.join(DIR, 'jobs.json')
  const LEDGER_FILE = path.join(DIR, 'ledger.json')
  const MODELS_FILE = path.join(DIR, 'models.json')
  const ACCESS_FILE = path.join(DIR, 'access.json')
  fs.mkdirSync(FILES, { recursive: true })
  const hf = createHfMcp(path.join(DIR, 'mcp.json'))

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

  // ── 모델 목록(힉스필드에서 6시간마다 새로, 못 받으면 저장분) ──
  let models = SNAPSHOT
  let modelsAt = null
  const savedModels = await readJson(MODELS_FILE, null)
  if (savedModels?.raw?.length) {
    models = normalizeModels(savedModels.raw)
    modelsAt = savedModels.at
  }
  async function refreshModels() {
    if (!(await hf.connected())) return
    const raw = []
    for (const type of ['image', 'video', 'audio']) {
      let after = null
      for (let page = 0; page < 5; page++) {
        const r = await hf.callTool('models_explore', { action: 'list', type, limit: 100, ...(after ? { after } : {}) })
        const d = JSON.parse(r?.content?.[0]?.text ?? '{}')
        raw.push(...(d.items ?? []))
        after = d.next_page_token
        if (!after) break
      }
    }
    const next = normalizeModels(raw)
    if (next.length > 20) {
      models = next
      modelsAt = new Date().toISOString()
      await writeJson(MODELS_FILE, { at: modelsAt, raw })
    }
  }
  if (process.env.NODE_ENV !== 'test') {
    setTimeout(() => refreshModels().catch((e) => console.error('[당근] 모델 목록 갱신 실패', e.message)), 8000)
    setInterval(() => refreshModels().catch(() => {}), 6 * 3600e3).unref?.()
  }

  // ── 목소리(음성 TTS) ──
  let voices = { at: 0, list: [] }
  async function getVoices() {
    if (Date.now() - voices.at < 24 * 3600e3 && voices.list.length) return voices.list
    const list = []
    let cursor = null
    for (let page = 0; page < 5; page++) {
      const r = await hf.callTool('list_voices', { size: 100, ...(cursor ? { cursor } : {}) })
      list.push(...(r?.structuredContent?.voices ?? []))
      cursor = r?.structuredContent?.next_cursor
      if (!cursor) break
    }
    voices = { at: Date.now(), list: list.filter((v) => v.voice_type === 'preset').map((v) => ({ id: v.voice_id, name: v.name, gender: v.gender ?? '', preview: v.preview_url ?? '' })) }
    return voices.list
  }

  // ── 라이브러리 접근 권한(관리자가 계정별로 정한다) ──
  /** 계정 ID → { mode: 'own' | 'all' | 'some', owners } */
  let access = Object.fromEntries(Object.entries((await readJson(ACCESS_FILE, {})) ?? {}).map(([k, v]) => [k, cleanAccess(v)]))

  // ── 라이브러리(작업 목록)·크레딧 기록 ──
  /** @type {any[]} */
  let jobs = await readJson(JOBS_FILE, [])
  /** 크레딧 사용 기록(보관 기간이 지나 작업이 지워져도 남긴다. 90일치) */
  let ledger = await readJson(LEDGER_FILE, [])
  let saving = Promise.resolve()
  const save = () => (saving = saving.then(() => Promise.all([writeJson(JOBS_FILE, jobs), writeJson(LEDGER_FILE, ledger)])).catch((e) => console.error('[당근] 저장 실패', e.message)))

  const me = (req) => {
    const u = currentUser(req)
    return u ? { owner: u.id, ownerName: u.name || u.username, ownerUsername: u.username } : { owner: 'master', ownerName: '전체마스터', ownerUsername: 'admin' }
  }
  const okName = (s) => /^[a-z0-9]{1,40}$/.test(s)
  const fileUrl = (owner, file) => `/api/carrot/file/${owner}/${file}`
  /** 화면에 보낼 작업. 프롬프트는 작성자 본인(또는 전체마스터)에게만 */
  const view = (j, viewer = j.owner, admin = false) => ({
    id: j.id,
    owner: j.owner,
    ownerName: j.ownerName,
    kind: j.kind,
    model: j.model,
    modelLabel: models.find((m) => m.key === j.model)?.label ?? j.modelLabel ?? j.model,
    prompt: canSeePrompt(viewer, j.owner, admin) ? j.prompt : null,
    promptHidden: !canSeePrompt(viewer, j.owner, admin),
    options: j.options,
    count: j.count,
    refs: j.refPreviews ?? [],
    status: j.status,
    error: j.error ?? null,
    credits: j.credits ?? null,
    createdAt: j.createdAt,
    doneAt: j.doneAt ?? null,
    expiresAt: new Date(Date.parse(j.createdAt) + KEEP_DAYS * 864e5).toISOString(),
    items: (j.items ?? []).map((it) => ({ type: it.type, url: fileUrl(j.owner, it.file), size: it.size, name: it.file })),
  })

  // ── 결과 기다리기 ──
  async function download(job, url, n, jobId) {
    const res = await fetch(url)
    if (!res.ok || !res.body) throw new Error(`결과 파일을 받지 못했습니다(${res.status})`)
    const ext = extFor(res.headers.get('content-type'), url, job.kind)
    const dir = path.join(FILES, job.owner)
    await fsp.mkdir(dir, { recursive: true })
    const file = `${job.id}-${n}.${ext}`
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(path.join(dir, file)))
    const { size } = await fsp.stat(path.join(dir, file))
    return { file, type: typeOfExt(ext), size, jobId }
  }
  function settle(job) {
    if (!job.requests.every((r) => TERMINAL.has(r.status))) return false
    job.items = job.items ?? []
    job.status = job.items.length ? 'done' : job.requests.some((r) => r.status === 'nsfw') ? 'nsfw' : 'failed'
    const bad = job.requests.filter((r) => r.status !== 'completed' || r.error)
    if (bad.length) {
      const nsfw = bad.some((r) => r.status === 'nsfw')
      job.error = `${bad.length}개는 ${nsfw ? '내용 검수에 걸려 만들지 못했습니다' : `실패했습니다${bad[0].error ? `: ${String(bad[0].error).slice(0, 160)}` : ''}`}`
    }
    // 크레딧: 성공한 만큼만(실패·검수는 힉스필드가 돌려준다)
    const ok = job.requests.filter((r) => r.status === 'completed').length
    if (job.credits != null) job.credits = Math.round(((job.credits * ok) / Math.max(1, job.requests.length)) * 10) / 10
    if (job.credits) ledger.push({ owner: job.owner, name: job.ownerName, username: job.ownerUsername, model: job.model, credits: job.credits, at: new Date().toISOString() })
    ledger = ledger.filter((l) => Date.now() - Date.parse(l.at) < 90 * 864e5)
    job.doneAt = new Date().toISOString()
    return true
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
            r.error = '너무 오래 걸려 기다리기를 멈췄습니다(힉스필드 생성 기록에서 확인해 주세요)'
            changed = true
            continue
          }
          try {
            const res = await hf.callTool('job_status', { jobId: r.id }, { timeout: 30000 })
            const { status, urls, error } = jobResult(res)
            if (status !== r.status) {
              r.status = status
              changed = true
            }
            if (status === 'completed') {
              if (!urls.length) r.error = '결과 주소가 없습니다'
              for (const u of urls) {
                try {
                  job.items = [...(job.items ?? []), await download(job, u, (job.items?.length ?? 0) + 1, r.id)]
                } catch (err) {
                  r.error = err.message
                }
              }
            } else if (TERMINAL.has(status) && error) r.error = error
          } catch (err) {
            if (err.kind === 'auth') {
              r.status = 'failed'
              r.error = err.message
              changed = true
            }
            // 연결 문제는 다음 차례에 다시
          }
        }
        if (settle(job)) changed = true
      }
      if (changed) await save()
    } finally {
      polling = false
    }
  }
  setInterval(() => pollOnce().catch(() => {}), 4000).unref?.()

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

  // ── 크레딧 미리 계산(생성 안 함) ──
  const costCache = new Map()
  async function cost(plan) {
    const key = JSON.stringify([plan.tool, plan.params])
    const hit = costCache.get(key)
    if (hit && Date.now() - hit.at < 10 * 60e3) return hit.credits
    const r = await hf.callTool(plan.tool, { params: { ...plan.params, get_cost: true }, context: CONTEXT }, { timeout: 20000 })
    const credits = Number(r?.structuredContent?.cost?.credits)
    if (!Number.isFinite(credits)) return null
    costCache.set(key, { credits, at: Date.now() })
    if (costCache.size > 500) costCache.delete(costCache.keys().next().value)
    return credits
  }
  const fail = (res, err) => res.status(err.kind === 'auth' || err.kind === 'net' ? 503 : 400).json({ error: err.message })

  // ── 화면용 API ──
  app.get('/api/carrot/models', requireStaff, async (req, res) => {
    const st = await hf.status()
    res.json({ connected: st.connected, keepDays: KEEP_DAYS, isAdmin: isAdmin(req), canBrowse: canBrowse(access, me(req).owner, isAdmin(req)), me: me(req), models, modelsAt, chat: Boolean(process.env.ANTHROPIC_API_KEY || fs.existsSync(path.join(DATA_DIR, 'sns', 'ai.json'))) })
  })
  app.get('/api/carrot/voices', requireStaff, async (_req, res) => {
    try {
      res.json({ voices: await getVoices() })
    } catch (err) {
      fail(res, err)
    }
  })

  /** 레퍼런스·프레임 올리기: { data: 'data:image/png;base64,…' } → { id: 힉스필드 media_id }. 라이브러리 결과는 { job, index } → 그 작업 ID */
  app.post('/api/carrot/upload', requireStaff, async (req, res) => {
    try {
      if (typeof req.body?.job === 'string') {
        const job = jobs.find((j) => j.id === req.body.job)
        const it = job?.items?.[Number(req.body?.index) || 0]
        if (!job || !it || it.type !== 'image') return res.status(404).json({ error: '그 결과를 찾지 못했습니다.' })
        if (!canView(access, me(req).owner, job.owner, isAdmin(req))) return res.status(403).json({ error: '볼 수 있는 라이브러리의 결과만 쓸 수 있습니다.' })
        if (it.jobId) return res.json({ id: it.jobId })
      }
      let buf
      let type
      if (typeof req.body?.data === 'string') {
        const m = /^data:([a-z/+-]+);base64,(.+)$/s.exec(req.body.data)
        if (!m) return res.status(400).json({ error: '이미지 파일을 읽지 못했습니다.' })
        type = m[1] === 'image/jpg' ? 'image/jpeg' : m[1]
        buf = Buffer.from(m[2], 'base64')
      } else {
        const job = jobs.find((j) => j.id === req.body?.job)
        const it = job.items[Number(req.body?.index) || 0]
        buf = await fsp.readFile(path.join(FILES, job.owner, it.file))
        const ext = it.file.split('.').pop()
        type = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
      }
      if (!UPLOAD_TYPES.includes(type)) return res.status(400).json({ error: 'JPG·PNG·WEBP·GIF 이미지만 올릴 수 있습니다.' })
      if (buf.length > MAX_UPLOAD) return res.status(400).json({ error: '이미지는 20MB 까지 올릴 수 있습니다.' })
      const ext = type.split('/')[1].replace('jpeg', 'jpg')
      const r = await hf.callTool('media_upload', { filename: `reference.${ext}`, content_type: type })
      const up = r?.structuredContent?.uploads?.[0]
      if (!up?.upload_url || !up.media_id) return res.status(502).json({ error: toolError(r) ?? '힉스필드 업로드 주소를 받지 못했습니다.' })
      const put = await fetch(up.upload_url, { method: 'PUT', headers: { 'Content-Type': type }, body: buf })
      if (!put.ok) return res.status(502).json({ error: `이미지를 힉스필드에 올리지 못했습니다(${put.status}).` })
      const c = await hf.callTool('media_confirm', { type: 'image', media_id: up.media_id })
      if (c?.isError) return res.status(502).json({ error: toolError(c) })
      res.json({ id: up.media_id })
    } catch (err) {
      fail(res, err)
    }
  })

  app.post('/api/carrot/estimate', requireStaff, async (req, res) => {
    try {
      const plan = planRequest({ ...req.body, prompt: req.body?.prompt || 'preview' }, models)
      res.json({ credits: await cost(plan) })
    } catch {
      res.json({ credits: null })
    }
  })

  app.post('/api/carrot/generate', requireStaff, async (req, res) => {
    let plan
    try {
      plan = planRequest(req.body, models)
    } catch (err) {
      return res.status(400).json({ error: err.message })
    }
    const who = me(req)
    try {
      const r = await hf.callTool(plan.tool, { params: plan.params, context: CONTEXT }, { timeout: 90000 })
      const err = toolError(r)
      if (err) return res.status(400).json({ error: err })
      const ids = jobIds(r)
      if (!ids.length) return res.status(502).json({ error: koreanToolError((r?.content ?? []).map((c) => c.text).join(' ') || '작업 번호가 없습니다') })
      const job = {
        id: crypto.randomBytes(8).toString('hex'),
        ...who,
        kind: plan.model.kind,
        model: plan.model.key,
        modelLabel: plan.model.label,
        prompt: String(req.body.prompt ?? '').trim().slice(0, 4000),
        options: req.body.options ?? {},
        count: ids.length,
        refPreviews: (Array.isArray(req.body.previews) ? req.body.previews : []).filter((u) => typeof u === 'string' && /^(https:\/\/|\/api\/carrot\/file\/)/.test(u)).slice(0, 6),
        status: 'running',
        requests: ids.map((id) => ({ id, status: 'pending' })),
        items: [],
        createdAt: new Date().toISOString(),
      }
      jobs.push(job)
      await save()
      cost(plan)
        .then((c) => {
          if (c != null && job.status === 'running') {
            job.credits = c
            save()
          }
        })
        .catch(() => {})
      setTimeout(() => pollOnce().catch(() => {}), 3000)
      res.json({ job: view(job) })
    } catch (err) {
      fail(res, err)
    }
  })

  /** 내 라이브러리(관리자는 ?owner=all 또는 계정 ID) */
  app.get('/api/carrot/jobs', requireStaff, (req, res) => {
    const who = me(req)
    const admin = isAdmin(req)
    const want = typeof req.query.owner === 'string' ? req.query.owner : ''
    const see = (owner) => canView(access, who.owner, owner, admin)
    const browse = canBrowse(access, who.owner, admin)
    const list = jobs.filter((j) => (!browse || !want ? j.owner === who.owner : want === 'all' ? see(j.owner) : j.owner === want && see(j.owner)))
    // 고를 수 있는 사람 목록: 볼 수 있는 사람만
    const owners = browse ? usageByOwner(jobs.filter((j) => see(j.owner))).map((u) => ({ owner: u.owner, name: u.name, username: u.username, jobs: u.jobs })) : undefined
    res.json({ jobs: list.map((j) => view(j, who.owner, admin)), owners, running: list.some((j) => j.status === 'running') })
  })

  app.get('/api/carrot/file/:owner/:file', requireStaff, (req, res) => {
    const { owner, file } = req.params
    if (!okName(owner) || !/^[a-z0-9]{16}-\d{1,2}\.[a-z0-9]{2,4}$/.test(file)) return res.status(400).json({ error: '잘못된 주소입니다.' })
    if (!canView(access, me(req).owner, owner, isAdmin(req))) return res.status(403).json({ error: '이 라이브러리를 볼 권한이 없습니다. 관리자에게 요청해 주세요.' })
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
  /** 쓸 수 있는 Claude 키들: Railway 변수 → 관리자 화면 SNS 연결에서 넣은 키(앞 것이 거절되면 다음 것) */
  const aiKeys = async () => [...new Set([process.env.ANTHROPIC_API_KEY, (await readJson(path.join(DATA_DIR, 'sns', 'ai.json'), null))?.apiKey].filter((k) => typeof k === 'string' && k.trim()))]
  const kindName = { image: '이미지', video: '영상', audio: '오디오' }
  const modelLines = () =>
    models
      .filter((m) => m.kind !== 'audio')
      .slice(0, 60)
      .map((m) => {
        const d = m.params.duration
        const du = d ? ` 길이(초):${d.options ? d.options.join('/') : `${d.min}~${d.max}`}` : ''
        return `- ${m.key} | ${kindName[m.kind]} | ${m.label}${m.ratios.length ? ` 비율:${m.ratios.join('/')}` : ''}${du}`
      })
      .join('\n')
  const system = () => `당신은 온비짱의 '당근' 생성기 도우미입니다. 사용자와 한국어로 짧게 대화하며 이미지·영상 생성 프롬프트를 함께 다듬습니다.
- 사용자가 원하는 결과가 충분히 구체적이면 바로 생성안을 내고(ready=true), 부족하면 꼭 필요한 것만 한두 가지 묻습니다(ready=false).
- 생성안의 prompt 는 모델이 잘 알아듣도록 장면·피사체·구도·조명·스타일·카메라 움직임(영상)을 구체적으로, 영어로 씁니다. 화면에 들어갈 글자가 있으면 그 글자는 원래 언어 그대로 따옴표로 넣습니다.
- 모델은 아래 목록의 key 만 씁니다. 사용자가 고른 모델이 있으면 그대로 두고, 맞지 않을 때만 바꾸고 이유를 말합니다.
- 비율·길이는 그 모델이 받는 값만 씁니다. 개수(count)는 이미지 1~4, 영상 1.
- 사용자가 여러 가지 버전(예: "5가지로")을 원하면 proposals 에 서로 다른 생성안을 그 수만큼(최대 5개) 넣습니다. 보통은 1개.
- 사용자가 링크를 보내도 당신은 그 내용을 볼 수 없습니다. 링크 속 내용이 필요하면 어떤 장면·분위기인지 글로 설명해 달라고 하거나, 레퍼런스 이미지로 올려 달라고 합니다.
- reply 는 사용자에게 보일 한국어 답(2~4문장). 생성은 사용자가 '이대로 생성'을 눌러야 시작되고, 회사 힉스필드 구독 크레딧이 쓰입니다.
- 불법·성인·실존 인물 사칭·타인 저작물 복제 요청은 정중히 거절합니다.

[모델 목록]
${modelLines()}`
  const CHAT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
      reply: { type: 'string' },
      ready: { type: 'boolean' },
      proposals: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { title: { type: 'string' }, model: { type: 'string' }, prompt: { type: 'string' }, aspect_ratio: { type: 'string' }, duration: { type: 'integer' }, count: { type: 'integer' } },
          required: ['title', 'model', 'prompt', 'aspect_ratio', 'duration', 'count'],
        },
      },
    },
    required: ['reply', 'ready', 'proposals'],
  }
  app.post('/api/carrot/chat', requireStaff, async (req, res) => {
    const keys = await aiKeys()
    if (!keys.length) return res.status(503).json({ error: 'Claude 키가 없어 대화로 생성을 쓸 수 없습니다. 관리자 화면 SNS 연결에서 AI 키를 넣어 주세요.' })
    const history = (Array.isArray(req.body?.messages) ? req.body.messages : [])
      .slice(-20)
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.text ?? '').slice(0, 4000) }))
      .filter((m) => m.content)
    if (!history.length || history[history.length - 1].role !== 'user') return res.status(400).json({ error: '메시지를 적어 주세요.' })
    while (history[0]?.role === 'assistant') history.shift()
    const c = req.body?.context ?? {}
    const current = models.find((m) => m.key === c.model)
    const ctxText = `[지금 화면] 탭: ${kindName[c.kind] ?? '이미지'} · 고른 모델: ${current?.key ?? '없음'} · 레퍼런스 ${Number(c.refs) || 0}장${c.start ? ' · 시작 프레임 있음' : ''}${c.end ? ' · 끝 프레임 있음' : ''}`
    history[history.length - 1] = { role: 'user', content: `${ctxText}\n\n${history[history.length - 1].content}` }
    let msg = null
    let lastErr = null
    for (const key of keys) {
      try {
        msg = await makeClient(key).messages.create({
          model: AI_MODEL,
          max_tokens: 8000,
          system: [{ type: 'text', text: system(), cache_control: { type: 'ephemeral' } }],
          output_config: { effort: 'low', format: { type: 'json_schema', schema: CHAT_SCHEMA } },
          messages: history,
        })
        break
      } catch (err) {
        lastErr = err
        // 키가 거절되면 다음 키로, 다른 오류는 바로 알린다
        if (err?.status !== 401 && err?.status !== 403) break
      }
    }
    if (!msg) {
      const st = lastErr?.status
      const why =
        st === 401 || st === 403
          ? 'Claude AI 키가 맞지 않거나 만료됐습니다. 관리자 화면 → ‘SNS 연결’의 AI 키(또는 Railway 변수 ANTHROPIC_API_KEY)를 새 키로 바꿔 주세요. 힉스필드 생성(생성하기 버튼)은 이 키와 상관없이 쓸 수 있습니다.'
          : st === 429 || st === 529
            ? 'Claude 가 잠시 바쁩니다. 조금 뒤 다시 보내 주세요.'
            : `대화 응답을 받지 못했습니다: ${String(lastErr?.message ?? '').slice(0, 160)}`
      return res.status(st === 401 || st === 403 ? 503 : 502).json({ error: why })
    }
    try {
      if (msg.stop_reason === 'refusal') return res.json({ reply: '이 요청은 도와드리기 어렵습니다. 다른 내용으로 말씀해 주세요.', proposals: [] })
      const out = JSON.parse(msg.content.find((b) => b.type === 'text')?.text ?? '{}')
      const proposals = (out.ready && Array.isArray(out.proposals) ? out.proposals : [])
        .slice(0, 5)
        .map((p) => {
          const model = models.find((m) => m.key === p.model && m.kind !== 'audio') ?? (current?.kind !== 'audio' ? current : null)
          if (!model || !p.prompt) return null
          return { title: String(p.title ?? '').slice(0, 60), model: model.key, kind: model.kind, prompt: String(p.prompt).slice(0, 4000), aspect_ratio: p.aspect_ratio || undefined, duration: p.duration || undefined, count: model.kind === 'video' ? 1 : Math.max(1, Math.min(4, p.count || 1)) }
        })
        .filter(Boolean)
      res.json({ reply: String(out.reply ?? '').slice(0, 2000), proposals })
    } catch (err) {
      res.status(502).json({ error: `대화 응답을 읽지 못했습니다: ${err.message}` })
    }
  })

  // ── 남은 크레딧·갱신일(화면 위쪽에 실시간 표시) ──
  let balanceCache = { at: 0, data: null }
  let cycleCache = { at: 0, data: null }
  async function account({ fresh = false } = {}) {
    if (!(await hf.connected())) return null
    if (fresh || Date.now() - balanceCache.at > 20_000) {
      const b = (await hf.callTool('balance', {}, { timeout: 15000 }))?.structuredContent ?? null
      balanceCache = { at: Date.now(), data: b }
    }
    // 갱신일: 거래 내역의 가장 최근 ‘Subscription Credits’ 지급(6시간마다 다시 찾는다)
    if (Date.now() - cycleCache.at > 6 * 3600e3 || (cycleCache.data?.nextReset && Date.parse(cycleCache.data.nextReset) < Date.now())) {
      let grant = null
      let cursor
      for (let page = 0; page < 20 && !grant; page++) {
        const r = await hf.callTool('transactions', { size: 100, ...(cursor !== undefined ? { cursor } : {}) }, { timeout: 20000 })
        let d = r?.structuredContent
        if (!d?.items) {
          try {
            d = JSON.parse(r?.content?.[0]?.text ?? '{}')
          } catch {
            d = {}
          }
        }
        grant = lastSubscriptionGrant(d.items)
        cursor = d.next_cursor
        if (cursor === null || cursor === undefined) break
      }
      cycleCache = { at: Date.now(), data: grant ? { lastReset: grant.at, monthly: grant.credits, nextReset: nextRenewal(grant.at) } : null }
    }
    const b = balanceCache.data
    return { credits: Number(b?.credits ?? 0), plan: b?.subscription_plan_type ?? '', ...(cycleCache.data ?? {}), at: new Date(balanceCache.at).toISOString() }
  }
  app.get('/api/carrot/account', requireStaff, async (req, res) => {
    try {
      res.json({ account: await account({ fresh: req.query.fresh === '1' }) })
    } catch (err) {
      res.json({ account: null, error: err.message })
    }
  })

  // ── 관리자: 힉스필드 계정 연결과 사용량 ──
  async function adminState() {
    const st = await hf.status()
    let balance = null
    if (st.connected) {
      try {
        balance = (await hf.callTool('balance', {}, { timeout: 15000 }))?.structuredContent ?? null
      } catch (err) {
        if (err.kind === 'auth') return { ...(await hf.status()), balance: null, error: err.message }
      }
    }
    let cycle = null
    try {
      const a = await account()
      if (a) cycle = { lastReset: a.lastReset ?? null, nextReset: a.nextReset ?? null, monthly: a.monthly ?? null }
    } catch {
      // 갱신일은 없어도 된다
    }
    return { ...st, balance, cycle, modelsAt, models: models.length }
  }
  app.get('/api/admin/carrot', requireAdmin, async (_req, res) => res.json(await adminState()))
  app.post('/api/admin/carrot/login', requireAdmin, async (_req, res) => {
    try {
      res.json({ url: await hf.startLogin() })
    } catch (err) {
      fail(res, err)
    }
  })
  app.post('/api/admin/carrot/callback', requireAdmin, async (req, res) => {
    try {
      await hf.finishLogin(req.body?.url)
      refreshModels().catch(() => {})
      res.json(await adminState())
    } catch (err) {
      res.status(400).json({ error: err.message })
    }
  })
  app.delete('/api/admin/carrot', requireAdmin, async (_req, res) => {
    await hf.logout()
    res.json(await adminState())
  })
  /** 라이브러리 접근 권한: 계정별 보기 범위 */
  app.get('/api/admin/carrot/access', requireAdmin, (_req, res) => res.json({ access }))
  app.put('/api/admin/carrot/access', requireAdmin, async (req, res) => {
    const id = String(req.body?.userId ?? '')
    if (!/^[a-z0-9]{1,40}$/.test(id)) return res.status(400).json({ error: '계정을 골라 주세요.' })
    const next = cleanAccess(req.body)
    next.owners = next.owners.filter((o) => o !== id)
    if (next.mode === 'some' && !next.owners.length) next.mode = 'own'
    // 기본(모두 함께 봄)이면 따로 적어 두지 않는다
    if (next.mode === 'all') delete access[id]
    else access[id] = next
    await writeJson(ACCESS_FILE, access)
    res.json({ access })
  })
  app.get('/api/admin/carrot/usage', requireAdmin, async (_req, res) => {
    const users = usageByOwner(jobs, ledger)
    res.json({ keepDays: KEEP_DAYS, users, totalBytes: users.reduce((s, u) => s + u.bytes, 0), totalJobs: jobs.length, running: jobs.filter((j) => j.status === 'running').length, credits30: Math.round(users.reduce((s, u) => s + u.credits30, 0) * 10) / 10 })
  })
}
