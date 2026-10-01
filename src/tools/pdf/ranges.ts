/** 쪽 범위 입력("1-3,5") 해석과 분할 묶음 계산. 순수 함수만 둔다. */

export interface RangeResult {
  /** 쉼표로 나눈 묶음마다의 쪽(0부터 세는 위치). 입력 순서를 그대로 따른다. */
  groups: number[][]
  /** 모든 묶음을 이어 붙이고 겹치는 쪽을 뺀 목록 */
  indices: number[]
  /** 잘못된 부분이 있으면 사용자에게 보여줄 설명 */
  error: string | null
}

/**
 * "1-3, 5, 8-" 같은 입력을 해석한다. 쪽 번호는 1부터, total 은 전체 쪽 수.
 * - "3-" 은 3쪽부터 끝까지, "-3" 은 처음부터 3쪽까지
 * - "5-2" 는 5, 4, 3, 2 (거꾸로)
 * - 구분은 쉼표·공백·세미콜론, 범위 기호는 - ~ – 모두 받는다
 */
export function parseRanges(input: string, total: number): RangeResult {
  const groups: number[][] = []
  const text = input.trim()
  if (!text) return { groups, indices: [], error: null }
  if (total <= 0) return { groups, indices: [], error: '쪽이 없습니다.' }

  const parts = text
    .replace(/[~–—―]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .split(/[,;\s]+/)
    .filter(Boolean)

  for (const part of parts) {
    const m = /^(\d*)(-?)(\d*)$/.exec(part)
    if (!m || (m[1] === '' && m[3] === '')) return { groups: [], indices: [], error: `‘${part}’ 는 읽을 수 없습니다. 1-3,5 처럼 적어 주세요.` }
    const hasDash = m[2] === '-'
    const from = m[1] === '' ? 1 : Number(m[1])
    const to = !hasDash ? from : m[3] === '' ? total : Number(m[3])
    if (from < 1 || to < 1) return { groups: [], indices: [], error: '쪽 번호는 1부터 시작합니다.' }
    if (from > total || to > total) return { groups: [], indices: [], error: `${Math.max(from, to)}쪽은 없습니다. 전체 ${total}쪽입니다.` }
    const group: number[] = []
    if (from <= to) for (let p = from; p <= to; p++) group.push(p - 1)
    else for (let p = from; p >= to; p--) group.push(p - 1)
    groups.push(group)
  }

  const seen = new Set<number>()
  const indices: number[] = []
  for (const g of groups) {
    for (const i of g) {
      if (!seen.has(i)) {
        seen.add(i)
        indices.push(i)
      }
    }
  }
  return { groups, indices, error: null }
}

/** 0부터 세는 위치 목록을 "1-3,5" 형태로 줄여 적는다(오름차순으로 이어지는 것만 묶는다). */
export function formatRanges(indices: number[]): string {
  const out: string[] = []
  let i = 0
  while (i < indices.length) {
    let j = i
    while (j + 1 < indices.length && indices[j + 1] === indices[j] + 1) j++
    out.push(j > i ? `${indices[i] + 1}-${indices[j] + 1}` : `${indices[i] + 1}`)
    i = j + 1
  }
  return out.join(',')
}

/** N쪽마다 나누기: [0..total) 을 size 개씩 묶는다. */
export function chunkEvery(total: number, size: number): number[][] {
  const n = Math.max(1, Math.floor(size))
  const groups: number[][] = []
  for (let start = 0; start < total; start += n) {
    const g: number[] = []
    for (let i = start; i < Math.min(total, start + n); i++) g.push(i)
    groups.push(g)
  }
  return groups
}

/** 분할 결과 파일명에 붙일 꼬리: 한 쪽이면 "3", 이어지면 "1-3", 흩어져 있으면 "1,3,5" (길면 줄인다) */
export function groupLabel(group: number[]): string {
  const label = formatRanges(group)
  return label.length > 24 ? `${label.slice(0, 22)}…` : label
}

/** 쪽 번호 형식. n 은 이 쪽 번호, total 은 마지막 번호 */
export type NumberFormat = 'n' | 'n/total' | '-n-' | 'n쪽' | 'page n'

export function formatPageNumber(format: NumberFormat, n: number, total: number): string {
  switch (format) {
    case 'n/total':
      return `${n} / ${total}`
    case '-n-':
      return `- ${n} -`
    case 'n쪽':
      return `${n}쪽`
    case 'page n':
      return `Page ${n}`
    default:
      return String(n)
  }
}
