// 온비짱 서버 — 사이트 설정(메뉴 노출·프리셋), 관리자 인증, 팀 보관함을 JSON 파일로 관리한다.
// 편집 대상 파일(사진·영상·문서)은 이 서버로 오지 않는다. 예외는 server/routes/ 에 명시된 선택 기능뿐이다.
import express from 'express'
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
// 개발(npm run dev)에서는 --dev 로 실행된다.
const DEV = process.argv.includes('--dev')
// 데이터 위치: DATA_DIR → Railway 볼륨(자동 제공 변수) → 프로젝트의 data/
const DATA_DIR = path.resolve(process.env.DATA_DIR ?? process.env.RAILWAY_VOLUME_MOUNT_PATH ?? path.join(ROOT, 'data'))
const DIST_DIR = path.join(ROOT, 'dist')
// 개발 중의 PORT 는 미리보기 도구가 화면(Vite) 포트로 넘겨주는 값이라 쓰지 않는다. 배포 환경(Railway 등)에서는 PORT 를 따른다.
const PORT = Number(process.env.API_PORT ?? (DEV ? 8787 : (process.env.PORT ?? 8787)))
// 믿을 수 있는 네트워크(개발·사내망)에서는 팀원 누구나 팀 보관함 저장과 서버 변환을 쓸 수 있다.
// 인터넷에 공개된 배포에서는 기본적으로 관리자만 쓸 수 있다. 사내망 전용으로 띄울 때 TRUSTED_NETWORK=1 을 준다.
const TRUSTED = DEV || process.env.TRUSTED_NETWORK === '1'
const HOST = process.env.HOST ?? '0.0.0.0'

const CONFIG_FILE = path.join(DATA_DIR, 'config.json')
const AUTH_FILE = path.join(DATA_DIR, 'auth.json')
const USERS_FILE = path.join(DATA_DIR, 'users.json')
const SECRET_FILE = path.join(DATA_DIR, 'session-secret')
const LIBRARY_DIR = path.join(DATA_DIR, 'library')

fs.mkdirSync(LIBRARY_DIR, { recursive: true })

// ── JSON 저장소 ───────────────────────────────────────────
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
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
  await fsp.rename(tmp, file)
}

// ── 관리자 인증 ───────────────────────────────────────────
const SESSION_COOKIE = 'ob_admin'
const SESSION_TTL_MS = 1000 * 60 * 60 * 12
const sessions = new Map() // token → expiresAt
const loginAttempts = new Map() // ip → { count, until }

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return { salt, hash }
}
function verifyPassword(password, auth) {
  const candidate = crypto.scryptSync(password, auth.salt, 64)
  const stored = Buffer.from(auth.hash, 'hex')
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored)
}
function readCookie(req, name) {
  const raw = req.headers.cookie
  if (!raw) return null
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return null
}
/** 관리자 비밀번호로 들어온 세션 */
function isMasterAdmin(req) {
  const token = readCookie(req, SESSION_COOKIE)
  if (!token) return false
  const expires = sessions.get(token)
  if (!expires || expires < Date.now()) {
    sessions.delete(token)
    return false
  }
  return true
}

// ── 직원 계정 ─────────────────────────────────────────────
// users.json 에 계정을 두고, 로그인 쿠키는 서명된 토큰(서버를 다시 켜도 유지)으로 준다.
// role: admin(관리자 화면 사용) · member(직원). 로그인하지 않은 사람은 방문자.
// access: 계정별 예외 — { 도구id: 'allow' | 'deny' } (관리자 메뉴 설정의 등급별 노출보다 우선)
const USER_COOKIE = 'ob_user'
const USER_TTL_MS = 1000 * 60 * 60 * 24 * 30
const ROLES = ['admin', 'member']
const SECRET = (() => {
  try {
    return fs.readFileSync(SECRET_FILE, 'utf8').trim()
  } catch {
    const s = crypto.randomBytes(32).toString('hex')
    fs.writeFileSync(SECRET_FILE, s, 'utf8')
    return s
  }
})()
let users = (() => {
  try {
    const raw = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'))
    return Array.isArray(raw?.users) ? raw.users : []
  } catch {
    return []
  }
})()
async function saveUsers(next) {
  users = next
  await writeJson(USERS_FILE, { users })
}
const sign = (body) => crypto.createHmac('sha256', SECRET).update(body).digest('base64url')
function userToken(u) {
  const body = Buffer.from(JSON.stringify({ u: u.id, v: u.tokenVersion ?? 0, e: Date.now() + USER_TTL_MS })).toString('base64url')
  return `${body}.${sign(body)}`
}
/** 로그인한 직원(없으면 null) */
function currentUser(req) {
  const raw = readCookie(req, USER_COOKIE)
  if (!raw) return null
  const [body, mac] = raw.split('.')
  if (!body || !mac) return null
  const expect = sign(body)
  if (mac.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null
  try {
    const { u, v, e } = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (typeof e !== 'number' || e < Date.now()) return null
    const user = users.find((x) => x.id === u)
    if (!user || user.disabled || (user.tokenVersion ?? 0) !== v) return null
    return user
  } catch {
    return null
  }
}
const publicUser = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role, access: u.access ?? {}, disabled: Boolean(u.disabled), createdAt: u.createdAt, lastLoginAt: u.lastLoginAt ?? null })

function isAdmin(req) {
  return isMasterAdmin(req) || currentUser(req)?.role === 'admin'
}
function cookieFlags(req) {
  // HTTPS(프록시 뒤 포함)로 들어온 요청에는 Secure 를 붙인다.
  return `Path=/; HttpOnly; SameSite=Strict${req.secure ? '; Secure' : ''}`
}
function startSession(req, res) {
  const token = crypto.randomBytes(32).toString('hex')
  sessions.set(token, Date.now() + SESSION_TTL_MS)
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; ${cookieFlags(req)}; Max-Age=${SESSION_TTL_MS / 1000}`)
}
function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next()
  res.status(401).json({ error: '관리자 로그인이 필요합니다.' })
}
/** 팀원이면 되는 동작. 공개 배포에서는 관리자만, 믿을 수 있는 네트워크에서는 누구나. */
function requireMember(req, res, next) {
  if (TRUSTED || currentUser(req)) return next()
  requireAdmin(req, res, next)
}
function validPassword(pw) {
  return typeof pw === 'string' && pw.length >= 8 && pw.length <= 200
}

const app = express()
app.disable('x-powered-by')
// Railway 같은 프록시 뒤에서 실제 접속 IP 와 HTTPS 여부를 알아내기 위해
app.set('trust proxy', 1)
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'same-origin')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  next()
})
app.use(express.json({ limit: '25mb' }))

// volume: 데이터가 배포 뒤에도 남는 저장소(Railway 볼륨·DATA_DIR)에 있는지
app.get('/api/health', (_req, res) => res.json({ ok: true, volume: Boolean(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH) }))
app.get('/api/site', (_req, res) => res.json({ trusted: TRUSTED }))

// ── 사이트 설정 ───────────────────────────────────────────
// 설정의 형태는 클라이언트(src/app/config.ts)가 정의한다. 서버는 저장만 하고 크기만 제한한다.
app.get('/api/config', async (_req, res) => {
  res.json({ config: await readJson(CONFIG_FILE, null) })
})
app.put('/api/config', requireAdmin, async (req, res) => {
  const config = req.body?.config
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return res.status(400).json({ error: '설정 형식이 올바르지 않습니다.' })
  }
  const saved = { ...config, updatedAt: new Date().toISOString() }
  await writeJson(CONFIG_FILE, saved)
  res.json({ config: saved })
})

app.get('/api/admin/status', async (req, res) => {
  const auth = await readJson(AUTH_FILE, null)
  res.json({ configured: Boolean(auth), loggedIn: isAdmin(req) })
})
app.post('/api/admin/setup', async (req, res) => {
  if (await readJson(AUTH_FILE, null)) return res.status(409).json({ error: '이미 관리자 비밀번호가 설정되어 있습니다.' })
  const { password } = req.body ?? {}
  if (!validPassword(password)) return res.status(400).json({ error: '비밀번호는 8자 이상이어야 합니다.' })
  await writeJson(AUTH_FILE, { ...hashPassword(password), createdAt: new Date().toISOString() })
  startSession(req, res)
  res.json({ ok: true })
})
app.post('/api/admin/login', async (req, res) => {
  const ip = req.ip ?? 'unknown'
  const attempt = loginAttempts.get(ip)
  if (attempt && attempt.until > Date.now() && attempt.count >= 5) {
    return res.status(429).json({ error: '로그인 시도가 많습니다. 1분 뒤에 다시 시도하세요.' })
  }
  const auth = await readJson(AUTH_FILE, null)
  if (!auth) return res.status(409).json({ error: '관리자 비밀번호가 아직 설정되지 않았습니다.' })
  const { password } = req.body ?? {}
  if (typeof password !== 'string' || !verifyPassword(password, auth)) {
    const count = attempt && attempt.until > Date.now() ? attempt.count + 1 : 1
    loginAttempts.set(ip, { count, until: Date.now() + 60_000 })
    return res.status(401).json({ error: '비밀번호가 맞지 않습니다.' })
  }
  loginAttempts.delete(ip)
  startSession(req, res)
  res.json({ ok: true })
})
app.post('/api/admin/logout', (req, res) => {
  const token = readCookie(req, SESSION_COOKIE)
  if (token) sessions.delete(token)
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; ${cookieFlags(req)}; Max-Age=0`)
  res.json({ ok: true })
})
app.post('/api/admin/password', requireAdmin, async (req, res) => {
  const auth = await readJson(AUTH_FILE, null)
  const { current, next } = req.body ?? {}
  if (!auth || typeof current !== 'string' || !verifyPassword(current, auth)) {
    return res.status(401).json({ error: '현재 비밀번호가 맞지 않습니다.' })
  }
  if (!validPassword(next)) return res.status(400).json({ error: '새 비밀번호는 8자 이상이어야 합니다.' })
  await writeJson(AUTH_FILE, { ...hashPassword(next), createdAt: auth.createdAt, changedAt: new Date().toISOString() })
  res.json({ ok: true })
})

// ── 직원 로그인 ───────────────────────────────────────────
const USERNAME_RE = /^[0-9A-Za-z가-힣._-]{2,30}$/
const validUserPassword = (pw) => typeof pw === 'string' && pw.length >= 6 && pw.length <= 200

app.get('/api/auth/me', (req, res) => {
  const u = currentUser(req)
  res.json({ user: u ? publicUser(u) : null, admin: isAdmin(req), master: isMasterAdmin(req) })
})
app.post('/api/auth/login', async (req, res) => {
  const ip = req.ip ?? 'unknown'
  const attempt = loginAttempts.get(ip)
  if (attempt && attempt.until > Date.now() && attempt.count >= 5) {
    return res.status(429).json({ error: '로그인 시도가 많습니다. 1분 뒤에 다시 시도하세요.' })
  }
  const { username, password } = req.body ?? {}
  const u = users.find((x) => typeof username === 'string' && x.username.toLowerCase() === username.trim().toLowerCase())
  if (!u || u.disabled || typeof password !== 'string' || !verifyPassword(password, u)) {
    const count = attempt && attempt.until > Date.now() ? attempt.count + 1 : 1
    loginAttempts.set(ip, { count, until: Date.now() + 60_000 })
    return res.status(401).json({ error: u?.disabled ? '사용이 중지된 계정입니다. 관리자에게 문의하세요.' : '아이디 또는 비밀번호가 맞지 않습니다.' })
  }
  loginAttempts.delete(ip)
  await saveUsers(users.map((x) => (x.id === u.id ? { ...x, lastLoginAt: new Date().toISOString() } : x)))
  res.setHeader('Set-Cookie', `${USER_COOKIE}=${userToken(u)}; ${cookieFlags(req)}; Max-Age=${USER_TTL_MS / 1000}`)
  res.json({ user: publicUser(u) })
})
app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${USER_COOKIE}=; ${cookieFlags(req)}; Max-Age=0`)
  res.json({ ok: true })
})
app.post('/api/auth/password', async (req, res) => {
  const u = currentUser(req)
  if (!u) return res.status(401).json({ error: '로그인이 필요합니다.' })
  const { current, next } = req.body ?? {}
  if (typeof current !== 'string' || !verifyPassword(current, u)) return res.status(401).json({ error: '현재 비밀번호가 맞지 않습니다.' })
  if (!validUserPassword(next)) return res.status(400).json({ error: '새 비밀번호는 6자 이상이어야 합니다.' })
  const updated = { ...u, ...hashPassword(next), tokenVersion: (u.tokenVersion ?? 0) + 1 }
  await saveUsers(users.map((x) => (x.id === u.id ? updated : x)))
  res.setHeader('Set-Cookie', `${USER_COOKIE}=${userToken(updated)}; ${cookieFlags(req)}; Max-Age=${USER_TTL_MS / 1000}`)
  res.json({ ok: true })
})

// ── 계정 관리(관리자) ─────────────────────────────────────
function cleanAccess(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const out = {}
  for (const [k, a] of Object.entries(v)) if (/^[a-z0-9-]{1,60}$/.test(k) && (a === 'allow' || a === 'deny')) out[k] = a
  return out
}
app.get('/api/admin/users', requireAdmin, (_req, res) => {
  res.json({ users: users.map(publicUser) })
})
app.post('/api/admin/users', requireAdmin, async (req, res) => {
  const { username, name, password, role } = req.body ?? {}
  const un = typeof username === 'string' ? username.trim() : ''
  const nm = typeof name === 'string' ? name.trim() : ''
  if (!USERNAME_RE.test(un)) return res.status(400).json({ error: '아이디는 2~30자의 한글·영문·숫자·. _ - 로 정해 주세요.' })
  if (!nm || nm.length > 30) return res.status(400).json({ error: '이름은 1~30자여야 합니다.' })
  if (!validUserPassword(password)) return res.status(400).json({ error: '비밀번호는 6자 이상이어야 합니다.' })
  if (!ROLES.includes(role)) return res.status(400).json({ error: '등급을 골라 주세요.' })
  if (users.some((x) => x.username.toLowerCase() === un.toLowerCase())) return res.status(409).json({ error: '이미 있는 아이디입니다.' })
  if (users.length >= 500) return res.status(409).json({ error: '계정은 500개까지 만들 수 있습니다.' })
  const u = { id: crypto.randomBytes(8).toString('hex'), username: un, name: nm, role, access: {}, ...hashPassword(password), tokenVersion: 0, createdAt: new Date().toISOString() }
  await saveUsers([...users, u])
  res.json({ user: publicUser(u) })
})
app.patch('/api/admin/users/:uid', requireAdmin, async (req, res) => {
  const u = users.find((x) => x.id === req.params.uid)
  if (!u) return res.status(404).json({ error: '계정을 찾을 수 없습니다.' })
  const b = req.body ?? {}
  const next = { ...u }
  const me = currentUser(req)
  if (b.name !== undefined) {
    const nm = typeof b.name === 'string' ? b.name.trim() : ''
    if (!nm || nm.length > 30) return res.status(400).json({ error: '이름은 1~30자여야 합니다.' })
    next.name = nm
  }
  if (b.role !== undefined) {
    if (!ROLES.includes(b.role)) return res.status(400).json({ error: '등급을 골라 주세요.' })
    if (me?.id === u.id && b.role !== 'admin' && !isMasterAdmin(req)) return res.status(400).json({ error: '내 계정의 관리자 등급은 직접 내릴 수 없습니다.' })
    next.role = b.role
  }
  if (b.disabled !== undefined) {
    if (me?.id === u.id && b.disabled) return res.status(400).json({ error: '내 계정은 사용 중지할 수 없습니다.' })
    next.disabled = Boolean(b.disabled)
    if (next.disabled) next.tokenVersion = (u.tokenVersion ?? 0) + 1
  }
  if (b.password !== undefined) {
    if (!validUserPassword(b.password)) return res.status(400).json({ error: '비밀번호는 6자 이상이어야 합니다.' })
    Object.assign(next, hashPassword(b.password))
    next.tokenVersion = (u.tokenVersion ?? 0) + 1
  }
  if (b.access !== undefined) {
    const a = cleanAccess(b.access)
    if (!a) return res.status(400).json({ error: '권한 형식이 올바르지 않습니다.' })
    next.access = a
  }
  await saveUsers(users.map((x) => (x.id === u.id ? next : x)))
  res.json({ user: publicUser(next) })
})
app.delete('/api/admin/users/:uid', requireAdmin, async (req, res) => {
  const u = users.find((x) => x.id === req.params.uid)
  if (!u) return res.status(404).json({ error: '계정을 찾을 수 없습니다.' })
  if (currentUser(req)?.id === u.id) return res.status(400).json({ error: '내 계정은 삭제할 수 없습니다.' })
  await saveUsers(users.filter((x) => x.id !== u.id))
  res.json({ ok: true })
})

// ── 팀 보관함 ─────────────────────────────────────────────
// 불러오기는 누구나. 저장은 팀원(공개 배포에서는 관리자), 삭제는 관리자만. kind 예: canvas-template, label-template, signature
const KIND_RE = /^[a-z0-9-]{1,40}$/
const ID_RE = /^[a-z0-9]{8,32}$/
const MAX_ITEMS_PER_KIND = 300

function kindDir(kind) {
  return path.join(LIBRARY_DIR, kind)
}
async function readIndex(kind) {
  return readJson(path.join(kindDir(kind), '_index.json'), [])
}
app.param('kind', (req, res, next, kind) => {
  if (!KIND_RE.test(kind)) return res.status(400).json({ error: '보관함 종류가 올바르지 않습니다.' })
  next()
})
app.param('id', (req, res, next, id) => {
  if (!ID_RE.test(id)) return res.status(400).json({ error: '항목 ID가 올바르지 않습니다.' })
  next()
})
app.get('/api/library/:kind', async (req, res) => {
  res.json({ items: await readIndex(req.params.kind) })
})
app.get('/api/library/:kind/:id', async (req, res) => {
  const item = await readJson(path.join(kindDir(req.params.kind), `${req.params.id}.json`), null)
  if (!item) return res.status(404).json({ error: '항목을 찾을 수 없습니다.' })
  res.json({ item })
})
app.post('/api/library/:kind', requireMember, async (req, res) => {
  const { name, data, thumb } = req.body ?? {}
  if (typeof name !== 'string' || !name.trim() || name.length > 80) {
    return res.status(400).json({ error: '이름은 1~80자여야 합니다.' })
  }
  if (data === undefined) return res.status(400).json({ error: '저장할 내용이 없습니다.' })
  if (thumb !== undefined && (typeof thumb !== 'string' || thumb.length > 400_000)) {
    return res.status(400).json({ error: '미리보기 이미지가 너무 큽니다.' })
  }
  const kind = req.params.kind
  const index = await readIndex(kind)
  if (index.length >= MAX_ITEMS_PER_KIND) {
    return res.status(409).json({ error: `보관함이 가득 찼습니다(최대 ${MAX_ITEMS_PER_KIND}개). 관리자에게 정리를 요청하세요.` })
  }
  await fsp.mkdir(kindDir(kind), { recursive: true })
  const id = crypto.randomBytes(8).toString('hex')
  const entry = { id, name: name.trim(), createdAt: new Date().toISOString(), ...(thumb ? { thumb } : {}) }
  await writeJson(path.join(kindDir(kind), `${id}.json`), { ...entry, data })
  await writeJson(path.join(kindDir(kind), '_index.json'), [entry, ...index])
  res.json({ item: entry })
})
app.delete('/api/library/:kind/:id', requireAdmin, async (req, res) => {
  const { kind, id } = req.params
  const index = await readIndex(kind)
  await fsp.rm(path.join(kindDir(kind), `${id}.json`), { force: true })
  await writeJson(path.join(kindDir(kind), '_index.json'), index.filter((e) => e.id !== id))
  res.json({ ok: true })
})

// ── 선택 기능 라우트 (server/routes/*.mjs) ────────────────
// 파일을 서버로 받는 기능(문서 변환)은 조회(GET)를 빼고 팀원만 쓸 수 있다.
app.use('/api/convert', (req, res, next) => (req.method === 'GET' ? next() : requireMember(req, res, next)))
const routesDir = path.join(__dirname, 'routes')
if (fs.existsSync(routesDir)) {
  for (const file of fs.readdirSync(routesDir).filter((f) => f.endsWith('.mjs')).sort()) {
    const mod = await import(pathToFileURL(path.join(routesDir, file)).href)
    if (typeof mod.default === 'function') {
      await mod.default(app, { requireAdmin, isAdmin, DATA_DIR, ROOT, TRUSTED })
      console.log(`[온비짱] 라우트 로드: ${file}`)
    }
  }
}

app.use('/api', (_req, res) => res.status(404).json({ error: '없는 API입니다.' }))

// ── 빌드된 화면 제공 (npm run build 이후) ────────────────
if (fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
  // 파일 이름에 내용 해시가 붙은 assets/ 는 오래 보관해도 된다. 첫 화면(index.html)은 항상 새로 받게 한다.
  app.use('/assets', express.static(path.join(DIST_DIR, 'assets'), { index: false, maxAge: '365d', immutable: true }))
  // 없는 assets 파일은 첫 화면(HTML)으로 대신 답하지 않고 404 로 알린다.
  app.use('/assets', (_req, res) => res.status(404).end())
  app.use(express.static(DIST_DIR, { index: false, maxAge: '1h' }))
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(path.join(DIST_DIR, 'index.html'))
  })
}

app.use((err, _req, res, _next) => {
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: '보내는 내용이 너무 큽니다.' })
  console.error('[온비짱] 서버 오류:', err)
  res.status(500).json({ error: '서버에서 문제가 생겼습니다.' })
})

app.listen(PORT, HOST, () => {
  console.log(`[온비짱] 서버 실행 중: http://localhost:${PORT}  (데이터: ${DATA_DIR}${TRUSTED ? ', 믿을 수 있는 네트워크 모드' : ''})`)
  if (!DEV && !process.env.DATA_DIR && !process.env.RAILWAY_VOLUME_MOUNT_PATH && process.env.RAILWAY_ENVIRONMENT) {
    console.warn('[온비짱] 경고: 볼륨이 연결되지 않았습니다. 다시 배포하면 관리자 비밀번호·설정·팀 보관함이 사라집니다. Railway 에서 볼륨을 /data 에 연결하세요.')
  }
})
