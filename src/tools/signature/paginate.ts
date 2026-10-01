/** Word 문서를 쪽으로 나누는 계산(순수 함수) */

export interface Span {
  top: number
  bottom: number
}

export interface PageSlice {
  start: number
  end: number
}

/**
 * 한 줄로 이어진 내용을 쪽 높이에 맞춰 자른다.
 * - hard: 잘리면 안 되는 것(글자 한 줄, 그림)
 * - soft: 되도록 자르지 않을 것(표의 한 행). 쪽보다 크면 포기하고 hard 만 지킨다.
 * - forced: 문서에 들어 있는 쪽 나눔 위치
 */
export function paginate(hard: Span[], soft: Span[], forced: number[], totalHeight: number, pageHeight: number, maxPages = 500): PageSlice[] {
  const pages: PageSlice[] = []
  if (totalHeight <= 0 || pageHeight <= 0) return [{ start: 0, end: Math.max(0, totalHeight) }]
  const eps = 0.5
  const forcedSorted = [...forced].sort((a, b) => a - b)
  const all = [...hard, ...soft]

  const safeBreak = (spans: Span[], start: number, limit: number): number | null => {
    let y = limit
    for (let guard = 0; guard < 1000; guard++) {
      let moved = false
      for (const s of spans) {
        if (s.top < y - eps && s.bottom > y + eps) {
          y = s.top
          moved = true
        }
      }
      if (!moved) break
    }
    return y > start + eps ? y : null
  }

  let start = 0
  while (start < totalHeight - eps && pages.length < maxPages) {
    const limit = start + pageHeight
    const nextForced = forcedSorted.find((f) => f > start + eps && f <= limit + eps)
    let end: number
    if (nextForced != null) end = nextForced
    else if (limit >= totalHeight - eps) end = totalHeight
    else end = safeBreak(all, start, limit) ?? safeBreak(hard, start, limit) ?? limit
    pages.push({ start, end })
    start = end
  }
  if (!pages.length) pages.push({ start: 0, end: totalHeight })
  return pages
}

export interface PageSetup {
  /** CSS px (96dpi) */
  width: number
  height: number
  margin: { top: number; right: number; bottom: number; left: number }
}

export const A4_SETUP: PageSetup = { width: 794, height: 1123, margin: { top: 96, right: 96, bottom: 96, left: 96 } }

const twipToPx = (twip: number) => twip / 15

/**
 * word/document.xml 에서 용지 크기와 여백을 읽는다(마지막 구역 기준).
 * 정보가 없거나 이상하면 A4 세로·여백 2.54cm.
 */
export function parsePageSetup(documentXml: string): PageSetup {
  const sections = documentXml.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g)
  const sect = sections?.[sections.length - 1]
  if (!sect) return A4_SETUP
  const attr = (tag: string, name: string): number | null => {
    const el = sect.match(new RegExp(`<w:${tag}\\b[^>]*>`))?.[0]
    const v = el?.match(new RegExp(`\\bw:${name}="(-?\\d+(?:\\.\\d+)?)"`))?.[1]
    return v != null ? Number(v) : null
  }
  const w = attr('pgSz', 'w')
  const h = attr('pgSz', 'h')
  const width = w && w >= 2880 && w <= 31680 ? twipToPx(w) : A4_SETUP.width
  const height = h && h >= 2880 && h <= 31680 ? twipToPx(h) : A4_SETUP.height
  const side = (name: string, fallback: number, max: number) => {
    const v = attr('pgMar', name)
    if (v == null) return fallback
    return Math.min(max, Math.max(0, twipToPx(Math.abs(v))))
  }
  return {
    width: Math.round(width),
    height: Math.round(height),
    margin: {
      top: Math.round(side('top', 96, height / 3)),
      bottom: Math.round(side('bottom', 96, height / 3)),
      left: Math.round(side('left', 96, width / 3)),
      right: Math.round(side('right', 96, width / 3)),
    },
  }
}

/** word/styles.xml 의 문서 기본 글자 크기(pt). 없으면 10. */
export function parseDefaultFontPt(stylesXml: string): number {
  const defaults = stylesXml.match(/<w:docDefaults>[\s\S]*?<\/w:docDefaults>/)?.[0]
  const half = defaults?.match(/<w:sz\b[^>]*\bw:val="(\d+)"/)?.[1]
  const pt = half ? Number(half) / 2 : 10
  return pt >= 6 && pt <= 24 ? pt : 10
}
