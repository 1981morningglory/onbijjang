/** QR 코드의 순수 로직: 내용 만들기(Wi-Fi·연락처 등), 모양 옵션, 인식률 경고, 일괄 생성 표 읽기. */
import type { Options } from 'qr-code-styling'
import { sanitizeFilename, uniqueName } from '@/lib/files'

// ── 내용 종류 ─────────────────────────────────────────────
export type QrKind = 'url' | 'text' | 'wifi' | 'vcard' | 'tel' | 'sms' | 'email'

export interface WifiData {
  ssid: string
  password: string
  security: 'WPA' | 'WEP' | 'nopass'
  hidden: boolean
}
export interface VCardData {
  name: string
  org: string
  title: string
  phone: string
  email: string
  url: string
  address: string
  note: string
}
export interface SmsData {
  phone: string
  message: string
}
export interface EmailData {
  to: string
  subject: string
  body: string
}
export interface QrContent {
  kind: QrKind
  url: string
  text: string
  wifi: WifiData
  vcard: VCardData
  tel: string
  sms: SmsData
  email: EmailData
}

export const EMPTY_CONTENT: QrContent = {
  kind: 'url',
  url: '',
  text: '',
  wifi: { ssid: '', password: '', security: 'WPA', hidden: false },
  vcard: { name: '', org: '', title: '', phone: '', email: '', url: '', address: '', note: '' },
  tel: '',
  sms: { phone: '', message: '' },
  email: { to: '', subject: '', body: '' },
}

/** 주소에 http(s):// 같은 앞부분이 없으면 https:// 를 붙인다. */
export function normalizeUrl(input: string): string {
  const v = input.trim()
  if (!v) return ''
  return /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`
}

/** 전화번호에서 숫자와 맨 앞 + 만 남긴다. */
export function normalizePhone(input: string): string {
  const v = input.trim()
  const digits = v.replace(/\D/g, '')
  return v.startsWith('+') && digits ? `+${digits}` : digits
}

const escapeWifi = (s: string) => s.replace(/([\\;,:"])/g, '\\$1')

/** Wi-Fi 접속 QR (휴대폰 카메라가 바로 연결을 제안하는 형식) */
export function wifiPayload(w: WifiData): string {
  const parts = [`T:${w.security}`, `S:${escapeWifi(w.ssid)}`]
  if (w.security !== 'nopass') parts.push(`P:${escapeWifi(w.password)}`)
  if (w.hidden) parts.push('H:true')
  return `WIFI:${parts.join(';')};;`
}

const escapeVCard = (s: string) => s.trim().replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1')

/** 연락처 QR (vCard 3.0). 비어 있는 항목은 넣지 않는다. */
export function vcardPayload(v: VCardData): string {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${escapeVCard(v.name)};;;;`, `FN:${escapeVCard(v.name)}`]
  if (v.org.trim()) lines.push(`ORG:${escapeVCard(v.org)}`)
  if (v.title.trim()) lines.push(`TITLE:${escapeVCard(v.title)}`)
  if (v.phone.trim()) lines.push(`TEL;TYPE=CELL:${normalizePhone(v.phone)}`)
  if (v.email.trim()) lines.push(`EMAIL:${v.email.trim()}`)
  if (v.url.trim()) lines.push(`URL:${normalizeUrl(v.url)}`)
  if (v.address.trim()) lines.push(`ADR:;;${escapeVCard(v.address)};;;;`)
  if (v.note.trim()) lines.push(`NOTE:${escapeVCard(v.note)}`)
  lines.push('END:VCARD')
  return lines.join('\n')
}

export function smsPayload(s: SmsData): string {
  return `SMSTO:${normalizePhone(s.phone)}:${s.message}`
}

export function emailPayload(e: EmailData): string {
  const params: string[] = []
  if (e.subject.trim()) params.push(`subject=${encodeURIComponent(e.subject)}`)
  if (e.body.trim()) params.push(`body=${encodeURIComponent(e.body)}`)
  return `mailto:${e.to.trim()}${params.length ? `?${params.join('&')}` : ''}`
}

export interface Payload {
  /** QR 에 담길 글. 만들 수 없으면 빈 문자열 */
  data: string
  /** 아직 만들 수 없는 이유(무엇을 입력하면 되는지) */
  problem: string | null
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** 입력한 내용으로 QR 에 담을 글을 만든다. */
export function buildPayload(c: QrContent): Payload {
  const need = (problem: string): Payload => ({ data: '', problem })
  switch (c.kind) {
    case 'url':
      return c.url.trim() ? { data: normalizeUrl(c.url), problem: null } : need('연결할 주소를 입력하세요.')
    case 'text':
      return c.text.trim() ? { data: c.text, problem: null } : need('QR 에 담을 글을 입력하세요.')
    case 'wifi':
      if (!c.wifi.ssid.trim()) return need('와이파이 이름을 입력하세요.')
      if (c.wifi.security !== 'nopass' && !c.wifi.password) return need('와이파이 비밀번호를 입력하세요. 비밀번호가 없으면 ‘비밀번호 없음’을 고르세요.')
      return { data: wifiPayload(c.wifi), problem: null }
    case 'vcard':
      if (!c.vcard.name.trim()) return need('연락처 이름을 입력하세요.')
      if (c.vcard.email.trim() && !EMAIL_RE.test(c.vcard.email.trim())) return need('이메일 주소 형식을 확인하세요. 예: name@company.co.kr')
      return { data: vcardPayload(c.vcard), problem: null }
    case 'tel':
      return normalizePhone(c.tel) ? { data: `tel:${normalizePhone(c.tel)}`, problem: null } : need('전화번호를 입력하세요.')
    case 'sms':
      return normalizePhone(c.sms.phone) ? { data: smsPayload(c.sms), problem: null } : need('문자를 받을 전화번호를 입력하세요.')
    case 'email':
      if (!c.email.to.trim()) return need('받는 사람 이메일 주소를 입력하세요.')
      if (!EMAIL_RE.test(c.email.to.trim())) return need('이메일 주소 형식을 확인하세요. 예: name@company.co.kr')
      return { data: emailPayload(c.email), problem: null }
  }
}

// ── 글자 → 바이트 ─────────────────────────────────────────
export function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length
}

/**
 * 한글 등 영문이 아닌 글자를 UTF-8 바이트 하나당 글자 하나인 문자열로 바꾼다.
 * QR 라이브러리가 글자 코드의 아래 8비트만 쓰기 때문에, 그대로 넘기면 한글이 깨진다.
 */
export function toByteString(s: string): string {
  let out = ''
  for (const b of new TextEncoder().encode(s)) out += String.fromCharCode(b)
  return out
}

// ── 모양 ──────────────────────────────────────────────────
export type Ecc = 'L' | 'M' | 'Q' | 'H'
export type DotShape = 'square' | 'rounded' | 'dots' | 'extra-rounded' | 'classy'
export type CornerShape = 'square' | 'extra-rounded' | 'dot'
export type CornerDotShape = 'square' | 'dot'
export type QrFormat = 'png' | 'jpeg' | 'svg'

export interface QrStyle {
  fg: string
  bg: string
  dots: DotShape
  corner: CornerShape
  cornerDot: CornerDotShape
  /** 바깥 여백(전체 크기 대비 %) */
  marginPct: number
  ecc: Ecc
  /** 로고 크기(10–50). 오류 복구 한도 안에서만 커진다. */
  logoSizePct: number
  /** 로고 둘레 여백(512px 기준 px) */
  logoMargin: number
}

export const DEFAULT_STYLE: QrStyle = {
  fg: '#14201a',
  bg: '#ffffff',
  dots: 'square',
  corner: 'square',
  cornerDot: 'square',
  marginPct: 4,
  ecc: 'M',
  logoSizePct: 40,
  logoMargin: 6,
}

export const SIZES = [512, 1024, 2048] as const
export const FORMAT_EXT: Record<QrFormat, string> = { png: 'png', jpeg: 'jpg', svg: 'svg' }

/** 로고가 가운데를 가리므로, 로고가 있으면 오류 복구 수준을 가장 높게(H) 올린다. */
export function effectiveEcc(chosen: Ecc, hasLogo: boolean): Ecc {
  return hasLogo ? 'H' : chosen
}

/** 가장 큰 QR(버전 40)에 바이트로 담을 수 있는 최대 길이 */
export const MAX_BYTES: Record<Ecc, number> = { L: 2953, M: 2331, Q: 1663, H: 1273 }

/** qr-code-styling 에 넘길 옵션 */
export function buildOptions(data: string, style: QrStyle, size: number, logo: string | null, format: QrFormat): Options {
  const clampPct = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
  return {
    type: format === 'svg' ? 'svg' : 'canvas',
    width: size,
    height: size,
    margin: Math.round((size * clampPct(style.marginPct, 0, 20)) / 100),
    data: toByteString(data),
    image: logo ?? undefined,
    qrOptions: { errorCorrectionLevel: effectiveEcc(style.ecc, Boolean(logo)) },
    imageOptions: {
      hideBackgroundDots: true,
      imageSize: clampPct(style.logoSizePct, 10, 50) / 100,
      margin: Math.round((clampPct(style.logoMargin, 0, 30) * size) / 512),
      saveAsBlob: true,
    },
    dotsOptions: { type: style.dots, color: style.fg },
    cornersSquareOptions: { type: style.corner, color: style.fg },
    cornersDotOptions: { type: style.cornerDot, color: style.fg },
    backgroundOptions: { color: style.bg },
  }
}

// ── 인식률 경고 ───────────────────────────────────────────
function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return 0
  const n = parseInt(m[1], 16)
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

export interface Warning {
  code: 'contrast' | 'inverted' | 'dense' | 'tiny-dots' | 'too-long'
  message: string
}

/** 색 조합이 스캔에 불리한지 */
export function colorWarnings(fg: string, bg: string): Warning[] {
  const out: Warning[] = []
  if (contrastRatio(fg, bg) < 3) out.push({ code: 'contrast', message: '점 색과 배경 색이 비슷해 인식이 안 될 수 있습니다. 점은 어둡게, 배경은 밝게 해 주세요.' })
  else if (luminance(fg) > luminance(bg)) out.push({ code: 'inverted', message: '어두운 배경에 밝은 점은 일부 휴대폰에서 읽히지 않습니다. 점을 어둡게, 배경을 밝게 하는 편이 안전합니다.' })
  return out
}

/** 내용이 QR 한도를 넘는지(넘으면 만들 수 없다) */
export function lengthProblem(data: string, ecc: Ecc): string | null {
  const bytes = utf8Length(data)
  if (bytes <= MAX_BYTES[ecc]) return null
  return `내용이 너무 깁니다(${bytes.toLocaleString('ko-KR')}바이트, 최대 ${MAX_BYTES[ecc].toLocaleString('ko-KR')}바이트). 글을 줄이거나, 긴 내용은 웹페이지에 올리고 그 주소를 QR 로 만드세요.`
}

/**
 * 점이 촘촘해 인식이 어려울 수 있는지. modules 는 QR 한 변의 칸 수(21–177).
 * 칸이 많을수록 작게 인쇄했을 때 읽기 어렵다.
 */
export function densityWarnings(modules: number, sizePx: number, marginPct: number): Warning[] {
  const out: Warning[] = []
  if (modules >= 57) out.push({ code: 'dense', message: `내용이 길어 점이 촘촘합니다(한 변 ${modules}칸). 작게 인쇄하면 읽기 어려우니 3cm 이상으로 크게 쓰거나 내용을 줄여 주세요.` })
  const usable = sizePx * (1 - (2 * marginPct) / 100)
  if (usable / modules < 4) out.push({ code: 'tiny-dots', message: '점 하나가 4px 보다 작습니다. 저장 크기를 더 크게 골라 주세요.' })
  return out
}

// ── 일괄 생성 ─────────────────────────────────────────────
export const MAX_BATCH = 500

export interface BatchRow {
  /** 표에서의 줄 번호(1부터) */
  line: number
  name: string
  content: string
  problem: string | null
}

export interface BatchTable {
  rows: BatchRow[]
  /** 한도를 넘어 버린 줄 수 */
  overflow: number
}

const HEADER_NAME = new Set(['이름', '파일명', '파일 이름', '제목', 'name', 'filename'])
const HEADER_CONTENT = new Set(['내용', '주소', '링크', 'url', 'link', 'content', 'text', '값'])

/**
 * 붙여넣은 표를 읽는다. 한 줄에 "이름[탭]내용"(쉼표도 가능). 한 칸만 있으면 내용으로 보고 이름은 QR_001 식으로 붙인다.
 * 첫 줄이 "이름 / 내용" 같은 머리글이면 건너뛴다.
 */
export function parseBatch(text: string, max = MAX_BATCH): BatchTable {
  const rows: BatchRow[] = []
  let overflow = 0
  let line = 0
  let first = true
  for (const raw of text.split(/\r?\n/)) {
    line++
    if (!raw.trim()) continue
    let name: string
    let content: string
    if (raw.includes('\t')) {
      const cells = raw.split('\t')
      name = (cells[0] ?? '').trim()
      content = cells.slice(1).join(' ').trim()
    } else {
      const i = raw.indexOf(',')
      // 쉼표가 없거나, 쉼표 앞이 주소처럼 보이면 한 칸(내용)으로 본다.
      if (i < 0 || /^[a-z][a-z0-9+.-]*:/i.test(raw.trim())) {
        name = ''
        content = raw.trim()
      } else {
        name = raw.slice(0, i).trim()
        content = raw.slice(i + 1).trim()
      }
    }
    if (first) {
      first = false
      if (HEADER_NAME.has(name.toLowerCase()) && HEADER_CONTENT.has(content.toLowerCase())) continue
    }
    if (rows.length >= max) {
      overflow++
      continue
    }
    const n = rows.length + 1
    const problem = !content ? '내용이 비어 있습니다' : lengthProblem(content, 'H') ? '내용이 너무 깁니다' : null
    rows.push({ line, name: name || `QR_${String(n).padStart(3, '0')}`, content, problem })
  }
  return { rows, overflow }
}

/** xlsx 에서 읽은 행 배열을 붙여넣기와 같은 글(탭 구분)로 바꾼다. 앞의 두 열만 쓴다. */
export function rowsToBatchText(rows: unknown[][]): string {
  const clean = (v: unknown) => String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim()
  return rows
    .map((r) => [clean(r?.[0]), clean(r?.[1])])
    .filter(([a, b]) => a || b)
    .map(([a, b]) => `${a}\t${b}`)
    .join('\n')
}

/** 만들 수 있는 줄마다 겹치지 않는 파일 이름을 붙인다(이름.확장자). */
export function batchFileNames(rows: readonly BatchRow[], ext: string): Array<{ row: BatchRow; filename: string }> {
  const used = new Set<string>()
  return rows.filter((r) => !r.problem).map((row) => ({ row, filename: uniqueName(`${sanitizeFilename(row.name, 'QR')}.${ext}`, used) }))
}
