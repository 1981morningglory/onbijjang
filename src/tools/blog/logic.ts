/** 블로그 본문 정리의 순수 로직: 줄바꿈 정리, 글자 수, 키워드 횟수, 금칙어 검사, 강조 구간. */

// ── 정리 ──────────────────────────────────────────────────
export interface CleanOptions {
  /** 문단 안에서 끊긴 짧은 줄을 한 줄로 잇는다(빈 줄은 문단 구분으로 남는다) */
  mergeShortLines: boolean
  /** 줄 너비에 맞춰 어절 단위로 줄을 나눈다 */
  wrap: boolean
  /** 한 줄 너비(한글 글자 수 기준, 영문·숫자·공백은 반 글자) */
  wrapWidth: number
  /** 연속 빈 줄을 하나로 */
  collapseBlankLines: boolean
  /** 줄 끝 공백 제거 */
  trimLineEnds: boolean
  /** 전각 공백·특수 공백을 일반 공백으로 */
  normalizeSpaces: boolean
  /** 이모지 제거 */
  removeEmoji: boolean
}

export const DEFAULT_CLEAN: CleanOptions = {
  mergeShortLines: true,
  wrap: true,
  wrapWidth: 18,
  collapseBlankLines: true,
  trimLineEnds: true,
  normalizeSpaces: true,
  removeEmoji: false,
}

export const WRAP_MIN = 8
export const WRAP_MAX = 40

// ©·®·™ 는 상표 표기에 쓰이므로 이모지로 보지 않는다.
const EMOJI = /(?:(?![©®™])\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|[\u{1F3FB}-\u{1F3FF}]|[‍️⃣])+/gu

/** 이모지를 지우고, 지운 자리에 남는 겹친 공백을 정리한다. */
export function stripEmoji(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const next = line.replace(EMOJI, '')
      return next === line ? line : next.replace(/ {2,}/g, ' ').trim()
    })
    .join('\n')
}

/** 전각 공백(　)·줄바꿈 없는 공백을 일반 공백으로 바꾸고, 보이지 않는 폭 없는 문자를 지운다. */
export function normalizeSpaces(text: string): string {
  return text.replace(/[　  -   ]/g, ' ').replace(/[​⁠﻿]/g, '')
}

/** 문단(빈 줄로 나뉜 덩어리) 안의 줄들을 공백 하나로 이어 한 줄로 만든다. */
export function mergeLines(text: string): string {
  const out: string[] = []
  let buf: string[] = []
  const flush = () => {
    if (buf.length) out.push(buf.join(' '))
    buf = []
  }
  for (const line of text.split('\n')) {
    if (line.trim()) buf.push(line.trim())
    else {
      flush()
      out.push('')
    }
  }
  flush()
  return out.join('\n')
}

/** 3줄 이상 이어진 빈 줄을 하나로 줄이고 맨 앞·뒤의 빈 줄을 없앤다. */
export function collapseBlankLines(text: string): string {
  return text
    .replace(/\n[ \t]*(?:\n[ \t]*)+\n/g, '\n\n')
    .replace(/^(?:[ \t]*\n)+/, '')
    .replace(/(?:\n[ \t]*)+$/, '')
}

const isWide = (cp: number) =>
  (cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) || cp >= 0x1f000

/** 화면에서 차지하는 너비. 한글·한자 등은 1, 영문·숫자·공백·기호는 0.5 */
export function visualWidth(text: string): number {
  let w = 0
  for (const ch of text) w += isWide(ch.codePointAt(0) ?? 0) ? 1 : 0.5
  return w
}

/** 한 줄을 어절(띄어쓰기) 단위로 width 에 맞춰 나눈다. 어절 하나가 width 보다 길어도 자르지 않는다. */
export function wrapLine(line: string, width: number): string[] {
  const words = line.split(/ +/).filter(Boolean)
  if (!words.length) return ['']
  const out: string[] = []
  let cur = ''
  let curW = 0
  for (const word of words) {
    const w = visualWidth(word)
    if (!cur) {
      cur = word
      curW = w
    } else if (curW + 0.5 + w > width) {
      out.push(cur)
      cur = word
      curW = w
    } else {
      cur = `${cur} ${word}`
      curW += 0.5 + w
    }
  }
  out.push(cur)
  return out
}

export function wrapText(text: string, width: number): string {
  const w = Math.min(WRAP_MAX, Math.max(WRAP_MIN, Math.round(width) || DEFAULT_CLEAN.wrapWidth))
  return text
    .split('\n')
    .flatMap((line) => (line.trim() ? wrapLine(line, w) : [line]))
    .join('\n')
}

/** 원문을 옵션대로 정리한 글. 원문은 바꾸지 않는다. */
export function cleanText(source: string, o: CleanOptions): string {
  let t = source.replace(/\r\n?/g, '\n')
  if (o.normalizeSpaces) t = normalizeSpaces(t)
  if (o.removeEmoji) t = stripEmoji(t)
  if (o.trimLineEnds) t = t.replace(/[ \t]+$/gm, '')
  if (o.mergeShortLines) t = mergeLines(t)
  if (o.collapseBlankLines) t = collapseBlankLines(t)
  if (o.wrap) t = wrapText(t, o.wrapWidth)
  return t
}

// ── 글자 수 ───────────────────────────────────────────────
export interface TextStats {
  /** 공백 포함(줄바꿈 제외) */
  withSpaces: number
  /** 공백 제외 */
  withoutSpaces: number
  /** 내용이 있는 줄 수 */
  lines: number
  /** 빈 줄로 나뉜 문단 수 */
  paragraphs: number
  /** 예상 읽기 시간(초) — 1분에 공백 제외 500자 기준 */
  readSeconds: number
}

export const READ_CHARS_PER_MINUTE = 500

function graphemeCount(text: string): number {
  if (!text) return 0
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    let n = 0
    for (const _ of new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(text)) n++
    return n
  }
  return Array.from(text).length
}

export function countStats(text: string): TextStats {
  const t = text.replace(/\r\n?/g, '\n')
  const lines = t.split('\n')
  const withSpaces = graphemeCount(t.replace(/\n/g, ''))
  const withoutSpaces = graphemeCount(t.replace(/\s/g, ''))
  let paragraphs = 0
  let inside = false
  for (const line of lines) {
    if (line.trim()) {
      if (!inside) paragraphs++
      inside = true
    } else inside = false
  }
  return {
    withSpaces,
    withoutSpaces,
    lines: lines.filter((l) => l.trim()).length,
    paragraphs,
    readSeconds: withoutSpaces ? Math.max(1, Math.round((withoutSpaces / READ_CHARS_PER_MINUTE) * 60)) : 0,
  }
}

export function formatReadTime(seconds: number): string {
  if (seconds <= 0) return '0초'
  if (seconds < 60) return `약 ${seconds}초`
  const m = Math.floor(seconds / 60)
  const s = Math.round((seconds % 60) / 10) * 10
  return s === 0 ? `약 ${m}분` : s === 60 ? `약 ${m + 1}분` : `약 ${m}분 ${s}초`
}

// ── 키워드·해시태그 ───────────────────────────────────────
export const MAX_KEYWORDS = 100

/** 공백·쉼표·# 로 나눠 키워드 목록을 만든다. 중복(대소문자 무시)을 빼고 max 개까지. */
export function parseKeywords(input: string, max = MAX_KEYWORDS): { keywords: string[]; dropped: number } {
  const seen = new Set<string>()
  const keywords: string[] = []
  let dropped = 0
  for (const raw of input.split(/[\s,，、#＃]+/)) {
    const k = raw.trim()
    if (!k || seen.has(k.toLowerCase())) continue
    seen.add(k.toLowerCase())
    if (keywords.length < max) keywords.push(k)
    else dropped++
  }
  return { keywords, dropped }
}

export function toHashtags(keywords: readonly string[]): string {
  return keywords.map((k) => `#${k}`).join(' ')
}

export type Range = [start: number, end: number]

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 낱말이 나온 자리(겹치지 않게, 대소문자 무시). 낱말 속 띄어쓰기는 줄바꿈·여러 공백과도 맞춘다. */
export function findRanges(text: string, term: string): Range[] {
  const t = term.trim()
  if (!t) return []
  const re = new RegExp(t.split(/\s+/).map(escapeRegExp).join('\\s+'), 'gi')
  const out: Range[] = []
  for (const m of text.matchAll(re)) out.push([m.index, m.index + m[0].length])
  return out
}

export interface KeywordCount {
  keyword: string
  count: number
  /** low: 기준보다 적게 · high: 기준보다 많이 */
  status: 'low' | 'ok' | 'high'
}

export function keywordReport(text: string, keywords: readonly string[], min: number, max: number): KeywordCount[] {
  return keywords.map((keyword) => {
    const count = findRanges(text, keyword).length
    return { keyword, count, status: count < min ? 'low' : max > 0 && count > max ? 'high' : 'ok' }
  })
}

// ── 금칙어 ────────────────────────────────────────────────
export interface BannedWord {
  word: string
  group: '과장' | '의료·효능' | '보장' | '내 목록'
}

/** 광고·후기 글에서 흔히 문제가 되는 표현의 기본 목록(직접 작성). 맥락에 따라 괜찮을 수도 있으니 "확인용"이다. */
export const DEFAULT_BANNED: BannedWord[] = [
  ...['최고', '최상', '최초', '최저가', '유일', '독보적', '1위', '완벽', '기적', '역대급', '무조건', '절대', '100%'].map((word) => ({ word, group: '과장' as const })),
  ...['치료', '완치', '예방', '치유', '특효', '만병통치', '항암', '약효', '처방', '부작용 없', '의사 추천', '즉시 효과', '통증 완화'].map((word) => ({ word, group: '의료·효능' as const })),
  ...['보장', '보증', '확실한 효과', '전액 환불', '원금 보장', '수익 보장', '영구적', '평생'].map((word) => ({ word, group: '보장' as const })),
]

/** 사용자 금칙어 입력(쉼표·줄바꿈 구분)을 낱말 목록으로. 낱말 안의 띄어쓰기는 유지한다. */
export function parseWordList(input: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of input.split(/[,，\n]+/)) {
    const w = raw.trim().replace(/\s+/g, ' ')
    if (!w || seen.has(w.toLowerCase())) continue
    seen.add(w.toLowerCase())
    out.push(w)
  }
  return out
}

/** 기본 목록(끈 것 제외) + 내 목록. 같은 낱말은 한 번만. */
export function activeBanned(disabledDefaults: readonly string[], userWords: readonly string[]): BannedWord[] {
  const off = new Set(disabledDefaults)
  const list = DEFAULT_BANNED.filter((b) => !off.has(b.word))
  const seen = new Set(list.map((b) => b.word.toLowerCase()))
  for (const word of userWords) {
    if (seen.has(word.toLowerCase())) continue
    seen.add(word.toLowerCase())
    list.push({ word, group: '내 목록' })
  }
  return list
}

export interface BannedHit {
  word: string
  group: BannedWord['group']
  count: number
}

export interface BannedScan {
  hits: BannedHit[]
  /** 걸린 자리 전체(겹치지 않음, 앞에서부터) */
  ranges: Range[]
  total: number
}

const overlaps = (a: Range, b: Range) => a[0] < b[1] && b[0] < a[1]

/** 금칙어가 나온 자리를 찾는다. 겹치면 긴 낱말을 우선한다("원금 보장" 안의 "보장"은 따로 세지 않는다). */
export function scanBanned(text: string, words: readonly BannedWord[]): BannedScan {
  const taken: Range[] = []
  const hits: BannedHit[] = []
  for (const b of [...words].sort((x, y) => y.word.length - x.word.length)) {
    let count = 0
    for (const r of findRanges(text, b.word)) {
      if (taken.some((t) => overlaps(t, r))) continue
      taken.push(r)
      count++
    }
    if (count) hits.push({ word: b.word, group: b.group, count })
  }
  hits.sort((a, b) => b.count - a.count || a.word.localeCompare(b.word, 'ko'))
  taken.sort((a, b) => a[0] - b[0])
  return { hits, ranges: taken, total: taken.length }
}

// ── 강조 ──────────────────────────────────────────────────
export interface Segment {
  text: string
  kind: 'plain' | 'keyword' | 'banned'
}

/** 본문을 보통 글·키워드·금칙어 조각으로 나눈다. 금칙어가 우선이고, 키워드끼리 겹치면 긴 것을 우선한다. */
export function highlightSegments(text: string, keywords: readonly string[], bannedRanges: readonly Range[]): Segment[] {
  const marks: Array<{ range: Range; kind: 'keyword' | 'banned' }> = bannedRanges.map((range) => ({ range, kind: 'banned' }))
  for (const k of [...keywords].sort((a, b) => b.length - a.length)) {
    for (const r of findRanges(text, k)) {
      if (!marks.some((m) => overlaps(m.range, r))) marks.push({ range: r, kind: 'keyword' })
    }
  }
  marks.sort((a, b) => a.range[0] - b.range[0])
  const out: Segment[] = []
  let pos = 0
  for (const m of marks) {
    if (m.range[0] > pos) out.push({ text: text.slice(pos, m.range[0]), kind: 'plain' })
    out.push({ text: text.slice(m.range[0], m.range[1]), kind: m.kind })
    pos = m.range[1]
  }
  if (pos < text.length) out.push({ text: text.slice(pos), kind: 'plain' })
  return out
}
