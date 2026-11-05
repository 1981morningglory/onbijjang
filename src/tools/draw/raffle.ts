/**
 * 추첨 — 명단 읽기·핸드폰번호 중복 정리·무작위 추첨.
 * 무작위는 브라우저 암호용 난수(crypto.getRandomValues)로 뽑아 예측할 수 없게 한다.
 */

export interface Roster {
  /** 칸 이름(머리줄이 없으면 ‘칸1’…) */
  cols: string[]
  rows: string[][]
}

export interface Entry {
  /** 원래 명단에서 몇째 줄(1부터, 머리줄 빼고) */
  line: number
  cells: string[]
}

/** 0 이상 n 미만 정수(치우침 없이) */
export function randomInt(n: number): number {
  if (n <= 0) throw new Error('n must be positive')
  const max = Math.floor(0x100000000 / n) * n
  const buf = new Uint32Array(1)
  for (;;) {
    crypto.getRandomValues(buf)
    if (buf[0] < max) return buf[0] % n
  }
}

/** 섞기(Fisher–Yates, 암호용 난수) */
export function shuffle<T>(list: readonly T[]): T[] {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** 핸드폰번호 숫자만(+82 10… → 010…) */
export function phoneKey(v: string): string {
  let d = String(v ?? '').replace(/\D/g, '')
  if (d.startsWith('82') && d.length >= 11) d = `0${d.slice(2)}`
  // 엑셀이 숫자로 바꿔 앞의 0 이 빠진 번호(1012345678)
  if (/^1[016789]\d{7,8}$/.test(d)) d = `0${d}`
  return d
}
export const isPhone = (v: string) => /^01[016789]\d{7,8}$/.test(phoneKey(v))

/** 붙여 넣은 글 → 표. 엑셀에서 복사하면 칸이 탭으로 나뉜다. 한 줄에 한 사람 */
export function parsePasted(text: string): Roster {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim())
  // 엑셀 복사(탭) > 쉼표 > ‘이름 010-1234-5678’처럼 띄어 쓴 번호 > 한 칸
  const split = (l: string) => {
    if (l.includes('\t')) return l.split('\t').map((c) => c.trim())
    if (l.includes(',')) return l.split(',').map((c) => c.trim())
    const m = /^(.*?)\s+(\+?[\d][\d\s-]{8,}\d)$/.exec(l.trim())
    return m ? [m[1].trim(), m[2].trim()] : [l.trim()]
  }
  return withHeader(lines.map(split))
}

/** 첫 줄이 머리줄(이름·전화 같은 글자, 번호 없음)이면 칸 이름으로 쓴다 */
export function withHeader(raw: string[][]): Roster {
  const rows = raw.filter((r) => r.some((c) => String(c ?? '').trim()))
  const width = Math.max(1, ...rows.map((r) => r.length))
  const norm = rows.map((r) => Array.from({ length: width }, (_, i) => String(r[i] ?? '').trim()))
  const first = norm[0] ?? []
  const looksHeader = first.length > 0 && !first.some(isPhone) && first.some((c) => /이름|성명|성함|닉네임|아이디|id|전화|휴대|핸드폰|연락처|번호|phone|mobile|name|주소|이메일/i.test(c))
  if (looksHeader && norm.length > 1) return { cols: first.map((c, i) => c || `칸${i + 1}`), rows: norm.slice(1) }
  return { cols: Array.from({ length: width }, (_, i) => `칸${i + 1}`), rows: norm }
}

/** 핸드폰번호 칸 찾기: 이름에 전화·휴대·핸드폰·연락처가 있거나, 값이 가장 많이 번호 꼴인 칸. 없으면 -1 */
export function guessPhoneCol(r: Roster): number {
  const byName = r.cols.findIndex((c) => /휴대|핸드폰|전화|연락처|phone|mobile|hp/i.test(c))
  if (byName >= 0) return byName
  let best = -1
  let bestN = 0
  r.cols.forEach((_, i) => {
    const n = r.rows.filter((row) => isPhone(row[i])).length
    if (n > bestN) {
      best = i
      bestN = n
    }
  })
  return bestN >= Math.max(1, r.rows.length * 0.3) ? best : -1
}

/** 이름 칸 찾기(보여 줄 때 씀): 이름·성명·닉네임… 없으면 번호가 아닌 첫 칸 */
export function guessNameCol(r: Roster, phoneCol: number): number {
  const byName = r.cols.findIndex((c) => /이름|성명|성함|닉네임|아이디|name|id/i.test(c))
  if (byName >= 0) return byName
  const other = r.cols.findIndex((_, i) => i !== phoneCol)
  return other >= 0 ? other : 0
}

/**
 * 추첨 대상 정리: 빈 줄 빼고, 핸드폰번호가 겹치면 위(먼저 나온) 줄만 남긴다.
 * phoneCol < 0 이면 겹침 정리 없이 모두.
 */
export function dedupe(r: Roster, phoneCol: number): { entries: Entry[]; removed: Array<Entry & { keptLine: number }> } {
  const seen = new Map<string, number>()
  const entries: Entry[] = []
  const removed: Array<Entry & { keptLine: number }> = []
  r.rows.forEach((cells, i) => {
    const e = { line: i + 1, cells }
    if (phoneCol >= 0) {
      const k = phoneKey(cells[phoneCol])
      if (k) {
        const kept = seen.get(k)
        if (kept != null) {
          removed.push({ ...e, keptLine: kept })
          return
        }
        seen.set(k, e.line)
      }
    }
    entries.push(e)
  })
  return { entries, removed }
}

export interface Prize {
  name: string
  count: number
}
export interface Winner {
  prize: string
  /** 그 등수 안에서 몇째(1부터) */
  order: number
  entry: Entry
}

/** 등수 순서대로 뽑는다(1등부터). 섞은 뒤 앞에서부터 나눠 준다 — 한 사람은 한 번만 당첨 */
export function drawWinners(entries: Entry[], prizes: Prize[]): Winner[] {
  const need = prizes.reduce((s, p) => s + Math.max(0, p.count), 0)
  if (need > entries.length) throw new Error(`당첨자 ${need}명이 추첨 대상 ${entries.length}명보다 많습니다.`)
  const pool = shuffle(entries)
  const out: Winner[] = []
  let k = 0
  for (const p of prizes) for (let i = 0; i < p.count; i++) out.push({ prize: p.name, order: i + 1, entry: pool[k++] })
  return out
}

/** 010-1234-5678 → 010-****-5678 */
export function maskPhone(v: string): string {
  const d = phoneKey(v)
  if (d.length < 10) return v
  return `${d.slice(0, 3)}-****-${d.slice(-4)}`
}
/** 홍길동 → 홍*동, 김철 → 김* */
export function maskName(v: string): string {
  const s = String(v ?? '').trim()
  if (s.length <= 1) return s
  if (s.length === 2) return `${s[0]}*`
  return `${s[0]}${'*'.repeat(s.length - 2)}${s.at(-1)}`
}
