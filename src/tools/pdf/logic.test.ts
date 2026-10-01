import { describe, expect, it } from 'vitest'
import { chunkEvery, formatPageNumber, formatRanges, groupLabel, parseRanges } from './ranges'
import { groupLines, inferTable, linesToParagraphs, sheetName, toCellValue, type TextPiece } from './tables'
import { fitImagePage, outputName, visualToUser } from './geometry'

describe('parseRanges', () => {
  it('기본 형태 1-3,5', () => {
    const r = parseRanges('1-3,5', 10)
    expect(r.error).toBeNull()
    expect(r.groups).toEqual([[0, 1, 2], [4]])
    expect(r.indices).toEqual([0, 1, 2, 4])
  })
  it('공백·물결표·세미콜론', () => {
    expect(parseRanges(' 1 ~ 3 ; 5  7', 10).groups).toEqual([[0, 1, 2], [4], [6]])
    expect(parseRanges('2–4', 10).indices).toEqual([1, 2, 3])
  })
  it('열린 범위', () => {
    expect(parseRanges('8-', 10).indices).toEqual([7, 8, 9])
    expect(parseRanges('-3', 10).indices).toEqual([0, 1, 2])
  })
  it('거꾸로 범위', () => {
    expect(parseRanges('5-3', 10).indices).toEqual([4, 3, 2])
  })
  it('겹치는 쪽은 indices 에서 한 번만, groups 에는 그대로', () => {
    const r = parseRanges('1-3,2-4', 10)
    expect(r.indices).toEqual([0, 1, 2, 3])
    expect(r.groups).toEqual([[0, 1, 2], [1, 2, 3]])
  })
  it('빈 입력은 오류 없이 비어 있다', () => {
    expect(parseRanges('  ', 10)).toEqual({ groups: [], indices: [], error: null })
  })
  it('범위를 벗어나면 오류', () => {
    expect(parseRanges('1-12', 10).error).toContain('12쪽은 없습니다')
    expect(parseRanges('0', 10).error).toContain('1부터')
    expect(parseRanges('abc', 10).error).toContain('읽을 수 없습니다')
    expect(parseRanges('1--3', 10).error).not.toBeNull()
    expect(parseRanges('-', 10).error).not.toBeNull()
  })
})

describe('formatRanges · chunkEvery · groupLabel', () => {
  it('이어지는 쪽을 묶는다', () => {
    expect(formatRanges([0, 1, 2, 4, 6, 7])).toBe('1-3,5,7-8')
    expect(formatRanges([])).toBe('')
    expect(formatRanges([4, 3, 2])).toBe('5,4,3')
  })
  it('N쪽마다 나눈다', () => {
    expect(chunkEvery(5, 2)).toEqual([[0, 1], [2, 3], [4]])
    expect(chunkEvery(3, 1)).toEqual([[0], [1], [2]])
    expect(chunkEvery(3, 0)).toEqual([[0], [1], [2]])
    expect(chunkEvery(0, 3)).toEqual([])
  })
  it('긴 꼬리는 줄인다', () => {
    expect(groupLabel([0, 1, 2])).toBe('1-3')
    expect(groupLabel(Array.from({ length: 30 }, (_, i) => i * 2)).length).toBeLessThanOrEqual(24)
  })
})

describe('formatPageNumber', () => {
  it('형식별', () => {
    expect(formatPageNumber('n', 3, 10)).toBe('3')
    expect(formatPageNumber('n/total', 3, 10)).toBe('3 / 10')
    expect(formatPageNumber('-n-', 3, 10)).toBe('- 3 -')
    expect(formatPageNumber('n쪽', 3, 10)).toBe('3쪽')
    expect(formatPageNumber('page n', 3, 10)).toBe('Page 3')
  })
})

/** 글자 하나의 폭을 6pt 로 가정한 가짜 조각 */
const piece = (str: string, x: number, y: number, h = 10): TextPiece => ({ str, x, y, w: str.length * 6, h })

describe('groupLines', () => {
  it('같은 기준선의 조각을 한 줄로, 틈이 작으면 한 칸으로', () => {
    const lines = groupLines([piece('세계', 62, 100), piece('안녕', 50, 100.4), piece('둘째 줄', 50, 114)])
    expect(lines).toHaveLength(2)
    expect(lines[0].text).toBe('안녕세계')
    expect(lines[0].cells).toHaveLength(1)
    expect(lines[1].text).toBe('둘째 줄')
  })
  it('넓은 틈은 다른 칸', () => {
    const [line] = groupLines([piece('품목', 50, 100), piece('수량', 200, 100), piece('금액', 320, 100)])
    expect(line.cells.map((c) => c.text)).toEqual(['품목', '수량', '금액'])
  })
  it('조각 사이 작은 틈은 띄어쓰기', () => {
    const [line] = groupLines([piece('Hello', 50, 100), piece('World', 84, 100)])
    expect(line.text).toBe('Hello World')
  })
  it('빈 조각은 무시', () => {
    expect(groupLines([piece('  ', 10, 10), piece('', 20, 10)])).toEqual([])
  })
})

describe('linesToParagraphs', () => {
  it('오른쪽 끝까지 찬 줄은 다음 줄과 잇고, 짧게 끝난 줄에서 문단을 나눈다', () => {
    const full = '가'.repeat(40)
    const lines = groupLines([piece(full, 50, 100), piece(full, 50, 114), piece('짧은 끝', 50, 128), piece(full, 50, 150), piece('다음 문단 끝', 50, 164)])
    const paras = linesToParagraphs(lines)
    expect(paras).toHaveLength(2)
    expect(paras[0].text).toBe(`${full} ${full} 짧은 끝`)
    expect(paras[1].text).toBe(`${full} 다음 문단 끝`)
  })
  it('큰 글자는 제목', () => {
    const lines = groupLines([piece('큰 제목', 50, 60, 20), piece('본문 한 줄입니다', 50, 100), piece('본문 두 줄입니다', 50, 114), piece('본문 세 줄입니다', 50, 128)])
    const paras = linesToParagraphs(lines)
    expect(paras[0]).toMatchObject({ text: '큰 제목', heading: true })
    expect(paras.slice(1).every((p) => !p.heading)).toBe(true)
  })
  it('하이픈으로 끊긴 영어 단어를 붙인다', () => {
    const lines = groupLines([piece('This is a long sentence that keeps go-', 50, 100), piece('ing on.', 50, 114)])
    expect(linesToParagraphs(lines)[0].text).toBe('This is a long sentence that keeps going on.')
  })
})

describe('inferTable', () => {
  it('세 열짜리 표: 왼쪽 정렬 글자 + 오른쪽 정렬 숫자', () => {
    // 수량·금액 열은 오른쪽 끝을 맞춘다(오른쪽 정렬)
    const right = (str: string, rightEdge: number, y: number) => piece(str, rightEdge - str.length * 6, y)
    const pieces = [
      piece('품목', 50, 100), right('수량', 260, 100), right('금액', 400, 100),
      piece('사과 상자', 50, 116), right('3', 260, 116), right('45,000', 400, 116),
      piece('배', 50, 132), right('12', 260, 132), right('7,500', 400, 132),
      piece('제주 감귤 한 박스', 50, 148), right('100', 260, 148), right('1,200,000', 400, 148),
    ]
    const t = inferTable(pieces)
    expect(t.tableRows).toBe(4)
    expect(t.rows).toEqual([
      ['품목', '수량', '금액'],
      ['사과 상자', '3', '45,000'],
      ['배', '12', '7,500'],
      ['제주 감귤 한 박스', '100', '1,200,000'],
    ])
  })
  it('빈 칸이 있는 줄도 열 위치를 지킨다', () => {
    const pieces = [
      piece('이름', 50, 100), piece('부서', 200, 100), piece('내선', 350, 100),
      piece('김하나', 50, 116), piece('영업', 200, 116), piece('101', 350, 116),
      piece('이두리', 50, 132), piece('102', 350, 132),
      piece('총무', 200, 148), piece('103', 350, 148),
    ]
    const t = inferTable(pieces)
    expect(t.rows[2]).toEqual(['이두리', '', '102'])
    expect(t.rows[3]).toEqual(['', '총무', '103'])
  })
  it('표 위의 제목 줄은 첫 열에 들어가고 열 경계를 망치지 않는다', () => {
    const pieces = [
      piece('2026년 3분기 거래처별 납품 내역 정리표', 50, 60),
      piece('거래처', 50, 100), piece('건수', 220, 100), piece('합계', 330, 100),
      piece('가나상사', 50, 116), piece('4', 220, 116), piece('120', 330, 116),
      piece('다라유통', 50, 132), piece('9', 220, 132), piece('88', 330, 132),
    ]
    const t = inferTable(pieces)
    expect(t.rows[0]).toEqual(['2026년 3분기 거래처별 납품 내역 정리표', '', ''])
    expect(t.rows[2]).toEqual(['가나상사', '4', '120'])
  })
  it('열이 없는 글은 한 열로', () => {
    const t = inferTable([piece('그냥 문장입니다', 50, 100), piece('두 번째 문장', 50, 116)])
    expect(t.tableRows).toBe(0)
    expect(t.rows).toEqual([['그냥 문장입니다'], ['두 번째 문장']])
  })
  it('빈 입력', () => {
    expect(inferTable([])).toEqual({ rows: [], tableRows: 0 })
  })
})

describe('toCellValue', () => {
  it('숫자로 보이는 값', () => {
    expect(toCellValue('1,234')).toBe(1234)
    expect(toCellValue('12.5')).toBe(12.5)
    expect(toCellValue('-3')).toBe(-3)
    expect(toCellValue('(1,000)')).toBe(-1000)
    expect(toCellValue('12,000원')).toBe(12000)
    expect(toCellValue('₩ 3,300')).toBe(3300)
    expect(toCellValue('0')).toBe(0)
    expect(toCellValue('0.5')).toBe(0.5)
  })
  it('글자로 둘 값', () => {
    expect(toCellValue('010-1234-5678')).toBe('010-1234-5678')
    expect(toCellValue('00123')).toBe('00123')
    expect(toCellValue('1234567890123456')).toBe('1234567890123456')
    expect(toCellValue('45%')).toBe('45%')
    expect(toCellValue('1,23')).toBe('1,23')
    expect(toCellValue('2026-10-01')).toBe('2026-10-01')
    expect(toCellValue('(100')).toBe('(100')
    expect(toCellValue(' 가나다 ')).toBe('가나다')
  })
  it('숫자 변환을 끄면 그대로', () => {
    expect(toCellValue('1,234', false)).toBe('1,234')
  })
})

describe('sheetName', () => {
  it('금지 문자 제거·31자·중복 방지', () => {
    const used = new Set<string>()
    expect(sheetName('견적/2026:10', used)).toBe('견적 2026 10')
    expect(sheetName('견적/2026:10', used)).toBe('견적 2026 10 (2)')
    expect(sheetName('가'.repeat(40), used)).toHaveLength(31)
    expect(sheetName('', used)).toBe('시트')
  })
})

describe('visualToUser', () => {
  const box = { x: 0, y: 0, width: 600, height: 800 }
  it('회전 없는 쪽은 그대로', () => {
    expect(visualToUser(box, 0, 10, 20)).toEqual({ x: 10, y: 20, angle: 0 })
  })
  it('90도 회전: 보이는 왼쪽 아래는 원래 오른쪽 아래', () => {
    expect(visualToUser(box, 90, 0, 0)).toEqual({ x: 600, y: 0, angle: 90 })
    expect(visualToUser(box, 90, 800, 600)).toEqual({ x: 0, y: 800, angle: 90 })
  })
  it('180도·270도', () => {
    expect(visualToUser(box, 180, 0, 0)).toEqual({ x: 600, y: 800, angle: 180 })
    expect(visualToUser(box, 270, 0, 0)).toEqual({ x: 0, y: 800, angle: 270 })
    expect(visualToUser(box, 270, 800, 600)).toEqual({ x: 600, y: 0, angle: 270 })
  })
  it('잘린 영역(크롭) 원점을 더한다', () => {
    expect(visualToUser({ x: 10, y: 20, width: 600, height: 800 }, 0, 5, 5)).toEqual({ x: 15, y: 25, angle: 0 })
  })
})

describe('fitImagePage', () => {
  it('사진 크기 유지: 96dpi 기준으로 쪽 크기를 정한다', () => {
    const r = fitImagePage(800, 400, { size: 'fit', marginMm: 0 })
    expect(r.pageW).toBeCloseTo(600)
    expect(r.pageH).toBeCloseTo(300)
    expect(r.w).toBeCloseTo(600)
    expect(r.x).toBe(0)
  })
  it('A4 세로에 여백을 두고 가운데 맞춘다', () => {
    const r = fitImagePage(1000, 1000, { size: 'a4-portrait', marginMm: 10 })
    expect(r.pageW).toBeCloseTo(595.28, 1)
    expect(r.pageH).toBeCloseTo(841.89, 1)
    const margin = (10 / 25.4) * 72
    expect(r.w).toBeCloseTo(595.28 - margin * 2, 1)
    expect(r.h).toBeCloseTo(r.w)
    expect(r.x).toBeCloseTo(margin, 1)
    expect(r.y).toBeCloseTo((841.89 - r.h) / 2, 1)
  })
  it('A4 자동: 가로 사진은 가로 용지', () => {
    const r = fitImagePage(2000, 1000, { size: 'a4-auto', marginMm: 0 })
    expect(r.pageW).toBeGreaterThan(r.pageH)
  })
  it('작은 사진을 용지보다 크게 늘리지 않는 선택', () => {
    const r = fitImagePage(100, 100, { size: 'a4-portrait', marginMm: 0, noUpscale: true })
    expect(r.w).toBeCloseTo(75)
  })
})

describe('outputName', () => {
  it('원본 이름을 살린다', () => {
    expect(outputName('계약서.pdf', '병합', 'pdf')).toBe('계약서_병합.pdf')
    expect(outputName('scan.final.PDF', '3', 'png')).toBe('scan.final_3.png')
    expect(outputName('', '분할_1-3', 'pdf')).toBe('문서_분할_1-3.pdf')
    expect(outputName('a/b:c.pdf', '', 'docx')).toBe('abc.docx')
  })
})
