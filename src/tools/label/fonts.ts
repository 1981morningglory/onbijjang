import '@fontsource/gaegu/400.css'
import '@fontsource/gaegu/700.css'
import '@fontsource/nanum-pen-script/400.css'
import boldUrl from 'pretendard/dist/public/static/alternative/Pretendard-Bold.ttf?url'
import regularUrl from 'pretendard/dist/public/static/alternative/Pretendard-Regular.ttf?url'
import { useSyncExternalStore } from 'react'
import { MM_PER_PT, type FontId, type LabelElement, type Measure } from './model'

/**
 * 라벨에 쓸 수 있는 글꼴. 프리텐다드는 PDF 에 글자 그대로(벡터) 들어가고,
 * 나머지는 PDF 에서 600dpi 그림으로 바뀐다(인쇄 창으로 뽑을 때는 모두 글자 그대로).
 */
export const FONTS: Array<{ id: FontId; name: string; css: string }> = [
  { id: 'pretendard', name: '프리텐다드 (고딕)', css: '"Pretendard Variable", Pretendard, "Malgun Gothic", sans-serif' },
  { id: 'serif', name: '바탕 (명조)', css: '"Nanum Myeongjo", Batang, "바탕", AppleMyungjo, serif' },
  { id: 'blackhan', name: '검은고딕 (제목용)', css: '"Black Han Sans", "Pretendard Variable", sans-serif' },
  { id: 'gaegu', name: '개구 (손글씨)', css: 'Gaegu, "Pretendard Variable", sans-serif' },
  { id: 'nanumpen', name: '나눔펜 (손글씨)', css: '"Nanum Pen Script", "Pretendard Variable", cursive' },
]
const CSS_BY_ID = Object.fromEntries(FONTS.map((f) => [f.id, f.css])) as Record<FontId, string>
export const fontCss = (id: FontId) => CSS_BY_ID[id] ?? CSS_BY_ID.pretendard
export const fontWeight = (bold: boolean) => (bold ? 700 : 400)

// ── 글자 너비 재기 ────────────────────────────────────────
const REF_PX = 100
let ctx: CanvasRenderingContext2D | null = null
const widths = new Map<string, number>()

/** 캔버스로 글자 너비를 잰다(100px 기준으로 재서 비례 계산). 화면·인쇄·PDF 의 줄 나눔이 모두 이 함수를 쓴다. */
export function measureFor(font: FontId, bold: boolean): Measure {
  const spec = `${fontWeight(bold)} ${REF_PX}px ${fontCss(font)}`
  return (text, sizePt) => {
    const key = `${spec}\u0000${text}`
    let w = widths.get(key)
    if (w === undefined) {
      ctx ??= document.createElement('canvas').getContext('2d')
      if (!ctx) return text.length * sizePt * 0.5 * MM_PER_PT
      ctx.font = spec
      w = ctx.measureText(text).width / REF_PX
      if (widths.size > 20000) widths.clear()
      widths.set(key, w)
    }
    return w * sizePt * MM_PER_PT
  }
}

// ── 글꼴이 늦게 도착하면 다시 재기 ─────────────────────────
let version = 0
const listeners = new Set<() => void>()
let watching = false
function watchFonts() {
  if (watching || typeof document === 'undefined' || !document.fonts) return
  watching = true
  const bump = () => {
    widths.clear()
    version++
    listeners.forEach((fn) => fn())
  }
  document.fonts.addEventListener('loadingdone', bump)
  void document.fonts.ready.then(bump)
}

/** 웹 글꼴이 도착할 때마다 바뀌는 번호. 글자 배치를 다시 계산하는 신호로 쓴다. */
export function useFontsVersion(): number {
  return useSyncExternalStore(
    (fn) => {
      watchFonts()
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => version,
  )
}

/** 디자인에 쓰인 글꼴·글자를 모두 불러올 때까지 기다린다(인쇄·PDF 직전에 부른다). */
export async function ensureFonts(design: LabelElement[], texts: string[]): Promise<void> {
  if (!document.fonts) return
  const sample = Array.from(new Set(Array.from(texts.join('')))).join('').slice(0, 4000) || '가A1'
  const specs = new Set<string>([`400 16px ${fontCss('pretendard')}`])
  for (const el of design) if (el.type === 'text') specs.add(`${fontWeight(el.bold)} 16px ${fontCss(el.font)}`)
  await Promise.all([...specs].map((spec) => document.fonts.load(spec, sample).catch(() => [])))
  widths.clear()
}

// ── PDF 에 심을 프리텐다드 ────────────────────────────────
let pdfFonts: Promise<{ regular: Uint8Array; bold: Uint8Array }> | null = null

/** 프리텐다드 TTF 두 벌(보통·굵게, 각 2.7MB)을 내려받는다. PDF 를 처음 만들 때 한 번만. */
export function loadPdfFonts(): Promise<{ regular: Uint8Array; bold: Uint8Array }> {
  pdfFonts ??= (async () => {
    const get = async (url: string) => {
      const res = await fetch(url)
      if (!res.ok) throw new Error('글꼴 파일을 내려받지 못했습니다.')
      return new Uint8Array(await res.arrayBuffer())
    }
    const [regular, bold] = await Promise.all([get(regularUrl), get(boldUrl)])
    return { regular, bold }
  })()
  pdfFonts.catch(() => (pdfFonts = null))
  return pdfFonts
}
