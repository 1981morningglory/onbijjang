/** 도장 만들기 — 글자 배치(순수 계산)와 캔버스 그리기 */
import { ctx2d, makeCanvas } from '@/lib/image'

export type SealShape = 'round' | 'square'

export const SEAL_MAX_CHARS = 16

/** 도장에 들어갈 글자만 남긴다(공백 제거, 최대 글자 수 제한). */
export function sealChars(text: string, appendIn = false): string[] {
  const chars = Array.from(text.replace(/\s+/g, '')).slice(0, SEAL_MAX_CHARS - (appendIn ? 1 : 0))
  if (appendIn && chars.length) chars.push('인')
  return chars
}

/**
 * 전통 방식 배치: 세로쓰기, 줄(열)은 오른쪽에서 왼쪽으로.
 * 돌려주는 배열의 첫 열이 가장 오른쪽 열이고, 각 열은 위에서 아래 순서다.
 * 1–3자는 한 줄, 4자는 2×2, 그 이상은 정사각에 가깝게 나눈다.
 */
export function sealLayout(chars: string[]): string[][] {
  const n = chars.length
  if (n === 0) return []
  const cols = n <= 3 ? 1 : Math.round(Math.sqrt(n))
  const base = Math.floor(n / cols)
  const extra = n % cols
  const out: string[][] = []
  let i = 0
  for (let c = 0; c < cols; c++) {
    const count = base + (c < extra ? 1 : 0)
    out.push(chars.slice(i, i + count))
    i += count
  }
  return out
}

export interface SealCell {
  ch: string
  /** 글자가 채울 칸(왼쪽 위 원점, 0–1 로 정규화한 도장 좌표) */
  x: number
  y: number
  w: number
  h: number
}

/**
 * 글자 칸의 위치를 0–1 좌표로 계산한다.
 * 원형은 원 안에 들어가는 사각 영역을, 사각은 테두리 안쪽 전체를 쓴다.
 */
export function sealCells(columns: string[][], shape: SealShape, border: number): SealCell[] {
  if (!columns.length) return []
  const cols = columns.length
  const maxRows = Math.max(...columns.map((c) => c.length))
  let boxW: number
  let boxH: number
  if (shape === 'round') {
    // 테두리 안쪽 원에 내접하는 사각형. 한 줄짜리는 세로로 긴 영역을 쓴다.
    const r = 0.5 - border - 0.035
    const aspect = cols === 1 ? Math.max(1, maxRows * 0.74) : maxRows / cols
    const phi = Math.atan(aspect)
    boxW = 2 * r * Math.cos(phi)
    boxH = 2 * r * Math.sin(phi)
  } else {
    const pad = border + 0.05
    boxW = 1 - pad * 2
    boxH = 1 - pad * 2
    // 한 줄짜리 사각 도장은 글자가 지나치게 넓어지지 않게 가운데로 모은다
    if (cols === 1 && maxRows >= 2) boxW *= 0.62
  }
  const left = 0.5 - boxW / 2
  const top = 0.5 - boxH / 2
  const colW = boxW / cols
  const cells: SealCell[] = []
  columns.forEach((column, ci) => {
    // 첫 열이 가장 오른쪽
    const x = left + (cols - 1 - ci) * colW
    const cellH = boxH / column.length
    column.forEach((ch, ri) => cells.push({ ch, x, y: top + ri * cellH, w: colW, h: cellH }))
  })
  return cells
}

export interface SealOptions {
  text: string
  shape: SealShape
  /** 끝에 '인' 을 붙인다 */
  appendIn: boolean
  /** CSS font-family */
  fontFamily: string
  fontWeight: number
  /** 테두리 굵기(도장 크기 대비 0.02–0.08) */
  border: number
  /** 인주가 덜 묻은 느낌 */
  worn: boolean
}

/** 씨앗이 같으면 같은 무늬가 나오는 난수 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashText(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * 도장을 검은색(투명 배경)으로 그린다. 색은 배치할 때 입힌다.
 * 글꼴은 미리 불러와 있어야 한다(fonts.ensureFont).
 */
export function drawSeal(opts: SealOptions, size = 640): HTMLCanvasElement | null {
  const chars = sealChars(opts.text, opts.appendIn)
  if (!chars.length) return null
  const canvas = makeCanvas(size, size)
  const ctx = ctx2d(canvas)
  const bw = opts.border * size
  ctx.strokeStyle = '#000'
  ctx.fillStyle = '#000'
  ctx.lineWidth = bw
  const inset = bw / 2 + size * 0.01
  if (opts.shape === 'round') {
    ctx.beginPath()
    ctx.arc(size / 2, size / 2, size / 2 - inset, 0, Math.PI * 2)
    ctx.stroke()
  } else {
    ctx.beginPath()
    ctx.roundRect(inset, inset, size - inset * 2, size - inset * 2, size * 0.035)
    ctx.stroke()
  }

  const cells = sealCells(sealLayout(chars), opts.shape, opts.border)
  const fontPx = 200
  ctx.font = `${opts.fontWeight} ${fontPx}px ${opts.fontFamily}`
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  for (const cell of cells) {
    const m = ctx.measureText(cell.ch)
    const gw = m.actualBoundingBoxLeft + m.actualBoundingBoxRight
    const gh = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent
    if (gw <= 0 || gh <= 0) continue
    const gap = 0.9
    const targetW = cell.w * size * gap
    const targetH = cell.h * size * gap
    // 칸을 채우도록 늘이되, 지나친 변형은 막는다
    let sx = targetW / gw
    let sy = targetH / gh
    const maxStretch = 1.7
    if (sx > sy * maxStretch) sx = sy * maxStretch
    if (sy > sx * maxStretch) sy = sx * maxStretch
    ctx.save()
    ctx.translate((cell.x + cell.w / 2) * size, (cell.y + cell.h / 2) * size)
    ctx.scale(sx, sy)
    ctx.fillText(cell.ch, m.actualBoundingBoxLeft - gw / 2, m.actualBoundingBoxAscent - gh / 2)
    ctx.restore()
  }

  if (opts.worn) {
    const rand = mulberry32(hashText(chars.join('') + opts.shape))
    ctx.globalCompositeOperation = 'destination-out'
    const specks = Math.round(size * 1.4)
    for (let i = 0; i < specks; i++) {
      const x = rand() * size
      const y = rand() * size
      const r = (0.4 + rand() * rand() * 3.2) * (size / 640)
      ctx.globalAlpha = 0.35 + rand() * 0.6
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }
  return canvas
}
