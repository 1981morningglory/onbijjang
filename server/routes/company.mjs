// 팀 기본 회사 자료(공급자 정보·직인·사업자등록증·통장 사본·담당자)와 팀 코드.
//
// 회사 자료는 저장소(GitHub)에 두지 않고 서버 데이터 폴더(Railway 볼륨)에만 둔다.
// 사이트는 누구나 열 수 있으므로, 회사 자료는 관리자가 정한 '팀 코드'를 한 번 넣은 브라우저에만 내준다.
// 팀 코드를 넣으면 서명된 쿠키(180일)를 준다. 관리자가 팀 코드를 바꾸면 예전 쿠키는 모두 무효가 된다.
//
//   GET    /api/company-kit/status   → { available, updatedAt, codeSet, authorized }
//   GET    /api/company-kit          → { kit, updatedAt }        (팀 코드 쿠키 또는 관리자)
//   POST   /api/team/login           → { ok }                    body { code }
//   POST   /api/team/logout
//   PUT    /api/admin/company-kit    → { updatedAt }             (관리자) body { kit }
//   DELETE /api/admin/company-kit                                (관리자)
//   PUT    /api/admin/team-code                                  (관리자) body { code }
import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'

const TEAM_COOKIE = 'ob_team'
const TEAM_TTL_S = 60 * 60 * 24 * 180
const MAX_KIT_BYTES = 20 * 1024 * 1024

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return fallback
    throw err
  }
}
async function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`
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

/** 회사 자료로 받아들일 모양인지 가볍게 확인한다(자세한 정리는 화면 쪽 normalizeKit). */
function validKit(kit) {
  if (!kit || typeof kit !== 'object' || Array.isArray(kit)) return '회사 자료 형식이 아닙니다.'
  if (!kit.company || typeof kit.company !== 'object') return '회사 정보가 없습니다.'
  if (kit.seals !== undefined && !Array.isArray(kit.seals)) return '직인 형식이 올바르지 않습니다.'
  const isData = (v) => typeof v === 'string' && /^data:(image\/(png|jpeg|webp)|application\/pdf);base64,/.test(v)
  for (const s of kit.seals ?? []) if (!isData(s?.dataUrl)) return '직인 이미지 형식이 올바르지 않습니다.'
  for (const key of ['registration', 'bankbook']) {
    const a = kit[key]
    if (a == null) continue
    if (!Array.isArray(a.pages) || !a.pages.every(isData)) return '첨부 자료 형식이 올바르지 않습니다.'
    if (a.pdfDataUrl !== undefined && !isData(a.pdfDataUrl)) return '첨부 PDF 형식이 올바르지 않습니다.'
  }
  return null
}

export default async function companyRoutes(app, { requireAdmin, isAdmin, DATA_DIR, TRUSTED }) {
  const KIT_FILE = path.join(DATA_DIR, 'company-kit.json')
  const CODE_FILE = path.join(DATA_DIR, 'team-code.json')
  const SECRET_FILE = path.join(DATA_DIR, 'secret.json')

  let secret = (await readJson(SECRET_FILE, null))?.key
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex')
    await writeJson(SECRET_FILE, { key: secret })
  }
  const sign = (version) => crypto.createHmac('sha256', secret).update(`team:${version}`).digest('hex')
  const codeInfo = () => readJson(CODE_FILE, null)

  async function isTeam(req) {
    if (TRUSTED || isAdmin(req)) return true
    const info = await codeInfo()
    const token = readCookie(req, TEAM_COOKIE)
    if (!info || !token) return false
    const [ver, mac] = token.split('.')
    if (Number(ver) !== info.version || !mac) return false
    const expected = Buffer.from(sign(info.version), 'hex')
    const got = Buffer.from(mac, 'hex')
    return got.length === expected.length && crypto.timingSafeEqual(got, expected)
  }

  const attempts = new Map() // ip → { count, until }

  app.get('/api/company-kit/status', async (req, res) => {
    const kit = await readJson(KIT_FILE, null)
    const info = await codeInfo()
    res.json({ available: Boolean(kit), updatedAt: kit?.updatedAt ?? null, codeSet: Boolean(info), needsCode: !TRUSTED, authorized: await isTeam(req) })
  })

  app.get('/api/company-kit', async (req, res) => {
    if (!(await isTeam(req))) return res.status(401).json({ error: '팀 코드를 먼저 넣어 주세요.' })
    const saved = await readJson(KIT_FILE, null)
    if (!saved) return res.status(404).json({ error: '관리자가 아직 회사 자료를 올리지 않았습니다.' })
    res.setHeader('Cache-Control', 'no-store')
    res.json(saved)
  })

  app.post('/api/team/login', async (req, res) => {
    const ip = req.ip ?? 'unknown'
    const a = attempts.get(ip)
    if (a && a.until > Date.now() && a.count >= 8) return res.status(429).json({ error: '시도가 많습니다. 1분 뒤에 다시 해 주세요.' })
    const info = await codeInfo()
    if (!info) return res.status(409).json({ error: '관리자가 아직 팀 코드를 정하지 않았습니다.' })
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : ''
    const candidate = crypto.scryptSync(code, info.salt, 64)
    const stored = Buffer.from(info.hash, 'hex')
    if (!code || candidate.length !== stored.length || !crypto.timingSafeEqual(candidate, stored)) {
      const count = a && a.until > Date.now() ? a.count + 1 : 1
      attempts.set(ip, { count, until: Date.now() + 60_000 })
      return res.status(401).json({ error: '팀 코드가 맞지 않습니다.' })
    }
    attempts.delete(ip)
    res.setHeader('Set-Cookie', `${TEAM_COOKIE}=${info.version}.${sign(info.version)}; Path=/; HttpOnly; SameSite=Lax${req.secure ? '; Secure' : ''}; Max-Age=${TEAM_TTL_S}`)
    res.json({ ok: true })
  })

  app.post('/api/team/logout', (req, res) => {
    res.setHeader('Set-Cookie', `${TEAM_COOKIE}=; Path=/; HttpOnly; SameSite=Lax${req.secure ? '; Secure' : ''}; Max-Age=0`)
    res.json({ ok: true })
  })

  app.put('/api/admin/company-kit', requireAdmin, async (req, res) => {
    const kit = req.body?.kit
    const problem = validKit(kit)
    if (problem) return res.status(400).json({ error: problem })
    const body = JSON.stringify(kit)
    if (body.length > MAX_KIT_BYTES) return res.status(413).json({ error: '회사 자료가 너무 큽니다(20MB 이하).' })
    const updatedAt = new Date().toISOString()
    const { format: _format, ...rest } = kit
    await writeJson(KIT_FILE, { kit: rest, updatedAt })
    res.json({ updatedAt })
  })

  app.delete('/api/admin/company-kit', requireAdmin, async (_req, res) => {
    await fsp.rm(KIT_FILE, { force: true })
    res.json({ ok: true })
  })

  app.put('/api/admin/team-code', requireAdmin, async (req, res) => {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : ''
    if (code.length < 4 || code.length > 60) return res.status(400).json({ error: '팀 코드는 4자 이상으로 정해 주세요.' })
    const prev = await codeInfo()
    const salt = crypto.randomBytes(16).toString('hex')
    const hash = crypto.scryptSync(code, salt, 64).toString('hex')
    // 버전을 올리면 예전 코드로 받은 쿠키는 모두 무효가 된다
    await writeJson(CODE_FILE, { salt, hash, version: (prev?.version ?? 0) + 1, changedAt: new Date().toISOString() })
    res.json({ ok: true })
  })
}
