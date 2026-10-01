/**
 * A4 라벨메이트 — 순수 모델.
 * 모든 길이는 밀리미터(mm), 글자 크기만 포인트(pt)다. DOM·캔버스에 기대지 않아 단위 테스트가 가능하다.
 */

export const PAGE_W = 210
export const PAGE_H = 297
export const PT_PER_MM = 72 / 25.4
export const MM_PER_PT = 25.4 / 72

export const round2 = (n: number) => Math.round(n * 100) / 100
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

// ── 용지 규격 ─────────────────────────────────────────────
export interface SheetSpec {
  id: string
  name: string
  pageW: number
  pageH: number
  cols: number
  rows: number
  labelW: number
  labelH: number
  marginLeft: number
  marginTop: number
  /** 칸과 칸 사이 빈 틈 */
  gapX: number
  gapY: number
  /** cd 는 원형(가운데 구멍) */
  shape: 'rect' | 'cd'
  /** 모서리 둥글기 — 칼선 모양에만 쓰인다 */
  radius: number
  /** CD 라벨 안쪽 구멍 지름 */
  hole: number
  custom?: boolean
}

export interface SheetSeed {
  id: string
  name: string
  cols: number
  rows: number
  labelW: number
  labelH: number
  shape?: 'rect' | 'cd'
  radius?: number
  hole?: number
  gapX?: number
  gapY?: number
}

/** 가로 칸 사이 기본 틈. 시중 라벨지는 대개 세로로는 붙어 있고 가로로 2–3mm 떨어져 있다. */
export const DEFAULT_GAP_X = 2.5

/**
 * 칸 크기와 열×행만으로 여백·간격을 정한다 — 전체 묶음을 A4 한가운데 둔다.
 * 가로 틈은 남는 폭을 고르게 나눈 값과 2.5mm 중 작은 쪽, 세로 틈은 0 이 기본이다.
 */
export function deriveSheet(seed: SheetSeed, pageW = PAGE_W, pageH = PAGE_H): SheetSpec {
  const cols = Math.max(1, Math.floor(seed.cols))
  const rows = Math.max(1, Math.floor(seed.rows))
  const freeX = pageW - cols * seed.labelW
  const freeY = pageH - rows * seed.labelH
  const gapX = seed.gapX ?? (cols > 1 ? clamp(freeX / (cols + 1), 0, DEFAULT_GAP_X) : 0)
  const gapY = seed.gapY ?? 0
  return {
    id: seed.id,
    name: seed.name,
    pageW,
    pageH,
    cols,
    rows,
    labelW: seed.labelW,
    labelH: seed.labelH,
    marginLeft: round2((freeX - (cols - 1) * gapX) / 2),
    marginTop: round2((freeY - (rows - 1) * gapY) / 2),
    gapX: round2(gapX),
    gapY: round2(gapY),
    shape: seed.shape ?? 'rect',
    radius: seed.radius ?? 0,
    hole: seed.hole ?? 0,
  }
}

export const cellsPerSheet = (s: SheetSpec) => s.cols * s.rows
export const marginRight = (s: SheetSpec) => round2(s.pageW - s.marginLeft - s.cols * s.labelW - (s.cols - 1) * s.gapX)
export const marginBottom = (s: SheetSpec) => round2(s.pageH - s.marginTop - s.rows * s.labelH - (s.rows - 1) * s.gapY)

/** index 는 왼쪽 위부터 가로로 센다(0 부터). */
export function cellRect(s: SheetSpec, index: number): Rect {
  const col = index % s.cols
  const row = Math.floor(index / s.cols)
  return {
    x: s.marginLeft + col * (s.labelW + s.gapX),
    y: s.marginTop + row * (s.labelH + s.gapY),
    w: s.labelW,
    h: s.labelH,
  }
}

/** 용지 위 한 점(mm)이 놓인 칸. 틈이나 여백이면 -1. */
export function cellAt(s: SheetSpec, x: number, y: number): number {
  const pitchX = s.labelW + s.gapX
  const pitchY = s.labelH + s.gapY
  const col = Math.floor((x - s.marginLeft) / pitchX)
  const row = Math.floor((y - s.marginTop) / pitchY)
  if (col < 0 || row < 0 || col >= s.cols || row >= s.rows) return -1
  if (x - s.marginLeft - col * pitchX > s.labelW || y - s.marginTop - row * pitchY > s.labelH) return -1
  return row * s.cols + col
}

/** 용지를 벗어나는 틈·여백까지 포함해 가장 가까운 칸(끌어서 고를 때 쓴다). */
export function nearestCell(s: SheetSpec, x: number, y: number): number {
  const col = clamp(Math.floor((x - s.marginLeft + s.gapX / 2) / (s.labelW + s.gapX)), 0, s.cols - 1)
  const row = clamp(Math.floor((y - s.marginTop + s.gapY / 2) / (s.labelH + s.gapY)), 0, s.rows - 1)
  return row * s.cols + col
}

/** 두 칸을 모서리로 하는 사각 범위의 칸들. */
export function cellRange(s: SheetSpec, a: number, b: number): number[] {
  const c0 = Math.min(a % s.cols, b % s.cols)
  const c1 = Math.max(a % s.cols, b % s.cols)
  const r0 = Math.min(Math.floor(a / s.cols), Math.floor(b / s.cols))
  const r1 = Math.max(Math.floor(a / s.cols), Math.floor(b / s.cols))
  const out: number[] = []
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(r * s.cols + c)
  return out
}

export type SheetField = 'cols' | 'rows' | 'labelW' | 'labelH' | 'marginLeft' | 'marginRight' | 'marginTop' | 'marginBottom' | 'gapX' | 'gapY' | 'radius' | 'hole'

/**
 * 규격의 한 값을 고친다. 저장되는 값은 왼쪽·위 여백과 간격이고 오른쪽·아래 여백은 거기서 나온다.
 * 오른쪽(아래) 여백을 직접 고치면 칸 간격을 그에 맞추고, 한 줄뿐이면 묶음을 옮긴다.
 */
export function editSheet(s: SheetSpec, field: SheetField, value: number): SheetSpec {
  const v = Number.isFinite(value) ? value : 0
  const next = { ...s }
  switch (field) {
    case 'cols':
      next.cols = clamp(Math.floor(v), 1, 30)
      break
    case 'rows':
      next.rows = clamp(Math.floor(v), 1, 60)
      break
    case 'labelW':
      next.labelW = clamp(v, 1, s.pageW)
      if (s.shape === 'cd') next.labelH = next.labelW
      break
    case 'labelH':
      next.labelH = clamp(v, 1, s.pageH)
      if (s.shape === 'cd') next.labelW = next.labelH
      break
    case 'marginLeft':
      next.marginLeft = v
      break
    case 'marginTop':
      next.marginTop = v
      break
    case 'gapX':
      next.gapX = Math.max(0, v)
      break
    case 'gapY':
      next.gapY = Math.max(0, v)
      break
    case 'marginRight': {
      const rest = s.pageW - v - s.cols * s.labelW
      if (s.cols > 1) {
        const gap = (rest - s.marginLeft) / (s.cols - 1)
        if (gap >= 0) next.gapX = round2(gap)
        else {
          next.gapX = 0
          next.marginLeft = round2(rest)
        }
      } else next.marginLeft = round2(rest)
      break
    }
    case 'marginBottom': {
      const rest = s.pageH - v - s.rows * s.labelH
      if (s.rows > 1) {
        const gap = (rest - s.marginTop) / (s.rows - 1)
        if (gap >= 0) next.gapY = round2(gap)
        else {
          next.gapY = 0
          next.marginTop = round2(rest)
        }
      } else next.marginTop = round2(rest)
      break
    }
    case 'radius':
      next.radius = clamp(v, 0, Math.min(s.labelW, s.labelH) / 2)
      break
    case 'hole':
      next.hole = clamp(v, 0, Math.min(s.labelW, s.labelH) - 1)
      break
  }
  return next
}

/** 인쇄하면 잘리거나 겹치는 규격 문제를 사용자 말로 알려준다. 없으면 빈 배열. */
export function sheetProblems(s: SheetSpec): string[] {
  const out: string[] = []
  const EPS = 0.005
  if (s.marginLeft < -EPS) out.push(`왼쪽 여백이 ${round2(s.marginLeft)}mm 입니다. 0 이상으로 맞춰 주세요.`)
  if (s.marginTop < -EPS) out.push(`위 여백이 ${round2(s.marginTop)}mm 입니다. 0 이상으로 맞춰 주세요.`)
  const r = marginRight(s)
  const b = marginBottom(s)
  if (r < -EPS) out.push(`칸이 용지 오른쪽으로 ${round2(-r)}mm 넘칩니다. 칸 너비·간격·열 수를 줄여 주세요.`)
  if (b < -EPS) out.push(`칸이 용지 아래로 ${round2(-b)}mm 넘칩니다. 칸 높이·간격·행 수를 줄여 주세요.`)
  return out
}

/** "3×7 · 63×38mm" */
export function sheetSummary(s: SheetSpec): string {
  if (s.shape === 'cd') return `${cellsPerSheet(s)}칸 · 바깥 ${round2(s.labelW)}mm · 구멍 ${round2(s.hole)}mm`
  return `${s.cols}×${s.rows} · ${round2(s.labelW)}×${round2(s.labelH)}mm`
}

// ── 라벨 디자인 ───────────────────────────────────────────
export type FontId = 'pretendard' | 'blackhan' | 'gaegu' | 'nanumpen' | 'serif'
export type Symbology =
  | 'code128'
  | 'gs1-128'
  | 'code39'
  | 'code93'
  | 'codabar'
  | 'ean13'
  | 'ean8'
  | 'upca'
  | 'itf'
  | 'qrcode'
  | 'datamatrix'
  | 'gs1datamatrix'
  | 'azteccode'
  | 'pdf417'

interface ElBase {
  id: string
  /** 라벨 한 칸의 왼쪽 위에서 잰 위치와 크기(mm) */
  x: number
  y: number
  w: number
  h: number
}
export interface TextEl extends ElBase {
  type: 'text'
  /** {열이름} 자리표시를 쓸 수 있다 */
  text: string
  font: FontId
  /** pt */
  size: number
  bold: boolean
  align: 'left' | 'center' | 'right'
  valign: 'top' | 'middle' | 'bottom'
  color: string
  /** 상자를 넘치면 글자를 줄인다 */
  shrink: boolean
}
export interface ImageEl extends ElBase {
  type: 'image'
  /** data URL (PNG 또는 JPEG) */
  src: string
  natW: number
  natH: number
  fit: 'contain' | 'cover' | 'fill'
}
export type ShapeKind = 'rect' | 'round' | 'ellipse' | 'triangle' | 'line'
export interface ShapeEl extends ElBase {
  type: 'shape'
  shape: ShapeKind
  fill: string | null
  stroke: string | null
  /** mm */
  strokeWidth: number
  /** 둥근 사각의 모서리 반지름(mm) */
  radius: number
}
export interface BarcodeEl extends ElBase {
  type: 'barcode'
  symbology: Symbology
  /** {열이름} 자리표시를 쓸 수 있다 */
  value: string
  /** 막대 아래에 값을 글자로 적는다(1차원 바코드만) */
  showText: boolean
  /** pt */
  textSize: number
  color: string
}
export type LabelElement = TextEl | ImageEl | ShapeEl | BarcodeEl

export const newId = () => Math.random().toString(36).slice(2, 10)

export const MIN_EL = 1

/** 요소를 라벨 안쪽에 머물게 한다(크기는 라벨보다 커질 수 없다). */
export function clampElement<T extends ElBase>(el: T, labelW: number, labelH: number): T {
  const w = clamp(el.w, MIN_EL, Math.max(MIN_EL, labelW))
  const h = clamp(el.h, MIN_EL, Math.max(MIN_EL, labelH))
  return { ...el, w: round2(w), h: round2(h), x: round2(clamp(el.x, 0, Math.max(0, labelW - w))), y: round2(clamp(el.y, 0, Math.max(0, labelH - h))) }
}

/** 칸 크기가 바뀐 용지로 옮길 때 디자인을 비율대로 맞춘다. 글자는 좁아진 쪽 비율을 따른다. */
export function fitDesign(design: LabelElement[], from: { w: number; h: number }, to: { w: number; h: number }): LabelElement[] {
  const sx = to.w / from.w
  const sy = to.h / from.h
  if (Math.abs(sx - 1) < 1e-6 && Math.abs(sy - 1) < 1e-6) return design
  const s = Math.min(sx, sy)
  return design.map((el) => {
    const moved = { ...el, x: round2(el.x * sx), y: round2(el.y * sy), w: round2(Math.max(MIN_EL, el.w * sx)), h: round2(Math.max(MIN_EL, el.h * sy)) }
    if (moved.type === 'text') moved.size = Math.max(4, Math.round(moved.size * s * 2) / 2)
    if (moved.type === 'barcode') moved.textSize = Math.max(4, Math.round(moved.textSize * s * 2) / 2)
    if (moved.type === 'shape') moved.radius = round2(moved.radius * s)
    return moved
  })
}

// ── 도형 경로 ─────────────────────────────────────────────
export type PathCmd = ['M', number, number] | ['L', number, number] | ['C', number, number, number, number, number, number] | ['Z']

const KAPPA = 0.5522847498

export function roundRectCmds(x: number, y: number, w: number, h: number, radius: number): PathCmd[] {
  const r = clamp(radius, 0, Math.min(w, h) / 2)
  if (r <= 0) return [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']]
  const k = r * KAPPA
  return [
    ['M', x + r, y],
    ['L', x + w - r, y],
    ['C', x + w - r + k, y, x + w, y + r - k, x + w, y + r],
    ['L', x + w, y + h - r],
    ['C', x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h],
    ['L', x + r, y + h],
    ['C', x + r - k, y + h, x, y + h - r + k, x, y + h - r],
    ['L', x, y + r],
    ['C', x, y + r - k, x + r - k, y, x + r, y],
    ['Z'],
  ]
}

export function ellipseCmds(cx: number, cy: number, rx: number, ry: number): PathCmd[] {
  const kx = rx * KAPPA
  const ky = ry * KAPPA
  return [
    ['M', cx + rx, cy],
    ['C', cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry],
    ['C', cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy],
    ['C', cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry],
    ['C', cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy],
    ['Z'],
  ]
}

/** 도형 하나의 윤곽(라벨 좌표). 선은 상자의 긴 쪽 방향으로 가운데를 지난다. */
export function shapeCmds(el: ShapeEl): PathCmd[] {
  const { x, y, w, h } = el
  switch (el.shape) {
    case 'rect':
      return roundRectCmds(x, y, w, h, 0)
    case 'round':
      return roundRectCmds(x, y, w, h, el.radius)
    case 'ellipse':
      return ellipseCmds(x + w / 2, y + h / 2, w / 2, h / 2)
    case 'triangle':
      return [['M', x + w / 2, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']]
    case 'line':
      return w >= h ? [['M', x, y + h / 2], ['L', x + w, y + h / 2]] : [['M', x + w / 2, y], ['L', x + w / 2, y + h]]
  }
}

/** 칸 하나의 칼선(용지 좌표가 아니라 주어진 사각형 기준). CD 는 바깥 원과 구멍. */
export function cellOutlineCmds(s: SheetSpec, r: Rect): PathCmd[][] {
  if (s.shape === 'cd') {
    const out = [ellipseCmds(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2)]
    if (s.hole > 0) out.push(ellipseCmds(r.x + r.w / 2, r.y + r.h / 2, s.hole / 2, s.hole / 2))
    return out
  }
  return [roundRectCmds(r.x, r.y, r.w, r.h, s.radius)]
}

const n3 = (n: number) => String(Math.round(n * 1000) / 1000)
export function cmdsToD(cmds: PathCmd[]): string {
  return cmds.map((c) => (c[0] === 'Z' ? 'Z' : c[0] + c.slice(1).map((v) => n3(v as number)).join(' '))).join('')
}

/** M·L·C·Z(절대 좌표)만 있는 경로 문자열을 읽는다. 바코드 경로를 PDF 로 옮길 때 쓴다. */
export function parsePath(d: string): PathCmd[] {
  const out: PathCmd[] = []
  const re = /([MLCZ])([^MLCZ]*)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(d))) {
    const op = m[1].toUpperCase()
    const nums = (m[2].match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number)
    if (op === 'Z') out.push(['Z'])
    else if (op === 'C') for (let i = 0; i + 5 < nums.length; i += 6) out.push(['C', nums[i], nums[i + 1], nums[i + 2], nums[i + 3], nums[i + 4], nums[i + 5]])
    else for (let i = 0; i + 1 < nums.length; i += 2) out.push([i === 0 && op === 'M' ? 'M' : 'L', nums[i], nums[i + 1]])
  }
  return out
}

// ── 자리표시·연번 ─────────────────────────────────────────
export const SERIAL_KEY = '연번'
const PLACEHOLDER_RE = /\{([^{}\n]+)\}/g

/** 문자열 안의 {이름} 목록(겹치지 않게, 나온 순서대로). */
export function findPlaceholders(text: string): string[] {
  const seen = new Set<string>()
  for (const m of text.matchAll(PLACEHOLDER_RE)) if (m[1].trim()) seen.add(m[1].trim())
  return [...seen]
}

/** {이름} 을 값으로 바꾼다. lookup 이 undefined 를 주면(모르는 이름) 그대로 둬 눈에 띄게 한다. */
export function substitute(text: string, lookup: (name: string) => string | undefined): string {
  return text.replace(PLACEHOLDER_RE, (whole, name: string) => lookup(name.trim()) ?? whole)
}

export interface SerialSettings {
  start: number
  step: number
  /** 앞을 0 으로 채우는 자릿수. 1 이면 채우지 않는다. */
  digits: number
}
export const DEFAULT_SERIAL: SerialSettings = { start: 1, step: 1, digits: 3 }

/** n 번째(0 부터) 라벨의 연번: 001, 002 … */
export function formatSerial(s: SerialSettings, n: number): string {
  const value = Math.trunc(s.start) + n * Math.trunc(s.step || 1)
  const digits = clamp(Math.trunc(s.digits) || 1, 1, 12)
  const body = String(Math.abs(value)).padStart(digits, '0')
  return value < 0 ? `-${body}` : body
}

// ── 표 데이터 ─────────────────────────────────────────────
export interface DataTable {
  columns: string[]
  rows: string[][]
}
export const EMPTY_TABLE: DataTable = { columns: [], rows: [] }
export const DEFAULT_COLUMN = '내용'

/**
 * 엑셀·시트에서 복사한 글(탭으로 칸, 줄바꿈으로 행)을 격자로 읽는다.
 * 셀 안에 줄바꿈·탭·따옴표가 있으면 엑셀이 큰따옴표로 감싸는 것도 처리한다. 끝의 빈 줄은 버린다.
 */
export function parseClipboardTable(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let i = 0
  const src = text.replace(/\r\n?/g, '\n')
  let atCellStart = true
  while (i < src.length) {
    const ch = src[i]
    if (atCellStart && ch === '"') {
      // 따옴표로 감싼 셀 — 닫는 따옴표 뒤가 탭·줄바꿈·끝일 때만 인정한다.
      let j = i + 1
      let buf = ''
      let closed = false
      while (j < src.length) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            buf += '"'
            j += 2
            continue
          }
          closed = true
          break
        }
        buf += src[j++]
      }
      const after = src[j + 1]
      if (closed && (after === undefined || after === '\t' || after === '\n')) {
        cell = buf
        i = j + 1
        atCellStart = false
        continue
      }
    }
    atCellStart = false
    if (ch === '\t') {
      row.push(cell)
      cell = ''
      atCellStart = true
    } else if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      atCellStart = true
    } else cell += ch
    i++
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  while (rows.length && rows[rows.length - 1].every((c) => c.trim() === '')) rows.pop()
  return rows
}

/** 격자를 왼쪽 위부터 가로로 읽어 한 줄로 편다 — 셀 1개가 라벨 1칸. 범위 안의 빈 셀은 빈 라벨로 남는다. */
export function flattenGrid(grid: string[][]): string[] {
  const width = Math.max(0, ...grid.map((r) => r.length))
  const out: string[] = []
  for (const r of grid) for (let c = 0; c < width; c++) out.push((r[c] ?? '').trim())
  while (out.length && out[out.length - 1] === '') out.pop()
  return out
}

/** 열 이름을 비지 않고 겹치지 않게 다듬는다. */
export function cleanColumns(names: string[]): string[] {
  const used = new Set<string>()
  return names.map((raw, i) => {
    const base = String(raw ?? '').replace(/[{}\n\r\t]/g, ' ').trim() || `열${i + 1}`
    let name = base
    for (let n = 2; used.has(name); n++) name = `${base}${n}`
    used.add(name)
    return name
  })
}

/** 첫 줄이 열 이름인 격자 → 표. 행 1개가 라벨 1장. */
export function tableFromGrid(grid: string[][], hasHeader: boolean): DataTable {
  const width = Math.max(0, ...grid.map((r) => r.length))
  if (!width) return EMPTY_TABLE
  const header = hasHeader ? grid[0] : []
  const columns = cleanColumns(Array.from({ length: width }, (_, i) => header[i] ?? ''))
  const body = (hasHeader ? grid.slice(1) : grid).map((r) => Array.from({ length: width }, (_, i) => String(r[i] ?? '').trim()))
  return { columns, rows: body.filter((r) => r.some((c) => c !== '')) }
}

const isBlankRow = (row: string[] | undefined) => !row || row.every((c) => (c ?? '') === '')

/** 끝에 붙은 빈 행을 뗀다(가운데 빈 행은 빈 라벨이라 남긴다). */
export function trimTable(t: DataTable): DataTable {
  let end = t.rows.length
  while (end > 0 && isBlankRow(t.rows[end - 1])) end--
  return end === t.rows.length ? t : { columns: t.columns, rows: t.rows.slice(0, end) }
}

/** 한 열에 startRow 부터 값을 차례로 써 넣는다. 모자란 행·열은 만든다. */
export function writeColumn(t: DataTable, startRow: number, column: string, values: string[]): DataTable {
  const columns = t.columns.includes(column) ? t.columns : [...t.columns, column]
  const ci = columns.indexOf(column)
  const rows = t.rows.map((r) => Array.from({ length: columns.length }, (_, i) => r[i] ?? ''))
  while (rows.length < startRow + values.length) rows.push(Array.from({ length: columns.length }, () => ''))
  values.forEach((v, k) => {
    rows[startRow + k] = rows[startRow + k].slice()
    rows[startRow + k][ci] = v
  })
  return trimTable({ columns, rows })
}

/** 여러 열을 가진 행들을 startRow 부터 덮어쓴다. 표에 없는 열은 뒤에 붙인다. */
export function writeRows(t: DataTable, startRow: number, incoming: DataTable): DataTable {
  const columns = [...t.columns]
  for (const c of incoming.columns) if (!columns.includes(c)) columns.push(c)
  const rows = t.rows.map((r) => Array.from({ length: columns.length }, (_, i) => r[i] ?? ''))
  while (rows.length < startRow + incoming.rows.length) rows.push(Array.from({ length: columns.length }, () => ''))
  incoming.rows.forEach((src, k) => {
    const row = rows[startRow + k].slice()
    incoming.columns.forEach((c, i) => (row[columns.indexOf(c)] = src[i] ?? ''))
    rows[startRow + k] = row
  })
  return trimTable({ columns, rows })
}

// ── 라벨 목록과 쪽 나눔 ───────────────────────────────────
export interface LabelData {
  values: Record<string, string>
  serial: string
  /** 표의 몇 번째 행인지(모든 칸 동일이면 -1) */
  row: number
}

export interface LabelSource {
  mode: 'same' | 'data'
  /** 모든 칸 동일일 때 찍을 장수 */
  copies: number
  table: DataTable
  /** 행 하나를 몇 장씩 */
  repeat: number
  serial: SerialSettings
}

/** 인쇄 한도 — 화면이 멈추지 않도록 라벨 수를 묶는다. */
export const MAX_LABELS = 5000

/**
 * 찍을 라벨을 순서대로 만든다. null 은 비워 두는 칸(표의 빈 행)이다.
 * 연번은 실제로 찍히는 라벨마다 하나씩 오르고, 빈 칸은 번호를 쓰지 않는다.
 */
export function buildLabels(src: LabelSource): Array<LabelData | null> {
  const out: Array<LabelData | null> = []
  let printed = 0
  if (src.mode === 'same') {
    const n = clamp(Math.floor(src.copies) || 0, 0, MAX_LABELS)
    for (let i = 0; i < n; i++) out.push({ values: {}, serial: formatSerial(src.serial, printed++), row: -1 })
    return out
  }
  const table = trimTable(src.table)
  const repeat = clamp(Math.floor(src.repeat) || 1, 1, 1000)
  for (let r = 0; r < table.rows.length && out.length < MAX_LABELS; r++) {
    const row = table.rows[r]
    for (let k = 0; k < repeat && out.length < MAX_LABELS; k++) {
      if (isBlankRow(row)) {
        out.push(null)
        continue
      }
      const values: Record<string, string> = {}
      table.columns.forEach((c, i) => (values[c] = row[i] ?? ''))
      out.push({ values, serial: formatSerial(src.serial, printed++), row: r })
    }
  }
  return out
}

/** 라벨 하나에 대해 자리표시를 푼다. 표의 열이 {연번} 보다 먼저다. */
export function resolveText(text: string, label: LabelData | null): string {
  if (!label) return text
  return substitute(text, (name) => (name in label.values ? label.values[name] : name === SERIAL_KEY ? label.serial : undefined))
}

export interface Slot {
  page: number
  cell: number
}

/**
 * 첫 장에서 쓸 수 있는 칸. startCell 앞의 칸과 skip(이미 쓴 칸)은 건너뛴다.
 * 쓸 칸이 하나도 남지 않으면 새 용지로 본다(전부 사용 가능).
 */
export function firstSheetFree(perSheet: number, startCell: number, skip: readonly number[]): number[] {
  const skipped = new Set(skip)
  const free: number[] = []
  for (let c = Math.max(0, Math.floor(startCell) || 0); c < perSheet; c++) if (!skipped.has(c)) free.push(c)
  if (free.length) return free
  return Array.from({ length: perSheet }, (_, i) => i)
}

/** n 번째(0 부터) 라벨이 놓일 자리. */
export function slotAt(index: number, perSheet: number, free0: readonly number[]): Slot {
  if (index < free0.length) return { page: 0, cell: free0[index] }
  const rest = index - free0.length
  return { page: 1 + Math.floor(rest / perSheet), cell: rest % perSheet }
}

/** 자리 → 몇 번째 라벨인지. 건너뛰는 칸이면 -1. */
export function slotIndex(slot: Slot, perSheet: number, free0: readonly number[]): number {
  if (slot.page === 0) return free0.indexOf(slot.cell)
  return free0.length + (slot.page - 1) * perSheet + slot.cell
}

/** 라벨 count 장을 찍는 데 드는 용지 수(최소 1). */
export function pageCount(count: number, perSheet: number, free0: readonly number[]): number {
  if (count <= free0.length) return 1
  return 1 + Math.ceil((count - free0.length) / perSheet)
}

// ── 맞춰 붙기(스냅) ───────────────────────────────────────
export interface SnapResult {
  value: number
  /** 붙은 기준선 위치. 붙지 않았으면 null */
  guide: number | null
}

/** anchors(움직이는 상자의 왼쪽·가운데·오른쪽 등) 중 하나가 targets 에 threshold 안으로 다가오면 붙인다. 돌려주는 값은 더할 보정량. */
export function snapDelta(anchors: number[], targets: number[], threshold: number): { delta: number; guide: number | null } {
  let best = { delta: 0, guide: null as number | null, dist: threshold + 1e-9 }
  for (const a of anchors)
    for (const t of targets) {
      const d = Math.abs(t - a)
      if (d < best.dist) best = { delta: t - a, guide: t, dist: d }
    }
  return { delta: best.delta, guide: best.guide }
}

/** 라벨 가장자리·가운데와 다른 요소의 가장자리·가운데 — 축 하나의 붙을 자리. */
export function snapTargets(size: number, others: Array<{ start: number; size: number }>): number[] {
  const out = [0, size / 2, size]
  for (const o of others) out.push(o.start, o.start + o.size / 2, o.start + o.size)
  return out
}

/** 옮길 때: 상자의 세 기준(시작·가운데·끝)을 맞춰 붙인 새 위치. */
export function snapMove(rect: Rect, label: { w: number; h: number }, others: Rect[], threshold: number): { x: number; y: number; guideX: number | null; guideY: number | null } {
  const sx = snapDelta([rect.x, rect.x + rect.w / 2, rect.x + rect.w], snapTargets(label.w, others.map((o) => ({ start: o.x, size: o.w }))), threshold)
  const sy = snapDelta([rect.y, rect.y + rect.h / 2, rect.y + rect.h], snapTargets(label.h, others.map((o) => ({ start: o.y, size: o.h }))), threshold)
  return { x: round2(rect.x + sx.delta), y: round2(rect.y + sy.delta), guideX: sx.guide, guideY: sy.guide }
}

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

/** 손잡이를 (dx, dy) 만큼 끌었을 때의 새 상자. 최소 크기를 지키고, 움직이는 변만 맞춰 붙인다. */
export function resizeRect(start: Rect, handle: Handle, dx: number, dy: number, label: { w: number; h: number }, others: Rect[], threshold: number): Rect & { guideX: number | null; guideY: number | null } {
  let { x, y, w, h } = start
  let guideX: number | null = null
  let guideY: number | null = null
  const tx = snapTargets(label.w, others.map((o) => ({ start: o.x, size: o.w })))
  const ty = snapTargets(label.h, others.map((o) => ({ start: o.y, size: o.h })))
  if (handle.includes('e')) {
    const s = snapDelta([start.x + start.w + dx], tx, threshold)
    guideX = s.guide
    w = Math.max(MIN_EL, start.w + dx + s.delta)
  }
  if (handle.includes('w')) {
    const s = snapDelta([start.x + dx], tx, threshold)
    guideX = s.guide
    const right = start.x + start.w
    x = Math.min(start.x + dx + s.delta, right - MIN_EL)
    w = right - x
  }
  if (handle.includes('s')) {
    const s = snapDelta([start.y + start.h + dy], ty, threshold)
    guideY = s.guide
    h = Math.max(MIN_EL, start.h + dy + s.delta)
  }
  if (handle.includes('n')) {
    const s = snapDelta([start.y + dy], ty, threshold)
    guideY = s.guide
    const bottom = start.y + start.h
    y = Math.min(start.y + dy + s.delta, bottom - MIN_EL)
    h = bottom - y
  }
  return { x: round2(x), y: round2(y), w: round2(w), h: round2(h), guideX, guideY }
}

// ── 글자 배치 ─────────────────────────────────────────────
/** 프리텐다드 기준 글자 상자 비율(em). 화면·인쇄·PDF 가 같은 기준선을 쓰도록 여기서 한 번 정한다. */
export const FONT_ASCENT = 0.952
export const FONT_DESCENT = 0.241
export const LINE_HEIGHT = 1.3
export const MIN_FONT_PT = 4

/** 글 한 줄의 너비(mm)를 재는 함수. 화면에서는 캔버스로, 테스트에서는 가짜로 넣는다. */
export type Measure = (text: string, sizePt: number) => number

/** 너비에 맞춰 줄을 나눈다. 띄어쓰기에서 먼저 끊고, 한 낱말이 너비보다 길면 글자 단위로 끊는다. */
export function wrapText(text: string, widthMm: number, sizePt: number, measure: Measure): string[] {
  const lines: string[] = []
  for (const para of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (para === '') {
      lines.push('')
      continue
    }
    let line = ''
    for (const word of para.split(/( +)/)) {
      if (word === '') continue
      const candidate = line + word
      if (measure(candidate.trimEnd(), sizePt) <= widthMm) {
        line = candidate
        continue
      }
      if (line.trim() !== '') {
        lines.push(line.trimEnd())
        line = ''
      }
      if (word.trim() === '') continue
      // 낱말 하나가 너비를 넘으면 글자 단위로 자른다.
      let chunk = ''
      for (const ch of Array.from(word)) {
        if (chunk !== '' && measure(chunk + ch, sizePt) > widthMm) {
          lines.push(chunk)
          chunk = ''
        }
        chunk += ch
      }
      line = chunk
    }
    lines.push(line.trimEnd())
  }
  return lines
}

export interface TextLayout {
  sizePt: number
  lines: string[]
  /** 상자 위쪽에서 잰 각 줄의 기준선(mm) */
  baselines: number[]
  /** 줄 높이(mm) */
  lineHeight: number
  /** 줄였는데도 상자를 넘친다 */
  overflow: boolean
}

export function layoutText(
  opts: { text: string; w: number; h: number; size: number; valign: 'top' | 'middle' | 'bottom'; shrink: boolean },
  measure: Measure,
): TextLayout {
  const fits = (size: number, lines: string[]) => lines.length * size * MM_PER_PT * LINE_HEIGHT <= opts.h + 0.01 && lines.every((l) => measure(l, size) <= opts.w + 0.01)
  let size = Math.max(MIN_FONT_PT, opts.size)
  let lines = wrapText(opts.text, opts.w, size, measure)
  if (opts.shrink) {
    while (size > MIN_FONT_PT && !fits(size, lines)) {
      size = Math.max(MIN_FONT_PT, size - 0.5)
      lines = wrapText(opts.text, opts.w, size, measure)
    }
  }
  const fs = size * MM_PER_PT
  const lh = fs * LINE_HEIGHT
  const block = lines.length * lh
  const top = opts.valign === 'top' ? 0 : opts.valign === 'middle' ? (opts.h - block) / 2 : opts.h - block
  const inset = (lh - (FONT_ASCENT + FONT_DESCENT) * fs) / 2 + FONT_ASCENT * fs
  return { sizePt: size, lines, baselines: lines.map((_, i) => top + i * lh + inset), lineHeight: lh, overflow: !fits(size, lines) }
}

// ── 바코드·이미지 놓기 ────────────────────────────────────
/**
 * 바코드가 요소 상자 안에서 차지하는 자리.
 * 1차원은 상자 너비·높이를 가득 채우고(막대는 늘려도 읽힌다) 아래에 글자 줄을 둔다.
 * 2차원은 비율을 지켜 가운데에 놓는다.
 */
export function barcodeBox(el: Pick<BarcodeEl, 'w' | 'h' | 'showText' | 'textSize'>, geom: { w: number; h: number }, linear: boolean): { bars: Rect; textBaseline: number | null; textSizeMm: number } {
  const textSizeMm = el.textSize * MM_PER_PT
  if (linear) {
    const textH = el.showText ? Math.min(el.h * 0.6, textSizeMm * 1.25) : 0
    const barsH = Math.max(0.5, el.h - textH)
    return { bars: { x: 0, y: 0, w: el.w, h: barsH }, textBaseline: el.showText ? barsH + textSizeMm * 0.98 : null, textSizeMm }
  }
  const scale = Math.min(el.w / geom.w, el.h / geom.h)
  const w = geom.w * scale
  const h = geom.h * scale
  return { bars: { x: (el.w - w) / 2, y: (el.h - h) / 2, w, h }, textBaseline: null, textSizeMm }
}

/** 이미지가 요소 상자 안에 그려질 자리(상자 기준). cover 는 상자를 넘치므로 상자로 잘라 그린다. */
export function imageBox(el: Pick<ImageEl, 'w' | 'h' | 'natW' | 'natH' | 'fit'>): Rect {
  if (el.fit === 'fill' || !el.natW || !el.natH) return { x: 0, y: 0, w: el.w, h: el.h }
  const scale = el.fit === 'contain' ? Math.min(el.w / el.natW, el.h / el.natH) : Math.max(el.w / el.natW, el.h / el.natH)
  const w = el.natW * scale
  const h = el.natH * scale
  return { x: (el.w - w) / 2, y: (el.h - h) / 2, w, h }
}

// ── 문서 ──────────────────────────────────────────────────
export interface PrintSettings {
  /** 인쇄 위치 보정(mm). +면 오른쪽·아래로 */
  offsetX: number
  offsetY: number
  cutLines: boolean
}

export interface LabelDoc {
  version: 1
  sheet: SheetSpec
  design: LabelElement[]
  mode: 'same' | 'data'
  /** 모든 칸 동일일 때 장수. null 이면 첫 장의 남은 칸을 가득 채운다 */
  copies: number | null
  table: DataTable
  repeat: number
  /** 첫 장에서 인쇄를 시작할 칸(0 부터) */
  startCell: number
  /** 첫 장에서 이미 써서 건너뛸 칸 */
  skip: number[]
  serial: SerialSettings
  print: PrintSettings
}

/** 지금 문서로 찍힐 라벨 전체와 쪽 나눔 정보. */
export function planDoc(doc: LabelDoc): { labels: Array<LabelData | null>; perSheet: number; free0: number[]; pages: number } {
  const perSheet = cellsPerSheet(doc.sheet)
  const free0 = firstSheetFree(perSheet, doc.startCell, doc.skip)
  const labels = buildLabels({ mode: doc.mode, copies: doc.copies ?? free0.length, table: doc.table, repeat: doc.repeat, serial: doc.serial })
  return { labels, perSheet, free0, pages: pageCount(labels.length, perSheet, free0) }
}

/** 한 쪽에 놓이는 라벨: 칸 번호 → 라벨(빈 칸은 빠진다). */
export function labelsOnPage(plan: ReturnType<typeof planDoc>, page: number): Array<{ cell: number; index: number; label: LabelData }> {
  const out: Array<{ cell: number; index: number; label: LabelData }> = []
  const first = page === 0 ? 0 : plan.free0.length + (page - 1) * plan.perSheet
  const count = page === 0 ? plan.free0.length : plan.perSheet
  for (let i = first; i < first + count && i < plan.labels.length; i++) {
    const label = plan.labels[i]
    if (label) out.push({ cell: slotAt(i, plan.perSheet, plan.free0).cell, index: i, label })
  }
  return out
}

/** 저장된 문서를 읽을 때 빠진 값·깨진 값을 기본값으로 메운다. 알아볼 수 없으면 null. */
export function normalizeDoc(raw: unknown, fallback: LabelDoc): LabelDoc | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<LabelDoc>
  if (!r.sheet || typeof r.sheet !== 'object' || !Array.isArray(r.design)) return null
  const s = r.sheet as Partial<SheetSpec>
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  const sheet: SheetSpec = {
    id: typeof s.id === 'string' ? s.id : fallback.sheet.id,
    name: typeof s.name === 'string' ? s.name : fallback.sheet.name,
    pageW: PAGE_W,
    pageH: PAGE_H,
    cols: clamp(Math.floor(num(s.cols, 1)), 1, 30),
    rows: clamp(Math.floor(num(s.rows, 1)), 1, 60),
    labelW: clamp(num(s.labelW, 50), 1, PAGE_W),
    labelH: clamp(num(s.labelH, 30), 1, PAGE_H),
    marginLeft: num(s.marginLeft, 0),
    marginTop: num(s.marginTop, 0),
    gapX: Math.max(0, num(s.gapX, 0)),
    gapY: Math.max(0, num(s.gapY, 0)),
    shape: s.shape === 'cd' ? 'cd' : 'rect',
    radius: Math.max(0, num(s.radius, 0)),
    hole: Math.max(0, num(s.hole, 0)),
    custom: Boolean(s.custom),
  }
  const design = (r.design as LabelElement[]).filter((el) => el && typeof el === 'object' && typeof el.id === 'string' && ['text', 'image', 'shape', 'barcode'].includes(el.type) && [el.x, el.y, el.w, el.h].every((v) => typeof v === 'number' && Number.isFinite(v)))
  const t = r.table
  const table: DataTable =
    t && Array.isArray(t.columns) && Array.isArray(t.rows)
      ? { columns: cleanColumns(t.columns.map(String)), rows: t.rows.filter(Array.isArray).map((row) => t.columns.map((_, i) => String(row[i] ?? ''))) }
      : EMPTY_TABLE
  const perSheet = sheet.cols * sheet.rows
  return {
    version: 1,
    sheet,
    design,
    mode: r.mode === 'data' ? 'data' : 'same',
    copies: typeof r.copies === 'number' && r.copies >= 0 ? Math.floor(r.copies) : null,
    table,
    repeat: clamp(Math.floor(num(r.repeat, 1)), 1, 1000),
    startCell: clamp(Math.floor(num(r.startCell, 0)), 0, perSheet - 1),
    skip: Array.isArray(r.skip) ? r.skip.filter((c): c is number => Number.isInteger(c) && c >= 0 && c < perSheet) : [],
    serial: { ...DEFAULT_SERIAL, ...(r.serial && typeof r.serial === 'object' ? { start: num(r.serial.start, 1), step: num(r.serial.step, 1) || 1, digits: clamp(Math.floor(num(r.serial.digits, 3)), 1, 12) } : {}) },
    print: { offsetX: clamp(num(r.print?.offsetX, 0), -20, 20), offsetY: clamp(num(r.print?.offsetY, 0), -20, 20), cutLines: Boolean(r.print?.cutLines) },
  }
}
