import { autoBind, contentOf, defaultDoc, withContent } from './factory'
import {
  DEFAULT_COLUMN,
  MAX_LABELS,
  cellsPerSheet,
  clampElement,
  cleanColumns,
  fitDesign,
  flattenGrid,
  normalizeDoc,
  parseClipboardTable,
  tableFromGrid,
  trimTable,
  writeColumn,
  writeRows,
  type DataTable,
  type LabelDoc,
  type SheetSpec,
} from './model'

/** 문서 단위의 바꾸기 — 화면 없이 계산만 해서 테스트할 수 있다. */

/** 용지를 바꾼다. fit 이면 디자인을 새 칸 크기 비율로 맞추고, 아니면 칸 안에 가두기만 한다. */
export function applySheet(doc: LabelDoc, sheet: SheetSpec, fit: boolean): LabelDoc {
  const perSheet = cellsPerSheet(sheet)
  const resized = fit ? fitDesign(doc.design, { w: doc.sheet.labelW, h: doc.sheet.labelH }, { w: sheet.labelW, h: sheet.labelH }) : doc.design
  const sizeChanged = sheet.labelW !== doc.sheet.labelW || sheet.labelH !== doc.sheet.labelH
  return {
    ...doc,
    sheet,
    design: sizeChanged ? resized.map((el) => clampElement(el, sheet.labelW, sheet.labelH)) : resized,
    startCell: Math.min(doc.startCell, perSheet - 1),
    skip: doc.skip.filter((c) => c < perSheet),
  }
}

/** 열 이름을 바꾸고, 디자인에 적힌 {옛이름} 도 같이 바꾼다. */
export function renameColumn(doc: LabelDoc, index: number, name: string): LabelDoc {
  const old = doc.table.columns[index]
  if (old === undefined) return doc
  // 다른 열과 이름이 겹치면 바꾸는 쪽에 숫자를 붙인다(이미 연결된 다른 열은 건드리지 않는다).
  const others = doc.table.columns.filter((_, i) => i !== index)
  const next = cleanColumns([...others, name])[others.length]
  if (next === old) return doc
  const columns = doc.table.columns.map((c, i) => (i === index ? next : c))
  const re = new RegExp(`\\{\\s*${old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}`, 'g')
  return {
    ...doc,
    table: { ...doc.table, columns },
    design: doc.design.map((el) => {
      const content = contentOf(el)
      if (content === null) return el
      const replaced = content.replace(re, `{${next}}`)
      return replaced === content ? el : withContent(el, replaced)
    }),
  }
}

export function removeColumn(doc: LabelDoc, index: number): LabelDoc {
  const columns = doc.table.columns.filter((_, i) => i !== index)
  const rows = doc.table.rows.map((r) => r.filter((_, i) => i !== index))
  return { ...doc, table: columns.length ? trimTable({ columns, rows }) : { columns: [], rows: [] } }
}

export function addColumn(doc: LabelDoc): LabelDoc {
  const columns = cleanColumns([...doc.table.columns, doc.table.columns.length ? `열${doc.table.columns.length + 1}` : DEFAULT_COLUMN])
  return { ...doc, mode: 'data', table: { columns, rows: doc.table.rows.map((r) => [...r, '']) } }
}

/** 고른 행들의 한 열에 같은 값을 넣는다. 표가 비어 있으면 열을 만들고 디자인에 잇는다. */
export function setRowValues(doc: LabelDoc, rows: number[], column: string, value: string): LabelDoc {
  let table: DataTable = doc.table
  for (const r of rows) table = writeColumn(table, r, column, [value])
  const bound = autoBind(doc.design, table.columns, doc.sheet)
  return { ...doc, mode: 'data', table, design: bound.design }
}

/** 고른 행의 내용을 비운다(빈 라벨로 남는다). */
export function clearRows(doc: LabelDoc, rows: number[]): LabelDoc {
  const target = new Set(rows)
  return { ...doc, table: trimTable({ columns: doc.table.columns, rows: doc.table.rows.map((r, i) => (target.has(i) ? r.map(() => '') : r)) }) }
}

export type PasteMode = 'cells' | 'rows'
export type PasteOutcome = { ok: true; doc: LabelDoc; count: number; bound: string | null; truncated: boolean } | { ok: false; message: string }

/**
 * 엑셀에서 복사한 글을 문서에 넣는다.
 * cells: 셀 하나가 라벨 한 칸(가로 순서). rows: 첫 줄은 열 이름, 한 줄이 라벨 한 장.
 * startLabel 이 null 이면 내용을 통째로 바꾸고, 숫자면 그 라벨 자리부터 덮어쓴다(쓰다 남은 용지·이어 붙이기).
 */
export function pasteIntoDoc(doc: LabelDoc, text: string, mode: PasteMode, startLabel: number | null, column?: string): PasteOutcome {
  const grid = parseClipboardTable(text)
  if (!grid.length) return { ok: false, message: '붙여넣을 내용이 없습니다. 엑셀에서 칸을 복사한 뒤 다시 붙여넣어 주세요.' }
  const repeat = Math.max(1, doc.repeat)
  const startRow = startLabel === null ? 0 : Math.floor(startLabel / repeat)
  let table: DataTable
  let count: number
  if (mode === 'cells') {
    const values = flattenGrid(grid)
    if (!values.length) return { ok: false, message: '붙여넣은 칸이 모두 비어 있습니다.' }
    const target = column && doc.table.columns.includes(column) ? column : (doc.table.columns[0] ?? DEFAULT_COLUMN)
    table = startLabel === null ? { columns: [target], rows: values.map((v) => [v]) } : writeColumn(doc.table, startRow, target, values)
    count = values.length
  } else {
    if (grid.length < 2) return { ok: false, message: '첫 줄은 열 이름으로 씁니다. 열 이름 줄과 내용 줄을 함께 복사해 주세요.' }
    const incoming = tableFromGrid(grid, true)
    if (!incoming.rows.length) return { ok: false, message: '열 이름 아래에 내용이 없습니다.' }
    table = startLabel === null ? incoming : writeRows(doc.table, startRow, incoming)
    count = incoming.rows.length
  }
  const limit = Math.floor(MAX_LABELS / repeat)
  const truncated = table.rows.length > limit
  if (truncated) table = { columns: table.columns, rows: table.rows.slice(0, limit) }
  const bound = autoBind(doc.design, table.columns, doc.sheet)
  return { ok: true, doc: { ...doc, mode: 'data', table, design: bound.design }, count, bound: bound.bound, truncated }
}

/** 팀 보관함에 저장하는 양식 — 용지·디자인·설정과 열 이름만 담고, 표의 내용(주소·이름 등)은 담지 않는다. */
export interface LabelTemplate extends Omit<LabelDoc, 'table'> {
  columns: string[]
}

export function toTemplate(doc: LabelDoc): LabelTemplate {
  const { table, ...rest } = doc
  return { ...rest, columns: table.columns }
}

/** 양식을 불러온다. 지금 표의 열이 양식과 같으면 내용을 그대로 둔다. */
export function fromTemplate(raw: unknown, current: LabelDoc): LabelDoc | null {
  if (!raw || typeof raw !== 'object') return null
  const t = raw as Partial<LabelTemplate> & { table?: DataTable }
  const columns = Array.isArray(t.columns) ? t.columns.map(String) : (t.table?.columns ?? [])
  const same = columns.length === current.table.columns.length && columns.every((c, i) => c === current.table.columns[i])
  return normalizeDoc({ ...t, table: { columns, rows: same ? current.table.rows : [] } }, defaultDoc())
}
