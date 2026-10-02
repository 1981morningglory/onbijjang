/**
 * 견적서·거래명세서의 데이터와 계산. 화면·PDF·엑셀이 모두 이 결과를 쓴다.
 * 금액은 모두 원 단위 정수.
 */

export type DocType = 'quote' | 'statement'
/** 단가에 부가세가 포함됐는지: 포함 · 별도 · 면세(세액 없음) */
export type VatMode = 'included' | 'excluded' | 'exempt'
/** 거래명세서 양식: 기본(장부형, 한 장에 2부) · 출고(품번·BOX수·내품수량, 인수증) */
export type StatementStyle = 'ledger' | 'shipment'

export interface LineItem {
  id: string
  /** 월/일 — 거래명세서에서만 씀 (MM-DD) */
  day: string
  name: string
  spec: string
  qty: number | null
  unitPrice: number | null
  note: string
  /** 출고 양식: 품번 */
  itemNo?: string
  /** 출고 양식: BOX 수(소수 가능) */
  boxes?: number | null
  /** 출고 양식: 한 BOX 의 내품 수량. BOX수와 함께 있으면 출고수량 = BOX수 × 내품수량 */
  perBox?: number | null
}

export interface QuoteDoc {
  type: DocType
  /** YYYY-MM-DD */
  date: string
  docNo: string
  customer: string
  /** 거래명세서의 공급받는자 상세 */
  customerBizNo: string
  customerAddress: string
  customerCeo: string
  /** 출고 양식의 공급받는자 업태·종목 */
  customerBizType?: string
  customerBizItem?: string
  /** 거래명세서 양식. 없으면 기본(장부형) — 예전에 저장한 문서 */
  statementStyle?: StatementStyle
  /** 품명·건명 */
  title: string
  items: LineItem[]
  vatMode: VatMode
  /** 기타사항(여러 줄) */
  notes: string
  /** 아래 안내 문구 */
  footnote: string
  /** 견적 유효기간(일). 0 이면 표시 안 함 */
  validDays: number
  showContact: boolean
  contactId: string | null
  showSeal: boolean
  sealId: string | null
  attachRegistration: boolean
  attachBankbook: boolean
  /** 거래명세서를 한 장에 2부(공급받는자·공급자 보관용)로 */
  twoCopies: boolean
  /** 작성자(문서함에 저장할 때 고른 담당자) */
  author?: string
}

export interface Company {
  name: string
  ceo: string
  bizNo: string
  address: string
  bizType: string
  bizItem: string
  tel: string
  fax: string
  email: string
  /** 문서 아래쪽에 넣는 한 줄 문구(예: 믿음이 있는 사회 - 모닝글로리) */
  slogan: string
}

export interface Contact {
  id: string
  name: string
  title: string
  phone: string
  email: string
  /** 기타 항목: 휴대폰·팩스·메모 등 자유롭게 */
  extras: Array<{ label: string; value: string }>
}

export interface Seal {
  id: string
  name: string
  /** 투명 배경 PNG data URL */
  dataUrl: string
}

export interface Attachment {
  name: string
  /** 원본 PDF (base64 data URL) — PDF 로 저장할 때 원본 쪽을 그대로 붙인다 */
  pdfDataUrl?: string
  /** 쪽 이미지(PNG/JPG data URL) — 엑셀·이미지 저장과 미리보기에 쓴다 */
  pages: string[]
}

/** 회사 자료: 서버의 팀 공간(회사 공통 자료·팀 자료)에 두고, 파일로도 주고받는다. */
export interface CompanyKit {
  version: 1
  company: Company
  seals: Seal[]
  registration: Attachment | null
  bankbook: Attachment | null
  /** 회사 로고(투명 PNG data URL). 출고 양식 거래명세서 아래쪽에 넣는다 */
  logo: string | null
  /** 통장 정보(입금 계좌 안내 문구에 씀) */
  bank: { bankName: string; account: string; holder: string }
  contacts: Contact[]
}

export const EMPTY_COMPANY: Company = { name: '', ceo: '', bizNo: '', address: '', bizType: '', bizItem: '', tel: '', fax: '', email: '', slogan: '' }

export function emptyKit(): CompanyKit {
  return { version: 1, company: { ...EMPTY_COMPANY }, seals: [], registration: null, bankbook: null, logo: null, bank: { bankName: '', account: '', holder: '' }, contacts: [] }
}

export const uid = () => Math.random().toString(36).slice(2, 10)

export function todayIso(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function emptyItem(): LineItem {
  return { id: uid(), day: '', name: '', spec: '', qty: null, unitPrice: null, note: '' }
}

export function newDoc(type: DocType = 'quote'): QuoteDoc {
  return {
    type,
    date: todayIso(),
    docNo: '',
    customer: '',
    customerBizNo: '',
    customerAddress: '',
    customerCeo: '',
    title: '',
    items: [emptyItem(), emptyItem(), emptyItem()],
    vatMode: 'included',
    notes: '',
    footnote: '※ 총합계 금액은 VAT 및 배송비 포함가격입니다.',
    validDays: 30,
    showContact: true,
    contactId: null,
    showSeal: true,
    sealId: null,
    attachRegistration: false,
    attachBankbook: false,
    twoCopies: true,
    statementStyle: 'shipment',
    customerBizType: '',
    customerBizItem: '',
  }
}

export const styleOf = (doc: Pick<QuoteDoc, 'statementStyle'>): StatementStyle => doc.statementStyle ?? 'ledger'
export const STYLE_NAME: Record<StatementStyle, string> = { ledger: '기본 양식', shipment: '출고 양식' }

// ── 계산 ──────────────────────────────────────────────────
export interface LineCalc {
  item: LineItem
  /** 내용이 하나라도 있는 줄 */
  filled: boolean
  supply: number
  tax: number
  total: number
}

export interface Totals {
  lines: LineCalc[]
  supply: number
  tax: number
  total: number
  qty: number
  /** BOX 수 합계(출고 양식) */
  boxes: number
}

const n = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * 줄마다 공급가액·세액·합계를 낸다.
 * - 부가세 포함 단가: 합계 = 수량×단가, 공급가액 = 합계÷1.1 (원 미만 반올림), 세액 = 합계 − 공급가액
 * - 부가세 별도 단가: 공급가액 = 수량×단가, 세액 = 공급가액×10% (원 미만 반올림), 합계 = 공급가액 + 세액
 * - 면세: 공급가액 = 합계 = 수량×단가, 세액 0
 */
export function calcLine(item: LineItem, vat: VatMode): LineCalc {
  const filled = Boolean(item.name.trim() || item.spec.trim() || item.note.trim() || item.itemNo?.trim() || item.qty || item.unitPrice || item.boxes)
  const amount = Math.round(n(item.qty) * n(item.unitPrice))
  if (vat === 'included') {
    const supply = Math.round(amount / 1.1)
    return { item, filled, supply, tax: amount - supply, total: amount }
  }
  if (vat === 'excluded') {
    const tax = Math.round(amount * 0.1)
    return { item, filled, supply: amount, tax, total: amount + tax }
  }
  return { item, filled, supply: amount, tax: 0, total: amount }
}

export function calcTotals(doc: Pick<QuoteDoc, 'items' | 'vatMode'>): Totals {
  const lines = doc.items.map((i) => calcLine(i, doc.vatMode))
  return {
    lines,
    supply: lines.reduce((s, l) => s + l.supply, 0),
    tax: lines.reduce((s, l) => s + l.tax, 0),
    total: lines.reduce((s, l) => s + l.total, 0),
    qty: lines.reduce((s, l) => s + n(l.item.qty), 0),
    boxes: Math.round(lines.reduce((s, l) => s + n(l.item.boxes), 0) * 100) / 100,
  }
}

// ── 표기 ──────────────────────────────────────────────────
export const won = (v: number) => new Intl.NumberFormat('ko-KR').format(Math.round(v))

const DIGITS = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구']
const SMALL = ['', '십', '백', '천']
const BIG = ['', '만', '억', '조', '경']

/** 금액을 한글로: 1234000 → "일백이십삼만사천" (공식 문서 관례대로 '일십·일백·일천'을 쓴다) */
export function koreanAmount(value: number): string {
  let v = Math.floor(Math.abs(value))
  if (v === 0) return '영'
  const groups: string[] = []
  let g = 0
  while (v > 0) {
    const part = v % 10000
    if (part) {
      let s = ''
      const digits = String(part).padStart(4, '0')
      for (let i = 0; i < 4; i++) {
        const d = Number(digits[i])
        if (d) s += DIGITS[d] + SMALL[3 - i]
      }
      groups.unshift(s + BIG[g])
    }
    v = Math.floor(v / 10000)
    g++
  }
  return (value < 0 ? '마이너스 ' : '') + groups.join('')
}

/** "일금 일백이십삼만사천원정 (₩1,234,000)" */
export function amountInWords(total: number): string {
  return `일금 ${koreanAmount(total)}원정 (₩${won(total)})`
}

/** 2026-10-02 → 2026년 10월 2일 */
export function dateKo(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  return `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일`
}

export function addDays(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days)
  return todayIso(d)
}

/** 문서 번호: Q-20261002-01 / T-20261002-01. seq 는 그날의 순번 */
export function makeDocNo(type: DocType, iso: string, seq: number): string {
  return `${type === 'quote' ? 'Q' : 'T'}-${iso.replace(/-/g, '')}-${String(seq).padStart(2, '0')}`
}

/** 담당자 연락처 한 줄: "홍길동 과장 · 직통 031-000-0000 · hong@… · 휴대폰 010-…" */
export function contactLine(c: Contact | null | undefined): string {
  if (!c) return ''
  const parts = [[c.name, c.title].filter(Boolean).join(' ')]
  if (c.phone) parts.push(`직통 ${c.phone}`)
  if (c.email) parts.push(c.email)
  for (const e of c.extras) if (e.value.trim()) parts.push(e.label.trim() ? `${e.label.trim()} ${e.value.trim()}` : e.value.trim())
  return parts.filter(Boolean).join(' · ')
}

export const DOC_TITLE: Record<DocType, string> = { quote: '견 적 서', statement: '거 래 명 세 서' }
export const DOC_NAME: Record<DocType, string> = { quote: '견적서', statement: '거래명세서' }

/** 저장 파일 이름: 견적서_고객사_20261002 */
export function fileBase(doc: QuoteDoc): string {
  const who = doc.customer.trim().replace(/[\\/:*?"<>|]/g, '').slice(0, 30)
  return [DOC_NAME[doc.type], who, doc.date.replace(/-/g, '')].filter(Boolean).join('_')
}

export const isAutoNo = (no: string) => /^[QT]-\d{8}-\d{2,}$/.test(no)

/** 팀 문서함에 있는 번호를 보고 그날의 다음 번호를 고른다: Q-20261002-03 */
export function proposeDocNo(type: DocType, iso: string, existing: string[]): string {
  const prefix = `${type === 'quote' ? 'Q' : 'T'}-${iso.replace(/-/g, '')}-`
  let max = 0
  for (const no of existing) {
    if (!no.startsWith(prefix)) continue
    const n = Number(no.slice(prefix.length))
    if (Number.isFinite(n) && n > max) max = n
  }
  return makeDocNo(type, iso, max + 1)
}

/** BOX수·내품수량이 둘 다 있으면 출고수량을 계산한다 */
export function shipQty(boxes: number | null | undefined, perBox: number | null | undefined): number | null {
  if (typeof boxes !== 'number' || typeof perBox !== 'number' || !Number.isFinite(boxes) || !Number.isFinite(perBox)) return null
  return Math.round(boxes * perBox * 1000) / 1000
}
