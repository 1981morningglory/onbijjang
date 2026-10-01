import type { ToolDef } from './registry'

const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']

/** 한글 음절을 초성으로 바꾼다: "배경 제거" → "ㅂㄱ ㅈㄱ" */
export function toChosung(text: string): string {
  let out = ''
  for (const ch of text) {
    const code = ch.charCodeAt(0) - 0xac00
    out += code >= 0 && code <= 11171 ? CHO[Math.floor(code / 588)] : ch
  }
  return out
}

const norm = (s: string) => s.toLowerCase().replace(/[\s·→\-_/]/g, '')
const isChosungOnly = (s: string) => /^[ㄱ-ㅎ]+$/.test(s)

/** 도구 검색. 제목 > 키워드 > 설명 순으로 점수를 주고, 초성만 입력해도 찾는다("ㅂㄱㅈㄱ"). */
export function searchTools(tools: ToolDef[], query: string): ToolDef[] {
  const q = norm(query)
  if (!q) return tools
  const chosung = isChosungOnly(q)
  const scored: Array<{ tool: ToolDef; score: number }> = []
  for (const tool of tools) {
    const title = norm(tool.title)
    let score = 0
    if (chosung) {
      const t = toChosung(title)
      if (t.startsWith(q)) score = 90
      else if (t.includes(q)) score = 70
      else if (tool.keywords.some((k) => toChosung(norm(k)).includes(q))) score = 40
    } else {
      if (title.startsWith(q)) score = 100
      else if (title.includes(q)) score = 80
      else if (tool.keywords.some((k) => norm(k).includes(q))) score = 60
      else if (norm(tool.summary).includes(q)) score = 30
    }
    if (score) scored.push({ tool, score })
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.tool)
}
