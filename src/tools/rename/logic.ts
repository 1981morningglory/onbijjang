/** 파일명 일괄 변경의 순수 규칙 엔진. 파일 자체는 다루지 않고 이름과 수정일만 받는다. */

export type RuleType = 'sequence' | 'replace' | 'affix' | 'date' | 'mapping'

interface RuleBase {
  id: string
  enabled: boolean
}
/** ① 공통 이름 + 순번 */
export interface SequenceRule extends RuleBase {
  type: 'sequence'
  /** replace: 이름을 "공통 이름+번호"로 바꾼다 · suffix/prefix: 지금 이름 뒤/앞에 번호만 붙인다 */
  placement: 'replace' | 'suffix' | 'prefix'
  base: string
  start: number
  digits: number
  separator: string
}
/** ② 찾아 바꾸기 */
export interface ReplaceRule extends RuleBase {
  type: 'replace'
  find: string
  replace: string
  regex: boolean
  caseSensitive: boolean
}
/** ③ 앞·뒤에 붙이기 */
export interface AffixRule extends RuleBase {
  type: 'affix'
  prefix: string
  suffix: string
}
/** ④ 날짜 넣기 (YYYYMMDD) */
export interface DateRule extends RuleBase {
  type: 'date'
  source: 'today' | 'modified'
  position: 'prefix' | 'suffix'
  separator: string
}
/** ⑤ 엑셀 매핑: "원래 이름[탭]새 이름" 줄들 */
export interface MappingRule extends RuleBase {
  type: 'mapping'
  text: string
}
export type Rule = SequenceRule | ReplaceRule | AffixRule | DateRule | MappingRule

export interface FilenamePreset {
  base: string
  start: number
  digits: number
}

export const RULE_LABEL: Record<RuleType, string> = {
  sequence: '공통 이름 + 순번',
  replace: '찾아 바꾸기',
  affix: '앞·뒤에 붙이기',
  date: '날짜 넣기',
  mapping: '엑셀 매핑',
}

export const MAX_DIGITS = 8

export function createRule(type: RuleType, id: string, preset: FilenamePreset): Rule {
  switch (type) {
    case 'sequence':
      return { id, enabled: true, type, placement: 'replace', base: preset.base, start: preset.start, digits: preset.digits, separator: '_' }
    case 'replace':
      return { id, enabled: true, type, find: '', replace: '', regex: false, caseSensitive: false }
    case 'affix':
      return { id, enabled: true, type, prefix: '', suffix: '' }
    case 'date':
      return { id, enabled: true, type, source: 'today', position: 'prefix', separator: '_' }
    case 'mapping':
      return { id, enabled: true, type, text: '' }
  }
}

/** 저장해 둔 규칙을 지금 형식에 맞춘다. 알 수 없는 항목은 버리고 빠진 값은 기본값으로 채운다. */
export function normalizeRules(raw: unknown, preset: FilenamePreset): Rule[] | null {
  if (!Array.isArray(raw)) return null
  const out: Rule[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Partial<Rule> & { type?: string; id?: unknown }
    if (typeof r.id !== 'string' || !r.type || !(r.type in RULE_LABEL)) continue
    const merged = { ...createRule(r.type as RuleType, r.id, preset), ...r, enabled: r.enabled !== false } as Rule
    out.push(merged)
  }
  return out
}

// ── 이름 다루기 ───────────────────────────────────────────
/** "사진.JPG" → { stem: "사진", ext: "JPG" }. 점으로 시작하는 이름은 확장자가 없는 것으로 본다. */
export function splitName(name: string): { stem: string; ext: string } {
  const i = name.lastIndexOf('.')
  if (i <= 0 || i === name.length - 1) return { stem: name, ext: '' }
  return { stem: name.slice(0, i), ext: name.slice(i + 1) }
}

export function joinName(stem: string, ext: string): string {
  return ext ? `${stem}.${ext}` : stem
}

export function dateStamp(ms: number): string {
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

export function padNumber(n: number, digits: number): string {
  const width = Math.min(MAX_DIGITS, Math.max(1, Math.floor(digits) || 1))
  const v = Math.floor(n)
  return v < 0 ? `-${String(-v).padStart(width, '0')}` : String(v).padStart(width, '0')
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 숫자를 숫자로 비교하는 이름순(사진2 < 사진10) */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, 'ko', { numeric: true, sensitivity: 'base' })
}

// ── 엑셀 매핑 ─────────────────────────────────────────────
export interface MappingTable {
  pairs: Array<[from: string, to: string]>
  /** 두 칸이 채워지지 않아 건너뛴 줄 수 */
  skipped: number
}

/** 엑셀에서 복사한 두 열(탭 구분) 또는 "원래,새" 쉼표 구분 줄을 읽는다. */
export function parseMapping(text: string): MappingTable {
  const pairs: MappingTable['pairs'] = []
  let skipped = 0
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const cells = line.includes('\t') ? line.split('\t') : line.split(',')
    const from = (cells[0] ?? '').trim()
    const to = (cells[1] ?? '').trim()
    if (from && to) pairs.push([from, to])
    else skipped++
  }
  return { pairs, skipped }
}

/** xlsx 에서 읽은 행 배열을 매핑 글(탭 구분)로 바꾼다. 앞의 두 열만 쓴다. */
export function rowsToMappingText(rows: unknown[][]): string {
  const clean = (v: unknown) => String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim()
  return rows
    .map((r) => [clean(r?.[0]), clean(r?.[1])])
    .filter(([a, b]) => a || b)
    .map(([a, b]) => `${a}\t${b}`)
    .join('\n')
}

// ── 검사 ──────────────────────────────────────────────────
export type IssueCode = 'empty' | 'illegal' | 'reserved' | 'edge' | 'long' | 'duplicate' | 'unmatched'
export interface Issue {
  code: IssueCode
  /** error 는 저장을 막는다. warn 은 알려 주기만 한다. */
  level: 'error' | 'warn'
  message: string
}

const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f]/g
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** Windows 에서 쓸 수 없는 이름인지 검사한다(중복은 여기서 보지 않는다). */
export function checkName(name: string): Issue[] {
  const issues: Issue[] = []
  const { stem } = splitName(name)
  if (!stem.trim()) {
    issues.push({ code: 'empty', level: 'error', message: '이름이 비어 있습니다' })
    return issues
  }
  const bad = [...new Set(name.match(ILLEGAL) ?? [])]
  if (bad.length) {
    const shown = bad.map((c) => (c.charCodeAt(0) < 32 ? '줄바꿈·탭' : c))
    issues.push({ code: 'illegal', level: 'error', message: `쓸 수 없는 문자 ${[...new Set(shown)].join(' ')}` })
  }
  if (RESERVED.test(name.split('.')[0].trim())) issues.push({ code: 'reserved', level: 'error', message: 'Windows 가 쓰는 이름이라 사용할 수 없습니다' })
  if (/^\s/.test(name) || /[. ]$/.test(name) || /\s$/.test(stem)) issues.push({ code: 'edge', level: 'error', message: '앞뒤 공백이나 끝의 점은 쓸 수 없습니다' })
  if (name.length > 255) issues.push({ code: 'long', level: 'error', message: `이름이 너무 깁니다(${name.length}자, 최대 255자)` })
  return issues
}

// ── 규칙 적용 ─────────────────────────────────────────────
export interface FileInfo {
  name: string
  lastModified: number
}

export interface RenameRow {
  original: string
  next: string
  changed: boolean
  issues: Issue[]
}

export interface MappingInfo {
  /** 읽은 줄 수 */
  total: number
  skipped: number
  /** 어떤 파일과도 맞지 않은 줄의 "원래 이름" */
  unused: string[]
  /** 매핑에 없는 파일 수 */
  unmatchedFiles: number
}

export interface RenameOutcome {
  rows: RenameRow[]
  /** 규칙 id → 오류(잘못된 정규식 등). 오류가 난 규칙은 건너뛴다. */
  ruleErrors: Record<string, string>
  mapping: Record<string, MappingInfo>
  changedCount: number
  errorCount: number
  warnCount: number
}

interface Prepared {
  rule: Rule
  apply: (stem: string, file: FileInfo, index: number, ext: string) => { stem: string; unmatched?: boolean }
  finish?: () => void
}

function prepare(rule: Rule, now: number, outcome: RenameOutcome): Prepared | null {
  switch (rule.type) {
    case 'sequence': {
      const start = Number.isFinite(rule.start) ? Math.floor(rule.start) : 1
      return {
        rule,
        apply: (stem, _f, index) => {
          const num = padNumber(start + index, rule.digits)
          if (rule.placement === 'suffix') return { stem: `${stem}${rule.separator}${num}` }
          if (rule.placement === 'prefix') return { stem: `${num}${rule.separator}${stem}` }
          return { stem: rule.base ? `${rule.base}${rule.separator}${num}` : num }
        },
      }
    }
    case 'replace': {
      if (!rule.find) return null
      const flags = rule.caseSensitive ? 'g' : 'gi'
      let re: RegExp
      try {
        re = new RegExp(rule.regex ? rule.find : escapeRegExp(rule.find), flags)
      } catch (err) {
        outcome.ruleErrors[rule.id] = `정규식을 읽을 수 없습니다: ${err instanceof Error ? err.message : String(err)}`
        return null
      }
      const literal = rule.replace
      return { rule, apply: (stem) => ({ stem: rule.regex ? stem.replace(re, literal) : stem.replace(re, () => literal) }) }
    }
    case 'affix':
      if (!rule.prefix && !rule.suffix) return null
      return { rule, apply: (stem) => ({ stem: `${rule.prefix}${stem}${rule.suffix}` }) }
    case 'date':
      return {
        rule,
        apply: (stem, file) => {
          const stamp = dateStamp(rule.source === 'today' ? now : file.lastModified) || dateStamp(now)
          return { stem: rule.position === 'prefix' ? `${stamp}${rule.separator}${stem}` : `${stem}${rule.separator}${stamp}` }
        },
      }
    case 'mapping': {
      const table = parseMapping(rule.text)
      const lookup = new Map<string, { to: string; from: string }>()
      for (const [from, to] of table.pairs) if (!lookup.has(from.toLowerCase())) lookup.set(from.toLowerCase(), { to, from })
      const used = new Set<string>()
      const info: MappingInfo = { total: table.pairs.length, skipped: table.skipped, unused: [], unmatchedFiles: 0 }
      outcome.mapping[rule.id] = info
      if (!table.pairs.length) return null
      return {
        rule,
        apply: (stem, file, _i, ext) => {
          const full = file.name.toLowerCase()
          const key = lookup.has(full) ? full : splitName(file.name).stem.toLowerCase()
          const hit = lookup.get(key)
          if (!hit) {
            info.unmatchedFiles++
            return { stem, unmatched: true }
          }
          used.add(key)
          // 새 이름에 같은 확장자를 적어 두었으면 한 번만 붙도록 떼어 낸다.
          const to = ext && hit.to.toLowerCase().endsWith(`.${ext.toLowerCase()}`) ? hit.to.slice(0, -(ext.length + 1)) : hit.to
          return { stem: to }
        },
        finish: () => {
          for (const [key, v] of lookup) if (!used.has(key)) info.unused.push(v.from)
        },
      }
    }
  }
}

/**
 * 규칙을 위에서부터 차례로 적용해 새 이름을 만든다. 확장자는 그대로 둔다.
 * now 는 "오늘" 날짜 기준(테스트에서 고정할 수 있게 받는다).
 */
export function computeRenames(files: readonly FileInfo[], rules: readonly Rule[], now: number = Date.now()): RenameOutcome {
  const outcome: RenameOutcome = { rows: [], ruleErrors: {}, mapping: {}, changedCount: 0, errorCount: 0, warnCount: 0 }
  const active = rules.filter((r) => r.enabled).map((r) => prepare(r, now, outcome)).filter((p): p is Prepared => p !== null)

  files.forEach((file, index) => {
    const { stem: originalStem, ext } = splitName(file.name)
    let stem = originalStem
    const issues: Issue[] = []
    for (const p of active) {
      const res = p.apply(stem, file, index, ext)
      stem = res.stem
      if (res.unmatched && !issues.some((i) => i.code === 'unmatched')) issues.push({ code: 'unmatched', level: 'warn', message: '매핑 목록에 없는 파일입니다' })
    }
    const next = joinName(stem, ext)
    issues.push(...checkName(next))
    outcome.rows.push({ original: file.name, next, changed: next !== file.name, issues })
  })
  for (const p of active) p.finish?.()

  // Windows 는 대소문자를 구분하지 않으므로 소문자로 맞춰 중복을 찾는다.
  const seen = new Map<string, number>()
  for (const row of outcome.rows) seen.set(row.next.toLowerCase(), (seen.get(row.next.toLowerCase()) ?? 0) + 1)
  for (const row of outcome.rows) {
    const n = seen.get(row.next.toLowerCase()) ?? 0
    if (n > 1) row.issues.push({ code: 'duplicate', level: 'error', message: `같은 이름이 ${n}개입니다` })
    if (row.changed) outcome.changedCount++
    if (row.issues.some((i) => i.level === 'error')) outcome.errorCount++
    else if (row.issues.length) outcome.warnCount++
  }
  return outcome
}

// ── 변경 내역 CSV ─────────────────────────────────────────
const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

/** 엑셀에서 바로 열리는 변경 내역(머리글 포함). BOM 은 저장할 때 붙인다. */
export function toChangeCsv(rows: readonly RenameRow[]): string {
  const lines = [['번호', '원래 이름', '새 이름', '상태'].join(',')]
  rows.forEach((r, i) => {
    const state = r.issues.length ? r.issues.map((x) => x.message).join(' / ') : r.changed ? '변경' : '그대로'
    lines.push([String(i + 1), csvCell(r.original), csvCell(r.next), csvCell(state)].join(','))
  })
  return lines.join('\r\n')
}

/** 배열에서 from 위치의 항목을 to 위치로 옮긴 새 배열 */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list]
  if (from < 0 || from >= next.length) return next
  const [item] = next.splice(from, 1)
  next.splice(Math.min(next.length, Math.max(0, to)), 0, item)
  return next
}
