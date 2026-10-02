import { describe, expect, it } from 'vitest'
import { amountInWords, calcLine, calcTotals, contactLine, emptyItem, fileBase, isAutoNo, koreanAmount, makeDocNo, newDoc, proposeDocNo, shipQty, styleOf, type QuoteDoc } from './model'

const item = (qty: number, unitPrice: number) => ({ ...emptyItem(), name: '의자', qty, unitPrice })

describe('금액 계산', () => {
  it('부가세 포함 단가: 합계에서 공급가액·세액을 나눈다', () => {
    const l = calcLine(item(3, 110_000), 'included')
    expect(l.total).toBe(330_000)
    expect(l.supply).toBe(300_000)
    expect(l.tax).toBe(30_000)
  })
  it('부가세 포함 단가가 1.1 로 나누어떨어지지 않으면 공급가액은 반올림, 세액은 나머지', () => {
    const l = calcLine(item(1, 10_000), 'included')
    expect(l.supply).toBe(9_091)
    expect(l.tax).toBe(909)
    expect(l.supply + l.tax).toBe(l.total)
  })
  it('부가세 별도 단가: 세액 10% 를 더한다', () => {
    const l = calcLine(item(2, 12_345), 'excluded')
    expect(l.supply).toBe(24_690)
    expect(l.tax).toBe(2_469)
    expect(l.total).toBe(27_159)
  })
  it('면세는 세액이 없다', () => {
    const l = calcLine(item(4, 2_500), 'exempt')
    expect([l.supply, l.tax, l.total]).toEqual([10_000, 0, 10_000])
  })
  it('빈 줄은 0 원이고 채워지지 않은 줄로 본다', () => {
    const l = calcLine(emptyItem(), 'included')
    expect(l.filled).toBe(false)
    expect(l.total).toBe(0)
  })
  it('합계는 줄마다 낸 값의 합이다', () => {
    const t = calcTotals({ items: [item(1, 10_000), item(2, 5_500), emptyItem()], vatMode: 'included' })
    expect(t.total).toBe(21_000)
    expect(t.supply + t.tax).toBe(t.total)
    expect(t.qty).toBe(3)
  })
})

describe('한글 금액', () => {
  it.each([
    [0, '영'],
    [7, '칠'],
    [10, '일십'],
    [1_234_000, '일백이십삼만사천'],
    [10_000, '일만'],
    [100_000_000, '일억'],
    [150_003_200, '일억오천만삼천이백'],
  ])('%i → %s', (v, s) => expect(koreanAmount(v)).toBe(s))
  it('문서용 표기', () => expect(amountInWords(330_000)).toBe('일금 삼십삼만원정 (₩330,000)'))
})

describe('표기 도우미', () => {
  it('문서 번호', () => {
    expect(makeDocNo('quote', '2026-10-02', 3)).toBe('Q-20261002-03')
    expect(makeDocNo('statement', '2026-10-02', 12)).toBe('T-20261002-12')
  })
  it('담당자 한 줄은 빈 항목을 건너뛴다', () => {
    expect(contactLine({ id: 'a', name: '홍길동', title: '과장', phone: '031-000-0000', email: '', extras: [{ label: '휴대폰', value: '010-1111-2222' }, { label: '메모', value: ' ' }] })).toBe(
      '홍길동 과장 · 직통 031-000-0000 · 휴대폰 010-1111-2222',
    )
  })
  it('팀 문서함 번호를 보고 그날 다음 번호를 고른다', () => {
    expect(proposeDocNo('quote', '2026-10-02', [])).toBe('Q-20261002-01')
    expect(proposeDocNo('quote', '2026-10-02', ['Q-20261002-01', 'Q-20261002-07', 'T-20261002-09', 'Q-20261001-12'])).toBe('Q-20261002-08')
    expect(proposeDocNo('statement', '2026-10-02', ['T-20261002-09'])).toBe('T-20261002-10')
    expect(isAutoNo('Q-20261002-08')).toBe(true)
    expect(isAutoNo('견적-001')).toBe(false)
  })
  it('파일 이름은 금지 문자를 뺀다', () => {
    expect(fileBase({ ...newDoc('quote'), customer: 'A/B:상사', date: '2026-10-02' })).toBe('견적서_AB상사_20261002')
  })
})

describe('거래명세서 출고 양식', () => {
  it('출고수량 = BOX수 × 내품수량, 둘 중 하나라도 없으면 계산하지 않는다', () => {
    expect(shipQty(6, 10)).toBe(60)
    expect(shipQty(2.5, 12)).toBe(30)
    expect(shipQty(null, 10)).toBeNull()
    expect(shipQty(4, undefined)).toBeNull()
  })
  it('견본 명세서와 같은 합계(공급가액 1,000,000 · 세액 100,000 · 합계 1,100,000 · BOX 10)', () => {
    const it1 = { ...emptyItem(), itemNo: '77000-87414', name: '캠퍼스 메이트 백팩(블랙)', boxes: 6, perBox: 10, qty: 60, unitPrice: 11_000 }
    const it2 = { ...emptyItem(), itemNo: '77000-87415', name: '캠퍼스 메이트 백팩(라이트 그레이)', boxes: 4, perBox: 10, qty: 40, unitPrice: 11_000 }
    const t = calcTotals({ items: [it1, it2, emptyItem()], vatMode: 'included' })
    expect([t.supply, t.tax, t.total, t.qty, t.boxes]).toEqual([1_000_000, 100_000, 1_100_000, 100, 10])
  })
  it('품번만 넣은 줄도 채워진 줄로 본다', () => {
    expect(calcTotals({ items: [{ ...emptyItem(), itemNo: 'A-1' }], vatMode: 'included' }).lines[0].filled).toBe(true)
  })
  it('새 문서는 출고 양식, 예전에 저장한 문서(양식 없음)는 기본 양식', () => {
    expect(styleOf(newDoc('statement'))).toBe('shipment')
    const { statementStyle: _s, ...old } = newDoc('statement')
    expect(styleOf(old as QuoteDoc)).toBe('ledger')
  })
})
