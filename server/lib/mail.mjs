// 견적서·거래명세서 메일 보내기 — 서버 쪽 순수 도우미(보내는 일은 routes/quote.mjs 가 nodemailer 로).
//
// - 담당자마다 자기 메일 계정(SMTP)으로 보낸다. 서버 주소는 메일 주소의 도메인으로 미리 채운다.
// - 메일 비밀번호(앱 비밀번호)는 서버 비밀 키로 암호화해 팀 폴더에만 둔다. 화면에는 다시 내보내지 않는다.
import crypto from 'node:crypto'

/** 자주 쓰는 메일 서비스: id → SMTP. 회사 도메인 메일은 화면에서 서비스를 고르거나 직접 넣는다. */
export const MAIL_PROVIDERS = [
  { id: 'gmail', label: 'Gmail · Google Workspace', host: 'smtp.gmail.com', port: 465, domains: ['gmail.com', 'googlemail.com'] },
  { id: 'naver', label: '네이버 메일', host: 'smtp.naver.com', port: 465, domains: ['naver.com'] },
  { id: 'daum', label: '다음·한메일', host: 'smtp.daum.net', port: 465, domains: ['daum.net', 'hanmail.net'] },
  { id: 'kakao', label: '카카오 메일', host: 'smtp.kakao.com', port: 465, domains: ['kakao.com'] },
  { id: 'nate', label: '네이트 메일', host: 'smtp.mail.nate.com', port: 465, domains: ['nate.com'] },
  { id: 'outlook', label: 'Outlook · Microsoft 365', host: 'smtp.office365.com', port: 587, domains: ['outlook.com', 'hotmail.com', 'live.com', 'outlook.kr'] },
  { id: 'worksmobile', label: '네이버웍스', host: 'smtp.worksmobile.com', port: 465, domains: [] },
  { id: 'hiworks', label: '하이웍스', host: 'smtps.hiworks.com', port: 465, domains: [] },
]

const EMAIL_RE = /^[^\s@<>(),;:"[\]]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/
export const isEmail = (v) => typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v.trim())

/** 메일 주소 도메인으로 서비스 추정(모르면 null) */
export function providerFor(email) {
  const domain = String(email ?? '').split('@')[1]?.trim().toLowerCase() ?? ''
  return MAIL_PROVIDERS.find((p) => p.domains.includes(domain)) ?? null
}

/** 받는 사람·참조 목록 정리: 주소만, 중복 없이, 최대 n개. 잘못된 주소가 있으면 그 값을 bad 로 돌려준다 */
export function cleanRecipients(list, max = 20) {
  const out = []
  const bad = []
  for (const raw of Array.isArray(list) ? list : []) {
    const v = String(raw ?? '').trim()
    if (!v) continue
    if (!isEmail(v)) bad.push(v)
    else if (!out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v)
  }
  return { list: out.slice(0, max), bad, over: out.length > max }
}

/** SMTP 설정 정리: 포트 465 는 처음부터 암호화(secure), 그 밖(587 등)은 STARTTLS */
export function cleanAccount(a, email) {
  const host = String(a?.host ?? '').trim().toLowerCase()
  if (!/^[a-z0-9.-]{3,120}$/.test(host) || !host.includes('.')) return { error: '보내는 메일 서버(SMTP) 주소를 확인해 주세요. 예: smtp.gmail.com' }
  const port = Number(a?.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: '포트 번호를 확인해 주세요(보통 465 또는 587).' }
  const user = String(a?.user ?? '').trim() || String(email ?? '').trim()
  if (!user || user.length > 120) return { error: '메일 계정(아이디)을 넣어 주세요.' }
  return { account: { host, port, secure: port === 465, user } }
}

// ── 비밀번호 암호화(AES-256-GCM) ─────────────────────────
const keyOf = (secret) => crypto.createHash('sha256').update(`quote-mail:${secret}`).digest()
export function sealSecret(plain, secret) {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', keyOf(secret), iv)
  const data = Buffer.concat([c.update(String(plain), 'utf8'), c.final()])
  return [iv, c.getAuthTag(), data].map((b) => b.toString('base64')).join('.')
}
export function openSecret(sealed, secret) {
  try {
    const [iv, tag, data] = String(sealed).split('.').map((s) => Buffer.from(s, 'base64'))
    const d = crypto.createDecipheriv('aes-256-gcm', keyOf(secret), iv)
    d.setAuthTag(tag)
    return Buffer.concat([d.update(data), d.final()]).toString('utf8')
  } catch {
    return null
  }
}

/** 메일 서버가 돌려준 오류를 사람이 알아볼 말로 */
export function mailErrorText(err) {
  const code = err?.code ?? ''
  const resp = String(err?.response ?? err?.message ?? '')
  if (code === 'EAUTH' || /\b535\b|auth/i.test(resp))
    return '메일 계정 또는 비밀번호가 맞지 않습니다. Gmail·네이버 등은 로그인 비밀번호가 아니라 ‘앱 비밀번호’를 넣어야 하고, 네이버·다음은 메일 환경설정에서 SMTP 사용을 켜야 합니다.'
  if (code === 'EDNS' || code === 'ENOTFOUND') return '메일 서버 주소를 찾을 수 없습니다. SMTP 주소를 확인해 주세요.'
  if (code === 'ETIMEDOUT' || code === 'ECONNECTION' || code === 'ESOCKET' || code === 'ECONNREFUSED') return '메일 서버에 연결하지 못했습니다. SMTP 주소·포트를 확인해 주세요.'
  if (code === 'EENVELOPE') return '받는 사람 주소를 메일 서버가 받지 않았습니다. 주소를 확인해 주세요.'
  if (/\b55[0-9]\b/.test(resp) && /size|large|exceed/i.test(resp)) return '첨부 파일이 너무 커서 메일 서버가 받지 않았습니다.'
  return `메일을 보내지 못했습니다: ${resp.slice(0, 200) || code || '알 수 없는 오류'}`
}
