/** 서명·글자에 쓰는 글꼴 */
import type { TextSpec } from './types'

export interface FontChoice {
  id: string
  label: string
  /** CSS font-family */
  family: string
  weight: number
}

export const FONT_CHOICES: FontChoice[] = [
  { id: 'sans', label: '기본(고딕)', family: `"Pretendard Variable", Pretendard, "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`, weight: 500 },
  { id: 'serif', label: '명조', family: `"Nanum Myeongjo", "NanumMyeongjo", Batang, "바탕", "AppleMyungjo", "Noto Serif KR", serif`, weight: 500 },
  { id: 'pen', label: '손글씨 · 나눔펜', family: `"Nanum Pen Script", cursive`, weight: 400 },
  { id: 'gaegu', label: '손글씨 · 개구', family: `Gaegu, cursive`, weight: 400 },
  { id: 'local', label: '내 PC 글꼴', family: 'sans-serif', weight: 400 },
]

export const SEAL_FONT_CHOICES: FontChoice[] = [
  { id: 'serif', label: '명조(전통)', family: `"Nanum Myeongjo", "NanumMyeongjo", Batang, "바탕", "AppleMyungjo", "Noto Serif KR", serif`, weight: 700 },
  { id: 'block', label: '굵은 고딕', family: `"Black Han Sans", "Pretendard Variable", "Malgun Gothic", sans-serif`, weight: 400 },
  { id: 'sans', label: '고딕', family: `"Pretendard Variable", Pretendard, "Malgun Gothic", sans-serif`, weight: 800 },
  { id: 'pen', label: '손글씨', family: `"Nanum Pen Script", cursive`, weight: 400 },
]

/** 글꼴 이름을 CSS 에 안전하게 넣는다 */
export function quoteFamily(name: string): string {
  return `"${name.replace(/["\\\n\r]/g, '').trim()}"`
}

export function resolveFont(spec: Pick<TextSpec, 'font' | 'family'>): { family: string; weight: number } {
  if (spec.font === 'local') {
    const name = spec.family?.trim()
    return { family: name ? `${quoteFamily(name)}, "Malgun Gothic", sans-serif` : FONT_CHOICES[0].family, weight: 400 }
  }
  const found = FONT_CHOICES.find((f) => f.id === spec.font) ?? FONT_CHOICES[0]
  return { family: found.family, weight: found.weight }
}

/** 캔버스에 그리기 전에 웹폰트(필요한 글자 조각)를 불러온다. 실패해도 대체 글꼴로 그린다. */
export async function ensureFont(family: string, weight: number, text: string): Promise<void> {
  if (!('fonts' in document)) return
  try {
    await Promise.race([document.fonts.load(`${weight} 48px ${family}`, text || '가'), new Promise((resolve) => setTimeout(resolve, 5000))])
  } catch {
    // 대체 글꼴로 그린다
  }
}

interface LocalFontData {
  family: string
}

export const canQueryLocalFonts = () => typeof window !== 'undefined' && 'queryLocalFonts' in window

/** 내 PC 에 설치된 글꼴 이름 목록(Chrome·Edge, 권한 필요). 쓸 수 없으면 null. */
export async function queryLocalFamilies(): Promise<string[] | null> {
  if (!canQueryLocalFonts()) return null
  try {
    const fonts = await (window as unknown as { queryLocalFonts: () => Promise<LocalFontData[]> }).queryLocalFonts()
    return Array.from(new Set(fonts.map((f) => f.family))).sort((a, b) => a.localeCompare(b, 'ko'))
  } catch {
    return null
  }
}
