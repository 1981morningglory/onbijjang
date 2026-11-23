// 로켓발주입고관리 — 쿠팡 서플라이어 허브 발주서(PO_SKU_LIST_*.csv) 읽기·요약·상품목록 배치
// 원래 claude.ai 아티팩트(coupang-po-summary/index.html)의 계산을 그대로 옮겼다. 정확성이 최우선이므로
// 숫자 계산·정렬·인쇄 배치 규칙을 바꾸지 말 것(바꾸면 시험 rocket.test.ts 와 tools/verify.py 로 대조).
//
// - 모든 금액은 VAT 별도(공급가 기준): 금액 = 수량 × 공급가. 공급가가 없으면 round(매입가 / 1.1)
// - 바코드·발주번호는 늘 문자열(R2149… 처럼 글자가 섞인 바코드가 있다)

export interface PoRow {
  po: string
  type: string
  status: string
  sku: string
  name: string
  bc: string
  ctr: string
  due: string
  day: string
  /** 발주수량 · 확정수량 · 입고수량 */
  q: number
  c: number
  inq: number
  /** 공급가(VAT 별도) */
  p: number
  /** 발주금액 · 확정금액(VAT 별도) */
  amt: number
  camt: number
  /** 총발주 매입금(VAT 포함, 참고용) */
  gross: number
}

export const REQUIRED_COLS = ['발주번호', 'SKU ID', 'SKU 이름', '물류센터', '발주수량', '확정수량'] as const

/** CSV 읽기(따옴표로 감싼 필드·쉼표·줄바꿈·"" 이스케이프 처리) */
export function parseCSV(t: string): string[][] {
  const out: string[][] = []
  let r: string[] = []
  let f = ''
  let q = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (q) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          f += '"'
          i++
        } else q = false
      } else f += c
    } else if (c === '"') q = true
    else if (c === ',') {
      r.push(f)
      f = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++
      r.push(f)
      f = ''
      if (r.length > 1 || r[0] !== '') out.push(r)
      r = []
    } else f += c
  }
  if (f !== '' || r.length) {
    r.push(f)
    out.push(r)
  }
  return out
}

/** 파일 바이트 → 글자(UTF-8, 깨지면 EUC-KR). 앞의 BOM 은 뗀다 */
export function decode(buf: ArrayBuffer | Uint8Array): string {
  let t = new TextDecoder('utf-8').decode(buf)
  if (t.includes(String.fromCharCode(0xfffd))) {
    try {
      t = new TextDecoder('euc-kr').decode(buf)
    } catch {
      // EUC-KR 을 못 읽는 환경이면 UTF-8 그대로
    }
  }
  return t.replace(/^﻿/, '')
}

const num = (v: unknown) => +String(v || '0').replace(/,/g, '') || 0

/** CSV 글자 → 발주 행. 쿠팡 발주서가 아니면 error */
export function readPo(text: string): { rows: PoRow[]; error?: string } {
  const a = parseCSV(text)
  if (a.length < 2) return { rows: [], error: '읽을 수 있는 행이 없어요.' }
  const h = a[0].map((s) => s.trim())
  const ix = (k: string) => h.indexOf(k)
  const miss = REQUIRED_COLS.filter((k) => ix(k) < 0)
  if (miss.length) return { rows: [], error: `쿠팡 발주서 형식이 아니에요: ${miss.join(', ')} 열이 없어요.` }
  const g = (r: string[], k: string) => (ix(k) < 0 ? '' : (r[ix(k)] ?? ''))
  const rows = a
    .slice(1)
    .filter((r) => g(r, '발주번호'))
    .map((r): PoRow => {
      const q = num(g(r, '발주수량'))
      const c = num(g(r, '확정수량'))
      const pv = num(g(r, '매입가'))
      const p = num(g(r, '공급가')) || Math.round(pv / 1.1)
      return {
        po: g(r, '발주번호'),
        type: g(r, '발주유형') || '-',
        status: g(r, '발주현황'),
        sku: g(r, 'SKU ID'),
        name: g(r, 'SKU 이름'),
        bc: g(r, 'SKU Barcode'),
        ctr: g(r, '물류센터'),
        due: g(r, '입고예정일') || '-',
        day: (g(r, '발주일') || '-').slice(0, 10),
        q,
        c,
        inq: num(g(r, '입고수량')),
        p,
        amt: q * p,
        camt: c * p,
        gross: num(g(r, '총발주 매입금')) || q * pv,
      }
    })
  return { rows }
}

export interface Group {
  k: string
  rows: number
  pos: Set<string>
  skus: Set<string>
  ctrs: Set<string>
  q: number
  c: number
  amt: number
  camt: number
  inq: number
  name: string
  bc: string
  /** 미확정수량 · 미확정금액 */
  short: number
  samt: number
}

/** 묶음별 합계(첫 행의 상품명·바코드를 대표로) */
export function group(list: PoRow[], key: keyof PoRow | ((r: PoRow) => string)): Group[] {
  const m = new Map<string, Omit<Group, 'short' | 'samt'>>()
  for (const r of list) {
    const k = typeof key === 'function' ? key(r) : String(r[key])
    let o = m.get(k)
    if (!o) {
      o = { k, rows: 0, pos: new Set(), skus: new Set(), q: 0, c: 0, amt: 0, camt: 0, inq: 0, ctrs: new Set(), name: r.name, bc: r.bc }
      m.set(k, o)
    }
    o.rows++
    o.pos.add(r.po)
    o.skus.add(r.sku)
    o.ctrs.add(r.ctr)
    o.q += r.q
    o.c += r.c
    o.amt += r.amt
    o.camt += r.camt
    o.inq += r.inq
  }
  return [...m.values()].map((o) => ({ ...o, short: o.q - o.c, samt: o.amt - o.camt }))
}

/** 입고예정일·발주유형 필터(빈 값 = 전체). 엑셀에도 똑같이 적용된다 */
export const filterRows = (rows: PoRow[], due: string, type: string) => rows.filter((r) => (!due || r.due === due) && (!type || r.type === type))

export type SkuSort = 'camt' | 'q' | 'short'
/** SKU별 합계(검색어·정렬) */
export function skuGroups(v: PoRow[], query: string, sort: SkuSort): Group[] {
  const q = query.trim().toLowerCase()
  let G = group(v, 'sku')
  if (q) G = G.filter((g) => `${g.k} ${g.name} ${g.bc}`.toLowerCase().includes(q))
  return G.sort((a, b) => (sort === 'short' ? b.short - a.short || b.samt - a.samt : b[sort] - a[sort]))
}

// ── 상품목록(엑셀 둘째 시트) 배치 ─────────────────────────
export const PRODUCT_HEAD = ['물류센터', '상품바코드', '상품이름', '발주수량', '비고'] as const
/** 한 페이지 최대 줄 수 */
export const PAGE_ROWS = 43
export interface ListLine {
  kind: 'h' | 'b' | 'd'
  cells: Array<string | number>
}
export interface ProductItem {
  ctr: string
  bc: string
  name: string
  q: number
}

/**
 * 같은 센터의 같은 SKU 는 발주수량을 합쳐 한 줄.
 * 센터: 상품 수가 적은 센터부터(같으면 센터 이름 순, 엑셀과 같은 Intl.Collator('en')) · 센터 안: 발주수량 많은 순, 같으면 상품이름 순
 */
export function productItems(v: PoRow[]): ProductItem[] {
  const col = new Intl.Collator('en')
  const cnt: Record<string, number> = {}
  const PG = group(v, (r) => `${r.ctr}\u0001${r.sku}`).map((g) => ({ ctr: g.k.split('\u0001')[0], bc: g.bc, name: g.name, q: g.q }))
  for (const r of PG) cnt[r.ctr] = (cnt[r.ctr] || 0) + 1
  return PG.sort((a, b) => cnt[a.ctr] - cnt[b.ctr] || col.compare(a.ctr, b.ctr) || b.q - a.q || col.compare(a.name, b.name))
}

/**
 * 인쇄 배치: 한 페이지 43줄. 센터가 바뀔 때는 늘 빈 줄 2 + 머리글.
 * 블록(머리글+상품)이 현재 페이지에 다 안 들어가면 새 페이지에서 시작, 여러 페이지에 걸친 센터는 페이지마다 머리글.
 * breaks: 새 페이지가 시작하는 줄 번호(0부터) = 앞 페이지 마지막 줄의 엑셀 행 번호(1부터)
 */
export function layoutProducts(items: ProductItem[]): { lines: ListLine[]; breaks: number[] } {
  const lines: ListLine[] = []
  const breaks: number[] = []
  let used = 0
  const newPage = () => {
    if (lines.length && used) breaks.push(lines.length)
    used = 0
  }
  const put = (cells: Array<string | number>, kind: ListLine['kind']) => {
    lines.push({ kind, cells })
    used++
  }
  const blocks: ProductItem[][] = []
  for (const r of items) {
    const b = blocks.at(-1)
    if (b && b[0].ctr === r.ctr) b.push(r)
    else blocks.push([r])
  }
  blocks.forEach((block, bi) => {
    if (bi) {
      if (used + 2 > PAGE_ROWS) newPage()
      put([], 'b')
      put([], 'b')
      if (used + 1 + block.length > PAGE_ROWS) newPage()
    }
    if (PAGE_ROWS - used < 2) newPage()
    put([...PRODUCT_HEAD], 'h')
    for (const r of block) {
      if (used >= PAGE_ROWS) {
        newPage()
        put([...PRODUCT_HEAD], 'h')
      }
      put([r.ctr, String(r.bc), r.name, r.q, ''], 'd')
    }
  })
  return { lines, breaks }
}

/** 요약(화면 맨 위) */
export function summarize(v: PoRow[]) {
  const T = group(v, () => '1')[0]
  const dues = [...new Set(v.map((r) => r.due))].sort()
  const days = [...new Set(v.map((r) => r.day))].sort()
  const shortRows = v.filter((r) => r.c < r.q)
  const C = group(v, 'ctr').sort((a, b) => b.amt - a.amt)
  const S = group(shortRows, 'sku').sort((a, b) => b.samt - a.samt)
  return { T, dues, days, shortRows, C, S }
}

// ── 글자 ─────────────────────────────────────────────────
export const won = (n: number) => Math.round(n).toLocaleString('ko-KR')
export const ea = won
export const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10}%` : '-')
/** 1억 2,345만원 */
export const big = (n: number) => {
  n = Math.round(n)
  const e = Math.floor(n / 1e8)
  const m = Math.round((n % 1e8) / 1e4)
  return e ? `${e}억 ${m.toLocaleString('ko-KR')}만원` : `${m.toLocaleString('ko-KR')}만원`
}
export const tsv = (a: Array<Array<string | number>>) => a.map((r) => r.join('\t')).join('\n')
