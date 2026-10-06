/**
 * 바코드 생성 — 순수 로직(화면·글꼴과 무관).
 * EAN-13 은 회사 고유코드 8801237 + 회사코드 뒤 5자리 + 검증코드, 쿠팡 R 바코드는 Code 128.
 */

export const COMPANY_PREFIX = '8801237'
export const MAX_ROWS = 500

export type BarcodeKind = 'flat' | 'long' | 'r'
export const isEanKind = (k: BarcodeKind) => k !== 'r'

// ── EAN-13 ───────────────────────────────────────────────
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
const R = L.map((p) => p.replace(/./g, (c) => (c === '0' ? '1' : '0')))
const G = R.map((p) => p.split('').reverse().join(''))
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']

export function eanCheckDigit(d12: string) {
  let odd = 0
  let even = 0
  for (let i = 0; i < 12; i++) {
    const n = Number(d12[i])
    if (i % 2 === 0) odd += n
    else even += n
  }
  const sum = odd + even * 3
  return { digit: (10 - (sum % 10)) % 10, odd, even, sum }
}

/** 95 모듈 비트열(1 = 바) */
export function ean13Bits(code13: string): string {
  const par = PARITY[Number(code13[0])]
  let bits = '101'
  for (let i = 1; i <= 6; i++) bits += par[i - 1] === 'L' ? L[Number(code13[i])] : G[Number(code13[i])]
  bits += '01010'
  for (let i = 7; i <= 12; i++) bits += R[Number(code13[i])]
  return bits + '101'
}

// ── Code 128 ─────────────────────────────────────────────
const C128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
]
const START_B = 104
const START_C = 105
const TO_C = 99
const TO_B = 100
const STOP = 106

export const code128Valid = (s: string) => s.length > 0 && /^[\x20-\x7E]+$/.test(s)

/** 코드 세트 B/C 를 섞어 가장 짧게. 숫자가 4자리 이상 이어지면 C(두 자리씩) */
export function code128Values(s: string): number[] {
  const digitRun = (i: number) => {
    let j = i
    while (j < s.length && s[j] >= '0' && s[j] <= '9') j++
    return j - i
  }
  const vals: number[] = []
  const lead = digitRun(0)
  let set: 'B' | 'C' = (lead === s.length && lead % 2 === 0) || lead >= 4 ? 'C' : 'B'
  vals.push(set === 'C' ? START_C : START_B)
  let i = 0
  while (i < s.length) {
    if (set === 'C') {
      if (digitRun(i) >= 2) {
        vals.push(Number(s.substr(i, 2)))
        i += 2
      } else {
        vals.push(TO_B)
        set = 'B'
      }
    } else {
      const run = digitRun(i)
      if (run >= 4) {
        if (run % 2 === 1) vals.push(s.charCodeAt(i++) - 32)
        vals.push(TO_C)
        set = 'C'
      } else vals.push(s.charCodeAt(i++) - 32)
    }
  }
  let chk = vals[0]
  for (let k = 1; k < vals.length; k++) chk += vals[k] * k
  vals.push(chk % 103, STOP)
  return vals
}

/** 바·공백 교대 폭을 비트열로 */
export function code128Bits(s: string): string {
  let bits = ''
  let bar = true
  for (const w of code128Values(s).map((v) => C128[v]).join('')) {
    bits += (bar ? '1' : '0').repeat(Number(w))
    bar = !bar
  }
  return bits
}

/** 비트열 → 바 목록(모듈 단위) */
export function bitsToRuns(bits: string): Array<{ m0: number; m1: number }> {
  const out: Array<{ m0: number; m1: number }> = []
  for (let i = 0; i < bits.length; ) {
    if (bits[i] !== '1') {
      i++
      continue
    }
    let j = i
    while (j < bits.length && bits[j] === '1') j++
    out.push({ m0: i, m1: j })
    i = j
  }
  return out
}

// ── 입력 해석 (한 줄씩, 엑셀 붙여넣기 포함) ─────────────────
export interface Row {
  /** 화면에 보여줄 입력값 */
  src: string
  code: string
  name: string
  no: string
  warn: string
  err: string
  skip: boolean
}

/** 회사코드: 15099-89039 / 1509989039 / NO.15099-89039 / 15099 – 89039 */
const NO_RE = /^(?:NO\.?)?(\d{5})[-–—_]?(\d{5})$/i

export function splitRows(text: string, kind: BarcodeKind): string[][] {
  const lines = text.split(/\r?\n/).map((s) => s.replace(/\s+$/, '')).filter((s) => s.trim())
  if (lines.length === 1 && !lines[0].includes('\t')) {
    const toks = lines[0].trim().split(/[,;\s]+/).filter(Boolean)
    const codeLike = isEanKind(kind) ? /^(NO\.?)?[0-9\-–—]+$/i : /^[A-Za-z0-9-]+$/
    if (toks.length > 1 && toks.every((t) => codeLike.test(t))) return toks.map((t) => [t])
  }
  return lines.map((l) => l.split('\t').map((c) => c.trim().replace(/^"|"$/g, '')).filter((c) => c !== ''))
}

export function parseEanRow(cells: string[]): Row {
  const r: Row = { src: cells.join('  '), code: '', name: '', no: '', warn: '', err: '', skip: false }
  let full = ''
  let art = ''
  let fromNo = ''
  let srcCell = ''
  for (const c of cells) {
    const d = c.replace(/\s/g, '')
    const m = d.match(NO_RE)
    if (m) {
      if (!r.no) {
        r.no = `${m[1]}-${m[2]}`
        fromNo = m[2]
        srcCell ||= c
      }
    } else if (/^\d{12,13}$/.test(d)) {
      if (!full) {
        full = d
        srcCell ||= c
      }
    } else if (/^\d{1,5}$/.test(d)) {
      if (!art) {
        art = d
        srcCell ||= c
      }
    } else if (!r.name) r.name = c
  }
  if (srcCell) r.src = srcCell
  if (full) {
    const c = eanCheckDigit(full.slice(0, 12))
    if (full.length === 13 && Number(full[12]) !== c.digit) {
      r.err = `검증코드 오류 (올바른 끝자리 ${c.digit})`
      r.code = full
      return r
    }
    r.code = full.slice(0, 12) + c.digit
    if (!r.code.startsWith(COMPANY_PREFIX)) r.warn = '8801237로 시작하지 않음'
    return r
  }
  if (!art && fromNo) art = fromNo
  if (!art) {
    r.skip = true
    r.err = '바코드 값 없음'
    return r
  }
  if (art.length < 5) {
    r.warn = `앞자리 0 보정 (${art} → ${art.padStart(5, '0')})`
    art = art.padStart(5, '0')
  }
  const d12 = COMPANY_PREFIX + art
  r.code = d12 + eanCheckDigit(d12).digit
  return r
}

export function parseRRow(cells: string[]): Row {
  const r: Row = { src: cells.join('  '), code: '', name: '', no: '', warn: '', err: '', skip: false }
  let code = ''
  let loose = ''
  for (const c of cells) {
    const m = c.replace(/\s/g, '').match(NO_RE)
    if (!code && /^R\d+$/i.test(c)) code = c.toUpperCase()
    else if (m) {
      if (!r.no) r.no = `${m[1]}-${m[2]}`
    } else if (!loose && /^[\x21-\x7E]+$/.test(c)) loose = c
    else if (!r.name) r.name = c
  }
  r.code = code || loose
  r.src = r.code || r.src
  if (!r.code) {
    r.skip = true
    r.err = '바코드 값 없음'
    return r
  }
  if (!code128Valid(r.code)) {
    r.err = '영문·숫자·기호만 쓸 수 있습니다'
    return r
  }
  if (!code) r.warn = 'R로 시작하지 않음'
  return r
}

export function parseInput(text: string, kind: BarcodeKind): Row[] {
  const parse = isEanKind(kind) ? parseEanRow : parseRRow
  return splitRows(text, kind).slice(0, MAX_ROWS).map(parse)
}

export type TopMode = 'none' | 'name' | 'no'

/** 맨 위 문구. 줄에 있는 제품명·회사코드가 공통 값보다 먼저 쓰인다. */
export function topText(r: Row, kind: BarcodeKind, mode: TopMode, commonName: string, commonNo: string): string {
  if (mode === 'name') return (r.name || commonName).trim()
  if (mode !== 'no') return ''
  let no = r.no || commonNo.trim().replace(/^NO\.?\s*/i, '')
  if (!no) return ''
  const digits = no.replace(/\D/g, '')
  if (isEanKind(kind) && /^\d{5}$/.test(no)) no = `${no}-${r.code.slice(7, 12)}`
  else if (/^\d{10}$/.test(digits) && !/[^0-9\-–—\s]/.test(no)) no = `${digits.slice(0, 5)}-${digits.slice(5)}`
  return (kind === 'r' ? 'NO. ' : 'NO.') + no
}

/** 저장 파일 이름(확장자 제외) */
export function fileBase(r: Row): string {
  const nm = r.name.replace(/[\\/:*?"<>|\t]+/g, ' ').trim().slice(0, 60)
  return nm ? `${r.code}_${nm}` : r.code
}
