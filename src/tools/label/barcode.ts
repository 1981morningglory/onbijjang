import type { Symbology } from './model'

/**
 * 바코드 14종 — 값 검사(순수)와 bwip-js 로 그리기.
 * bwip-js 는 무거워서 처음 쓸 때 불러온다. 값이 틀리면 예외 대신 사용자 말로 된 안내를 돌려준다.
 */
export interface SymbologyDef {
  id: Symbology
  name: string
  /** bwip-js 의 종류 이름 */
  bcid: string
  /** linear: 막대(가로로 늘려도 됨) · matrix: 정사각 2차원 · stacked: 여러 줄(PDF417) */
  kind: 'linear' | 'matrix' | 'stacked'
  sample: string
  hint: string
}

export const SYMBOLOGIES: SymbologyDef[] = [
  { id: 'code128', name: 'Code 128', bcid: 'code128', kind: 'linear', sample: 'ONBI-0001', hint: '영문·숫자·기호. 가장 널리 쓰는 물류용 바코드입니다.' },
  { id: 'gs1-128', name: 'GS1-128', bcid: 'gs1-128', kind: 'linear', sample: '(01)08801234567893(10)A1', hint: '괄호 안에 식별 번호를 적습니다. 예: (01)상품코드 14자리 (10)로트' },
  { id: 'code39', name: 'Code 39', bcid: 'code39', kind: 'linear', sample: 'CODE-39', hint: '숫자, 영문 대문자, 공백, - . $ / + % 만 쓸 수 있습니다.' },
  { id: 'code93', name: 'Code 93', bcid: 'code93', kind: 'linear', sample: 'CODE-93', hint: '숫자, 영문 대문자, 공백, - . $ / + % 만 쓸 수 있습니다.' },
  { id: 'codabar', name: 'Codabar', bcid: 'rationalizedCodabar', kind: 'linear', sample: 'A12345B', hint: '숫자와 - $ : / . + 를 쓰고, 앞뒤에 A–D 중 하나를 붙입니다(없으면 A 를 붙입니다).' },
  { id: 'ean13', name: 'EAN-13', bcid: 'ean13', kind: 'linear', sample: '8801234567893', hint: '숫자 13자리(마지막은 검사 숫자). 12자리만 넣으면 검사 숫자를 계산해 붙입니다.' },
  { id: 'ean8', name: 'EAN-8', bcid: 'ean8', kind: 'linear', sample: '12345670', hint: '숫자 8자리(마지막은 검사 숫자). 7자리만 넣으면 검사 숫자를 붙입니다.' },
  { id: 'upca', name: 'UPC-A', bcid: 'upca', kind: 'linear', sample: '012345678905', hint: '숫자 12자리(마지막은 검사 숫자). 11자리만 넣으면 검사 숫자를 붙입니다.' },
  { id: 'itf', name: 'ITF (Interleaved 2 of 5)', bcid: 'interleaved2of5', kind: 'linear', sample: '12345678901231', hint: '숫자만, 짝수 자리. 홀수 자리면 앞에 0 을 붙입니다.' },
  { id: 'qrcode', name: 'QR 코드', bcid: 'qrcode', kind: 'matrix', sample: 'https://example.com', hint: '주소·한글 등 무엇이든 담을 수 있습니다.' },
  { id: 'datamatrix', name: 'DataMatrix', bcid: 'datamatrix', kind: 'matrix', sample: 'ONBI-0001', hint: '작은 면적에 많은 내용을 담습니다.' },
  { id: 'gs1datamatrix', name: 'GS1 DataMatrix', bcid: 'gs1datamatrix', kind: 'matrix', sample: '(01)08801234567893(17)271231(10)A1', hint: '괄호 안에 식별 번호를 적습니다. 예: (01)상품코드 (17)유효기한 (10)로트' },
  { id: 'azteccode', name: 'Aztec', bcid: 'azteccode', kind: 'matrix', sample: 'ONBI-0001', hint: '여백 없이도 잘 읽히는 2차원 코드입니다.' },
  { id: 'pdf417', name: 'PDF417', bcid: 'pdf417', kind: 'stacked', sample: 'ONBI-0001', hint: '가로로 긴 2차원 코드입니다.' },
]
export const SYMBOLOGY_BY_ID = Object.fromEntries(SYMBOLOGIES.map((s) => [s.id, s])) as Record<Symbology, SymbologyDef>

/** GS1 검사 숫자(EAN·UPC·GTIN 공통): 오른쪽부터 3,1,3,1 … 을 곱해 더한다. body 는 검사 숫자를 뺀 숫자열. */
export function gs1CheckDigit(body: string): number {
  let sum = 0
  for (let i = 0; i < body.length; i++) {
    const digit = body.charCodeAt(body.length - 1 - i) - 48
    sum += digit * (i % 2 === 0 ? 3 : 1)
  }
  return (10 - (sum % 10)) % 10
}

export type BarcodeCheck = { ok: true; /** bwip-js 에 넘길 값 */ text: string; /** 막대 아래에 적을 글자 */ display: string } | { ok: false; message: string }

const MAX_2D_CHARS = 1500

function fixedDigits(name: string, value: string, full: number): BarcodeCheck {
  if (!/^\d+$/.test(value)) return { ok: false, message: `${name} 은(는) 숫자만 쓸 수 있습니다.` }
  if (value.length === full - 1) {
    const text = value + gs1CheckDigit(value)
    return { ok: true, text, display: text }
  }
  if (value.length !== full) return { ok: false, message: `${name} 은(는) 숫자 ${full}자리(또는 검사 숫자를 뺀 ${full - 1}자리)입니다. 지금 ${value.length}자리입니다.` }
  const expected = gs1CheckDigit(value.slice(0, -1))
  if (expected !== Number(value.slice(-1))) return { ok: false, message: `검사 숫자(마지막 자리)가 맞지 않습니다. ${value.slice(-1)} 이 아니라 ${expected} 이어야 합니다.` }
  return { ok: true, text: value, display: value }
}

/** 값이 그 바코드 규칙에 맞는지 보고, 그릴 값으로 다듬는다(검사 숫자 붙이기 등). */
export function validateBarcode(symbology: Symbology, raw: string): BarcodeCheck {
  const value = raw.trim()
  if (value === '') return { ok: false, message: '값이 비어 있습니다.' }
  switch (symbology) {
    case 'ean13':
      return fixedDigits('EAN-13', value, 13)
    case 'ean8':
      return fixedDigits('EAN-8', value, 8)
    case 'upca':
      return fixedDigits('UPC-A', value, 12)
    case 'itf': {
      if (!/^\d+$/.test(value)) return { ok: false, message: 'ITF 는 숫자만 쓸 수 있습니다.' }
      const text = value.length % 2 ? `0${value}` : value
      return { ok: true, text, display: text }
    }
    case 'code39':
    case 'code93':
      if (!/^[0-9A-Z \-.$/+%]+$/.test(value)) {
        const name = symbology === 'code39' ? 'Code 39' : 'Code 93'
        return { ok: false, message: /[a-z]/.test(value) ? `${name} 는 소문자를 담지 못합니다. 대문자로 바꾸거나 Code 128 을 쓰세요.` : `${name} 는 숫자, 영문 대문자, 공백, - . $ / + % 만 쓸 수 있습니다.` }
      }
      return { ok: true, text: value, display: value }
    case 'codabar': {
      const upper = value.toUpperCase()
      const framed = /^[A-D].*[A-D]$/.test(upper) && upper.length >= 3
      const body = framed ? upper.slice(1, -1) : upper
      if (!/^[0-9\-$:/.+]+$/.test(body)) return { ok: false, message: 'Codabar 는 숫자와 - $ : / . + 만 쓸 수 있습니다(앞뒤 글자는 A–D).' }
      return { ok: true, text: framed ? upper : `A${body}A`, display: body }
    }
    case 'code128':
      if (!/^[\x20-\x7e]+$/.test(value)) return { ok: false, message: 'Code 128 은 영문·숫자·기호만 쓸 수 있습니다. 한글을 담으려면 QR 코드를 쓰세요.' }
      return { ok: true, text: value, display: value }
    case 'gs1-128':
    case 'gs1datamatrix':
      if (!/^(\(\d{2,4}\)[^()]+)+$/.test(value)) return { ok: false, message: 'GS1 값은 (01)08801234567893(10)A1 처럼 괄호 안에 식별 번호를 적습니다.' }
      return { ok: true, text: value, display: value }
    default:
      if (value.length > MAX_2D_CHARS) return { ok: false, message: `내용이 너무 깁니다(${value.length}자). ${MAX_2D_CHARS}자 이하로 줄여 주세요.` }
      return { ok: true, text: value, display: value }
  }
}

/** bwip-js 가 던진 오류를 사용자 말로 바꾼다. */
export function explainBwipError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (/check ?digit|checksum|csum/i.test(raw)) return '검사 숫자가 맞지 않습니다. 숫자를 다시 확인하세요.'
  if (/GS1|\bAI\b|AIs /.test(raw)) return 'GS1 식별 번호나 값의 형식이 맞지 않습니다. 자릿수와 날짜(YYMMDD)를 확인하세요.'
  if (/length|too ?long|too ?short|capacity|exceed|no symbol/i.test(raw)) return '자릿수가 맞지 않거나 내용이 너무 깁니다.'
  if (/character|invalid|must contain/i.test(raw)) return '이 바코드에 쓸 수 없는 글자가 들어 있습니다.'
  return '이 값으로는 바코드를 만들 수 없습니다. 값과 종류를 확인하세요.'
}

/** 바코드 모양 — 가로 w, 세로 h 안의 채움 경로 하나(M·L·Z 절대 좌표, 홀짝 채움). 그려진 부분에 딱 맞게 잘려 있다. */
export interface BarcodeGeometry {
  w: number
  h: number
  d: string
}

const num = (n: number) => String(Math.round(n * 1000) / 1000)

/**
 * bwip-js 가 만든 SVG 를 채움 경로 하나로 정리한다.
 * 1차원 막대는 굵기를 가진 선(stroke)으로 오므로 사각형으로 바꾼다 — 화면·인쇄·PDF 가 같은 모양을 쓰게 하려는 것.
 */
export function svgToGeometry(svg: string): BarcodeGeometry {
  // 다각형마다 [x0, y0, x1, y1, …]
  const polys: number[][] = []
  for (const m of svg.matchAll(/<path\b([^>]*)>/g)) {
    const attrs = m[1]
    const path = /\sd="([^"]*)"/.exec(attrs)?.[1] ?? ''
    const strokeWidth = /stroke-width="([^"]+)"/.exec(attrs)?.[1]
    if (strokeWidth === undefined) {
      for (const sub of path.split(/(?=M)/)) {
        const pts = (sub.match(/-?\d*\.?\d+/g) ?? []).map(Number)
        if (pts.length >= 6) polys.push(pts)
      }
      continue
    }
    const sw = Number(strokeWidth)
    for (const seg of path.matchAll(/M\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*L\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/g)) {
      const [x0, y0, x1, y1] = seg.slice(1).map(Number)
      if (x0 === x1) {
        const top = Math.min(y0, y1)
        const bottom = Math.max(y0, y1)
        polys.push([x0 - sw / 2, top, x0 + sw / 2, top, x0 + sw / 2, bottom, x0 - sw / 2, bottom])
      } else {
        const left = Math.min(x0, x1)
        const right = Math.max(x0, x1)
        polys.push([left, y0 - sw / 2, right, y0 - sw / 2, right, y0 + sw / 2, left, y0 + sw / 2])
      }
    }
  }
  if (!polys.length) throw new Error('바코드 모양이 비어 있습니다.')
  // 그려진 부분에 딱 맞게 잘라, 요소 상자를 막대가 가득 채우게 한다.
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const pts of polys)
    for (let i = 0; i < pts.length; i += 2) {
      minX = Math.min(minX, pts[i])
      maxX = Math.max(maxX, pts[i])
      minY = Math.min(minY, pts[i + 1])
      maxY = Math.max(maxY, pts[i + 1])
    }
  let d = ''
  for (const pts of polys) {
    for (let i = 0; i < pts.length; i += 2) d += `${i === 0 ? 'M' : 'L'}${num(pts[i] - minX)} ${num(pts[i + 1] - minY)}`
    d += 'Z'
  }
  return { w: maxX - minX, h: maxY - minY, d }
}

interface BwipLike {
  toSVG(opts: { bcid: string; text: string; scale?: number; includetext?: boolean; padding?: number }): string
}

export type BarcodeResult = { ok: true; geometry: BarcodeGeometry; display: string; def: SymbologyDef } | { ok: false; message: string; pending?: boolean }

let lib: BwipLike | null = null
let loading: Promise<BwipLike> | null = null
const cache = new Map<string, BarcodeResult>()
const CACHE_LIMIT = 4000

export const isBarcodeLibReady = () => lib !== null

/** bwip-js 를 불러온다. 한 번 불러오면 makeBarcode 가 바로 값을 돌려준다. */
export function loadBarcodeLib(): Promise<void> {
  if (lib) return Promise.resolve()
  loading ??= import('bwip-js').then((mod) => {
    const m = mod as unknown as BwipLike & { default?: BwipLike }
    lib = typeof m.toSVG === 'function' ? m : (m.default as BwipLike)
    cache.clear()
    return lib
  })
  return loading.then(() => undefined)
}

/** 테스트용: 이미 불러온 bwip-js 를 직접 넣는다. */
export function setBarcodeLib(next: BwipLike) {
  lib = next
  cache.clear()
}

/** 바코드 하나를 만든다. 라이브러리를 아직 못 불러왔으면 pending. 같은 값은 다시 계산하지 않는다. */
export function makeBarcode(symbology: Symbology, value: string): BarcodeResult {
  const key = `${symbology}\u0000${value}`
  const hit = cache.get(key)
  if (hit) return hit
  const def = SYMBOLOGY_BY_ID[symbology]
  if (!def) return { ok: false, message: '지원하지 않는 바코드 종류입니다.' }
  const check = validateBarcode(symbology, value)
  let result: BarcodeResult
  if (!check.ok) result = { ok: false, message: check.message }
  else if (!lib) return { ok: false, message: '바코드를 준비하는 중입니다.', pending: true }
  else {
    try {
      const svg = lib.toSVG({ bcid: def.bcid, text: check.text, scale: 1, includetext: false, padding: 0 })
      result = { ok: true, geometry: svgToGeometry(svg), display: check.display, def }
    } catch (err) {
      result = { ok: false, message: explainBwipError(err) }
    }
  }
  if (cache.size >= CACHE_LIMIT) cache.clear()
  cache.set(key, result)
  return result
}
