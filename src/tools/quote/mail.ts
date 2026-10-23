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
  /** 실제로 보내는 주소(로그인 계정). 담당자 주소와 다르면 답장은 담당자 주소로 온다 */
  fromAddress: string
}
export interface BookEntry {
  id: string
  name: string
  email: string
  /** 소속·메모(예: 영업팀, 거래처 A사) */
  org: string
}
/** 발송 목록 한 줄 */
export interface MailLogEntry {
  id: string
  at: string
  from: string
  /** 답장 받는 주소(담당자 주소) */
  replyTo?: string
  by: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  customer: string
  docNo: string
  docId: string
  files: Array<{ name: string; size: number }>
  ok: boolean
  error?: string
  /** 메일함에 본문·첨부까지 저장했는지 */
  saved: boolean
}
/** 메일함에 저장한 메일 */
export interface SavedMail {
  entry: MailLogEntry
  text: string
  files: Array<{ name: string; type: string; size: number; n: number }>
}
export interface MailState {
  providers: MailProvider[]
  accounts: Record<string, MailAccount>
  addressBook: BookEntry[]
  /** 거래처 → 지난번에 보낸 받는 사람 */
  lastTo: Record<string, string[]>
}

export const loadMail = () => api<MailState>('/quote/mail')
export const saveAccount = (contactId: string, a: { host: string; port: number; user: string; pass: string }) =>
  api<{ account: MailAccount }>(`/quote/mail/accounts/${contactId}`, { method: 'PUT', body: a })
export const removeAccount = (contactId: string) => api(`/quote/mail/accounts/${contactId}`, { method: 'DELETE' })
export const testAccount = (contactId: string) => api<{ ok: true; from: string; to: string }>(`/quote/mail/accounts/${contactId}/test`, { method: 'POST' })
export const saveBook = (entries: BookEntry[]) => api<{ addressBook: BookEntry[] }>('/quote/addressbook', { method: 'PUT', body: { entries } })

export interface SendRequest {
  contactId: string
  to: string[]
  cc: string[]
  bcc: string[]
  bccMe: boolean
  /** 메일함에 본문·첨부까지 저장 */
  saveCopy: boolean
  subject: string
  text: string
  attachments: Array<{ filename: string; content: string; contentType: string }>
  customer: string
  docNo: string
  docId: string | null
}
export const loadLog = () => api<{ log: MailLogEntry[] }>('/quote/mail/log').then((r) => r.log)
export const loadSaved = (id: string) => api<SavedMail>(`/quote/mailbox/${id}`)
export const deleteSaved = (id: string) => api(`/quote/mailbox/${id}`, { method: 'DELETE' })
/** 메일함 파일 받기(첨부 n 또는 .eml) */
export async function fetchSavedFile(id: string, what: number | 'eml'): Promise<Blob> {
  const res = await fetch(`/api/quote/mailbox/${id}/${what === 'eml' ? 'eml' : `files/${what}`}`, { credentials: 'same-origin' })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? '파일을 받지 못했습니다.')
  return res.blob()
}

/** 첨부 크기 한도(서버와 같게) */
export const MAX_ATTACH = 15 * 1024 * 1024
export const fileSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`)

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

/** 문서 없이 쓰는 메일의 기본 본문: 인사 · 서명 */
export function plainBody(kit: CompanyKit, sender: Contact | undefined) {
  return [`안녕하세요. ${kit.company.name.trim() || '저희 회사'}${sender?.name ? ` ${sender.name}${sender.title ? ` ${sender.title}` : ''}` : ''}입니다.`, '', '', '감사합니다.', '', signature(kit, sender)].join('\n')
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
