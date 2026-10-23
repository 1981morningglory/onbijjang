/**
 * 견적서·거래명세서 메일 보내기 — 화면 쪽.
 * 담당자 메일 계정(SMTP)과 팀 주소록은 서버(/api/quote/mail, /api/quote/addressbook)에 둔다.
 * 받는 사람·참조 칸에는 메일 주소를 그대로 넣거나, 주소록 이름만 넣으면 주소로 바뀐다.
 */
import { api } from '@/lib/api'
import { DOC_NAME, won, type CompanyKit, type Contact, type QuoteDoc } from './model'

export interface MailProvider {
  id: string
  label: string
  host: string
  port: number
  domains: string[]
}
export interface MailAccount {
  host: string
  port: number
  user: string
  savedAt: string
}
export interface BookEntry {
  id: string
  name: string
  email: string
  /** 소속·메모(예: 영업팀, 거래처 A사) */
  org: string
}
export interface MailLogEntry {
  at: string
  from: string
  by: string
  to: string[]
  cc: string[]
  subject: string
  customer: string
  docNo: string
  files: string[]
}
export interface MailState {
  providers: MailProvider[]
  accounts: Record<string, MailAccount>
  addressBook: BookEntry[]
  /** 거래처 → 지난번에 보낸 받는 사람 */
  lastTo: Record<string, string[]>
  log: MailLogEntry[]
}

export const loadMail = () => api<MailState>('/quote/mail')
export const saveAccount = (contactId: string, a: { host: string; port: number; user: string; pass: string }) =>
  api<{ account: MailAccount }>(`/quote/mail/accounts/${contactId}`, { method: 'PUT', body: a })
export const removeAccount = (contactId: string) => api(`/quote/mail/accounts/${contactId}`, { method: 'DELETE' })
export const testAccount = (contactId: string) => api(`/quote/mail/accounts/${contactId}/test`, { method: 'POST' })
export const saveBook = (entries: BookEntry[]) => api<{ addressBook: BookEntry[] }>('/quote/addressbook', { method: 'PUT', body: { entries } })

export interface SendRequest {
  contactId: string
  to: string[]
  cc: string[]
  bccMe: boolean
  subject: string
  text: string
  attachments: Array<{ filename: string; content: string; contentType: string }>
  customer: string
  docNo: string
  docId: string | null
}
export const sendMail = (req: SendRequest) => api<{ ok: true; entry: MailLogEntry; rejected: string[] }>('/quote/mail/send', { method: 'POST', body: req })

const EMAIL_RE = /^[^\s@<>(),;:"[\]]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/
export const isEmail = (v: string) => EMAIL_RE.test(v.trim())

/** 메일 주소 도메인으로 서비스 추정 */
export const providerFor = (providers: MailProvider[], email: string) => {
  const domain = email.split('@')[1]?.trim().toLowerCase() ?? ''
  return providers.find((p) => p.domains.includes(domain)) ?? null
}

/** 받는 사람·참조 한 칸에 넣은 글을 사람 단위로 나눈다(쉼표·세미콜론·줄바꿈) */
export const splitTokens = (text: string) =>
  text
    .split(/[,;\n]+/)
    .map((t) => t.trim())
    .filter(Boolean)

/**
 * 넣은 글 하나를 메일 주소로: '홍길동 <a@b.kr>' → a@b.kr, 메일 주소 → 그대로, 주소록 이름 → 그 주소.
 * 같은 이름이 여럿이면 소속까지 넣어 고르게 한다('홍길동(영업팀)').
 */
export function resolveRecipient(token: string, book: BookEntry[]): { email: string } | { error: string } {
  const t = token.trim()
  const angle = /<([^<>]+)>\s*$/.exec(t)
  if (angle) return isEmail(angle[1]) ? { email: angle[1].trim() } : { error: `${t}: 메일 주소가 올바르지 않습니다.` }
  if (isEmail(t)) return { email: t }
  const key = t.replace(/\s+/g, '').toLowerCase()
  const full = (e: BookEntry) => `${e.name}${e.org ? `(${e.org})` : ''}`.replace(/\s+/g, '').toLowerCase()
  const exact = book.filter((e) => full(e) === key)
  if (exact.length === 1) return { email: exact[0].email }
  const byName = book.filter((e) => e.name.replace(/\s+/g, '').toLowerCase() === key)
  if (byName.length === 1) return { email: byName[0].email }
  if (byName.length > 1) return { error: `‘${t}’ 이름이 주소록에 ${byName.length}명 있습니다. 목록에서 골라 주세요.` }
  if (t.includes('@')) return { error: `${t}: 메일 주소가 올바르지 않습니다.` }
  return { error: `‘${t}’ 은(는) 주소록에 없는 이름입니다. 메일 주소를 넣거나 주소록에 먼저 추가해 주세요.` }
}

/** 주소 → 화면에 보일 이름(주소록에 있으면 '홍길동 <주소>') */
export const labelOf = (email: string, book: BookEntry[]) => {
  const e = book.find((x) => x.email.toLowerCase() === email.toLowerCase())
  return e ? `${e.name}${e.org ? `(${e.org})` : ''} <${e.email}>` : email
}

/** 기본 제목: [우리회사] 견적서 송부 - 고객사 (번호) */
export function defaultSubject(doc: QuoteDoc, kit: CompanyKit) {
  const company = kit.company.name.trim()
  const what = doc.type === 'statement' ? '거래명세서' : '견적서'
  return [company && `[${company}]`, `${what} 송부`, doc.customer.trim() && `- ${doc.customer.trim()}`, doc.docNo && `(${doc.docNo})`].filter(Boolean).join(' ')
}

/** 기본 본문: 인사 · 문서 요약 · 담당자 서명 */
export function defaultBody(doc: QuoteDoc, kit: CompanyKit, sender: Contact | undefined, total: number) {
  const what = DOC_NAME[doc.type].replace(/\s+/g, '')
  const lines = [
    `${doc.customer.trim() ? `${doc.customer.trim()} ` : ''}담당자님, 안녕하세요.`,
    `${kit.company.name.trim() || '저희 회사'}${sender?.name ? ` ${sender.name}${sender.title ? ` ${sender.title}` : ''}` : ''}입니다.`,
    '',
    `요청하신 ${what}를 첨부 파일로 보내 드립니다.`,
    '',
    doc.title.trim() && `- 건명: ${doc.title.trim()}`,
    doc.docNo && `- 문서 번호: ${doc.docNo}`,
    total > 0 && `- 합계 금액: ${won(total)}원`,
    '',
    '확인 부탁드리며, 궁금하신 점은 언제든 연락 주세요.',
    '감사합니다.',
    '',
    signature(kit, sender),
  ]
  return lines
    .filter((l) => l !== false && l !== null && l !== undefined)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}

const signature = (kit: CompanyKit, c: Contact | undefined) =>
  [
    [kit.company.name, c?.name, c?.title].filter(Boolean).join(' '),
    c?.phone && `직통 ${c.phone}`,
    ...(c?.extras ?? []).filter((x) => x.label && x.value).map((x) => `${x.label} ${x.value}`),
    c?.email && `메일 ${c.email}`,
  ]
    .filter(Boolean)
    .join('\n')

/** Blob → base64(서버로 보낼 첨부) */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
