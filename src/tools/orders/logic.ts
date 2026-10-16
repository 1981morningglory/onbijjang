/**
 * 주문서 만들기 — 사방넷 주문서(발주서) 한 장을 읽어 창고 전달·CJ대한통운 업로드·구글 드라이브 업로드 파일을 만든다.
 * 순수 함수만 둔다(엑셀 읽기·쓰기는 excel.ts).
 */

/** 사방넷 발주서의 칸 이름 */
export const COL = {
  no: 'NO',
  orderNo: '주문번호',
  buyer: '주문자명',
  receiver: '수취인명',
  phone1: '전화번호1',
  phone2: '전화번호2',
  address: '수취인주소',
  code: '상품코드',
  name: '상품명',
  rawName: '상품명(수집/삭제)',
  option: '옵션',
  rawOption: '옵션(수집/삭제)',
  qty: '수량',
  message: '배송메세지',
  mall: '쇼핑몰',
  sabangNo: '사방넷주문번호',
  warehouse: '물류처명',
  invoice: '송장번호',
} as const

/** 한 줄(사방넷 칸 이름 → 값). 사방넷에서 칸을 더 받아 오면 그 칸도 그대로 담긴다 */
export type OrderRow = Record<string, string | number | null>

export interface SourceSheet {
  sheetName: string
  /** 원본 칸 순서 */
  cols: string[]
  rows: OrderRow[]
}

export const DEFAULT_WAREHOUSE = '모닝글로리-일산센터'
export const JEJU_NOTE = '제주도출고O'

const s = (v: unknown) => (v == null ? '' : String(v).trim())

/** 엑셀 칸 값 → 저장할 값. 사방넷이 숫자로 내보낸 주문번호·전화번호도 글자로(앞의 0, 긴 숫자 보존) */
export function cellValue(header: string, v: unknown): string | number | null {
  if (v == null || v === '') return null
  if (typeof v === 'object') {
    const o = v as { text?: unknown; result?: unknown; richText?: Array<{ text: string }> }
    if (o.richText) return o.richText.map((r) => r.text).join('').trim() || null
    if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ')
    return cellValue(header, o.result ?? o.text)
  }
  if (typeof v === 'number') {
    if (header === COL.qty || header === COL.no || header === COL.sabangNo) return Number.isInteger(v) ? v : Math.round(v)
    return String(v)
  }
  const t = String(v).trim()
  if (!t) return null
  if (header === COL.qty || header === COL.sabangNo) {
    const n = Number(t.replace(/,/g, ''))
    return Number.isFinite(n) ? n : t
  }
  return t
}

/** 머리줄이 사방넷 발주서인지 */
export function looksLikeSabangnet(cols: string[]): string | null {
  const need = [COL.orderNo, COL.receiver, COL.code, COL.name, COL.qty, COL.mall]
  const miss = need.filter((c) => !cols.includes(c))
  return miss.length ? `사방넷 주문서에 있어야 할 칸이 없습니다: ${miss.join(', ')}` : null
}

/** 시트·파일 이름 앞의 20261015 → '2026-10-15' */
export function dateFromName(...names: string[]): string | null {
  for (const n of names) {
    const m = /(20\d{2})[-._]?(\d{2})[-._]?(\d{2})/.exec(n ?? '')
    if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[3]) >= 1 && Number(m[3]) <= 31) return `${m[1]}-${m[2]}-${m[3]}`
  }
  return null
}

/** 한국 날짜(YYYY-MM-DD) */
export const todayKst = (now = Date.now()) => new Date(now + 9 * 3600_000).toISOString().slice(0, 10)

export const isJeju = (r: OrderRow) => s(r[COL.address]).includes('제주')

/** 상품코드가 없는 줄(사방넷이 상품을 못 맞춘 것) — 사람이 채워야 한다 */
export const needsProduct = (r: OrderRow) => !s(r[COL.code])

/** 매칭 기억용 열쇠: 쇼핑몰에서 들어온 상품명 + 옵션 */
export const productKey = (r: OrderRow) => `${s(r[COL.rawName])}|${s(r[COL.rawOption])}`

/**
 * 엑셀 정렬과 같은 순서: 쇼핑몰 → 주문번호 → 상품코드.
 * 엑셀처럼 숫자 < 영문(대소문자 무시) < 한글 순이 되도록 소문자로 바꿔 글자 번호로 비교한다.
 */
export function compareRows(a: OrderRow, b: OrderRow): number {
  for (const k of [COL.mall, COL.orderNo, COL.code]) {
    const x = s(a[k]).toLowerCase()
    const y = s(b[k]).toLowerCase()
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}
export const sortRows = (rows: OrderRow[]) => rows.map((r, i) => [r, i] as const).sort((p, q) => compareRows(p[0], q[0]) || p[1] - q[1]).map(([r]) => r)

export type OutputKind = 'warehouse' | 'cj' | 'drive'

export interface OutputSpec {
  kind: OutputKind
  label: string
  /** 파일 이름 끝말 */
  suffix: string
  cols: string[]
  widths: number[]
  /** 배송메세지: 원본 그대로 / 제주만 '제주도출고O' */
  message: 'original' | 'jeju'
}

export const OUTPUTS: OutputSpec[] = [
  {
    kind: 'warehouse',
    label: '센터주문서',
    suffix: '센터주문서',
    cols: [COL.no, COL.receiver, COL.code, COL.name, COL.option, COL.qty, COL.message],
    // NO 4 · 수취인명 11 · 상품코드 15.7 · 상품명 36(남는 폭은 상품명에, centerWidths) · 옵션 7.3 · 수량 4 · 배송메세지 10
    widths: [4, 11, 15.7, 36, 7.3, 4, 10],
    message: 'jeju',
  },
  {
    kind: 'cj',
    label: 'CJ택배',
    suffix: 'CJ택배',
    cols: [COL.no, COL.orderNo, COL.buyer, COL.receiver, COL.phone1, COL.phone2, COL.address, COL.code, COL.name, COL.option, COL.qty, COL.message, COL.mall, COL.sabangNo, COL.warehouse],
    widths: [3.5, 18.1, 16.6, 21.4, 14.2, 14.2, 76.9, 14.5, 31.2, 13.2, 4, 39.4, 10.4, 11.9, 15.6],
    message: 'original',
  },
  {
    kind: 'drive',
    label: '구글드라이브용',
    suffix: '구글드라이브용',
    cols: [COL.no, COL.orderNo, COL.buyer, COL.receiver, COL.phone1, COL.phone2, COL.code, COL.name, COL.option, COL.qty, COL.message, COL.mall, COL.sabangNo],
    widths: [3.5, 18.1, 16.6, 21.4, 14.2, 14.2, 14.5, 31.2, 13.2, 4, 11, 10.4, 11.9],
    message: 'jeju',
  },
]

// ── 센터주문서: A4 쪽 나누기 ─────────────────────────────
/** 센터주문서 행 높이(pt) — 머리줄 포함 전부 */
export const CENTER_ROW_HEIGHT = 19
/**
 * A4 세로·좁은 여백(위아래 0.75in)에서 한 쪽에 들어가는 주문 줄 수.
 * 인쇄 높이 297mm − 38.1mm = 733.9pt, 머리줄(반복) 1줄 + 주문 37줄 = 38줄 × 19pt = 722pt(약 12pt 여유)
 */
export const CENTER_PAGE_ROWS = 37

/** 엑셀 열 너비(글자 수) → 화면 픽셀(기본 글꼴 최대 숫자 폭 7px) */
export const colPx = (w: number) => Math.trunc(w * 7 + 5)
/** A4 세로 폭 210mm 에서 좁은 여백(좌우 0.25in)을 뺀 인쇄 폭(96dpi 픽셀). 테두리·반올림 몫으로 12px 남긴다 */
export const A4_PRINT_PX = Math.floor((210 / 25.4 - 0.5) * 96) - 12
/** 정해 준 열 너비로 한 쪽에 넣고, 남는 폭은 모두 상품명 열에(0.1 단위로 내림) */
export function centerWidths(base: number[], nameIndex = 3, printPx = A4_PRINT_PX): number[] {
  const used = base.reduce((t, w) => t + colPx(w), 0)
  const extra = printPx - used
  if (extra <= 0) return base
  const out = [...base]
  out[nameIndex] = Math.floor((base[nameIndex] + extra / 7) * 10) / 10
  while (out.reduce((t, w) => t + colPx(w), 0) > printPx) out[nameIndex] = Math.round((out[nameIndex] - 0.1) * 10) / 10
  return out
}
/** 한 주문(쇼핑몰+주문번호) */
export const orderKey = (r: OrderRow) => `${s(r[COL.mall])}|${s(r[COL.orderNo])}`
/** 같은 사람(주문자·수취인·주소가 같으면 한 상자로 포장될 수 있다) */
export const customerKey = (r: OrderRow) => `${s(r[COL.buyer])}|${s(r[COL.receiver])}|${s(r[COL.address]).replace(/\s+/g, '')}`
/**
 * 정렬된 줄을 사람 단위로 묶는다. 같은 사람이 주문을 여러 건 했으면(쇼핑몰이 달라도) 처음 나온 자리로 모은다.
 * 피킹할 때 한 사람 물건이 앞뒤 쪽으로 갈려 따로 포장되는 일을 막기 위해서다.
 */
export function orderGroups(sorted: OrderRow[]): OrderRow[][] {
  const m = new Map<string, OrderRow[]>()
  for (const r of sorted) {
    const k = customerKey(r)
    const g = m.get(k)
    if (g) g.push(r)
    else m.set(k, [r])
  }
  return [...m.values()]
}

/**
 * 한 사람의 주문이 두 쪽에 나뉘지 않게 쪽을 채운다.
 * 정렬 순서대로 넣다가 다음 사람 묶음이 남은 칸에 안 들어가면, 뒤에서 남은 칸에 들어가는 작은 묶음(낱개 주문)을 끌어와 채우고
 * 큰 묶음은 다음 쪽 맨 위로 보낸다. 한 쪽보다 긴 묶음은 어쩔 수 없이 새 쪽에서 시작해 넘어간다.
 */
export function layoutCenter(rows: OrderRow[], perPage = CENTER_PAGE_ROWS): { rows: OrderRow[]; pageEnds: number[]; groups: OrderRow[][]; oversized: number } {
  const left = orderGroups(sortRows(rows))
  const pages: OrderRow[][][] = []
  let oversized = 0
  while (left.length) {
    const page: OrderRow[][] = []
    let room = perPage
    if (left[0].length > perPage) {
      // 한 쪽보다 긴 주문: 혼자 새 쪽에서 시작
      oversized++
      const g = left.shift()!
      page.push(g)
      room = perPage - (g.length % perPage || perPage)
    }
    for (let i = 0; i < left.length && room > 0; ) {
      if (left[i].length <= room) {
        room -= left[i].length
        page.push(left.splice(i, 1)[0])
      } else i++
    }
    pages.push(page)
  }
  const groups = pages.flat()
  const pageEnds: number[] = []
  let n = 0
  for (const p of pages) {
    n += p.reduce((t, g) => t + g.length, 0)
    pageEnds.push(n)
  }
  return { rows: groups.flat(), pageEnds, groups, oversized }
}

/** 출력 순서: 센터주문서는 쪽 나누기를 고려한 순서, 나머지는 정렬 순서 */
export const outputRows = (spec: OutputSpec, rows: OrderRow[]) => (spec.kind === 'warehouse' ? layoutCenter(rows).rows : sortRows(rows))

// ── 센터주문서 둘째 탭: 출고제품 요약 ────────────────────
export interface ProductSummaryRow {
  rank: number
  code: string
  name: string
  option: string
  /** 주문수량(합계) */
  qty: number
  /** 주문건수(주문자명 수) */
  buyers: number
}
/** 많이 나가는 순서(주문수량 → 주문건수) 상위 n개. 같은 수량·건수면 같은 순위 */
export function productSummary(rows: OrderRow[], top = 20): ProductSummaryRow[] {
  const m = new Map<string, { code: string; name: string; option: string; qty: number; buyers: Set<string> }>()
  for (const r of rows) {
    const name = s(r[COL.name]) || s(r[COL.rawName])
    const option = s(r[COL.option])
    const key = `${s(r[COL.code])}|${name}|${option}`
    const e = m.get(key) ?? { code: s(r[COL.code]), name, option, qty: 0, buyers: new Set<string>() }
    e.qty += Number(r[COL.qty]) || 0
    e.buyers.add(s(r[COL.buyer]) || s(r[COL.receiver]))
    m.set(key, e)
  }
  const list = [...m.values()].sort((a, b) => b.qty - a.qty || b.buyers.size - a.buyers.size || a.name.localeCompare(b.name, 'ko'))
  const out: ProductSummaryRow[] = []
  list.slice(0, top).forEach((e, i) => {
    const prev = out[i - 1]
    const rank = prev && prev.qty === e.qty && prev.buyers === e.buyers.size ? prev.rank : i + 1
    out.push({ rank, code: e.code, name: e.name, option: e.option, qty: e.qty, buyers: e.buyers.size })
  })
  return out
}
export const SUMMARY_COLS = ['순위', 'NO.', '제품명', '옵션', '주문수량', '주문건수', '비고']
export const SUMMARY_WIDTHS = [6, 5, 40, 12, 9, 9, 13]

/** 머릿말: '2026.10.16 주문서 2차' */
export const centerHeader = (date: string, seq: number) => `${date.replace(/-/g, '.')} 주문서 ${seq}차`

/** 내보낼 표(머리줄 + 줄). NO 는 '1','2'… 글자, 수량·사방넷주문번호는 숫자 */
export function buildOutput(spec: OutputSpec, rows: OrderRow[]): Array<Array<string | number | null>> {
  const out: Array<Array<string | number | null>> = [spec.cols]
  outputRows(spec, rows).forEach((r, i) => {
    out.push(
      spec.cols.map((c) => {
        if (c === COL.no) return String(i + 1)
        if (c === COL.message) return spec.message === 'jeju' ? (isJeju(r) ? JEJU_NOTE : null) : (r[c] ?? null)
        const v = r[c]
        if (c === COL.qty || c === COL.sabangNo) return v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : v
        return v == null ? null : String(v)
      }),
    )
  })
  return out
}

/** 업로드 시각 '13:05' (한국 시각) */
export const timeKst = (iso: string) => new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(11, 16)
/** 업로드 일시 '2026-10-15 13:05' (한국 시각) */
export const dateTimeKst = (iso: string) => new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 16).replace('T', ' ')

/** '2026-10-15', 2 → '20261015_2차' */
export const batchStamp = (date: string, seq: number) => `${date.replace(/-/g, '')}_${seq}차`
export const outputFileName = (spec: OutputSpec, date: string, seq: number) => `${batchStamp(date, seq)}_${spec.suffix}.xlsx`

// ── 조회 ─────────────────────────────────────────────────
export type SearchField = 'all' | 'person' | 'phone' | 'address' | 'product' | 'orderNo' | 'mall' | 'invoice'
export const SEARCH_FIELDS: ReadonlyArray<{ value: SearchField; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'person', label: '주문자·수취인' },
  { value: 'phone', label: '전화번호' },
  { value: 'address', label: '주소' },
  { value: 'product', label: '상품(코드·이름)' },
  { value: 'orderNo', label: '주문번호' },
  { value: 'mall', label: '쇼핑몰' },
  { value: 'invoice', label: '송장번호' },
]
export const digits = (v: unknown) => s(v).replace(/\D/g, '')

/** 송장번호 칸 찾기(CJ 결과 파일 등): '운송장번호' '송장번호' */
export const findInvoiceCol = (cols: string[]) => cols.find((c) => /운송장\s*번호|송장\s*번호|운송장/.test(c)) ?? null
/** 줄 맞추기 열쇠 칸 */
export const findKeyCols = (cols: string[]) => ({
  sabangNo: cols.find((c) => /사방넷\s*주문\s*번호/.test(c)) ?? null,
  orderNo: cols.find((c) => /^(?:고객)?주문\s*번호$/.test(c.replace(/\s/g, ''))) ?? null,
})
