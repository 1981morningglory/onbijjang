/**
 * PDF 글자 조각(좌표 포함)을 줄·문단·표로 묶는 순수 함수.
 * 좌표는 화면 기준: x 는 왼쪽에서, y 는 위에서 아래로(글자 기준선 위치), 단위는 pt.
 */

export interface TextPiece {
  str: string
  x: number
  /** 기준선(글자 아랫선)의 y — 위에서 아래로 커진다 */
  y: number
  w: number
  /** 글자 높이(대략 글자 크기) */
  h: number
}

export interface TextLine {
  text: string
  x: number
  y: number
  /** 줄의 오른쪽 끝 */
  right: number
  size: number
  cells: LineCell[]
}

export interface LineCell {
  text: string
  x: number
  right: number
}

const median = (values: number[]): number => {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** 두 조각 사이에 띄어쓰기를 넣을지: 틈이 글자 크기의 15% 를 넘으면 띄운다. */
function joinPieces(pieces: TextPiece[]): string {
  let out = ''
  let prevRight: number | null = null
  for (const p of pieces) {
    if (prevRight !== null) {
      const gap = p.x - prevRight
      if (gap > p.h * 0.15 && !out.endsWith(' ') && !p.str.startsWith(' ')) out += ' '
    }
    out += p.str
    prevRight = p.x + p.w
  }
  return out.replace(/\s+/g, ' ').trim()
}

/**
 * 조각을 줄로 묶는다. 같은 줄 = 기준선 차이가 글자 높이의 절반 이내.
 * 줄 안에서 가로 틈이 cellGap(글자 높이 배수)보다 크면 다른 칸으로 나눈다.
 */
export function groupLines(pieces: TextPiece[], cellGap = 1.2): TextLine[] {
  const usable = pieces.filter((p) => p.str.trim() !== '' && p.h > 0)
  if (!usable.length) return []
  const sorted = [...usable].sort((a, b) => a.y - b.y || a.x - b.x)

  const rows: TextPiece[][] = []
  for (const p of sorted) {
    const row = rows[rows.length - 1]
    if (row) {
      const refY = median(row.map((r) => r.y))
      const refH = Math.max(median(row.map((r) => r.h)), p.h)
      if (Math.abs(p.y - refY) <= refH * 0.5) {
        row.push(p)
        continue
      }
    }
    rows.push([p])
  }

  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x)
    const size = median(row.map((r) => r.h))
    const groups: TextPiece[][] = []
    for (const p of row) {
      const g = groups[groups.length - 1]
      if (g) {
        const last = g[g.length - 1]
        if (p.x - (last.x + last.w) <= Math.max(size, p.h) * cellGap) {
          g.push(p)
          continue
        }
      }
      groups.push([p])
    }
    const cells: LineCell[] = groups
      .map((g) => ({ text: joinPieces(g), x: g[0].x, right: Math.max(...g.map((q) => q.x + q.w)) }))
      .filter((c) => c.text !== '')
    return {
      text: joinPieces(row),
      x: row[0].x,
      y: median(row.map((r) => r.y)),
      right: Math.max(...row.map((r) => r.x + r.w)),
      size,
      cells,
    }
  })
}

export interface Paragraph {
  text: string
  size: number
  /** 본문보다 눈에 띄게 큰 글자(제목으로 다룬다) */
  heading: boolean
}

/**
 * 줄을 문단으로 묶는다(Word 로 내보낼 때).
 * 앞줄이 오른쪽 끝까지 차 있고, 줄 간격과 글자 크기가 비슷하면 같은 문단으로 잇는다.
 */
export function linesToParagraphs(lines: TextLine[]): Paragraph[] {
  if (!lines.length) return []
  const body = median(lines.map((l) => l.size))
  const rightEdge = Math.max(...lines.map((l) => l.right))
  const leftEdge = Math.min(...lines.map((l) => l.x))
  const width = Math.max(1, rightEdge - leftEdge)

  const out: Paragraph[] = []
  let cur: { parts: string[]; size: number; lastY: number; lastRight: number } | null = null
  const flush = () => {
    if (!cur) return
    out.push({ text: joinWrapped(cur.parts), size: cur.size, heading: cur.size >= body * 1.25 })
    cur = null
  }
  for (const line of lines) {
    if (cur) {
      const sameSize = Math.abs(line.size - cur.size) <= cur.size * 0.12
      const closeGap = line.y - cur.lastY <= Math.max(line.size, cur.size) * 1.9 && line.y > cur.lastY
      const prevFull = cur.lastRight >= rightEdge - width * 0.08
      if (sameSize && closeGap && prevFull) {
        cur.parts.push(line.text)
        cur.lastY = line.y
        cur.lastRight = line.right
        continue
      }
      flush()
    }
    cur = { parts: [line.text], size: line.size, lastY: line.y, lastRight: line.right }
  }
  flush()
  return out
}

/** 줄바꿈으로 끊긴 줄을 잇는다. 영어 단어가 하이픈으로 끊긴 경우는 붙인다. */
function joinWrapped(parts: string[]): string {
  let out = ''
  for (const part of parts) {
    if (!out) out = part
    else if (/[A-Za-z]-$/.test(out) && /^[a-z]/.test(part)) out = out.slice(0, -1) + part
    else out += ` ${part}`
  }
  return out
}

export interface InferredTable {
  rows: string[][]
  /** 열이 2개 이상으로 나뉜 줄의 수 — 0 이면 표로 보기 어렵다 */
  tableRows: number
}

/**
 * 좌표를 보고 행·열을 추정한다.
 * 1) 줄로 묶고, 줄 안에서 넓은 틈으로 칸을 나눈다.
 * 2) 칸이 2개 이상인 줄들만 모아, 가로축에서 "거의 모든 줄이 비워 둔 구간"을 열 경계로 삼는다.
 * 3) 각 칸을 가장 많이 겹치는 열에 넣는다. 한 칸짜리 줄(제목·설명)은 시작 위치의 열에 넣는다.
 */
export function inferTable(pieces: TextPiece[]): InferredTable {
  const lines = groupLines(pieces, 1.2)
  if (!lines.length) return { rows: [], tableRows: 0 }
  const tableLines = lines.filter((l) => l.cells.length >= 2)
  if (!tableLines.length) return { rows: lines.map((l) => [l.text]), tableRows: 0 }

  const minX = Math.floor(Math.min(...tableLines.map((l) => l.cells[0].x)))
  const maxX = Math.ceil(Math.max(...tableLines.map((l) => l.cells[l.cells.length - 1].right)))
  const span = Math.max(1, maxX - minX)
  const cover = new Uint16Array(span + 1)
  for (const line of tableLines) {
    for (const c of line.cells) {
      const a = Math.max(0, Math.floor(c.x) - minX)
      const b = Math.min(span, Math.ceil(c.right) - minX)
      for (let i = a; i < b; i++) cover[i]++
    }
  }
  // 열 사이 빈 구간에 걸친 줄이 조금(10%) 있어도 경계로 인정한다 — 병합된 칸·긴 문장 때문.
  const tolerated = Math.floor(tableLines.length * 0.1)
  const bodySize = median(tableLines.map((l) => l.size))
  const minGap = Math.max(2, bodySize * 0.4)

  const bands: Array<{ from: number; to: number }> = []
  let start = -1
  let gapRun = 0
  for (let i = 0; i <= span; i++) {
    const filled = i < span && cover[i] > tolerated
    if (filled) {
      if (start < 0) start = i
      gapRun = 0
    } else if (start >= 0) {
      gapRun++
      if (gapRun >= minGap || i === span) {
        bands.push({ from: minX + start, to: minX + i - gapRun + 1 })
        start = -1
        gapRun = 0
      }
    }
  }
  if (start >= 0) bands.push({ from: minX + start, to: maxX })
  if (bands.length < 2) return { rows: lines.map((l) => l.cells.map((c) => c.text)), tableRows: tableLines.length }

  const columnOf = (cell: LineCell): number => {
    let best = -1
    let bestOverlap = 0
    bands.forEach((b, i) => {
      const overlap = Math.min(cell.right, b.to) - Math.max(cell.x, b.from)
      if (overlap > bestOverlap) {
        bestOverlap = overlap
        best = i
      }
    })
    if (best >= 0) return best
    // 어느 열과도 겹치지 않으면 가장 가까운 열
    let nearest = 0
    let dist = Infinity
    const center = (cell.x + cell.right) / 2
    bands.forEach((b, i) => {
      const d = center < b.from ? b.from - center : center > b.to ? center - b.to : 0
      if (d < dist) {
        dist = d
        nearest = i
      }
    })
    return nearest
  }
  const startColumn = (x: number): number => {
    for (let i = 0; i < bands.length; i++) if (x < bands[i].to) return i
    return bands.length - 1
  }

  const rows = lines.map((line) => {
    const row = new Array<string>(bands.length).fill('')
    if (line.cells.length === 1) {
      row[startColumn(line.cells[0].x)] = line.cells[0].text
      return row
    }
    for (const cell of line.cells) {
      const col = columnOf(cell)
      row[col] = row[col] ? `${row[col]} ${cell.text}` : cell.text
    }
    return row
  })
  return { rows, tableRows: tableLines.length }
}

/**
 * 엑셀 칸 값으로 바꾼다. 숫자로 보이면 숫자로(천 단위 쉼표·원/₩ 처리, 괄호는 음수),
 * 0 으로 시작하는 번호(전화·우편·상품 코드), 16자리 이상, 퍼센트는 글자로 둔다.
 */
export function toCellValue(raw: string, numeric = true): string | number {
  const text = raw.trim()
  if (!numeric || text === '') return text
  const m = /^([-+−(])?\s*[₩$]?\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*(원)?\s*(\))?$/.exec(text)
  if (!m) return text
  const digits = m[2].replace(/,/g, '')
  if (digits.length > 15) return text
  if (digits.length > 1 && digits.startsWith('0')) return text
  if ((m[1] === '(') !== (m[5] === ')')) return text
  let value = Number(digits + (m[3] ?? ''))
  if (!Number.isFinite(value)) return text
  if (m[1] === '-' || m[1] === '−' || m[1] === '(') value = -value
  return value
}

/** 시트 이름 규칙(31자, 금지 문자 제거, 겹치지 않게) */
export function sheetName(name: string, used: Set<string>): string {
  const base = name.replace(/[\\/?*[\]:]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || '시트'
  let candidate = base
  for (let n = 2; used.has(candidate.toLowerCase()); n++) {
    const tail = ` (${n})`
    candidate = base.slice(0, 31 - tail.length) + tail
  }
  used.add(candidate.toLowerCase())
  return candidate
}
