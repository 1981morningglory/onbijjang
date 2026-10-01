import { SYMBOLOGY_BY_ID } from './barcode'
import { DEFAULT_SERIAL, EMPTY_TABLE, MM_PER_PT, SERIAL_KEY, findPlaceholders, newId, round2, type BarcodeEl, type ImageEl, type LabelDoc, type LabelElement, type ShapeEl, type ShapeKind, type SheetSpec, type Symbology, type TextEl } from './model'
import { DEFAULT_SHEET } from './sheets'

/** 새 요소 만들기와 열 연결 — 화면 없이 계산만 한다. */
const INK = '#14201a'
const center = (size: number, total: number) => round2((total - size) / 2)

/** 칸 높이에 어울리는 기본 글자 크기(pt). */
export function defaultFontSize(labelH: number): number {
  return Math.max(6, Math.min(14, Math.round((labelH * 0.22) / MM_PER_PT)))
}

export function createText(sheet: SheetSpec, text = '새 글자'): TextEl {
  const size = defaultFontSize(sheet.labelH)
  const w = round2(Math.max(4, sheet.labelW - 6))
  const h = round2(Math.min(Math.max(3, sheet.labelH - 4), size * MM_PER_PT * 1.3 * 2 + 1))
  return { id: newId(), type: 'text', text, font: 'pretendard', size, bold: false, align: 'center', valign: 'middle', color: INK, shrink: true, x: center(w, sheet.labelW), y: center(h, sheet.labelH), w, h }
}

export function createShape(sheet: SheetSpec, shape: ShapeKind): ShapeEl {
  const line = shape === 'line'
  const w = round2(line ? Math.max(4, sheet.labelW - 8) : Math.max(3, Math.min(sheet.labelW * 0.5, 30)))
  const h = round2(line ? Math.min(2, sheet.labelH) : Math.max(3, Math.min(sheet.labelH * 0.5, 20)))
  return { id: newId(), type: 'shape', shape, fill: null, stroke: INK, strokeWidth: 0.3, radius: 2, x: center(w, sheet.labelW), y: center(h, sheet.labelH), w, h }
}

export function createBarcode(sheet: SheetSpec, symbology: Symbology): BarcodeEl {
  const def = SYMBOLOGY_BY_ID[symbology]
  let w: number
  let h: number
  if (def.kind === 'linear') {
    w = Math.max(8, Math.min(sheet.labelW - 6, 45))
    h = Math.max(5, Math.min(sheet.labelH - 4, 16))
  } else if (def.kind === 'stacked') {
    w = Math.max(8, Math.min(sheet.labelW - 6, 45))
    h = Math.max(4, Math.min(sheet.labelH - 4, 12))
  } else {
    w = h = Math.max(5, Math.min(sheet.labelW - 4, sheet.labelH - 4, 22))
  }
  return { id: newId(), type: 'barcode', symbology, value: def.sample, showText: def.kind === 'linear', textSize: 7, color: '#000000', x: center(w, sheet.labelW), y: center(h, sheet.labelH), w: round2(w), h: round2(h) }
}

export function createImage(sheet: SheetSpec, src: string, natW: number, natH: number): ImageEl {
  const scale = Math.min((sheet.labelW - 4) / natW, (sheet.labelH - 4) / natH)
  const w = round2(Math.max(2, natW * scale))
  const h = round2(Math.max(2, natH * scale))
  return { id: newId(), type: 'image', src, natW, natH, fit: 'contain', x: center(w, sheet.labelW), y: center(h, sheet.labelH), w, h }
}

export const ELEMENT_NAME: Record<LabelElement['type'], string> = { text: '글자', image: '이미지', shape: '도형', barcode: '바코드' }

/** 요소 목록에 보일 이름: "글자 2 · {상품명}" */
export function elementTitles(design: LabelElement[]): Record<string, string> {
  const count: Record<string, number> = {}
  const out: Record<string, string> = {}
  for (const el of design) {
    count[el.type] = (count[el.type] ?? 0) + 1
    out[el.id] = `${ELEMENT_NAME[el.type]} ${count[el.type]}`
  }
  return out
}

/** 요소가 가리키는 내용(자리표시를 담을 수 있는 글자·바코드만). */
export const contentOf = (el: LabelElement): string | null => (el.type === 'text' ? el.text : el.type === 'barcode' ? el.value : null)
export const withContent = (el: LabelElement, content: string): LabelElement => (el.type === 'text' ? { ...el, text: content } : el.type === 'barcode' ? { ...el, value: content } : el)

/** 내용이 정확히 {열} 하나면 그 열 이름. */
export function boundColumn(el: LabelElement): string | null {
  const m = /^\{([^{}\n]+)\}$/.exec((contentOf(el) ?? '').trim())
  return m ? m[1].trim() : null
}

/** 디자인이 쓰는 열 이름들(표에 있는 것만). */
export function usedColumns(design: LabelElement[], columns: string[]): Set<string> {
  const known = new Set(columns)
  const out = new Set<string>()
  for (const el of design) for (const name of findPlaceholders(contentOf(el) ?? '')) if (known.has(name)) out.add(name)
  return out
}

/**
 * 표를 새로 채웠는데 디자인이 어느 열도 쓰지 않으면, 첫 글자 항목을 첫 열에 잇는다(글자 항목이 없으면 만든다).
 * 이미 연결된 열이 하나라도 있으면 건드리지 않는다.
 */
export function autoBind(design: LabelElement[], columns: string[], sheet: SheetSpec): { design: LabelElement[]; bound: string | null } {
  if (!columns.length || usedColumns(design, columns).size) return { design, bound: null }
  const column = columns[0]
  // 연번을 담은 글자 항목은 그대로 두고, 그 밖의 첫 글자 항목을 쓴다.
  const index = design.findIndex((el) => el.type === 'text' && !findPlaceholders(el.text).includes(SERIAL_KEY))
  if (index >= 0) return { design: design.map((el, i) => (i === index ? withContent(el, `{${column}}`) : el)), bound: column }
  return { design: [...design, createText(sheet, `{${column}}`)], bound: column }
}

/** 아직 쓰이지 않은 열마다 글자 항목을 하나씩 만들어 위에서부터 쌓는다. */
export function addColumnTexts(design: LabelElement[], columns: string[], sheet: SheetSpec): LabelElement[] {
  const used = usedColumns(design, columns)
  const missing = columns.filter((c) => !used.has(c))
  if (!missing.length) return design
  const rowH = Math.max(3, Math.min(8, (sheet.labelH - 4) / missing.length))
  const size = Math.max(5, Math.min(11, Math.floor((rowH / 1.3 / MM_PER_PT) * 2) / 2))
  const w = round2(Math.max(4, sheet.labelW - 6))
  const top = Math.max(0, (sheet.labelH - rowH * missing.length) / 2)
  const added = missing.map((c, i): TextEl => ({ ...createText(sheet, `{${c}}`), size, x: center(w, sheet.labelW), y: round2(top + i * rowH), w, h: round2(rowH), align: 'left' }))
  return [...design, ...added]
}

/** 처음 여는 사람에게 보이는 문서. */
export function defaultDoc(): LabelDoc {
  const sheet = DEFAULT_SHEET
  return {
    version: 1,
    sheet,
    design: [{ ...createText(sheet, '온비짱 라벨'), id: 'welcome' }],
    mode: 'same',
    copies: null,
    table: EMPTY_TABLE,
    repeat: 1,
    startCell: 0,
    skip: [],
    serial: DEFAULT_SERIAL,
    print: { offsetX: 0, offsetY: 0, cutLines: false },
  }
}
