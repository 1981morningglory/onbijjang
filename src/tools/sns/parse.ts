/**
 * 지원자가 적은 SNS 주소를 아이디로 바꾼다. 신청서에는 오타·공백·아이디만 적은 경우가 많아 너그럽게 읽는다.
 */

export type SnsKind = 'ig' | 'blog'

export interface Applicant {
  /** 신청서의 몇 번째 줄인지(엑셀 행 번호) */
  row?: number
  name?: string
  phone?: string
  /** 신청서에 적은 그대로 */
  raw: string
}

export interface ParsedList {
  /** 아이디 → 그 아이디를 적은 사람들 */
  keys: Map<string, Applicant[]>
  invalid: Applicant[]
  /** 같은 아이디가 두 번 이상 나온 수 */
  duplicates: number
}

const IG_RESERVED = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct', 'tv', 'about', 'developer', 'legal', 'web', 'share', 'com', 'con', 'co', 'www'])
const IG_USER = /^[a-z0-9._]{1,30}$/
const okUser = (u: string) => IG_USER.test(u) && /[a-z]/.test(u) && !IG_RESERVED.has(u)

/** 인스타그램 주소·아이디 → 아이디(소문자). 못 읽으면 null */
export function igKey(input: string): string | null {
  const s = input.trim().replace(/\s+/g, '').replace(/[)\]>,]+$/, '')
  if (!s) return null
  // instagram.com 과 흔한 오타(instagrram, instargram, instagarm, .con, 빗금 빠짐, instagram.com: 등)
  const d = /inst[a-z]*/i.exec(s)
  if (d && /^inst[a-z]*g[a-z]*[mn]$/i.test(d[0])) {
    const after = s.slice(d.index + d[0].length)
    if (/^(?:[./:]|com|con)/i.test(after)) {
      const rest = after
        .replace(/^\.?(?:com|con|co)?/i, '')
        .replace(/^[/:]+/, '')
        .replace(/^_u\//i, '')
        .replace(/^@/, '')
      const h = /^[A-Za-z0-9_][A-Za-z0-9._]{0,29}/.exec(rest)
      const u = h ? h[0].toLowerCase().replace(/\.+$/, '') : ''
      return okUser(u) ? u : null
    }
  }
  if (/^[^@]+@[^@]+\.[a-z]{2,}$/i.test(s)) return null // 이메일
  if (/https?:|www\.|\.(?:com|net|kr|co)\b/i.test(s)) return null // 다른 사이트 주소
  // '인스타그램/@아이디' 처럼 글 속에 @아이디
  const at = /@([A-Za-z0-9._]{2,30})/.exec(s)
  if (at) {
    const u = at[1].toLowerCase().replace(/\.+$/, '')
    return okUser(u) ? u : null
  }
  if (/[/:]/.test(s)) return null
  const u = s.toLowerCase()
  return okUser(u) && !/^\d+$/.test(u) ? u : null
}

const BLOG_ID = /^[a-z0-9_-]{2,40}$/

/** 네이버 블로그 주소·아이디 → 아이디(소문자) 또는 'naverme:코드'. 못 읽으면 null */
export function blogKey(input: string): string | null {
  const s = input.trim().replace(/\s+/g, '')
  if (!s) return null
  const q = /[?&]blogId=([A-Za-z0-9_-]+)/i.exec(s)
  if (q) return q[1].toLowerCase()
  const m = /(?:m\.)?blog\.naver\.com?\/+([A-Za-z0-9_-]+)/i.exec(s)
  if (m && !/^(PostView|PostList|prologue|BlogHome|SympathyHistoryList)/i.test(m[1])) return m[1].toLowerCase()
  const me = /([A-Za-z0-9_-]+)\.blog\.me/i.exec(s)
  if (me) return me[1].toLowerCase()
  const short = /naver\.me\/([A-Za-z0-9]{3,20})/i.exec(s)
  if (short) return `naverme:${short[1]}`
  // 블로그를 고르고 네이버 메일을 적은 경우: 네이버 블로그 아이디는 보통 네이버 아이디와 같다
  const mail = /^([A-Za-z0-9_-]{2,40})@naver\.?com$/i.exec(s)
  if (mail) return mail[1].toLowerCase()
  if (/[/:.@]/.test(s)) return null
  const id = s.toLowerCase()
  return BLOG_ID.test(id) && /[a-z]/.test(id) ? id : null
}

export const keyOf = (kind: SnsKind, input: string) => (kind === 'ig' ? igKey(input) : blogKey(input))

/** 어느 SNS 주소인지 주소만 보고 짐작 */
export function guessKind(input: string): SnsKind | null {
  const s = input.replace(/\s+/g, '')
  if (/inst[a-z]{0,3}gr+[a-z]{0,2}m/i.test(s)) return 'ig'
  if (/blog\.naver|\.blog\.me|naver\.me\//i.test(s)) return 'blog'
  return null
}

/** 칸에 붙여 넣은 글 → 줄마다 지원자 */
export function linesToApplicants(text: string): Applicant[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((raw) => ({ raw }))
}

export function parseList(kind: SnsKind, people: Applicant[]): ParsedList {
  const keys = new Map<string, Applicant[]>()
  const invalid: Applicant[] = []
  let duplicates = 0
  for (const p of people) {
    const k = keyOf(kind, p.raw)
    if (!k) {
      invalid.push(p)
      continue
    }
    const list = keys.get(k)
    if (list) {
      list.push(p)
      duplicates++
    } else keys.set(k, [p])
  }
  return { keys, invalid, duplicates }
}

/** 지원자 엑셀(설문 결과)을 읽어 인스타그램·블로그 지원자로 나눈다. 이름·연락처는 브라우저 밖으로 나가지 않는다. */
export async function readApplicantsXlsx(file: File): Promise<{ ig: Applicant[]; blog: Applicant[]; other: Applicant[]; total: number }> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  const ws = wb.worksheets[0]
  if (!ws) throw new Error('시트가 없습니다.')
  const text = (v: unknown): string => {
    if (v == null) return ''
    if (typeof v === 'object') {
      const o = v as { text?: unknown; hyperlink?: unknown; result?: unknown; richText?: Array<{ text: string }> }
      if (o.richText) return o.richText.map((r) => r.text).join('')
      return String(o.text ?? o.hyperlink ?? o.result ?? '')
    }
    return String(v)
  }
  // 머리줄 찾기: 'SNS' 와 '주소'가 들어간 칸이 있는 줄
  let headRow = 0
  const col = { url: 0, name: 0, phone: 0, type: 0 }
  for (let r = 1; r <= Math.min(10, ws.rowCount) && !headRow; r++) {
    ws.getRow(r).eachCell((cell, c) => {
      const t = text(cell.value).replace(/\s+/g, '')
      if (/SNS.*주소|주소.*SNS|URL|링크/i.test(t) && !col.url) col.url = c
      else if (/성함|이름|성명/.test(t) && !col.name) col.name = c
      else if (/연락처|전화|휴대폰/.test(t) && !col.phone) col.phone = c
      else if (/SNS.*선택|채널|SNS종류/i.test(t) && !col.type) col.type = c
    })
    if (col.url) headRow = r
  }
  if (!col.url) throw new Error('SNS 주소 칸을 찾지 못했습니다. 머리줄에 ‘SNS주소’가 있는 엑셀인지 확인해 주세요.')
  const ig: Applicant[] = []
  const blog: Applicant[] = []
  const other: Applicant[] = []
  let total = 0
  for (let r = headRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const raw = text(row.getCell(col.url).value).trim()
    const typ = col.type ? text(row.getCell(col.type).value) : ''
    if (!raw && !typ) continue
    total++
    const p: Applicant = { row: r, raw, name: col.name ? text(row.getCell(col.name).value).trim() : undefined, phone: col.phone ? text(row.getCell(col.phone).value).trim() : undefined }
    const kind = guessKind(raw) ?? (/인스타/.test(typ) ? 'ig' : /블로그/.test(typ) ? 'blog' : null)
    if (kind === 'ig') ig.push(p)
    else if (kind === 'blog') blog.push(p)
    else other.push({ ...p, raw: raw || `(${typ || '주소 없음'})` })
  }
  return { ig, blog, other, total }
}
