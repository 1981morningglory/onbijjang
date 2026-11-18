// 설문폼 — 구글폼처럼 설문을 만들고 링크로 응답을 받는다.
//
// - 만들기·편집·응답 보기: 직원등급 이상(관리자 메뉴 설정·계정별 허용/차단을 따른다). 내가 만든 설문만, 전체마스터는 모두.
// - 공유: 작성자(또는 전체마스터)가 직원을 골라 응답을 공유하면, 그 직원은 응답 보기·내려받기만 할 수 있다(편집·삭제 불가).
// - 응답: 링크를 받은 누구나(로그인 없음). 전체 주소 /form/<설문ID> 또는 짧은 주소 /f/<6글자>.
// - 저장: 데이터 폴더 forms/<설문ID>.json(설문), <설문ID>.responses.json(응답), <설문ID>.csv(응답이 올 때마다 새로 쓰는 파일).
// - 응답 보내기는 한 사람(IP)이 한 설문에 한 시간 30번까지.
// - 중복 응답 막기(설정): IP·고른 질문 값(이름·전화 등). IP 는 비밀 값으로 바꾼 것만 응답에 남긴다(원래 IP 는 저장하지 않음).
// - 사진: 설문 머리·질문·보기에 넣는 사진은 forms/images/ 에 두고 /api/forms/img/<이름> 으로 누구나 본다.
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { cleanAnswers, cleanForm, findDuplicate, isOpen, shortCode, toCsv } from '../lib/forms.mjs'

const FID = /^[a-f0-9]{16}$/
const SHORT = /^[a-z0-9]{6}$/
const HOURLY = 30

export default async function formsRoutes(app, ctx) {
  const { requireTool, isAdmin, currentUser, listUsers, DATA_DIR, ROOT } = ctx
  const requireForms = requireTool('forms', ['member', 'staff', 'admin'], '설문폼을 쓸 권한이 없습니다. 관리자에게 허용을 요청해 주세요.')
  const DIR = path.join(DATA_DIR, 'forms')
  await fsp.mkdir(DIR, { recursive: true })
  const file = (fid, ext = 'json') => path.join(DIR, `${fid}.${ext}`)
  const IMG_DIR = path.join(DIR, 'images')
  await fsp.mkdir(IMG_DIR, { recursive: true })
  // IP 를 응답에 남길 때 쓰는 비밀 값(원래 IP 를 알아낼 수 없게)
  const secretFile = path.join(DIR, '.secret')
  let secret
  try {
    secret = (await fsp.readFile(secretFile, 'utf8')).trim()
  } catch {
    secret = crypto.randomBytes(32).toString('hex')
    await fsp.writeFile(secretFile, secret, { mode: 0o600 })
  }
  const ipHash = (fid, ip) => crypto.createHmac('sha256', secret).update(`${fid}|${ip ?? ''}`).digest('hex').slice(0, 32)

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

  // 설문 목록을 메모리에(설문 내용만, 응답은 필요할 때 읽는다)
  /** @type {Map<string, any>} */
  const forms = new Map()
  for (const f of await fsp.readdir(DIR)) {
    const m = /^([a-f0-9]{16})\.json$/.exec(f)
    if (!m) continue
    const v = await readJson(path.join(DIR, f), null)
    if (v?.id) forms.set(v.id, v)
  }
  const byShort = () => new Map([...forms.values()].filter((f) => f.short).map((f) => [f.short, f]))
  const findPublic = (key) => (FID.test(key) ? forms.get(key) : SHORT.test(key) ? byShort().get(key) : null)

  // 같은 설문에 응답이 동시에 와도 차례로 쓴다
  const locks = new Map()
  const withLock = (fid, fn) => {
    const prev = locks.get(fid) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    locks.set(fid, next.catch(() => {}))
    return next
  }
  const responsesOf = (fid) => readJson(file(fid, 'responses.json'), [])

  const me = (req) => {
    const u = currentUser(req)
    return u ? { owner: u.id, ownerName: u.name || u.username } : { owner: 'master', ownerName: '전체마스터' }
  }
  const mine = (req, f) => f && (isAdmin(req) || f.owner === me(req).owner)
  /** 응답을 볼 수 있는가: 작성자·전체마스터 또는 공유받은 직원 */
  const canRead = (req, f) => f && (mine(req, f) || (f.sharedWith ?? []).includes(me(req).owner))
  const people = () => new Map((listUsers?.() ?? []).map((u) => [u.id, u]))
  const sharedView = (f, map = people()) => (f.sharedWith ?? []).filter((id) => map.has(id)).map((id) => ({ id, name: map.get(id).name, username: map.get(id).username }))
  const base = (req) => process.env.SHARE_BASE_URL || `${req.protocol}://${req.get('host')}`
  const links = (req, f) => ({ full: `${base(req)}/form/${f.id}`, short: `${base(req)}/f/${f.short}` })
  const summary = (req, f, map) => {
    const own = mine(req, f)
    return { id: f.id, title: f.title, description: f.description, owner: f.owner, ownerName: f.ownerName, questions: f.questions.length, responses: f.responseCount ?? 0, lastResponseAt: f.lastResponseAt ?? null, open: isOpen(f), settings: f.settings, createdAt: f.createdAt, updatedAt: f.updatedAt, links: links(req, f), canEdit: own, shared: !own, sharedWith: own ? sharedView(f, map) : [] }
  }

  // ── 사진 ──
  /** 사진 올리기: { data: 'data:image/jpeg;base64,…' } → { url }. 같은 사진은 같은 이름 */
  app.post('/api/forms/images', requireForms, async (req, res) => {
    const m = /^data:(image\/(jpeg|png|webp|gif));base64,(.+)$/s.exec(String(req.body?.data ?? ''))
    if (!m) return res.status(400).json({ error: 'JPG·PNG·WEBP·GIF 사진만 넣을 수 있습니다.' })
    const buf = Buffer.from(m[3], 'base64')
    if (!buf.length || buf.length > 8 * 1024 * 1024) return res.status(400).json({ error: '사진은 8MB 까지 넣을 수 있습니다.' })
    const ext = m[2] === 'jpeg' ? 'jpg' : m[2]
    const name = `${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32)}.${ext}`
    const dest = path.join(IMG_DIR, name)
    if (!fs.existsSync(dest)) await fsp.writeFile(dest, buf)
    res.json({ url: `/api/forms/img/${name}` })
  })
  app.get('/api/forms/img/:name', (req, res) => {
    const name = req.params.name
    if (!/^[a-f0-9]{16,64}\.(jpg|png|webp|gif)$/.test(name)) return res.status(404).end()
    const full = path.join(IMG_DIR, name)
    if (!fs.existsSync(full)) return res.status(404).end()
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.sendFile(full)
  })

  // ── 만드는 사람 ──
  app.get('/api/forms', requireForms, (req, res) => {
    const map = people()
    const list = [...forms.values()].filter((f) => canRead(req, f)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    res.json({ forms: list.map((f) => summary(req, f, map)), isAdmin: isAdmin(req) })
  })
  /** 공유할 직원 찾기(이름·아이디) */
  app.get('/api/forms/people', requireForms, (req, res) => {
    const q = String(req.query.q ?? '').trim().toLowerCase()
    const myId = me(req).owner
    const list = (listUsers?.() ?? []).filter((u) => u.id !== myId && (!q || `${u.name} ${u.username}`.toLowerCase().includes(q))).slice(0, 30)
    res.json({ people: list.map(({ id, name, username }) => ({ id, name, username })) })
  })
  /** 응답 공유 대상 정하기(작성자·전체마스터): { userIds } */
  app.put('/api/forms/:fid/share', requireForms, async (req, res) => {
    const f = forms.get(req.params.fid)
    if (!mine(req, f)) return res.status(404).json({ error: '설문을 찾지 못했습니다.' })
    const map = people()
    const ids = [...new Set((Array.isArray(req.body?.userIds) ? req.body.userIds : []).map(String))].filter((id) => map.has(id) && id !== f.owner).slice(0, 100)
    f.sharedWith = ids
    await writeJson(file(f.id), f)
    res.json({ sharedWith: sharedView(f, map) })
  })
  app.post('/api/forms', requireForms, async (req, res) => {
    const clean = cleanForm(req.body ?? {})
    let short = shortCode()
    const used = byShort()
    while (used.has(short)) short = shortCode()
    const now = new Date().toISOString()
    const f = { id: crypto.randomBytes(8).toString('hex'), short, ...me(req), ...clean, responseCount: 0, createdAt: now, updatedAt: now }
    forms.set(f.id, f)
    await writeJson(file(f.id), f)
    res.json({ form: { ...f, links: links(req, f) } })
  })
  app.get('/api/forms/:fid', requireForms, (req, res) => {
    const f = forms.get(req.params.fid)
    if (!mine(req, f)) return res.status(404).json({ error: '설문을 찾지 못했습니다.' })
    res.json({ form: { ...f, links: links(req, f) } })
  })
  app.put('/api/forms/:fid', requireForms, async (req, res) => {
    const f = forms.get(req.params.fid)
    if (!mine(req, f)) return res.status(404).json({ error: '설문을 찾지 못했습니다.' })
    const next = { ...f, ...cleanForm(req.body ?? {}), updatedAt: new Date().toISOString() }
    forms.set(f.id, next)
    await writeJson(file(f.id), next)
    // 질문 제목이 바뀌었을 수 있으니 CSV 머리글도 새로
    await withLock(f.id, async () => fsp.writeFile(file(f.id, 'csv'), toCsv(next, await responsesOf(f.id)), 'utf8'))
    res.json({ form: { ...next, links: links(req, next) } })
  })
  app.delete('/api/forms/:fid', requireForms, async (req, res) => {
    const f = forms.get(req.params.fid)
    if (!mine(req, f)) return res.status(404).json({ error: '설문을 찾지 못했습니다.' })
    forms.delete(f.id)
    for (const ext of ['json', 'responses.json', 'csv']) await fsp.rm(file(f.id, ext), { force: true })
    res.json({ ok: true })
  })
  app.get('/api/forms/:fid/responses', requireForms, async (req, res) => {
    const f = forms.get(req.params.fid)
    if (!canRead(req, f)) return res.status(404).json({ error: '설문을 찾지 못했습니다.' })
    const own = mine(req, f)
    res.json({ form: { ...f, links: links(req, f), sharedWith: own ? sharedView(f) : undefined, canEdit: own }, responses: (await responsesOf(f.id)).map(({ ip: _ip, ...r }) => r) })
  })
  /** 응답 하나 지우기(:rid) 또는 전부 지우기(all) */
  app.delete('/api/forms/:fid/responses/:rid', requireForms, async (req, res) => {
    const f = forms.get(req.params.fid)
    if (!mine(req, f)) return res.status(404).json({ error: '설문을 찾지 못했습니다.' })
    const list = await withLock(f.id, async () => {
      const all = await responsesOf(f.id)
      const next = req.params.rid === 'all' ? [] : all.filter((r) => r.id !== req.params.rid)
      await writeJson(file(f.id, 'responses.json'), next)
      await fsp.writeFile(file(f.id, 'csv'), toCsv(f, next), 'utf8')
      return next.map(({ ip: _ip, ...r }) => r)
    })
    f.responseCount = list.length
    f.lastResponseAt = list.at(-1)?.at ?? null
    await writeJson(file(f.id), f)
    res.json({ responses: list })
  })
  /** 서버에 쌓아 둔 응답 파일(CSV) 그대로 */
  app.get('/api/forms/:fid/responses.csv', requireForms, async (req, res) => {
    const f = forms.get(req.params.fid)
    if (!canRead(req, f)) return res.status(404).json({ error: '설문을 찾지 못했습니다.' })
    if (!fs.existsSync(file(f.id, 'csv'))) await fsp.writeFile(file(f.id, 'csv'), toCsv(f, await responsesOf(f.id)), 'utf8')
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${f.title}_응답.csv`)}`)
    res.sendFile(file(f.id, 'csv'))
  })

  // ── 응답하는 사람(로그인 없음) ──
  const publicView = (f) => ({ id: f.id, title: f.title, description: f.description, headerImage: f.headerImage || '', questions: f.questions, open: isOpen(f), oneResponse: f.settings.oneResponse, thanks: f.settings.thanks, closeAt: f.settings.closeAt })
  app.get('/api/forms/public/:key', (req, res) => {
    const f = findPublic(req.params.key)
    if (!f) return res.status(404).json({ error: '없는 설문이거나 삭제된 설문입니다.' })
    res.json({ form: publicView(f) })
  })
  const hits = new Map()
  app.post('/api/forms/public/:key', async (req, res) => {
    const f = findPublic(req.params.key)
    if (!f) return res.status(404).json({ error: '없는 설문이거나 삭제된 설문입니다.' })
    if (!isOpen(f)) return res.status(403).json({ error: '응답을 받지 않는 설문입니다(마감).' })
    const who = `${f.id}|${req.ip ?? 'anon'}`
    const h = hits.get(who)
    const now = Date.now()
    const recent = (h ?? []).filter((t) => now - t < 3600e3)
    if (recent.length >= HOURLY) return res.status(429).json({ error: '응답을 너무 많이 보냈습니다. 잠시 뒤 다시 해 주세요.' })
    const r = cleanAnswers(f, req.body?.answers)
    if (r.error) return res.status(400).json({ error: r.error })
    hits.set(who, [...recent, now])
    const resp = { id: crypto.randomBytes(6).toString('hex'), at: new Date().toISOString(), answers: r.answers, ip: ipHash(f.id, req.ip) }
    let dup = null
    const total = await withLock(f.id, async () => {
      const all = await responsesOf(f.id)
      // 중복 응답 막기(설정에 따라)
      dup = findDuplicate(f, all, r.answers, resp.ip)
      if (dup) return all.length
      all.push(resp)
      await writeJson(file(f.id, 'responses.json'), all)
      await fsp.writeFile(file(f.id, 'csv'), toCsv(f, all), 'utf8')
      return all.length
    })
    if (dup) return res.status(409).json({ error: dup, duplicate: true })
    f.responseCount = total
    f.lastResponseAt = resp.at
    await writeJson(file(f.id), f)
    res.json({ ok: true, id: resp.id })
  })

  // 링크 미리보기(카카오톡 등)에 설문 제목이 보이도록 첫 HTML 의 제목만 바꾼다(빌드된 화면이 있을 때)
  const indexFile = path.join(ROOT, 'dist', 'index.html')
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  const sendForm = (req, res, next) => {
    if (!fs.existsSync(indexFile)) return next()
    const f = findPublic(req.params.key)
    const title = f ? `${f.title} — 설문` : '설문'
    const desc = f?.description ? f.description.slice(0, 120) : '링크를 눌러 설문에 응답해 주세요.'
    const meta = `<title>${esc(title)}</title><meta property="og:title" content="${esc(title)}" /><meta property="og:description" content="${esc(desc)}" /><meta name="description" content="${esc(desc)}" />`
    res.setHeader('Cache-Control', 'no-cache')
    res.type('html').send(fs.readFileSync(indexFile, 'utf8').replace(/<title>[^<]*<\/title>/, meta))
  }
  app.get('/form/:key', sendForm)
  app.get('/f/:key', sendForm)
}
