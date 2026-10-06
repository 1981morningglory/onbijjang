/**
 * QR SVG(qr-code-styling 결과) → 인쇄용 벡터 파일(EPS · PDF · AI).
 * qr-code-styling 은 모양을 clipPath 안의 rect·circle·path(회전 포함)로 그리고, 색은 그 clipPath 를 쓴 rect 의 fill 로 칠한다.
 * 여기서는 clipPath 속 도형을 모두 3차 베지어 경로로 바꿔 그 색으로 직접 칠한다(바코드 생성기의 EPS·AI 와 같은 방식).
 * 가운데 로고(래스터)는 배경색 위에 합성한 JPG 로 넣는다.
 */

type Pt = [number, number]
type Seg = { t: 'M'; p: Pt } | { t: 'L'; p: Pt } | { t: 'C'; c1: Pt; c2: Pt; p: Pt } | { t: 'Z' }
export interface VecShape {
  segs: Seg[]
  evenOdd: boolean
  color: string
}
export interface VecImage {
  jpeg: Uint8Array
  px: number
  py: number
  x: number
  y: number
  w: number
  h: number
}
export interface VecDoc {
  width: number
  height: number
  shapes: VecShape[]
  image: VecImage | null
}
type M6 = [number, number, number, number, number, number]

const ID: M6 = [1, 0, 0, 1, 0, 0]
const mul = (a: M6, b: M6): M6 => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
]
const ap = (m: M6, [x, y]: Pt): Pt => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

export function parseTransform(s: string | null): M6 {
  let m = ID
  if (!s) return m
  for (const [, fn, raw] of s.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = raw.split(/[\s,]+/).filter(Boolean).map(Number)
    let t: M6 = ID
    if (fn === 'translate') t = [1, 0, 0, 1, a[0] || 0, a[1] || 0]
    else if (fn === 'scale') t = [a[0], 0, 0, a[1] ?? a[0], 0, 0]
    else if (fn === 'matrix' && a.length === 6) t = a as M6
    else if (fn === 'rotate') {
      const r = ((a[0] || 0) * Math.PI) / 180
      const c = Math.cos(r)
      const sn = Math.sin(r)
      const rot: M6 = [c, sn, -sn, c, 0, 0]
      t = a.length >= 3 ? mul(mul([1, 0, 0, 1, a[1], a[2]], rot), [1, 0, 0, 1, -a[1], -a[2]]) : rot
    }
    m = mul(m, t)
  }
  return m
}

/** 타원 호 → 3차 베지어(SVG 명세 F.6 의 중심 매개변수 변환) */
function arcToCubics(p0: Pt, rx: number, ry: number, phiDeg: number, large: boolean, sweep: boolean, p: Pt): Array<[Pt, Pt, Pt]> {
  if ((p0[0] === p[0] && p0[1] === p[1]) || !rx || !ry) return [[p0, p, p]]
  rx = Math.abs(rx)
  ry = Math.abs(ry)
  const phi = (phiDeg * Math.PI) / 180
  const cp = Math.cos(phi)
  const sp = Math.sin(phi)
  const dx = (p0[0] - p[0]) / 2
  const dy = (p0[1] - p[1]) / 2
  const x1 = cp * dx + sp * dy
  const y1 = -sp * dx + cp * dy
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
  if (lam > 1) {
    rx *= Math.sqrt(lam)
    ry *= Math.sqrt(lam)
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den))
  const cx1 = (k * rx * y1) / ry
  const cy1 = (-k * ry * x1) / rx
  const cx = cp * cx1 - sp * cy1 + (p0[0] + p[0]) / 2
  const cy = sp * cx1 + cp * cy1 + (p0[1] + p[1]) / 2
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry)
  let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry)
  if (!sweep && dt > 0) dt -= 2 * Math.PI
  else if (sweep && dt < 0) dt += 2 * Math.PI
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9))
  const d = dt / n
  const kk = (4 / 3) * Math.tan(d / 4)
  const pt = (t: number): Pt => [cx + rx * Math.cos(t) * cp - ry * Math.sin(t) * sp, cy + rx * Math.cos(t) * sp + ry * Math.sin(t) * cp]
  const der = (t: number): Pt => [-rx * Math.sin(t) * cp - ry * Math.cos(t) * sp, -rx * Math.sin(t) * sp + ry * Math.cos(t) * cp]
  const out: Array<[Pt, Pt, Pt]> = []
  for (let i = 0; i < n; i++) {
    const a = t1 + i * d
    const b = a + d
    const pa = pt(a)
    const pb = i === n - 1 ? p : pt(b)
    const da = der(a)
    const db = der(b)
    out.push([[pa[0] + kk * da[0], pa[1] + kk * da[1]], [pb[0] - kk * db[0], pb[1] - kk * db[1]], pb])
  }
  return out
}

/** SVG path d → 절대 좌표 M/L/C/Z */
export function parsePathD(d: string): Seg[] {
  const toks = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? []
  const out: Seg[] = []
  let i = 0
  let cmd = ''
  let cur: Pt = [0, 0]
  let start: Pt = [0, 0]
  let lastC: Pt | null = null
  let lastQ: Pt | null = null
  const num = () => Number(toks[i++])
  const isNum = () => i < toks.length && !/^[a-zA-Z]$/.test(toks[i])
  while (i < toks.length) {
    if (/^[a-zA-Z]$/.test(toks[i])) cmd = toks[i++]
    else if (!cmd) break
    const rel = cmd === cmd.toLowerCase()
    const C = cmd.toUpperCase()
    const R = (x: number, y: number): Pt => (rel ? [cur[0] + x, cur[1] + y] : [x, y])
    if (C === 'Z') {
      out.push({ t: 'Z' })
      cur = start
      lastC = lastQ = null
      continue
    }
    if (!isNum()) continue
    if (C === 'M') {
      cur = start = R(num(), num())
      out.push({ t: 'M', p: cur })
      cmd = rel ? 'l' : 'L'
      lastC = lastQ = null
    } else if (C === 'L') {
      cur = R(num(), num())
      out.push({ t: 'L', p: cur })
      lastC = lastQ = null
    } else if (C === 'H') {
      const x = num()
      cur = [rel ? cur[0] + x : x, cur[1]]
      out.push({ t: 'L', p: cur })
      lastC = lastQ = null
    } else if (C === 'V') {
      const y = num()
      cur = [cur[0], rel ? cur[1] + y : y]
      out.push({ t: 'L', p: cur })
      lastC = lastQ = null
    } else if (C === 'C' || C === 'S') {
      const c1: Pt = C === 'C' ? R(num(), num()) : lastC ? [2 * cur[0] - lastC[0], 2 * cur[1] - lastC[1]] : cur
      const c2 = R(num(), num())
      const p = R(num(), num())
      out.push({ t: 'C', c1, c2, p })
      lastC = c2
      lastQ = null
      cur = p
    } else if (C === 'Q' || C === 'T') {
      const q: Pt = C === 'Q' ? R(num(), num()) : lastQ ? [2 * cur[0] - lastQ[0], 2 * cur[1] - lastQ[1]] : cur
      const p = R(num(), num())
      out.push({ t: 'C', c1: [cur[0] + (2 / 3) * (q[0] - cur[0]), cur[1] + (2 / 3) * (q[1] - cur[1])], c2: [p[0] + (2 / 3) * (q[0] - p[0]), p[1] + (2 / 3) * (q[1] - p[1])], p })
      lastQ = q
      lastC = null
      cur = p
    } else if (C === 'A') {
      const rx = num()
      const ry = num()
      const rot = num()
      const large = num() !== 0
      const sweep = num() !== 0
      const p = R(num(), num())
      for (const [c1, c2, e] of arcToCubics(cur, rx, ry, rot, large, sweep, p)) out.push({ t: 'C', c1, c2, p: e })
      cur = p
      lastC = lastQ = null
    } else i++
  }
  return out
}

const K = 0.5522847498
function circleSegs(cx: number, cy: number, rx: number, ry = rx): Seg[] {
  const k = K
  return [
    { t: 'M', p: [cx + rx, cy] },
    { t: 'C', c1: [cx + rx, cy + k * ry], c2: [cx + k * rx, cy + ry], p: [cx, cy + ry] },
    { t: 'C', c1: [cx - k * rx, cy + ry], c2: [cx - rx, cy + k * ry], p: [cx - rx, cy] },
    { t: 'C', c1: [cx - rx, cy - k * ry], c2: [cx - k * rx, cy - ry], p: [cx, cy - ry] },
    { t: 'C', c1: [cx + k * rx, cy - ry], c2: [cx + rx, cy - k * ry], p: [cx + rx, cy] },
    { t: 'Z' },
  ]
}

function elementSegs(el: Element): Seg[] {
  const n = (a: string) => parseFloat(el.getAttribute(a) ?? '') || 0
  switch (el.localName) {
    case 'rect': {
      const [x, y, w, h] = [n('x'), n('y'), n('width'), n('height')]
      if (w <= 0 || h <= 0) return []
      const rx = Math.min(w / 2, n('rx') || n('ry'))
      if (rx > 0) return parsePathD(`M ${x + rx} ${y} H ${x + w - rx} A ${rx} ${rx} 0 0 1 ${x + w} ${y + rx} V ${y + h - rx} A ${rx} ${rx} 0 0 1 ${x + w - rx} ${y + h} H ${x + rx} A ${rx} ${rx} 0 0 1 ${x} ${y + h - rx} V ${y + rx} A ${rx} ${rx} 0 0 1 ${x + rx} ${y} Z`)
      return [{ t: 'M', p: [x, y] }, { t: 'L', p: [x + w, y] }, { t: 'L', p: [x + w, y + h] }, { t: 'L', p: [x, y + h] }, { t: 'Z' }]
    }
    case 'circle':
      return n('r') > 0 ? circleSegs(n('cx'), n('cy'), n('r')) : []
    case 'ellipse':
      return circleSegs(n('cx'), n('cy'), n('rx'), n('ry'))
    case 'path':
      return parsePathD(el.getAttribute('d') ?? '')
    default:
      return []
  }
}

function applyM(segs: Seg[], m: M6): Seg[] {
  if (m === ID) return segs
  return segs.map((s) => (s.t === 'Z' ? s : s.t === 'C' ? { t: 'C', c1: ap(m, s.c1), c2: ap(m, s.c2), p: ap(m, s.p) } : { t: s.t, p: ap(m, s.p) }))
}

function ctm(el: Element, stop: Element): M6 {
  const chain: Element[] = []
  for (let e: Element | null = el; e && e !== stop; e = e.parentElement) chain.unshift(e)
  return chain.reduce<M6>((m, e) => mul(m, parseTransform(e.getAttribute('transform'))), ID)
}

/** 로고를 배경색 위에 합성해 JPG 로 */
async function logoToJpeg(href: string, bg: string, w: number, h: number): Promise<{ jpeg: Uint8Array; px: number; py: number } | null> {
  const img = new Image()
  img.src = href
  try {
    await img.decode()
  } catch {
    return null
  }
  const scale = Math.min(4, Math.max(1, 1200 / Math.max(w, h)))
  const cw = Math.max(1, Math.round(w * scale))
  const ch = Math.max(1, Math.round(h * scale))
  const c = document.createElement('canvas')
  c.width = cw
  c.height = ch
  const g = c.getContext('2d')!
  g.fillStyle = /^#[0-9a-f]{6}$/i.test(bg) ? bg : '#ffffff'
  g.fillRect(0, 0, cw, ch)
  g.drawImage(img, 0, 0, cw, ch)
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.95))
  return blob ? { jpeg: new Uint8Array(await blob.arrayBuffer()), px: cw, py: ch } : null
}

/** QR SVG 글 → 벡터 도형 목록 */
export async function svgToVecDoc(svgText: string): Promise<VecDoc> {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  const svg = doc.documentElement
  const vb = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number)
  const width = vb.length === 4 ? vb[2] : parseFloat(svg.getAttribute('width') ?? '') || 0
  const height = vb.length === 4 ? vb[3] : parseFloat(svg.getAttribute('height') ?? '') || 0
  const clips = new Map<string, Element>()
  for (const cp of Array.from(doc.getElementsByTagName('clipPath'))) clips.set(cp.getAttribute('id') ?? '', cp)
  const shapes: VecShape[] = []
  let image: VecImage | null = null
  let bg = '#ffffff'
  const SHAPES = new Set(['rect', 'circle', 'ellipse', 'path'])
  const visit = async (el: Element) => {
    if (el.localName === 'defs' || el.localName === 'clipPath') return
    if (el.localName === 'image') {
      const href = el.getAttribute('href') ?? el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? ''
      const m = ctm(el, svg)
      const n = (a: string) => parseFloat(el.getAttribute(a) ?? '') || 0
      const [x, y] = ap(m, [n('x'), n('y')])
      const [w, h] = [n('width') * Math.hypot(m[0], m[1]), n('height') * Math.hypot(m[2], m[3])]
      const j = href ? await logoToJpeg(href, bg, w, h) : null
      if (j) image = { ...j, x, y, w, h }
      return
    }
    if (SHAPES.has(el.localName)) {
      const fill = el.getAttribute('fill') ?? '#000000'
      if (fill === 'none' || fill.startsWith('url(')) return
      const clipRef = /url\(['"]?#([^'")]+)['"]?\)/.exec(el.getAttribute('clip-path') ?? '')?.[1]
      const clip = clipRef ? clips.get(clipRef) : null
      if (clip && /background/.test(clipRef!)) bg = fill
      if (clip) {
        for (const c of Array.from(clip.querySelectorAll('rect,circle,ellipse,path'))) {
          const segs = applyM(elementSegs(c), ctm(c, clip))
          if (segs.length) shapes.push({ segs, evenOdd: (c.getAttribute('clip-rule') ?? c.getAttribute('fill-rule')) === 'evenodd', color: fill })
        }
      } else {
        const segs = applyM(elementSegs(el), ctm(el, svg))
        if (segs.length) shapes.push({ segs, evenOdd: el.getAttribute('fill-rule') === 'evenodd', color: fill })
      }
      return
    }
    for (const c of Array.from(el.children)) await visit(c)
  }
  for (const c of Array.from(svg.children)) await visit(c)
  return { width, height, shapes, image }
}

// ── 쓰기 ─────────────────────────────────────────────────
const f = (n: number) => (Math.round(n * 1000) / 1000).toString()
const psEsc = (s: string) => s.replace(/[\\()]/g, '\\$&').replace(/[^\x20-\x7e]/g, '?')
function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const v = m ? parseInt(m[1], 16) : 0
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
}
/** 검정은 인쇄용 K100, 그 밖에는 RGB */
function colorOp(hex: string, kind: 'ps' | 'pdf'): string {
  const [r, g, b] = rgb(hex)
  if (r === 0 && g === 0 && b === 0) return kind === 'ps' ? '0 0 0 1 setcmykcolor' : '0 0 0 1 k'
  return kind === 'ps' ? `${f(r)} ${f(g)} ${f(b)} setrgbcolor` : `${f(r)} ${f(g)} ${f(b)} rg`
}

/** 한 변 sizePt(포인트) 짜리 페이지에 맞춘 그리기 명령 */
function drawOps(d: VecDoc, sizePt: number, kind: 'ps' | 'pdf'): string[] {
  const s = sizePt / Math.max(d.width, d.height)
  const H = d.height * s
  const P = ([x, y]: Pt) => `${f(x * s)} ${f(H - y * s)}`
  const o: string[] = []
  let color = ''
  for (const sh of d.shapes) {
    if (sh.color !== color) o.push(colorOp((color = sh.color), kind))
    for (const g of sh.segs) {
      if (g.t === 'M') o.push(`${P(g.p)} ${kind === 'ps' ? 'moveto' : 'm'}`)
      else if (g.t === 'L') o.push(`${P(g.p)} ${kind === 'ps' ? 'lineto' : 'l'}`)
      else if (g.t === 'C') o.push(`${P(g.c1)} ${P(g.c2)} ${P(g.p)} ${kind === 'ps' ? 'curveto' : 'c'}`)
      else o.push(kind === 'ps' ? 'closepath' : 'h')
    }
    o.push(kind === 'ps' ? (sh.evenOdd ? 'eofill' : 'fill') : sh.evenOdd ? 'f*' : 'f')
  }
  return o
}

const hex = (b: Uint8Array) => {
  let s = ''
  for (let i = 0; i < b.length; i++) {
    s += b[i].toString(16).padStart(2, '0')
    if (i % 40 === 39) s += '\n'
  }
  return s
}

export function toEps(d: VecDoc, sizePt: number, title: string): Uint8Array {
  const s = sizePt / Math.max(d.width, d.height)
  const W = d.width * s
  const H = d.height * s
  const o = [
    '%!PS-Adobe-3.0 EPSF-3.0', `%%BoundingBox: 0 0 ${Math.ceil(W)} ${Math.ceil(H)}`, `%%HiResBoundingBox: 0 0 ${f(W)} ${f(H)}`,
    `%%Title: (${psEsc(title)})`, '%%Creator: Onbijjang QR', '%%LanguageLevel: 2', '%%Pages: 1', '%%EndComments', '%%Page: 1 1', 'gsave',
    ...drawOps(d, sizePt, 'ps'),
  ]
  if (d.image) {
    const im = d.image
    o.push(
      'gsave', `${f(im.x * s)} ${f(H - (im.y + im.h) * s)} translate ${f(im.w * s)} ${f(im.h * s)} scale`, '/DeviceRGB setcolorspace',
      `<< /ImageType 1 /Width ${im.px} /Height ${im.py} /BitsPerComponent 8 /Decode [0 1 0 1 0 1] /ImageMatrix [${im.px} 0 0 -${im.py} 0 ${im.py}] /DataSource currentfile /ASCIIHexDecode filter /DCTDecode filter >> image`,
      hex(im.jpeg) + '>', 'grestore',
    )
  }
  o.push('grestore', 'showpage', '%%Trailer', '%%EOF', '')
  return new TextEncoder().encode(o.join('\n'))
}

/** 단일 페이지 벡터 PDF (= Illustrator 에서 바로 열리는 PDF 호환 .ai) */
export function toPdf(d: VecDoc, sizePt: number, title: string): Uint8Array {
  const s = sizePt / Math.max(d.width, d.height)
  const W = d.width * s
  const H = d.height * s
  const c = ['q', ...drawOps(d, sizePt, 'pdf'), 'Q']
  if (d.image) {
    const im = d.image
    c.push('q', `${f(im.w * s)} 0 0 ${f(im.h * s)} ${f(im.x * s)} ${f(H - (im.y + im.h) * s)} cm`, '/Im1 Do', 'Q')
  }
  const enc = new TextEncoder()
  const stream = c.join('\n')
  const parts: Array<string | Uint8Array> = []
  const offs: number[] = []
  let len = 0
  const push = (x: string | Uint8Array) => {
    parts.push(x)
    len += typeof x === 'string' ? enc.encode(x).length : x.length
  }
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'.replace(/[\x80-\xff]/g, 'A'))
  const obj = (body: string | Array<string | Uint8Array>) => {
    offs.push(len)
    push(`${offs.length} 0 obj\n`)
    for (const b of Array.isArray(body) ? body : [body]) push(b)
    push('\nendobj\n')
  }
  const res = d.image ? '<< /XObject << /Im1 6 0 R >> >>' : '<< >>'
  obj('<< /Type /Catalog /Pages 2 0 R >>')
  obj('<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  obj(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(W)} ${f(H)}] /Resources ${res} /Contents 4 0 R >>`)
  obj(`<< /Length ${enc.encode(stream).length} >>\nstream\n${stream}\nendstream`)
  obj(`<< /Title (${psEsc(title)}) /Producer (Onbijjang QR) >>`)
  if (d.image) {
    const im = d.image
    obj([`<< /Type /XObject /Subtype /Image /Width ${im.px} /Height ${im.py} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.jpeg.length} >>\nstream\n`, im.jpeg, '\nendstream'])
  }
  const xref = len
  push(`xref\n0 ${offs.length + 1}\n0000000000 65535 f \n` + offs.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join(''))
  push(`trailer\n<< /Size ${offs.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  const out = new Uint8Array(len)
  let p = 0
  for (const x of parts) {
    const b = typeof x === 'string' ? enc.encode(x) : x
    out.set(b, p)
    p += b.length
  }
  return out
}
