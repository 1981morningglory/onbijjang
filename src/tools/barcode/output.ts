import type { Cmd, LabelModel } from './layout'

/** 출력 — SVG · EPS · PDF(= Illustrator 에서 열리는 PDF 호환 .ai) · PNG. 색은 K100(먹 1도). */

const PT = 72 / 25.4
const f = (n: number) => String(Math.round(n * 1000) / 1000)
const psEsc = (s: string) => s.replace(/[\\()]/g, (m) => '\\' + m).replace(/[^\x20-\x7E]/g, '?')
const xmlEsc = (s: string) => s.replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]!)

/** 경로를 돌며 Q 는 C 로 바꿔 넘긴다 */
function walk(cmds: Cmd[], fn: (t: 'M' | 'L' | 'C' | 'Z', p: number[]) => void) {
  let cx = 0
  let cy = 0
  let sx = 0
  let sy = 0
  for (const c of cmds) {
    const p = c.p
    if (c.t === 'M') {
      fn('M', p)
      cx = sx = p[0]
      cy = sy = p[1]
    } else if (c.t === 'L') {
      fn('L', p)
      cx = p[0]
      cy = p[1]
    } else if (c.t === 'C') {
      fn('C', p)
      cx = p[4]
      cy = p[5]
    } else if (c.t === 'Q') {
      const [x1, y1, x, y] = p
      fn('C', [cx + (2 / 3) * (x1 - cx), cy + (2 / 3) * (y1 - cy), x + (2 / 3) * (x1 - x), y + (2 / 3) * (y1 - y), x, y])
      cx = x
      cy = y
    } else {
      fn('Z', [])
      cx = sx
      cy = sy
    }
  }
}

export function svgPathD(cmds: Cmd[]): string {
  const o: string[] = []
  walk(cmds, (t, p) => o.push(t + p.map(f).join(' ')))
  return o.join('')
}

export function toSVG(m: LabelModel, title: string): string {
  const p = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f(m.w)}mm" height="${f(m.h)}mm" viewBox="0 0 ${f(m.w)} ${f(m.h)}">`,
    `<title>${xmlEsc(title)}</title>`,
    `<rect width="${f(m.w)}" height="${f(m.h)}" fill="#fff"/>`,
    '<g fill="#000">',
  ]
  for (const b of m.bars) p.push(`<rect x="${f(b.x)}" y="${f(b.y)}" width="${f(b.w)}" height="${f(b.h)}"/>`)
  for (const c of m.paths) p.push(`<path d="${svgPathD(c)}"/>`)
  p.push('</g>', '</svg>')
  return p.join('\n')
}

interface VecOps {
  rect: (x: number, y: number, w: number, h: number) => string
  M: string
  L: string
  C: string
  Z: string
  fill: string
}
function vecOps(m: LabelModel, H: number, ops: VecOps): string[] {
  const o: string[] = []
  for (const b of m.bars) o.push(ops.rect(b.x * PT, H - (b.y + b.h) * PT, b.w * PT, b.h * PT))
  for (const cmds of m.paths) {
    walk(cmds, (t, p) => {
      const q: string[] = []
      for (let i = 0; i < p.length; i += 2) q.push(f(p[i] * PT), f(H - p[i + 1] * PT))
      o.push(t === 'Z' ? ops.Z : `${q.join(' ')} ${ops[t]}`)
    })
    o.push(ops.fill)
  }
  return o
}

export function toEPS(m: LabelModel, title: string): string {
  const W = m.w * PT
  const H = m.h * PT
  const o = [
    '%!PS-Adobe-3.0 EPSF-3.0',
    `%%BoundingBox: 0 0 ${Math.ceil(W)} ${Math.ceil(H)}`,
    `%%HiResBoundingBox: 0 0 ${f(W)} ${f(H)}`,
    `%%Title: (${psEsc(title)})`,
    '%%Creator: onbijjang barcode',
    '%%LanguageLevel: 2',
    '%%Pages: 1',
    '%%EndComments',
    '%%BeginProlog',
    '/R { rectfill } bind def /m { moveto } bind def /l { lineto } bind def /c { curveto } bind def /h { closepath } bind def',
    '%%EndProlog',
    '%%Page: 1 1',
    'gsave',
    '0 0 0 1 setcmykcolor',
    ...vecOps(m, H, { rect: (x, y, w, h) => `${f(x)} ${f(y)} ${f(w)} ${f(h)} R`, M: 'm', L: 'l', C: 'c', Z: 'h', fill: 'fill' }),
    'grestore',
    'showpage',
    '%%Trailer',
    '%%EOF',
    '',
  ]
  return o.join('\n')
}

export function toPDF(m: LabelModel, title: string): Uint8Array<ArrayBuffer> {
  const W = m.w * PT
  const H = m.h * PT
  const stream = ['q', '0 0 0 1 k', ...vecOps(m, H, { rect: (x, y, w, h) => `${f(x)} ${f(y)} ${f(w)} ${f(h)} re f`, M: 'm', L: 'l', C: 'c', Z: 'h', fill: 'f' }), 'Q'].join('\n')
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(W)} ${f(H)}] /Resources << >> /Contents 4 0 R >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    `<< /Title (${psEsc(title)}) /Producer (onbijjang barcode) >>`,
  ]
  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'
  const offs: number[] = []
  objs.forEach((ob, i) => {
    offs.push(out.length)
    out += `${i + 1} 0 obj\n${ob}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((n) => String(n).padStart(10, '0') + ' 00000 n \n').join('')
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  const bytes = new Uint8Array(out.length)
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff
  return bytes
}

/** 600dpi PNG */
export function toPNG(m: LabelModel): Promise<Blob> {
  const ppm = 600 / 25.4
  const cv = document.createElement('canvas')
  cv.width = Math.round(m.w * ppm)
  cv.height = Math.round(m.h * ppm)
  const g = cv.getContext('2d')!
  g.fillStyle = '#fff'
  g.fillRect(0, 0, cv.width, cv.height)
  g.fillStyle = '#000'
  for (const b of m.bars) {
    const x0 = Math.round(b.x * ppm)
    const x1 = Math.round((b.x + b.w) * ppm)
    g.fillRect(x0, Math.round(b.y * ppm), x1 - x0, Math.round(b.h * ppm))
  }
  g.scale(ppm, ppm)
  for (const p of m.paths) g.fill(new Path2D(svgPathD(p)))
  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('PNG 를 만들지 못했습니다.'))), 'image/png'))
}

export type OutFormat = 'eps' | 'ai' | 'pdf' | 'svg' | 'png'
export const FORMATS: Array<{ value: OutFormat; label: string }> = [
  { value: 'eps', label: 'EPS' },
  { value: 'ai', label: 'AI' },
  { value: 'pdf', label: 'PDF' },
  { value: 'svg', label: 'SVG' },
  { value: 'png', label: 'PNG' },
]

export async function render(m: LabelModel, fmt: OutFormat, title: string): Promise<Blob> {
  if (fmt === 'eps') return new Blob([toEPS(m, title)], { type: 'application/postscript' })
  if (fmt === 'ai') return new Blob([toPDF(m, title)], { type: 'application/illustrator' })
  if (fmt === 'pdf') return new Blob([toPDF(m, title)], { type: 'application/pdf' })
  if (fmt === 'svg') return new Blob([toSVG(m, title)], { type: 'image/svg+xml' })
  return toPNG(m)
}
