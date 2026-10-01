import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SERIAL,
  PAGE_H,
  PAGE_W,
  barcodeBox,
  buildLabels,
  cellAt,
  cellRange,
  cellRect,
  cellsPerSheet,
  clampElement,
  cleanColumns,
  cmdsToD,
  deriveSheet,
  editSheet,
  findPlaceholders,
  firstSheetFree,
  fitDesign,
  flattenGrid,
  formatSerial,
  imageBox,
  labelsOnPage,
  layoutText,
  marginBottom,
  marginRight,
  nearestCell,
  normalizeDoc,
  pageCount,
  parseClipboardTable,
  parsePath,
  planDoc,
  resizeRect,
  resolveText,
  roundRectCmds,
  sheetProblems,
  slotAt,
  slotIndex,
  snapMove,
  substitute,
  tableFromGrid,
  wrapText,
  writeColumn,
  writeRows,
  type LabelDoc,
  type Measure,
  type TextEl,
} from './model'
import { DEFAULT_SHEET, SHEETS, searchSheets } from './sheets'

describe('용지 규격', () => {
  it('23종이 모두 A4 안에 들어가고 가운데 정렬된다', () => {
    expect(SHEETS).toHaveLength(23)
    expect(new Set(SHEETS.map((s) => s.id)).size).toBe(23)
    for (const s of SHEETS) {
      expect(sheetProblems(s), s.name).toEqual([])
      expect(marginRight(s), s.name).toBeCloseTo(s.marginLeft, 2)
      expect(marginBottom(s), s.name).toBeCloseTo(s.marginTop, 2)
      expect(s.marginLeft).toBeGreaterThanOrEqual(0)
      expect(s.marginTop).toBeGreaterThanOrEqual(0)
      const last = cellRect(s, cellsPerSheet(s) - 1)
      expect(last.x + last.w).toBeLessThanOrEqual(PAGE_W + 0.011)
      expect(last.y + last.h).toBeLessThanOrEqual(PAGE_H + 0.011)
    }
  })

  it('칸 수가 스펙과 같다', () => {
    const counts = SHEETS.map((s) => cellsPerSheet(s))
    expect(counts).toEqual([1, 1, 2, 4, 6, 8, 10, 12, 12, 14, 16, 18, 18, 21, 24, 27, 36, 40, 54, 60, 65, 84, 2])
  })

  it('21칸(63×38, 3×7)의 여백과 칸 위치', () => {
    const s = deriveSheet({ id: 't', name: 't', cols: 3, rows: 7, labelW: 63, labelH: 38 })
    // 가로: 210 - 189 = 21 → 틈 2.5 × 2, 여백 8 / 세로: 297 - 266 = 31 → 여백 15.5
    expect(s.gapX).toBe(2.5)
    expect(s.gapY).toBe(0)
    expect(s.marginLeft).toBe(8)
    expect(s.marginTop).toBe(15.5)
    expect(cellRect(s, 0)).toEqual({ x: 8, y: 15.5, w: 63, h: 38 })
    expect(cellRect(s, 4)).toEqual({ x: 8 + 65.5, y: 15.5 + 38, w: 63, h: 38 })
    expect(cellRect(s, 20)).toEqual({ x: 8 + 131, y: 15.5 + 228, w: 63, h: 38 })
  })

  it('남는 폭이 좁으면 틈을 고르게 나눈다', () => {
    const s = deriveSheet({ id: 't', name: 't', cols: 2, rows: 1, labelW: 104, labelH: 100 })
    expect(s.gapX).toBeCloseTo(0.67, 2)
    expect(s.marginLeft + 2 * 104 + s.gapX + marginRight(s)).toBeCloseTo(210, 2)
  })

  it('한 칸짜리와 CD 라벨', () => {
    const full = SHEETS[0]
    expect(cellRect(full, 0)).toEqual({ x: 0, y: 0.5, w: 210, h: 296 })
    const cd = SHEETS[22]
    expect(cd.shape).toBe('cd')
    expect(cd.hole).toBe(41)
    expect(cellRect(cd, 0)).toEqual({ x: 48, y: 23, w: 114, h: 114 })
    expect(cellRect(cd, 1)).toEqual({ x: 48, y: 160, w: 114, h: 114 })
  })

  it('cellAt·nearestCell·cellRange', () => {
    const s = DEFAULT_SHEET
    expect(cellAt(s, 10, 20)).toBe(0)
    expect(cellAt(s, 1, 20)).toBe(-1)
    expect(cellAt(s, 8 + 63 + 1, 20)).toBe(-1) // 틈
    expect(cellAt(s, 8 + 65.5 + 1, 15.5 + 38 + 1)).toBe(4)
    expect(nearestCell(s, -50, -50)).toBe(0)
    expect(nearestCell(s, 500, 500)).toBe(20)
    expect(cellRange(s, 0, 4)).toEqual([0, 1, 3, 4])
    expect(cellRange(s, 5, 0)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('여백·간격을 직접 고친다', () => {
    const s = DEFAULT_SHEET
    const left = editSheet(s, 'marginLeft', 7)
    expect(left.marginLeft).toBe(7)
    expect(marginRight(left)).toBe(9)
    // 오른쪽 여백을 고치면 간격이 맞춰진다: 210 - 8 - 7 - 189 = 6 → 3
    const right = editSheet(s, 'marginRight', 7)
    expect(right.marginLeft).toBe(8)
    expect(right.gapX).toBe(3)
    expect(marginRight(right)).toBe(7)
    // 아래 여백: 297 - 15.5 - 10 - 266 = 5.5 → 6개 틈
    const bottom = editSheet(s, 'marginBottom', 10)
    expect(bottom.gapY).toBeCloseTo(0.92, 2)
    // 한 줄뿐이면 묶음이 움직인다
    const one = editSheet(SHEETS[1], 'marginRight', 0)
    expect(one.marginLeft).toBe(5)
    // 간격이 음수가 될 만큼 큰 여백이면 간격 0 으로 두고 묶음을 옮긴다
    const big = editSheet(s, 'marginRight', 20)
    expect(big.gapX).toBe(0)
    expect(big.marginLeft).toBe(1)
    expect(marginRight(big)).toBe(20)
  })

  it('용지를 넘치면 알려준다', () => {
    const wide = editSheet(DEFAULT_SHEET, 'labelW', 70)
    expect(sheetProblems(wide).join(' ')).toContain('오른쪽')
    const tall = editSheet(DEFAULT_SHEET, 'rows', 8)
    expect(sheetProblems(tall).join(' ')).toContain('아래')
    expect(sheetProblems(editSheet(DEFAULT_SHEET, 'marginLeft', -1)).join(' ')).toContain('왼쪽')
  })

  it('검색', () => {
    expect(searchSheets(SHEETS, '21').map((s) => s.id)).toContain('a4-21-63x38')
    expect(searchSheets(SHEETS, '3x7').map((s) => s.id)).toEqual(['a4-21-63x38'])
    expect(searchSheets(SHEETS, '3×7').map((s) => s.id)).toEqual(['a4-21-63x38'])
    expect(searchSheets(SHEETS, 'cd').map((s) => s.id)).toEqual(['a4-cd-114'])
    expect(searchSheets(SHEETS, '63.5').map((s) => s.id)).toEqual(['a4-18-63.5x45'])
    expect(searchSheets(SHEETS, '')).toHaveLength(23)
    expect(searchSheets(SHEETS, '없는규격')).toEqual([])
  })
})

describe('자리표시와 연번', () => {
  it('찾기와 바꾸기', () => {
    expect(findPlaceholders('{상품명} / {바코드} / {상품명}')).toEqual(['상품명', '바코드'])
    expect(findPlaceholders('없음 { } {}')).toEqual([])
    const values: Record<string, string> = { 상품명: '사과', 가격: '' }
    expect(substitute('{상품명} {가격}원 {모름}', (n) => values[n])).toBe('사과 원 {모름}')
    expect(substitute('{ 상품명 }', (n) => values[n])).toBe('사과')
  })

  it('연번 서식', () => {
    expect(formatSerial(DEFAULT_SERIAL, 0)).toBe('001')
    expect(formatSerial(DEFAULT_SERIAL, 11)).toBe('012')
    expect(formatSerial({ start: 998, step: 1, digits: 3 }, 3)).toBe('1001')
    expect(formatSerial({ start: 10, step: 5, digits: 1 }, 2)).toBe('20')
    expect(formatSerial({ start: 5, step: -3, digits: 2 }, 3)).toBe('-04')
  })

  it('라벨별로 푼다 — 표의 열이 연번보다 먼저', () => {
    expect(resolveText('No.{연번} {이름}', { values: { 이름: '홍길동' }, serial: '007', row: 0 })).toBe('No.007 홍길동')
    expect(resolveText('{연번}', { values: { 연번: 'A-1' }, serial: '007', row: 0 })).toBe('A-1')
    expect(resolveText('{연번}', null)).toBe('{연번}')
  })
})

describe('붙여넣기', () => {
  it('탭·줄바꿈 격자', () => {
    expect(parseClipboardTable('a\tb\r\nc\td\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
    expect(parseClipboardTable('한 줄')).toEqual([['한 줄']])
    expect(parseClipboardTable('')).toEqual([])
    expect(parseClipboardTable('a\t\n\tb\n\n\n')).toEqual([
      ['a', ''],
      ['', 'b'],
    ])
  })

  it('따옴표로 감싼 셀(셀 안 줄바꿈·따옴표)', () => {
    expect(parseClipboardTable('"첫 줄\n둘째 줄"\t옆\n"그는 ""안녕"" 했다"\t끝')).toEqual([
      ['첫 줄\n둘째 줄', '옆'],
      ['그는 "안녕" 했다', '끝'],
    ])
    // 따옴표로 시작하지만 닫히지 않으면 글자 그대로
    expect(parseClipboardTable('"24인치\tb')).toEqual([['"24인치', 'b']])
    expect(parseClipboardTable('5" 화면\tb')).toEqual([['5" 화면', 'b']])
  })

  it('셀 1개 → 라벨 1칸(가로 순서, 안쪽 빈 셀은 빈 라벨)', () => {
    expect(flattenGrid([['a', 'b', 'c'], ['d'], ['', '', 'g']])).toEqual(['a', 'b', 'c', 'd', '', '', '', '', 'g'])
    expect(flattenGrid([['a', ''], ['', '']])).toEqual(['a'])
    expect(flattenGrid([])).toEqual([])
  })

  it('첫 줄이 열 이름인 표', () => {
    const t = tableFromGrid([['상품명', '', '상품명'], ['사과', '1', 'x'], ['', '', ''], ['배', '2']], true)
    expect(t.columns).toEqual(['상품명', '열2', '상품명2'])
    expect(t.rows).toEqual([
      ['사과', '1', 'x'],
      ['배', '2', ''],
    ])
    expect(tableFromGrid([['a', 'b']], false)).toEqual({ columns: ['열1', '열2'], rows: [['a', 'b']] })
    expect(cleanColumns(['{이름}', ' ', '이름'])).toEqual(['이름', '열2', '이름2'])
  })

  it('고른 칸부터 써 넣기', () => {
    const t0 = { columns: ['내용'], rows: [['a'], ['b'], ['c']] }
    expect(writeColumn(t0, 1, '내용', ['X', 'Y', 'Z']).rows).toEqual([['a'], ['X'], ['Y'], ['Z']])
    expect(writeColumn({ columns: [], rows: [] }, 2, '내용', ['X'])).toEqual({ columns: ['내용'], rows: [[''], [''], ['X']] })
    expect(writeColumn(t0, 0, '메모', ['m']).rows).toEqual([['a', 'm'], ['b', ''], ['c', '']])
    // 끝의 빈 행은 떼어낸다
    expect(writeColumn(t0, 2, '내용', ['']).rows).toEqual([['a'], ['b']])
    const merged = writeRows(t0, 2, { columns: ['내용', '가격'], rows: [['사과', '100'], ['배', '200']] })
    expect(merged.columns).toEqual(['내용', '가격'])
    expect(merged.rows).toEqual([['a', ''], ['b', ''], ['사과', '100'], ['배', '200']])
  })
})

describe('라벨 목록과 쪽 나눔', () => {
  it('모든 칸 동일 — N장과 연번', () => {
    const labels = buildLabels({ mode: 'same', copies: 3, table: { columns: [], rows: [] }, repeat: 1, serial: DEFAULT_SERIAL })
    expect(labels.map((l) => l?.serial)).toEqual(['001', '002', '003'])
  })

  it('행마다 한 장, 반복, 빈 행은 빈 칸(번호를 쓰지 않는다)', () => {
    const table = { columns: ['이름'], rows: [['가'], [''], ['나'], [''], ['']] }
    const labels = buildLabels({ mode: 'data', copies: 0, table, repeat: 2, serial: { start: 1, step: 1, digits: 2 } })
    expect(labels.map((l) => (l ? `${l.values.이름}${l.serial}` : null))).toEqual(['가01', '가02', null, null, '나03', '나04'])
    expect(labels[4]?.row).toBe(2)
  })

  it('시작 칸과 이미 쓴 칸', () => {
    expect(firstSheetFree(6, 2, [4])).toEqual([2, 3, 5])
    expect(firstSheetFree(6, 0, [])).toEqual([0, 1, 2, 3, 4, 5])
    // 남는 칸이 없으면 새 용지로 본다
    expect(firstSheetFree(3, 0, [0, 1, 2])).toEqual([0, 1, 2])
    const free = firstSheetFree(6, 2, [4])
    expect([0, 1, 2, 3, 4, 9].map((i) => slotAt(i, 6, free))).toEqual([
      { page: 0, cell: 2 },
      { page: 0, cell: 3 },
      { page: 0, cell: 5 },
      { page: 1, cell: 0 },
      { page: 1, cell: 1 },
      { page: 2, cell: 0 },
    ])
    for (let i = 0; i < 20; i++) expect(slotIndex(slotAt(i, 6, free), 6, free)).toBe(i)
    expect(slotIndex({ page: 0, cell: 0 }, 6, free)).toBe(-1)
    expect(slotIndex({ page: 0, cell: 4 }, 6, free)).toBe(-1)
  })

  it('용지 수', () => {
    const free = [2, 3, 5]
    expect(pageCount(0, 6, free)).toBe(1)
    expect(pageCount(3, 6, free)).toBe(1)
    expect(pageCount(4, 6, free)).toBe(2)
    expect(pageCount(9, 6, free)).toBe(2)
    expect(pageCount(10, 6, free)).toBe(3)
  })

  const baseDoc = (): LabelDoc => ({
    version: 1,
    sheet: DEFAULT_SHEET,
    design: [],
    mode: 'same',
    copies: null,
    table: { columns: [], rows: [] },
    repeat: 1,
    startCell: 0,
    skip: [],
    serial: DEFAULT_SERIAL,
    print: { offsetX: 0, offsetY: 0, cutLines: false },
  })

  it('문서 계획: 장수를 비우면 첫 장의 남은 칸을 채운다', () => {
    const plan = planDoc({ ...baseDoc(), startCell: 5, skip: [6] })
    expect(plan.labels).toHaveLength(15)
    expect(plan.pages).toBe(1)
    expect(labelsOnPage(plan, 0).map((l) => l.cell)).toEqual([5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])
  })

  it('문서 계획: 표 50행은 21칸 용지 3장', () => {
    const rows = Array.from({ length: 50 }, (_, i) => [`상품 ${i + 1}`])
    const plan = planDoc({ ...baseDoc(), mode: 'data', table: { columns: ['내용'], rows }, startCell: 4 })
    expect(plan.pages).toBe(3)
    expect(labelsOnPage(plan, 0)).toHaveLength(17)
    expect(labelsOnPage(plan, 0)[0]).toMatchObject({ cell: 4, index: 0 })
    expect(labelsOnPage(plan, 1)).toHaveLength(21)
    expect(labelsOnPage(plan, 1)[0]).toMatchObject({ cell: 0, index: 17 })
    expect(labelsOnPage(plan, 2)).toHaveLength(12)
    expect(labelsOnPage(plan, 2)[11].label.values.내용).toBe('상품 50')
  })

  it('저장된 문서 읽기', () => {
    expect(normalizeDoc(null, baseDoc())).toBeNull()
    expect(normalizeDoc({ sheet: {}, design: 'x' }, baseDoc())).toBeNull()
    const doc = normalizeDoc({ sheet: { ...DEFAULT_SHEET, cols: 999 }, design: [{ id: 'a', type: 'text', x: 0, y: 0, w: 1, h: 1 }, { type: 'zzz' }], startCell: 9999, skip: [1, 'x', 500], mode: 'data', table: { columns: ['a', 'a'], rows: [[1, 2, 3], 'bad'] } }, baseDoc())
    expect(doc?.sheet.cols).toBe(30)
    expect(doc?.design).toHaveLength(1)
    expect(doc?.startCell).toBe(30 * 7 - 1)
    expect(doc?.skip).toEqual([1])
    expect(doc?.table).toEqual({ columns: ['a', 'a2'], rows: [['1', '2']] })
    expect(doc?.print).toEqual({ offsetX: 0, offsetY: 0, cutLines: false })
  })
})

describe('디자인 요소', () => {
  it('라벨 안에 가둔다', () => {
    expect(clampElement({ id: 'a', x: -5, y: 100, w: 500, h: 0.2 }, 63, 38)).toEqual({ id: 'a', x: 0, y: 37, w: 63, h: 1 })
  })

  it('칸 크기가 바뀌면 비율대로 맞춘다', () => {
    const text: TextEl = { id: 't', type: 'text', text: 'a', font: 'pretendard', size: 12, bold: false, align: 'left', valign: 'top', color: '#000000', shrink: false, x: 10, y: 10, w: 40, h: 10 }
    const [moved] = fitDesign([text], { w: 60, h: 40 }, { w: 30, h: 40 }) as TextEl[]
    expect(moved).toMatchObject({ x: 5, y: 10, w: 20, h: 10, size: 6 })
    expect(fitDesign([text], { w: 60, h: 40 }, { w: 60, h: 40 })[0]).toBe(text)
  })

  it('옮길 때 가장자리·가운데·다른 요소에 붙는다', () => {
    const label = { w: 60, h: 40 }
    // 가운데(30)에 상자 가운데가 붙는다
    expect(snapMove({ x: 19.4, y: 5, w: 20, h: 10 }, label, [], 1)).toMatchObject({ x: 20, guideX: 30, y: 5, guideY: null })
    // 다른 요소의 오른쪽 변(25)에 왼쪽 변이 붙는다
    expect(snapMove({ x: 25.6, y: 22, w: 10, h: 5 }, label, [{ x: 5, y: 2, w: 20, h: 6 }], 1)).toMatchObject({ x: 25, guideX: 25 })
    // 멀면 붙지 않는다
    expect(snapMove({ x: 12.3, y: 21.7, w: 7, h: 3 }, label, [], 1)).toMatchObject({ x: 12.3, y: 21.7, guideX: null, guideY: null })
  })

  it('크기 조절: 움직이는 변만 붙고 최소 크기를 지킨다', () => {
    const label = { w: 60, h: 40 }
    const start = { x: 10, y: 10, w: 20, h: 10 }
    expect(resizeRect(start, 'e', 29.7, 0, label, [], 1)).toMatchObject({ x: 10, w: 50, guideX: 60 })
    expect(resizeRect(start, 'nw', 3, 2, label, [], 0.5)).toMatchObject({ x: 13, y: 12, w: 17, h: 8 })
    expect(resizeRect(start, 'w', 100, 0, label, [], 0.5)).toMatchObject({ x: 29, w: 1 })
    expect(resizeRect(start, 's', 0, -100, label, [], 0.5)).toMatchObject({ y: 10, h: 1 })
  })

  it('경로 문자열', () => {
    const d = cmdsToD(roundRectCmds(0, 0, 10, 5, 0))
    expect(d).toBe('M0 0L10 0L10 5L0 5Z')
    expect(parsePath(d)).toEqual(roundRectCmds(0, 0, 10, 5, 0))
    expect(parsePath('M0.50 73L0.50 0M2.5 73L2.5 0')).toEqual([['M', 0.5, 73], ['L', 0.5, 0], ['M', 2.5, 73], ['L', 2.5, 0]])
    const round = roundRectCmds(0, 0, 10, 5, 99)
    expect(round[0]).toEqual(['M', 2.5, 0])
    expect(parsePath(cmdsToD(round))).toHaveLength(round.length)
  })

  it('바코드·이미지가 상자 안에 놓이는 자리', () => {
    const linear = barcodeBox({ w: 40, h: 12, showText: true, textSize: 8 }, { w: 96, h: 73 }, true)
    expect(linear.bars.w).toBe(40)
    expect(linear.bars.h).toBeCloseTo(12 - 8 * (25.4 / 72) * 1.25, 5)
    expect(linear.textBaseline).toBeGreaterThan(linear.bars.h)
    expect(linear.textBaseline).toBeLessThan(12)
    const matrix = barcodeBox({ w: 40, h: 12, showText: true, textSize: 8 }, { w: 50, h: 50 }, false)
    expect(matrix.bars).toEqual({ x: 14, y: 0, w: 12, h: 12 })
    expect(matrix.textBaseline).toBeNull()
    expect(imageBox({ w: 40, h: 20, natW: 100, natH: 100, fit: 'contain' })).toEqual({ x: 10, y: 0, w: 20, h: 20 })
    expect(imageBox({ w: 40, h: 20, natW: 100, natH: 100, fit: 'cover' })).toEqual({ x: 0, y: -10, w: 40, h: 40 })
    expect(imageBox({ w: 40, h: 20, natW: 100, natH: 100, fit: 'fill' })).toEqual({ x: 0, y: 0, w: 40, h: 20 })
  })
})

describe('글자 배치', () => {
  // 글자 하나의 너비 = 글자 크기의 절반(pt) — 계산하기 쉬운 가짜 측정
  const MM = 25.4 / 72
  const measure: Measure = (text, size) => Array.from(text).length * size * 0.5 * MM

  it('띄어쓰기에서 줄을 나눈다', () => {
    // 10pt → 글자당 5pt. 너비 30pt(6글자)
    expect(wrapText('가나다 라마바 사', 30 * MM, 10, measure)).toEqual(['가나다', '라마바 사'])
    expect(wrapText('가나\n\n다', 30 * MM, 10, measure)).toEqual(['가나', '', '다'])
  })

  it('긴 낱말은 글자 단위로 자른다', () => {
    expect(wrapText('가나다라마바사아자', 20 * MM, 10, measure)).toEqual(['가나다라', '마바사아', '자'])
    expect(wrapText('AB 가나다라마바', 20 * MM, 10, measure)).toEqual(['AB', '가나다라', '마바'])
  })

  it('세로 정렬과 기준선', () => {
    const top = layoutText({ text: '가', w: 50, h: 20, size: 10, valign: 'top', shrink: false }, measure)
    const mid = layoutText({ text: '가', w: 50, h: 20, size: 10, valign: 'middle', shrink: false }, measure)
    const bot = layoutText({ text: '가', w: 50, h: 20, size: 10, valign: 'bottom', shrink: false }, measure)
    const lh = 10 * MM * 1.3
    expect(top.lineHeight).toBeCloseTo(lh, 6)
    expect(mid.baselines[0] - top.baselines[0]).toBeCloseTo((20 - lh) / 2, 6)
    expect(bot.baselines[0] - top.baselines[0]).toBeCloseTo(20 - lh, 6)
    expect(top.baselines[0]).toBeGreaterThan(0)
    expect(top.baselines[0]).toBeLessThan(lh)
    const two = layoutText({ text: '가\n나', w: 50, h: 20, size: 10, valign: 'top', shrink: false }, measure)
    expect(two.baselines[1] - two.baselines[0]).toBeCloseTo(lh, 6)
  })

  it('넘치면 줄인다', () => {
    const big = layoutText({ text: '가나다라마바사아자차', w: 10, h: 4, size: 20, valign: 'top', shrink: true }, measure)
    expect(big.sizePt).toBeLessThan(20)
    expect(big.overflow).toBe(false)
    expect(big.lines.length * big.lineHeight).toBeLessThanOrEqual(4.01)
    const keep = layoutText({ text: '가나다라마바사아자차', w: 10, h: 4, size: 20, valign: 'top', shrink: false }, measure)
    expect(keep.sizePt).toBe(20)
    expect(keep.overflow).toBe(true)
    // 아무리 줄여도 안 들어가면 최소 크기에서 멈춘다
    const tiny = layoutText({ text: '가'.repeat(500), w: 5, h: 2, size: 12, valign: 'top', shrink: true }, measure)
    expect(tiny.sizePt).toBe(4)
    expect(tiny.overflow).toBe(true)
  })
})
