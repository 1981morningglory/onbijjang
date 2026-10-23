// 결과 공유 짧은 주소 — /s/아이디
//
// - 화면이 보낸 입력값(사주: 생년월일시 등, MBTI: 유형·비율)만 맡아 두고 8글자 아이디를 준다.
//   받은 사람 화면이 이 값으로 결과를 다시 계산한다(결과 자체는 저장하지 않음).
// - 같은 결과는 늘 같은 아이디(비밀 열쇠로 만든 값이라 생년월일로 아이디를 짐작할 수 없다).
// - 아이디를 만드는 것은 로그인 없이도 되지만 한 사람(IP) 하루 100번까지.
// - SHARE_BASE_URL(예: https://짧은도메인.kr)을 Railway 변수에 넣으면 그 주소로 링크를 만든다.
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

const ALLOWED = {
  saju: ['y', 'm', 'd', 'cal', 't', 'g', 'city', 'b', 'n'],
  mbti: ['r', 'p'],
}
const DAILY_LIMIT = 100
const ID_RE = /^[A-Za-z0-9]{8}$/
const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/** 정해진 이름의 값만 남겨 다시 만든 주소 뒤 글. 이상하면 null */
export function cleanQuery(kind, q) {
  const keys = ALLOWED[kind]
  if (!keys || typeof q !== 'string' || q.length > 400) return null
  const src = new URLSearchParams(q)
  const out = new URLSearchParams()
  for (const k of keys) {
    const v = src.get(k)
    if (v == null) continue
    if (v.length > 40 || /[\u0000-\u001f<>]/.test(v)) return null
    out.set(k, v)
  }
  if (kind === 'saju' && !(out.get('y') && out.get('m') && out.get('d'))) return null
  if (kind === 'mbti' && !/^[EI][SN][TF][JP]$/i.test(out.get('r') ?? '')) return null
  return out.toString()
}

export function makeId(secret, kind, q) {
  const h = crypto.createHmac('sha256', secret).update(`${kind}|${q}`).digest()
  let id = ''
  for (let i = 0; i < 8; i++) id += B62[h[i] % 62]
  return id
}

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
/** 공유 화면용 첫 HTML: 메신저 미리보기·브라우저 탭에 온비짱 이름 대신 중립적인 제목을 보인다 */
export function sharedHtml(html, kind) {
  const title = kind === 'mbti' ? '성격유형(MBTI) 결과가 도착했어요' : '사주 결과가 도착했어요'
  const desc = kind === 'mbti' ? '네 가지 성향 비율과 유형 풀이를 확인해 보세요.' : '원국표·오행·대운·세운과 풀이를 확인해 보세요.'
  const icon = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${kind === 'mbti' ? '🧠' : '🔮'}</text></svg>`)}`
  const meta = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(desc)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta name="robots" content="noindex" />`,
  ].join('\n    ')
  return html
    .replace(/<title>[^<]*<\/title>/, meta)
    .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="${icon}" />`)
}

export default async function shareRoutes(app, ctx) {
  const DIR = path.join(ctx.DATA_DIR, 'share')
  await fsp.mkdir(DIR, { recursive: true })
  const secretFile = path.join(DIR, '.secret')
  let secret
  try {
    secret = (await fsp.readFile(secretFile, 'utf8')).trim()
  } catch {
    secret = crypto.randomBytes(32).toString('hex')
    await fsp.writeFile(secretFile, secret, { mode: 0o600 })
  }
  const used = new Map()
  const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)

  // 공유 화면 첫 HTML(빌드된 화면이 있을 때만). 나머지는 서버의 기본 화면 제공이 맡는다
  const indexFile = path.join(ctx.ROOT, 'dist', 'index.html')
  const sendShared = (kind) => (req, res, next) => {
    if (!fs.existsSync(indexFile)) return next()
    res.setHeader('Cache-Control', 'no-cache')
    res.type('html').send(sharedHtml(fs.readFileSync(indexFile, 'utf8'), kind(req)))
  }
  app.get('/v/:kind', sendShared((req) => req.params.kind))
  app.get('/s/:code', sendShared((req) => {
    try {
      if (ID_RE.test(req.params.code)) return JSON.parse(fs.readFileSync(path.join(DIR, `${req.params.code}.json`), 'utf8')).kind
    } catch {
      // 없는 링크는 화면에서 안내한다
    }
    return 'saju'
  }))

  app.post('/api/share', async (req, res) => {
    const kind = req.body?.kind
    const q = cleanQuery(kind, req.body?.q)
    if (!q) return res.status(400).json({ error: '공유할 결과가 올바르지 않습니다.' })
    const who = req.ip ?? 'anon'
    const u = used.get(who)
    const count = u?.day === today() ? u.count : 0
    if (count >= DAILY_LIMIT) return res.status(429).json({ error: '오늘은 링크를 너무 많이 만들었습니다. 내일 다시 해 주세요.' })
    used.set(who, { day: today(), count: count + 1 })
    const id = makeId(secret, kind, q)
    const file = path.join(DIR, `${id}.json`)
    try {
      await fsp.access(file)
    } catch {
      await fsp.writeFile(file, JSON.stringify({ kind, q, at: new Date().toISOString() }), 'utf8')
    }
    res.json({ id, base: process.env.SHARE_BASE_URL || null })
  })

  // (주의: 서버 전체에 ':id' 검사(소문자만)가 걸려 있어 이름을 code 로 쓴다)
  app.get('/api/share/:code', async (req, res) => {
    const id = req.params.code
    if (!ID_RE.test(id)) return res.status(404).json({ error: '없는 링크입니다.' })
    try {
      const v = JSON.parse(await fsp.readFile(path.join(DIR, `${id}.json`), 'utf8'))
      res.json({ kind: v.kind, q: v.q })
    } catch {
      res.status(404).json({ error: '없는 링크입니다.' })
    }
  })
}
