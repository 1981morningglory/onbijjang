import { describe, expect, it } from 'vitest'
import { addColumn, applySheet, clearRows, fromTemplate, pasteIntoDoc, removeColumn, renameColumn, setRowValues, toTemplate } from './docops'
import { addColumnTexts, autoBind, boundColumn, createBarcode, createText, defaultDoc, elementTitles, usedColumns } from './factory'
import { planDoc, labelsOnPage, resolveText, type TextEl } from './model'
import { SHEET_BY_ID } from './sheets'

describe('엑셀 붙여넣기', () => {
  it('셀 1개 → 라벨 1칸, 첫 글자 항목에 자동 연결', () => {
    const out = pasteIntoDoc(defaultDoc(), '사과\t배\t감\n귤\t\t포도\n', 'cells', null)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.count).toBe(6)
    expect(out.bound).toBe('내용')
    expect(out.doc.mode).toBe('data')
    expect(out.doc.table).toEqual({ columns: ['내용'], rows: [['사과'], ['배'], ['감'], ['귤'], [''], ['포도']] })
    expect((out.doc.design[0] as TextEl).text).toBe('{내용}')
    const plan = planDoc(out.doc)
    const page = labelsOnPage(plan, 0)
    // 빈 셀은 빈 칸으로 남아 자리를 차지한다
    expect(page.map((l) => l.cell)).toEqual([0, 1, 2, 3, 5])
    expect(page.map((l) => resolveText('{내용}', l.label))).toEqual(['사과', '배', '감', '귤', '포도'])
  })

  it('시작 칸을 주면 그 칸부터 인쇄된다(쓰다 남은 용지)', () => {
    const out = pasteIntoDoc({ ...defaultDoc(), startCell: 7 }, 'A\nB\nC', 'cells', null)
    if (!out.ok) throw new Error('paste failed')
    expect(labelsOnPage(planDoc(out.doc), 0).map((l) => l.cell)).toEqual([7, 8, 9])
  })

  it('고른 칸부터 덮어쓴다', () => {
    const first = pasteIntoDoc(defaultDoc(), 'A\nB\nC\nD', 'cells', null)
    if (!first.ok) throw new Error('paste failed')
    const second = pasteIntoDoc(first.doc, 'X\nY\nZ', 'cells', 2)
    if (!second.ok) throw new Error('paste failed')
    expect(second.doc.table.rows.map((r) => r[0])).toEqual(['A', 'B', 'X', 'Y', 'Z'])
    expect(second.bound).toBeNull()
  })

  it('한 줄 = 라벨 한 장(첫 줄은 열 이름)', () => {
    const out = pasteIntoDoc(defaultDoc(), '상품명\t바코드\n사과\t8801234567893\n배\t8801234567909', 'rows', null)
    if (!out.ok) throw new Error('paste failed')
    expect(out.doc.table.columns).toEqual(['상품명', '바코드'])
    expect(out.count).toBe(2)
    expect(out.bound).toBe('상품명')
    const bad = pasteIntoDoc(defaultDoc(), '상품명\t바코드', 'rows', null)
    expect(bad.ok).toBe(false)
  })

  it('빈 내용은 안내를 돌려준다', () => {
    const out = pasteIntoDoc(defaultDoc(), '  \n\t\n', 'cells', null)
    expect(out.ok).toBe(false)
    expect(!out.ok && out.message).toContain('붙여넣')
  })

  it('한도를 넘으면 잘라 내고 알려준다', () => {
    const text = Array.from({ length: 5200 }, (_, i) => `v${i}`).join('\n')
    const out = pasteIntoDoc(defaultDoc(), text, 'cells', null)
    if (!out.ok) throw new Error('paste failed')
    expect(out.truncated).toBe(true)
    expect(out.doc.table.rows).toHaveLength(5000)
  })
})

describe('열 연결', () => {
  it('이미 연결된 열이 있으면 건드리지 않는다', () => {
    const doc = defaultDoc()
    const design = [createText(doc.sheet, '{가격}원')]
    expect(autoBind(design, ['상품명', '가격'], doc.sheet)).toEqual({ design, bound: null })
  })

  it('글자 항목이 없으면 만든다', () => {
    const doc = defaultDoc()
    const code = createBarcode(doc.sheet, 'qrcode')
    const out = autoBind([code], ['내용'], doc.sheet)
    expect(out.design).toHaveLength(2)
    expect(boundColumn(out.design[1])).toBe('내용')
  })

  it('쓰이지 않은 열마다 글자 항목을 만든다', () => {
    const doc = defaultDoc()
    const design = addColumnTexts([createText(doc.sheet, '{상품명}')], ['상품명', '가격', '원산지'], doc.sheet)
    expect(design).toHaveLength(3)
    expect([...usedColumns(design, ['상품명', '가격', '원산지'])]).toEqual(['상품명', '가격', '원산지'])
    for (const el of design) {
      expect(el.y).toBeGreaterThanOrEqual(0)
      expect(el.y + el.h).toBeLessThanOrEqual(doc.sheet.labelH + 0.01)
    }
    expect(Object.values(elementTitles(design))).toEqual(['글자 1', '글자 2', '글자 3'])
  })

  it('열 이름을 바꾸면 디자인의 자리표시도 바뀐다', () => {
    const base = defaultDoc()
    const doc = { ...base, table: { columns: ['상품명', '가격'], rows: [['사과', '100']] }, design: [createText(base.sheet, '{상품명} {가격}원'), createText(base.sheet, '{ 상품명 }'), createBarcode(base.sheet, 'code128')] }
    const next = renameColumn(doc, 0, '품명')
    expect(next.table.columns).toEqual(['품명', '가격'])
    expect((next.design[0] as TextEl).text).toBe('{품명} {가격}원')
    expect((next.design[1] as TextEl).text).toBe('{품명}')
    expect(next.design[2]).toBe(doc.design[2])
    // 겹치는 이름은 피한다
    expect(renameColumn(doc, 0, '가격').table.columns).toEqual(['가격2', '가격'])
  })

  it('열·행 고치기', () => {
    const base = { ...defaultDoc(), table: { columns: ['a', 'b'], rows: [['1', '2'], ['3', '4']] } }
    expect(removeColumn(base, 0).table).toEqual({ columns: ['b'], rows: [['2'], ['4']] })
    expect(removeColumn(removeColumn(base, 0), 0).table).toEqual({ columns: [], rows: [] })
    expect(addColumn(base).table.columns).toEqual(['a', 'b', '열3'])
    expect(clearRows(base, [1]).table.rows).toEqual([['1', '2']])
    const typed = setRowValues(defaultDoc(), [0, 3], '내용', '직접 입력')
    expect(typed.table.rows).toEqual([['직접 입력'], [''], [''], ['직접 입력']])
    expect(typed.mode).toBe('data')
    expect(boundColumn(typed.design[0])).toBe('내용')
  })
})

describe('용지 바꾸기와 양식', () => {
  it('용지를 바꾸면 디자인을 새 칸 크기에 맞추고 시작 칸을 줄인다', () => {
    const doc = { ...defaultDoc(), startCell: 20, skip: [3, 19] }
    const next = applySheet(doc, SHEET_BY_ID['a4-8-99x68'], true)
    expect(next.startCell).toBe(7)
    expect(next.skip).toEqual([3])
    for (const el of next.design) {
      expect(el.x + el.w).toBeLessThanOrEqual(99.01)
      expect(el.y + el.h).toBeLessThanOrEqual(68.01)
    }
    // 칸 크기만 조금 고칠 때는 비율로 늘리지 않고 안에 가두기만 한다
    const narrow = applySheet(doc, { ...doc.sheet, labelW: 30 }, false)
    expect(narrow.design[0].w).toBeLessThanOrEqual(30)
    expect((narrow.design[0] as TextEl).size).toBe((doc.design[0] as TextEl).size)
  })

  it('양식에는 표의 내용을 담지 않는다', () => {
    const pasted = pasteIntoDoc(defaultDoc(), '홍길동\n김온비', 'cells', null)
    if (!pasted.ok) throw new Error('paste failed')
    const template = toTemplate(pasted.doc)
    expect(JSON.stringify(template)).not.toContain('홍길동')
    expect(template.columns).toEqual(['내용'])
    // 다른 문서에서 불러오면 내용 없이, 같은 열을 쓰는 문서에서 불러오면 내용을 둔 채로
    expect(fromTemplate(JSON.parse(JSON.stringify(template)), defaultDoc())?.table).toEqual({ columns: ['내용'], rows: [] })
    expect(fromTemplate(JSON.parse(JSON.stringify(template)), pasted.doc)?.table.rows).toHaveLength(2)
    expect(fromTemplate('엉뚱한 값', defaultDoc())).toBeNull()
  })
})
