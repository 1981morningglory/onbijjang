/**
 * 엑셀 일괄 계산 — 붙여넣은 표를 읽어 상품 목록으로 바꾸고, 마켓별 이익표와 내보내기용 표를 만든다. 순수 함수.
 */
import type { Product } from './calc'
import { bestMarket, calcMarket, MARKET_LABEL, MARKETS, resolveCategories, type AllSettings, type MarketId, type MarketResult } from './settings'

export const BULK_MAX_ROWS = 2000

export const BULK_FIELDS = ['name', 'price', 'cost', 'shipping', 'category'] as const
export type BulkField = (typeof BULK_FIELDS)[number]
export const BULK_FIELD_LABEL: Record<BulkField, string> = { name: '상품명', price: '판매가', cost: '원가', shipping: '배송비', category: '카테고리' }
/** 열 번호(0부터). 쓰지 않는 항목은 -1 */
export type BulkMapping = Record<BulkField, number>

/** 엑셀에서 복사한 표(탭 구분) 또는 CSV 글자를 행·열로 나눈다. 따옴표로 감싼 칸 안의 줄바꿈·구분자를 지킨다. */
export function parseTable(text: string): string[][] {
  const src = text.replace(/\r\n?/g, '\n')
  const delimiter = src.includes('\t') ? '\t' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === delimiter) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  row.push(cell)
  rows.push(row)
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''))
}

/** "12,800원", "₩12,800", " 12800 " → 12800. 숫자가 아니면 null */
export function parseMoney(cell: string | number | null | undefined): number | null {
  if (cell == null) return null
  if (typeof cell === 'number') return Number.isFinite(cell) && cell >= 0 ? Math.round(cell) : null
  const cleaned = cell.replace(/[,\s원₩]/g, '')
  if (cleaned === '' || !/^\d+(\.\d+)?$/.test(cleaned)) return null
  return Math.round(Number(cleaned))
}

const HEADER_HINT: Record<BulkField, RegExp> = {
  name: /상품명|품명|상품|이름|제품/,
  price: /판매가|판매\s*가격|가격|소비자가/,
  cost: /원가|매입가|공급가|사입가|입고가/,
  shipping: /배송비|택배비|운임/,
  category: /카테고리|분류/,
}

/** 첫 행이 머리글인지, 각 항목이 몇 번째 열인지 짐작한다. 사용자가 화면에서 바꿀 수 있다. */
export function guessMapping(rows: string[][]): { hasHeader: boolean; mapping: BulkMapping } {
  const first = rows[0] ?? []
  const width = Math.max(0, ...rows.slice(0, 20).map((r) => r.length))
  const mapping: BulkMapping = { name: -1, price: -1, cost: -1, shipping: -1, category: -1 }
  const used = new Set<number>()
  let hits = 0
  for (const field of BULK_FIELDS) {
    const idx = first.findIndex((cell, i) => !used.has(i) && HEADER_HINT[field].test(cell) && parseMoney(cell) == null)
    if (idx >= 0) {
      mapping[field] = idx
      used.add(idx)
      hits++
    }
  }
  const hasHeader = hits >= 2 || (hits === 1 && first.every((c) => parseMoney(c) == null))
  if (!hasHeader) {
    // 머리글이 없으면 상품명, 판매가, 원가, 배송비, 카테고리 순서로 본다.
    BULK_FIELDS.forEach((field, i) => (mapping[field] = i < width ? i : -1))
    return { hasHeader: false, mapping }
  }
  // 머리글에서 못 찾은 항목은 남은 열을 순서대로 채운다(카테고리는 비워 둔다).
  for (const field of ['name', 'price', 'cost', 'shipping'] as const) {
    if (mapping[field] >= 0) continue
    for (let i = 0; i < width; i++) {
      if (!used.has(i)) {
        mapping[field] = i
        used.add(i)
        break
      }
    }
  }
  return { hasHeader: true, mapping }
}

export interface BulkRow {
  /** 붙여넣은 표에서 몇 번째 줄인지(1부터) */
  line: number
  product: Product
  category: string
  /** 계산할 수 없는 이유 */
  error?: string
}

/** shipMode 'paid': 배송비 열을 고객 결제 배송비이자 택배비로 본다. 'free': 판매자가 내는 택배비로만 본다. */
export function buildRows(rows: string[][], mapping: BulkMapping, hasHeader: boolean, shipMode: 'free' | 'paid'): BulkRow[] {
  const out: BulkRow[] = []
  rows.forEach((cells, i) => {
    if (hasHeader && i === 0) return
    const at = (field: BulkField) => (mapping[field] >= 0 ? (cells[mapping[field]] ?? '') : '')
    const price = parseMoney(at('price'))
    const cost = parseMoney(at('cost'))
    const shipping = at('shipping') === '' ? 0 : parseMoney(at('shipping'))
    const name = at('name') || `${i + 1}행`
    let error: string | undefined
    if (price == null || price <= 0) error = '판매가를 숫자로 읽지 못했습니다'
    else if (cost == null) error = '원가를 숫자로 읽지 못했습니다'
    else if (shipping == null) error = '배송비를 숫자로 읽지 못했습니다'
    out.push({
      line: i + 1,
      category: at('category'),
      error,
      product: {
        name,
        price: price ?? 0,
        cost: cost ?? 0,
        shipMode,
        buyerShipping: shipMode === 'paid' ? (shipping ?? 0) : 0,
        shippingCost: shipping ?? 0,
      },
    })
  })
  return out
}

export interface BulkResult {
  row: BulkRow
  markets: MarketResult[]
  best: MarketId | null
}

export function calcBulk(rows: BulkRow[], all: AllSettings): BulkResult[] {
  // 같은 카테고리 이름은 한 번만 찾는다.
  const cache = new Map<string, AllSettings>()
  return rows.map((row) => {
    if (row.error) return { row, markets: [], best: null }
    const key = row.category.trim()
    let resolved = cache.get(key)
    if (!resolved) {
      resolved = resolveCategories(all, key)
      cache.set(key, resolved)
    }
    const markets = MARKETS.map((market) => calcMarket(market, row.product, resolved))
    return { row, markets, best: bestMarket(markets) }
  })
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** 내보내기용 표(첫 행은 머리글). 요율이 비어 계산하지 못한 칸은 빈칸. */
export function toExportTable(results: BulkResult[]): Array<Array<string | number>> {
  const header: Array<string | number> = ['상품명', '판매가', '원가', '배송비', '카테고리']
  for (const m of MARKETS) header.push(`${MARKET_LABEL[m]} 이익`, `${MARKET_LABEL[m]} 이익률(%)`)
  header.push('가장 남는 마켓', '가장 큰 이익', '비고')
  const table = [header]
  for (const r of results) {
    const p = r.row.product
    const line: Array<string | number> = [p.name, p.price, p.cost, p.shippingCost, r.row.category]
    for (const m of MARKETS) {
      const found = r.markets.find((x) => x.market === m)
      if (!found || found.result.missing.length) line.push('', '')
      else line.push(found.result.profit, found.result.marginPct == null ? '' : round1(found.result.marginPct))
    }
    const best = r.markets.find((x) => x.market === r.best)
    const missing = r.markets.filter((x) => x.result.missing.length).map((x) => x.label)
    line.push(best ? best.label : '', best ? best.result.profit : '', r.row.error ?? (missing.length ? `요율 미입력: ${missing.join(', ')}` : ''))
    table.push(line)
  }
  return table
}

/** 엑셀에서 한글이 깨지지 않도록 BOM 을 붙인 CSV */
export function toCsv(table: Array<Array<string | number>>): string {
  const esc = (v: string | number) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return '﻿' + table.map((row) => row.map(esc).join(',')).join('\r\n')
}
