import { bitsToRuns, code128Bits, ean13Bits, type BarcodeKind } from './logic'

/**
 * 라벨 배치(mm, 위가 0). 글자는 모두 윤곽선 경로로 만든다 → EPS·AI·PDF 를 서체 없는 PC 에서 열어도 똑같다.
 * 비율은 팀이 쓰던 예시 3종(평형·롱바·쿠팡 R)에서 잰 값(X = 바 한 칸 굵기 기준).
 */

/** 경로 명령 — M x y · L x y · Q x1 y1 x y · C x1 y1 x2 y2 x y · Z */
export interface Cmd {
  t: 'M' | 'L' | 'Q' | 'C' | 'Z'
  p: number[]
}

/** 글꼴 하나(단위: 글꼴 단위, 위가 +) */
export interface GlyphFont {
  unitsPerEm: number
  capHeight: number
  has(ch: string): boolean
  advance(ch: string): number
  path(ch: string): Cmd[]
}

export interface Fonts {
  bold: GlyphFont
  medium: GlyphFont
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface LabelModel {
  w: number
  h: number
  bars: Rect[]
  paths: Cmd[][]
}

export interface LabelItem {
  kind: BarcodeKind
  code: string
  top: string
  origin: string
}

export interface LabelOptions {
  /** 바 한 칸 굵기(mm) */
  X: number
  /** 바 높이(mm) */
  barH: number
  /** 글자 크기 배율 (1 = 100%) */
  textScale: number
  /** 좌우 여백(Quiet zone) 포함 */
  quiet: boolean
}

const STYLE = {
  flat: { topCap: 6.5, digCap: 6.5, oriCap: 5.0, gapTop: 3.5, gapDig: 2.0, gapOri: 3.5, groupGap: 2.0, firstGap: 0, digBold: false },
  long: { topCap: 5.7, digCap: 5.0, oriCap: 4.2, gapTop: 2.8, gapDig: 1.2, gapOri: 3.0, groupGap: 2.5, firstGap: 2.6, digBold: true },
  r: { topCap: 6.0, digCap: 5.6, oriCap: 4.8, gapTop: 2.5, gapDig: 2.0, gapOri: 3.5, groupGap: 3.0, firstGap: 0, digBold: false },
} as const

function pick(ch: string, prefer: GlyphFont, fonts: Fonts) {
  if (prefer.has(ch)) return prefer
  return fonts.bold.has(ch) ? fonts.bold : prefer
}

function advance(str: string, em: number, prefer: GlyphFont, fonts: Fonts) {
  let w = 0
  for (const ch of str) {
    const f = pick(ch, prefer, fonts)
    w += (f.advance(ch) * em) / f.unitsPerEm
  }
  return w
}

/** 글자열 → 경로(mm, 아래로 +). x = 왼쪽, base = 기준선 */
function textCmds(str: string, x: number, base: number, em: number, prefer: GlyphFont, fonts: Fonts): Cmd[] {
  const out: Cmd[] = []
  let cx = x
  for (const ch of str) {
    const f = pick(ch, prefer, fonts)
    const s = em / f.unitsPerEm
    if (ch !== ' ') {
      for (const c of f.path(ch)) {
        const p: number[] = []
        for (let i = 0; i < c.p.length; i += 2) p.push(cx + c.p[i] * s, base - c.p[i + 1] * s)
        out.push({ t: c.t, p })
      }
    }
    cx += f.advance(ch) * s
  }
  return out
}

function bbox(cmds: Cmd[]) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const c of cmds) {
    for (let i = 0; i < c.p.length; i += 2) {
      x0 = Math.min(x0, c.p[i])
      x1 = Math.max(x1, c.p[i])
      y0 = Math.min(y0, c.p[i + 1])
      y1 = Math.max(y1, c.p[i + 1])
    }
  }
  return { x0, y0, x1, y1 }
}

const shift = (cmds: Cmd[], dx: number, dy: number): Cmd[] => cmds.map((c) => ({ t: c.t, p: c.p.map((v, i) => v + (i % 2 === 0 ? dx : dy)) }))

/** 숫자 묶음 — 고정 칸(pitch)마다 가운데 정렬 */
function digitGroup(str: string, edgeX: number, align: 'left' | 'right', base: number, em: number, pitch: number, font: GlyphFont, fonts: Fonts) {
  const left = align === 'right' ? edgeX - pitch * str.length : edgeX
  const cmds: Cmd[] = []
  ;[...str].forEach((ch, i) => {
    const adv = advance(ch, em, font, fonts)
    cmds.push(...textCmds(ch, left + i * pitch + (pitch - adv) / 2, base, em, font, fonts))
  })
  return { cmds, left, right: left + pitch * str.length }
}

export function buildLabel(item: LabelItem, o: LabelOptions, fonts: Fonts): LabelModel {
  const X = o.X
  const st = STYLE[item.kind]
  const ts = o.textScale || 1
  const isEan = item.kind !== 'r'
  const bits = isEan ? ean13Bits(item.code) : code128Bits(item.code)
  const qL = o.quiet ? (isEan ? 11 : 10) * X : 0
  const qR = o.quiet ? (isEan ? 7 : 10) * X : 0
  const bx0 = qL
  const bx1 = qL + bits.length * X
  const W = bx1 + qR
  const margin = o.quiet ? 2 * X : 0
  const cap = fonts.medium.capHeight / fonts.medium.unitsPerEm
  const emOf = (capX: number) => (capX * X * ts) / cap
  const paths: Cmd[][] = []
  let y = margin

  // 맨 위 문구(굵게, 왼쪽 정렬, 바 폭보다 길면 줄임)
  if (item.top) {
    let em = emOf(st.topCap)
    const wTxt = advance(item.top, em, fonts.bold, fonts)
    const avail = bx1 - bx0
    if (wTxt > avail) em *= avail / wTxt
    let cmds = textCmds(item.top, 0, 0, em, fonts.bold, fonts)
    const b = bbox(cmds)
    cmds = shift(cmds, bx0 - b.x0, y - b.y0)
    paths.push(cmds)
    y += b.y1 - b.y0 + st.gapTop * X * ts
  }

  const barTop = y
  const barH = o.barH
  const runs = bitsToRuns(bits)
  const bars: Rect[] = []
  const dEm = emOf(st.digCap)
  const dCap = st.digCap * X * ts
  const dFont = st.digBold ? fonts.bold : fonts.medium
  const pitch = Math.max(...[...'0123456789'].map((c) => advance(c, dEm, dFont, fonts)))
  let bottom = barTop + barH

  if (item.kind === 'flat') {
    runs.forEach((r) => bars.push({ x: bx0 + r.m0 * X, y: barTop, w: (r.m1 - r.m0) * X, h: barH }))
    const base = barTop + barH + st.gapDig * X * ts + dCap
    const g2 = digitGroup(item.code.slice(7), bx1, 'right', base, dEm, pitch, dFont, fonts)
    const g1 = digitGroup(item.code.slice(1, 7), g2.left - st.groupGap * pitch, 'right', base, dEm, pitch, dFont, fonts)
    const d0 = digitGroup(item.code[0], bx0, 'left', base, dEm, pitch, dFont, fonts)
    paths.push(g2.cmds, g1.cmds, d0.cmds)
    bottom = base
  } else if (item.kind === 'long') {
    const base = barTop + barH - 0.2 * X
    const g2 = digitGroup(item.code.slice(7), bx1, 'right', base, dEm, pitch, dFont, fonts)
    const g1 = digitGroup(item.code.slice(1, 7), g2.left - st.groupGap * pitch, 'right', base, dEm, pitch, dFont, fonts)
    const d0 = digitGroup(item.code[0], g1.left - st.firstGap * pitch, 'right', base, dEm, pitch, dFont, fonts)
    paths.push(g2.cmds, g1.cmds, d0.cmds)
    const shortH = barH - (dCap + 1.3 * X * ts)
    const limit = d0.left - X
    runs.forEach((r) => {
      const x = bx0 + r.m0 * X
      const w = (r.m1 - r.m0) * X
      bars.push({ x, y: barTop, w, h: x + w <= limit + 1e-9 ? barH : shortH })
    })
  } else {
    runs.forEach((r) => bars.push({ x: bx0 + r.m0 * X, y: barTop, w: (r.m1 - r.m0) * X, h: barH }))
    const base = barTop + barH + st.gapDig * X * ts + dCap
    const m = item.code.match(/^([^0-9]*)([0-9]{4,})$/)
    if (m) {
      const digits = m[2]
      const h1 = Math.floor(digits.length / 2)
      const g2 = digitGroup(digits.slice(h1), bx1 - X, 'right', base, dEm, pitch, dFont, fonts)
      const g1 = digitGroup(digits.slice(0, h1), g2.left - st.groupGap * pitch, 'right', base, dEm, pitch, dFont, fonts)
      paths.push(g2.cmds, g1.cmds)
      if (m[1]) paths.push(textCmds(m[1], bx0 + 1.8 * X, base, dEm, dFont, fonts))
    } else {
      const w = advance(item.code, dEm, dFont, fonts)
      paths.push(textCmds(item.code, (bx0 + bx1 - w) / 2, base, dEm, dFont, fonts))
    }
    bottom = base
  }

  // 원산지(가운데 정렬)
  if (item.origin) {
    const em = emOf(st.oriCap)
    let cmds = textCmds(item.origin, 0, 0, em, fonts.medium, fonts)
    const b = bbox(cmds)
    cmds = shift(cmds, (bx0 + bx1) / 2 - (b.x0 + b.x1) / 2, bottom + st.gapOri * X * ts - b.y0)
    paths.push(cmds)
    bottom += st.gapOri * X * ts + (b.y1 - b.y0)
  }

  const nonEmpty = paths.filter((p) => p.length)
  const all = nonEmpty.flat()
  const maxY = Math.max(bottom, all.length ? bbox(all).y1 : 0, ...bars.map((b) => b.y + b.h))
  return { w: W, h: maxY + margin, bars, paths: nonEmpty }
}
