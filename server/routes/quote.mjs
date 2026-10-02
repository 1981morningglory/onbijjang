// 견적서·거래명세표 — 팀별 공간.
//
// - 관리자가 팀을 만들고 팀마다 '팀 코드'를 정해 넘겨준다. 팀은 나중에 자기 코드를 바꿀 수 있다.
// - 견적서 앱에 들어갈 때 팀 코드를 묻고, 맞는 팀의 공간으로만 들어간다(코드가 팀을 정한다 — 팀끼리 코드가 겹치면 안 된다).
// - 팀 공간: 문서(견적서·거래명세표), 팀 담당자, 팀 회사 자료(없으면 관리자가 올린 회사 공통 자료).
// - 다른 팀의 코드를 모르면 그 팀의 문서를 볼 수 없다. 관리자는 모든 팀에 들어갈 수 있다.
// - 모든 자료는 서버 데이터 폴더(Railway 볼륨)에만 저장한다. 공개 저장소에는 들어가지 않는다.
//
// 세션: 서명된 쿠키 ob_team = <teamId>.<codeVersion>.<hmac>  (180일). 팀 코드가 바뀌면 버전이 올라 예전 쿠키는 무효.
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

const COOKIE = 'ob_team'
const TTL_S = 60 * 60 * 24 * 180
const MAX_KIT_BYTES = 20 * 1024 * 1024
const MAX_DOC_BYTES = 2 * 1024 * 1024
const MAX_DOCS = 20000
const ID_RE = /^[a-z0-9]{6,32}$/

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
function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return null
}
const newId = () => crypto.randomBytes(8).toString('hex')
const hashCode = (code, salt = crypto.randomBytes(16).toString('hex')) => ({ salt, hash: crypto.scryptSync(code, salt, 64).toString('hex') })
function codeMatches(code, team) {
  const a = crypto.scryptSync(code, team.salt, 64)
  const b = Buffer.from(team.hash, 'hex')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '')
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** 회사 자료 모양 확인(자세한 정리는 화면 쪽 normalizeKit) */
function kitProblem(kit) {
  if (!kit || typeof kit !== 'object' || Array.isArray(kit)) return '회사 자료 형식이 아닙니다.'
  if (!kit.company || typeof kit.company !== 'object') return '회사 정보가 없습니다.'
  const isData = (v) => typeof v === 'string' && /^data:(image\/(png|jpeg|webp)|application\/pdf);base64,/.test(v)
  if (kit.seals !== undefined && !Array.isArray(kit.seals)) return '직인 형식이 올바르지 않습니다.'
  for (const s of kit.seals ?? []) if (!isData(s?.dataUrl)) return '직인 이미지 형식이 올바르지 않습니다.'
  for (const key of ['registration', 'bankbook']) {
    const a = kit[key]
    if (a == null) continue
    if (!Array.isArray(a.pages) || !a.pages.every(isData)) return '첨부 자료 형식이 올바르지 않습니다.'
    if (a.pdfDataUrl !== undefined && !isData(a.pdfDataUrl)) return '첨부 PDF 형식이 올바르지 않습니다.'
  }
  if (JSON.stringify(kit).length > MAX_KIT_BYTES) return '회사 자료가 너무 큽니다(20MB 이하).'
  return null
}

/** 게시판 목록에 쓸 요약. 품목·거래처 집계도 이것으로 한다. */
function summarize(doc, id, prev) {
  const items = Array.isArray(doc.items) ? doc.items : []
  const vat = doc.vatMode
  let supply = 0
  let tax = 0
  let total = 0
  const lines = []
  for (const it of items) {
    const qty = num(it?.qty) ?? 0
    const price = num(it?.unitPrice) ?? 0
    const name = str(it?.name, 80).trim()
    if (!name && !qty && !price) continue
    const amount = Math.round(qty * price)
    let s, t, tot
    if (vat === 'included') {
      s = Math.round(amount / 1.1)
      t = amount - s
      tot = amount
    } else if (vat === 'excluded') {
      s = amount
      t = Math.round(amount * 0.1)
      tot = amount + t
    } else {
      s = amount
      t = 0
      tot = amount
    }
    supply += s
    tax += t
    total += tot
    lines.push({ name, spec: str(it?.spec, 30), qty, unitPrice: price, total: tot })
  }
  const now = new Date().toISOString()
  return {
    id,
    type: doc.type === 'statement' ? 'statement' : 'quote',
    date: str(doc.date, 10),
    docNo: str(doc.docNo, 30),
    customer: str(doc.customer, 60),
    customerBizNo: str(doc.customerBizNo, 20),
    title: str(doc.title, 60),
    vatMode: vat,
    supply,
    tax,
    total,
    items: lines.slice(0, 80),
    author: str(doc.author, 30),
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  }
}

export default async function quoteRoutes(app, { requireAdmin, isAdmin, DATA_DIR }) {
  const TEAMS_FILE = path.join(DATA_DIR, 'teams.json')
  const COMPANY_KIT = path.join(DATA_DIR, 'company-kit.json')
  // 회사 공통 자료를 바꾸거나 지울 때 직전 것을 한 벌 남겨 되돌릴 수 있게 한다(직인을 잃지 않도록)
  const COMPANY_KIT_PREV = path.join(DATA_DIR, 'company-kit.prev.json')
  const SECRET_FILE = path.join(DATA_DIR, 'secret.json')
  const teamDir = (id) => path.join(DATA_DIR, 'teams', id)

  let secret = (await readJson(SECRET_FILE, null))?.key
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex')
    await writeJson(SECRET_FILE, { key: secret })
  }
  const mac = (teamId, version) => crypto.createHmac('sha256', secret).update(`team:${teamId}:${version}`).digest('hex')

  // 팀 목록·문서 목록을 동시에 고치지 않도록 줄 세운다
  const queues = new Map()
  const serial = (key, fn) => {
    const prev = queues.get(key) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    queues.set(
      key,
      next.catch(() => {}),
    )
    return next
  }

  const loadTeams = () => readJson(TEAMS_FILE, [])
  const publicTeam = (t) => ({ id: t.id, name: t.name })

  /** 이 요청의 팀(쿠키) — 없거나 무효면 null */
  async function sessionTeam(req) {
    const token = readCookie(req, COOKIE)
    if (!token) return null
    const [id, ver, sig] = token.split('.')
    if (!ID_RE.test(id ?? '') || !sig) return null
    const team = (await loadTeams()).find((t) => t.id === id)
    if (!team || Number(ver) !== team.version) return null
    const expected = Buffer.from(mac(team.id, team.version), 'hex')
    const got = Buffer.from(sig, 'hex')
    if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return null
    return team
  }
  const setSession = (req, res, team) =>
    res.setHeader('Set-Cookie', `${COOKIE}=${team.id}.${team.version}.${mac(team.id, team.version)}; Path=/; HttpOnly; SameSite=Lax${req.secure ? '; Secure' : ''}; Max-Age=${TTL_S}`)
  const clearSession = (req, res) => res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax${req.secure ? '; Secure' : ''}; Max-Age=0`)

  async function requireTeam(req, res, next) {
    const team = await sessionTeam(req)
    if (!team) return res.status(401).json({ error: '팀 코드를 넣어 주세요.' })
    req.team = team
    next()
  }

  /** 다른 팀과 같은 코드인지 */
  async function codeTaken(code, exceptId) {
    for (const t of await loadTeams()) if (t.id !== exceptId && codeMatches(code, t)) return true
    return false
  }
  const validCode = (code) => typeof code === 'string' && code.trim().length >= 4 && code.trim().length <= 60

  // ── 입장 ────────────────────────────────────────────────
  app.get('/api/quote/session', async (req, res) => {
    const team = await sessionTeam(req)
    const admin = isAdmin(req)
    const teams = admin ? (await loadTeams()).map(publicTeam) : undefined
    res.json({ team: team ? publicTeam(team) : null, admin, teams, hasTeams: (await loadTeams()).length > 0 })
  })

  const attempts = new Map()
  app.post('/api/quote/login', async (req, res) => {
    const ip = req.ip ?? 'unknown'
    const a = attempts.get(ip)
    if (a && a.until > Date.now() && a.count >= 8) return res.status(429).json({ error: '시도가 많습니다. 1분 뒤에 다시 해 주세요.' })
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : ''
    const team = code ? (await loadTeams()).find((t) => codeMatches(code, t)) : null
    if (!team) {
      const count = a && a.until > Date.now() ? a.count + 1 : 1
      attempts.set(ip, { count, until: Date.now() + 60_000 })
      return res.status(401).json({ error: '맞는 팀이 없습니다. 팀 코드를 확인해 주세요.' })
    }
    attempts.delete(ip)
    setSession(req, res, team)
    res.json({ team: publicTeam(team) })
  })

  /** 관리자는 코드 없이 아무 팀에나 들어간다 */
  app.post('/api/quote/admin-enter', requireAdmin, async (req, res) => {
    const team = (await loadTeams()).find((t) => t.id === req.body?.teamId)
    if (!team) return res.status(404).json({ error: '없는 팀입니다.' })
    setSession(req, res, team)
    res.json({ team: publicTeam(team) })
  })

  app.post('/api/quote/logout', (req, res) => {
    clearSession(req, res)
    res.json({ ok: true })
  })

  /** 팀이 자기 코드를 바꾼다(지금 코드 확인). 바꾸면 다른 팀원도 새 코드를 넣어야 한다. */
  app.post('/api/quote/team/code', requireTeam, async (req, res) => {
    const { current, next } = req.body ?? {}
    if (typeof current !== 'string' || !codeMatches(current.trim(), req.team)) return res.status(401).json({ error: '지금 팀 코드가 맞지 않습니다.' })
    if (!validCode(next)) return res.status(400).json({ error: '새 팀 코드는 4자 이상으로 정해 주세요.' })
    if (await codeTaken(next.trim(), req.team.id)) return res.status(409).json({ error: '다른 팀이 쓰는 코드입니다. 다른 코드로 정해 주세요.' })
    const updated = await serial('teams', async () => {
      const teams = await loadTeams()
      const t = teams.find((x) => x.id === req.team.id)
      Object.assign(t, hashCode(next.trim()), { version: t.version + 1, codeChangedAt: new Date().toISOString() })
      await writeJson(TEAMS_FILE, teams)
      return t
    })
    setSession(req, res, updated)
    res.json({ ok: true })
  })

  // ── 팀 자료: 회사 자료·담당자 ───────────────────────────
  app.get('/api/quote/kit', requireTeam, async (req, res) => {
    const own = await readJson(path.join(teamDir(req.team.id), 'kit.json'), null)
    const common = await readJson(COMPANY_KIT, null)
    const settings = await readJson(path.join(teamDir(req.team.id), 'settings.json'), {})
    res.setHeader('Cache-Control', 'no-store')
    res.json({ kit: own?.kit ?? common?.kit ?? null, source: own ? 'team' : common ? 'common' : 'none', updatedAt: own?.updatedAt ?? common?.updatedAt ?? null, contacts: settings.contacts ?? [] })
  })
  app.put('/api/quote/kit', requireTeam, async (req, res) => {
    const problem = kitProblem(req.body?.kit)
    if (problem) return res.status(400).json({ error: problem })
    const { format: _f, contacts: _c, ...kit } = req.body.kit
    const updatedAt = new Date().toISOString()
    await writeJson(path.join(teamDir(req.team.id), 'kit.json'), { kit: { ...kit, contacts: [] }, updatedAt })
    res.json({ updatedAt })
  })
  app.delete('/api/quote/kit', requireTeam, async (req, res) => {
    await fsp.rm(path.join(teamDir(req.team.id), 'kit.json'), { force: true })
    res.json({ ok: true })
  })
  app.put('/api/quote/contacts', requireTeam, async (req, res) => {
    const list = Array.isArray(req.body?.contacts) ? req.body.contacts.slice(0, 50) : null
    if (!list) return res.status(400).json({ error: '담당자 형식이 올바르지 않습니다.' })
    const contacts = list.map((c) => ({
      id: ID_RE.test(c?.id ?? '') ? c.id : str(c?.id, 32).replace(/[^a-z0-9]/g, '') || newId(),
      name: str(c?.name, 30),
      title: str(c?.title, 20),
      phone: str(c?.phone, 30),
      email: str(c?.email, 80),
      extras: Array.isArray(c?.extras) ? c.extras.slice(0, 6).map((e) => ({ label: str(e?.label, 12), value: str(e?.value, 60) })) : [],
    }))
    await serial(`settings:${req.team.id}`, async () => {
      const file = path.join(teamDir(req.team.id), 'settings.json')
      const s = await readJson(file, {})
      await writeJson(file, { ...s, contacts })
    })
    res.json({ contacts })
  })

  // ── 팀 문서함 ───────────────────────────────────────────
  const indexFile = (teamId) => path.join(teamDir(teamId), 'docs', '_index.json')
  const docFile = (teamId, id) => path.join(teamDir(teamId), 'docs', `${id}.json`)

  app.get('/api/quote/docs', requireTeam, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.json({ docs: await readJson(indexFile(req.team.id), []) })
  })
  app.get('/api/quote/docs/:id', requireTeam, async (req, res) => {
    if (!ID_RE.test(req.params.id)) return res.status(400).json({ error: '문서 번호가 올바르지 않습니다.' })
    const saved = await readJson(docFile(req.team.id, req.params.id), null)
    if (!saved) return res.status(404).json({ error: '문서를 찾을 수 없습니다. 다른 팀원이 지웠을 수 있습니다.' })
    res.setHeader('Cache-Control', 'no-store')
    res.json(saved)
  })

  /** 새 문서 저장(번호가 비었거나 자동 번호면 팀 안에서 그날 순번으로 매긴다) */
  app.post('/api/quote/docs', requireTeam, async (req, res) => {
    const doc = req.body?.doc
    if (!doc || typeof doc !== 'object' || JSON.stringify(doc).length > MAX_DOC_BYTES) return res.status(400).json({ error: '문서 형식이 올바르지 않거나 너무 큽니다.' })
    const teamId = req.team.id
    const result = await serial(`docs:${teamId}`, async () => {
      const index = await readJson(indexFile(teamId), [])
      if (index.length >= MAX_DOCS) return { error: '문서함이 가득 찼습니다. 오래된 문서를 지워 주세요.' }
      const date = str(doc.date, 10)
      const prefix = doc.type === 'statement' ? 'T' : 'Q'
      let docNo = str(doc.docNo, 30)
      const auto = new RegExp(`^[QT]-\\d{8}-\\d{2,}$`)
      const used = new Set(index.map((d) => d.docNo))
      if (!docNo || (auto.test(docNo) && used.has(docNo))) {
        const day = date.replace(/-/g, '')
        let seq = 1
        while (used.has(`${prefix}-${day}-${String(seq).padStart(2, '0')}`)) seq++
        docNo = `${prefix}-${day}-${String(seq).padStart(2, '0')}`
      }
      const id = newId()
      const full = { ...doc, docNo }
      const entry = summarize(full, id)
      await writeJson(docFile(teamId, id), { id, doc: full, meta: entry })
      await writeJson(indexFile(teamId), [entry, ...index])
      return { entry }
    })
    if (result.error) return res.status(409).json({ error: result.error })
    res.json(result)
  })

  app.put('/api/quote/docs/:id', requireTeam, async (req, res) => {
    if (!ID_RE.test(req.params.id)) return res.status(400).json({ error: '문서 번호가 올바르지 않습니다.' })
    const doc = req.body?.doc
    if (!doc || typeof doc !== 'object' || JSON.stringify(doc).length > MAX_DOC_BYTES) return res.status(400).json({ error: '문서 형식이 올바르지 않거나 너무 큽니다.' })
    const teamId = req.team.id
    const result = await serial(`docs:${teamId}`, async () => {
      const index = await readJson(indexFile(teamId), [])
      const at = index.findIndex((d) => d.id === req.params.id)
      if (at < 0) return { error: '문서를 찾을 수 없습니다.', status: 404 }
      const entry = summarize(doc, req.params.id, index[at])
      await writeJson(docFile(teamId, req.params.id), { id: req.params.id, doc, meta: entry })
      index.splice(at, 1)
      await writeJson(indexFile(teamId), [entry, ...index])
      return { entry }
    })
    if (result.error) return res.status(result.status ?? 409).json({ error: result.error })
    res.json(result)
  })

  app.delete('/api/quote/docs/:id', requireTeam, async (req, res) => {
    if (!ID_RE.test(req.params.id)) return res.status(400).json({ error: '문서 번호가 올바르지 않습니다.' })
    const teamId = req.team.id
    await serial(`docs:${teamId}`, async () => {
      const index = await readJson(indexFile(teamId), [])
      await writeJson(
        indexFile(teamId),
        index.filter((d) => d.id !== req.params.id),
      )
      await fsp.rm(docFile(teamId, req.params.id), { force: true })
    })
    res.json({ ok: true })
  })

  // ── 관리자: 팀 관리 · 회사 공통 자료 ────────────────────
  app.get('/api/admin/teams', requireAdmin, async (_req, res) => {
    const teams = await loadTeams()
    const out = []
    for (const t of teams) {
      const index = await readJson(indexFile(t.id), [])
      const ownKit = fs.existsSync(path.join(teamDir(t.id), 'kit.json'))
      out.push({ ...publicTeam(t), createdAt: t.createdAt, codeChangedAt: t.codeChangedAt ?? null, docs: index.length, lastDocAt: index[0]?.updatedAt ?? null, ownKit })
    }
    res.json({ teams: out })
  })
  app.post('/api/admin/teams', requireAdmin, async (req, res) => {
    const name = str(req.body?.name, 40).trim()
    const code = req.body?.code
    if (!name) return res.status(400).json({ error: '팀 이름을 적어 주세요.' })
    if (!validCode(code)) return res.status(400).json({ error: '팀 코드는 4자 이상으로 정해 주세요.' })
    if (await codeTaken(code.trim())) return res.status(409).json({ error: '다른 팀이 쓰는 코드입니다. 다른 코드로 정해 주세요.' })
    const team = await serial('teams', async () => {
      const teams = await loadTeams()
      const t = { id: newId(), name, ...hashCode(code.trim()), version: 1, createdAt: new Date().toISOString() }
      teams.push(t)
      await writeJson(TEAMS_FILE, teams)
      return t
    })
    res.json({ team: publicTeam(team) })
  })
  app.patch('/api/admin/teams/:id', requireAdmin, async (req, res) => {
    const { name, code } = req.body ?? {}
    if (code !== undefined && !validCode(code)) return res.status(400).json({ error: '팀 코드는 4자 이상으로 정해 주세요.' })
    if (code !== undefined && (await codeTaken(code.trim(), req.params.id))) return res.status(409).json({ error: '다른 팀이 쓰는 코드입니다. 다른 코드로 정해 주세요.' })
    const result = await serial('teams', async () => {
      const teams = await loadTeams()
      const t = teams.find((x) => x.id === req.params.id)
      if (!t) return null
      if (typeof name === 'string' && name.trim()) t.name = name.trim().slice(0, 40)
      if (code !== undefined) Object.assign(t, hashCode(code.trim()), { version: t.version + 1, codeChangedAt: new Date().toISOString() })
      await writeJson(TEAMS_FILE, teams)
      return t
    })
    if (!result) return res.status(404).json({ error: '없는 팀입니다.' })
    res.json({ team: publicTeam(result) })
  })
  app.delete('/api/admin/teams/:id', requireAdmin, async (req, res) => {
    if (!ID_RE.test(req.params.id)) return res.status(400).json({ error: '팀 번호가 올바르지 않습니다.' })
    await serial('teams', async () => {
      const teams = await loadTeams()
      await writeJson(
        TEAMS_FILE,
        teams.filter((t) => t.id !== req.params.id),
      )
    })
    await fsp.rm(teamDir(req.params.id), { recursive: true, force: true })
    res.json({ ok: true })
  })

  const kitBrief = (saved) => (saved?.kit ? { name: saved.kit.company?.name ?? '', seals: saved.kit.seals?.length ?? 0, updatedAt: saved.updatedAt ?? null } : null)
  /** 지금 자료를 직전 자료로 옮겨 둔다 */
  const keepPrevious = async () => {
    const current = await readJson(COMPANY_KIT, null)
    if (current?.kit) await writeJson(COMPANY_KIT_PREV, current)
  }

  app.get('/api/admin/company-kit', requireAdmin, async (_req, res) => {
    const saved = await readJson(COMPANY_KIT, null)
    res.json({ ...(saved ?? { kit: null, updatedAt: null }), previous: kitBrief(await readJson(COMPANY_KIT_PREV, null)) })
  })
  app.put('/api/admin/company-kit', requireAdmin, async (req, res) => {
    const problem = kitProblem(req.body?.kit)
    if (problem) return res.status(400).json({ error: problem })
    const { format: _f, ...kit } = req.body.kit
    const updatedAt = new Date().toISOString()
    await serial('company-kit', async () => {
      await keepPrevious()
      await writeJson(COMPANY_KIT, { kit, updatedAt })
    })
    res.json({ updatedAt })
  })
  app.delete('/api/admin/company-kit', requireAdmin, async (_req, res) => {
    await serial('company-kit', async () => {
      await keepPrevious()
      await fsp.rm(COMPANY_KIT, { force: true })
    })
    res.json({ ok: true })
  })
  /** 직전 자료로 되돌리기(지금 자료와 맞바꾼다) */
  app.post('/api/admin/company-kit/restore', requireAdmin, async (_req, res) => {
    const result = await serial('company-kit', async () => {
      const prev = await readJson(COMPANY_KIT_PREV, null)
      if (!prev?.kit) return null
      const current = await readJson(COMPANY_KIT, null)
      await writeJson(COMPANY_KIT, prev)
      if (current?.kit) await writeJson(COMPANY_KIT_PREV, current)
      else await fsp.rm(COMPANY_KIT_PREV, { force: true })
      return prev
    })
    if (!result) return res.status(404).json({ error: '되돌릴 직전 자료가 없습니다.' })
    res.json({ updatedAt: result.updatedAt })
  })
}
