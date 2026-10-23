/**
 * 결과 나누기 — PDF 저장과 공유 링크.
 * - PDF: 화면의 결과 덩어리([data-pdf-block])를 하나씩 그림으로 떠서 A4 쪽에 차례로 담는다(덩어리가 쪽 사이에서 잘리지 않게).
 * - 링크: 입력값만 주소에 담는다. 받은 사람 화면에서 같은 계산을 다시 한다.
 */
import type { ChartInput } from './logic'
import { CITIES } from './logic'
import { AXES, TYPES, type Axis } from './mbti/data'

// ── 링크 ─────────────────────────────────────────────────
const BASE = () => `${location.origin}/tools/saju`

export function sajuLink(input: ChartInput, name: string): string {
  const q = new URLSearchParams()
  q.set('y', String(input.year))
  q.set('m', String(input.month))
  q.set('d', String(input.day))
  if (input.calendar === 'lunar') q.set('cal', input.leap ? 'leap' : 'lunar')
  q.set('t', input.hour == null ? 'x' : `${String(input.hour).padStart(2, '0')}${String(input.minute).padStart(2, '0')}`)
  q.set('g', input.gender === 'male' ? 'm' : 'f')
  const city = input.longitude == null ? null : CITIES.find((c) => c.lon === input.longitude)
  if (city) q.set('city', city.name)
  if (input.dayBoundary !== 'midnight') q.set('b', input.dayBoundary)
  if (name) q.set('n', name.slice(0, 20))
  return `${BASE()}?${q}`
}

export interface SajuLinkData {
  input: ChartInput
  name: string
  city: string
}
const int = (v: string | null) => (v != null && /^\d+$/.test(v) ? Number(v) : NaN)

/** 주소의 사주 입력값. 없거나 이상하면 null */
export function parseSajuLink(search: string): SajuLinkData | null {
  const q = new URLSearchParams(search)
  const year = int(q.get('y'))
  const month = int(q.get('m'))
  const day = int(q.get('d'))
  if (!(year >= 1800 && year <= 2300 && month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null
  const t = q.get('t') ?? 'x'
  const tm = /^(\d{2})(\d{2})$/.exec(t)
  const hour = tm ? Number(tm[1]) : null
  const minute = tm ? Number(tm[2]) : 0
  if (hour != null && (hour > 23 || minute > 59)) return null
  const cal = q.get('cal')
  const cityName = q.get('city') ?? ''
  const city = CITIES.find((c) => c.name === cityName)
  const b = q.get('b')
  return {
    input: {
      calendar: cal === 'lunar' || cal === 'leap' ? 'lunar' : 'solar',
      leap: cal === 'leap',
      year,
      month,
      day,
      hour,
      minute,
      gender: q.get('g') === 'm' ? 'male' : 'female',
      longitude: city ? city.lon : null,
      dayBoundary: b === 'jasi' || b === 'splitJasi' ? b : 'midnight',
    },
    name: (q.get('n') ?? '').slice(0, 20),
    city: city?.name ?? '',
  }
}

export function mbtiLink(type: string, pct: Record<Axis, number> | null): string {
  const q = new URLSearchParams({ tab: 'mbti', r: type })
  if (pct) q.set('p', AXES.map((a) => pct[a]).join('.'))
  return `${BASE()}?${q}`
}

export function parseMbtiLink(search: string): { type: string; pct: Record<Axis, number> | null } | null {
  const q = new URLSearchParams(search)
  const type = (q.get('r') ?? '').toUpperCase()
  if (!TYPES[type]) return null
  const nums = (q.get('p') ?? '').split('.').map(Number)
  const ok = nums.length === 4 && nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 100)
  // 비율이 유형과 맞지 않으면(손으로 고친 주소) 비율은 버린다
  const pct = ok ? (Object.fromEntries(AXES.map((a, i) => [a, nums[i]])) as Record<Axis, number>) : null
  const agrees = pct && AXES.every((a, i) => (pct[a] > 50) === (type[i] === a[0]))
  return { type, pct: agrees ? pct : null }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

// ── PDF ──────────────────────────────────────────────────
const A4_W = 595.28
const A4_H = 841.89
const MARGIN = 28
const GAP = 10

/** 화면 덩어리들을 A4 PDF 로. container 안의 [data-pdf-block] 차례대로, [data-pdf-skip] 은 뺀다 */
export async function exportPdf(container: HTMLElement, filename: string, title: string) {
  const [{ toCanvas, getFontEmbedCSS }, { PDFDocument, rgb }] = await Promise.all([import('html-to-image'), import('pdf-lib')])
  // 접어 둔 글(자세히 읽기)도 PDF 에는 펼쳐서 담는다
  document.body.dataset.pdf = '1'
  try {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    await buildPdf(container, filename, title, toCanvas, getFontEmbedCSS, PDFDocument, rgb)
  } finally {
    delete document.body.dataset.pdf
  }
}

async function buildPdf(
  container: HTMLElement,
  filename: string,
  title: string,
  toCanvas: typeof import('html-to-image').toCanvas,
  getFontEmbedCSS: typeof import('html-to-image').getFontEmbedCSS,
  PDFDocument: typeof import('pdf-lib').PDFDocument,
  rgb: typeof import('pdf-lib').rgb,
) {
  const blocks = [...container.querySelectorAll<HTMLElement>('[data-pdf-block]')].filter((el) => el.offsetParent !== null)
  if (!blocks.length) throw new Error('저장할 결과가 없습니다.')
  // 바탕색은 앱의 종이색(body 는 투명이라 검게 나온다)
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--color-paper').trim() || '#f7f4ec'
  const fontEmbedCSS = await getFontEmbedCSS(blocks[0]).catch(() => '')
  const filter = (n: HTMLElement) => !(n instanceof HTMLElement && n.dataset.pdfSkip != null)
  const pdf = await PDFDocument.create()
  pdf.setTitle(title)
  pdf.setCreator('온비짱')
  const contentW = A4_W - MARGIN * 2
  const usableH = A4_H - MARGIN * 2
  let page = pdf.addPage([A4_W, A4_H])
  page.drawRectangle({ x: 0, y: 0, width: A4_W, height: A4_H, color: cssRgb(bg, rgb) })
  let y = MARGIN // 위에서부터 쓴 높이
  const newPage = () => {
    page = pdf.addPage([A4_W, A4_H])
    page.drawRectangle({ x: 0, y: 0, width: A4_W, height: A4_H, color: cssRgb(bg, rgb) })
    y = MARGIN
  }
  for (const el of blocks) {
    const canvas = await toCanvas(el, { pixelRatio: 2, backgroundColor: bg, fontEmbedCSS, filter, cacheBust: false })
    const scale = contentW / canvas.width
    const h = canvas.height * scale
    if (h <= usableH) {
      if (y + h > A4_H - MARGIN && y > MARGIN) newPage()
      const img = await pdf.embedPng(await canvasPng(canvas))
      page.drawImage(img, { x: MARGIN, y: A4_H - y - h, width: contentW, height: h })
      y += h + GAP
    } else {
      // 한 쪽보다 긴 덩어리는 쪽 높이로 잘라 담는다
      if (y > MARGIN) newPage()
      const slicePx = Math.floor(usableH / scale)
      for (let top = 0; top < canvas.height; top += slicePx) {
        const part = document.createElement('canvas')
        part.width = canvas.width
        part.height = Math.min(slicePx, canvas.height - top)
        part.getContext('2d')!.drawImage(canvas, 0, -top)
        const img = await pdf.embedPng(await canvasPng(part))
        const ph = part.height * scale
        page.drawImage(img, { x: MARGIN, y: A4_H - MARGIN - ph, width: contentW, height: ph })
        if (top + slicePx < canvas.height) newPage()
        else y = MARGIN + ph + GAP
      }
    }
  }
  const bytes = await pdf.save()
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

async function canvasPng(c: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'))
  if (!blob) throw new Error('그림을 만들지 못했습니다.')
  return new Uint8Array(await blob.arrayBuffer())
}

function cssRgb<T>(hex: string, rgb: (r: number, g: number, b: number) => T): T {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  const [r, g, b] = m ? [m[1], m[2], m[3]].map((x) => parseInt(x, 16)) : [247, 244, 236]
  return rgb(r / 255, g / 255, b / 255)
}

/** 파일 이름에 못 쓰는 글자 빼기 */
export const safeName = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60)
