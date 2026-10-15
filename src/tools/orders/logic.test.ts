import { describe, expect, it } from 'vitest'
import { buildOutput, cellValue, COL, dateFromName, JEJU_NOTE, looksLikeSabangnet, needsProduct, OUTPUTS, outputFileName, productKey, sortRows, type OrderRow } from './logic'

const row = (o: Partial<Record<string, string | number | null>>): OrderRow => ({
  [COL.orderNo]: '1',
  [COL.buyer]: '가',
  [COL.receiver]: '가',
  [COL.phone1]: '010-0000-0000',
  [COL.phone2]: '010-0000-0000',
  [COL.address]: '서울특별시 어딘가 1',
  [COL.code]: '10000-00001',
  [COL.name]: '상품',
  [COL.rawName]: '쇼핑몰 상품',
  [COL.option]: '단품',
  [COL.rawOption]: '',
  [COL.qty]: 1,
  [COL.message]: null,
  [COL.mall]: '스마트스토어',
  [COL.sabangNo]: 100,
  [COL.warehouse]: '모닝글로리-일산센터',
  ...o,
})
const spec = (k: string) => OUTPUTS.find((o) => o.kind === k)!

describe('사방넷 주문서 읽기', () => {
  it('칸 값: 주문번호·전화는 글자, 수량·사방넷주문번호는 숫자', () => {
    expect(cellValue(COL.orderNo, 4503915316)).toBe('4503915316')
    expect(cellValue(COL.qty, 8.0)).toBe(8)
    expect(cellValue(COL.sabangNo, '2168350096')).toBe(2168350096)
    expect(cellValue(COL.message, '  ')).toBeNull()
    expect(cellValue(COL.name, { richText: [{ text: '가' }, { text: '나' }] })).toBe('가나')
  })
  it('사방넷 칸이 없으면 알려 준다', () => {
    expect(looksLikeSabangnet(['NO', '주문번호'])).toContain('수취인명')
    expect(looksLikeSabangnet(Object.keys(row({})))).toBeNull()
  })
  it('시트 이름에서 날짜', () => {
    expect(dateFromName('20261015_주문서확인처리_발주서_CJ대한통운')).toBe('2026-10-15')
    expect(dateFromName('주문서', '발주_2026-10-16.xlsx')).toBe('2026-10-16')
    expect(dateFromName('주문서')).toBeNull()
  })
})

describe('결과 파일', () => {
  const rows = [
    row({ [COL.mall]: '스마트스토어', [COL.orderNo]: '2026101594677801', [COL.code]: '77000-20557' }),
    row({ [COL.mall]: 'i-Scream', [COL.orderNo]: '20261015M245241', [COL.message]: '행정실로' }),
    row({ [COL.mall]: '스마트스토어', [COL.orderNo]: '2026101594677801', [COL.code]: '10310-21673' }),
    row({ [COL.mall]: '11번가', [COL.address]: '제주특별자치도 제주시 구산로 50', [COL.message]: '행정실로 부탁', [COL.qty]: 110 }),
    row({ [COL.mall]: 'ESM지마켓', [COL.orderNo]: '4503915316' }),
    row({ [COL.mall]: '교보핫트랙스' }),
  ]
  it('엑셀과 같은 순서: 쇼핑몰(숫자 < 영문 < 한글) → 주문번호 → 상품코드', () => {
    expect(sortRows(rows).map((r) => `${r[COL.mall]}/${r[COL.code]}`)).toEqual([
      '11번가/10000-00001',
      'ESM지마켓/10000-00001',
      'i-Scream/10000-00001',
      '교보핫트랙스/10000-00001',
      '스마트스토어/10310-21673',
      '스마트스토어/77000-20557',
    ])
  })
  it('창고 전달: 칸 7개, NO 는 글자, 제주만 ‘제주도출고O’', () => {
    const t = buildOutput(spec('warehouse'), rows)
    expect(t[0]).toEqual(['NO', '수취인명', '상품코드', '상품명', '옵션', '수량', '배송메세지'])
    expect(t[1]).toEqual(['1', '가', '10000-00001', '상품', '단품', 110, JEJU_NOTE])
    expect(t[3][6]).toBeNull() // i-Scream 줄의 원래 배송메세지는 넣지 않는다
  })
  it('CJ 업로드: 배송메세지 원본 그대로, 수집 상품명·옵션 칸은 뺀다', () => {
    const t = buildOutput(spec('cj'), rows)
    expect(t[0]).not.toContain(COL.rawName)
    expect(t[0]).toContain(COL.address)
    expect(t[1][t[0].indexOf(COL.message)]).toBe('행정실로 부탁')
    expect(t[1][t[0].indexOf(COL.sabangNo)]).toBe(100)
  })
  it('구글 드라이브: 주소·물류처명 없이, 제주 표시', () => {
    const t = buildOutput(spec('drive'), rows)
    expect(t[0]).not.toContain(COL.address)
    expect(t[0]).not.toContain(COL.warehouse)
    expect(t[1][t[0].indexOf(COL.message)]).toBe(JEJU_NOTE)
  })
  it('상품을 못 맞춘 줄과 기억 열쇠, 파일 이름', () => {
    const r = row({ [COL.code]: null, [COL.rawName]: '점착메모지 블루', [COL.rawOption]: '100매:블루' })
    expect(needsProduct(r)).toBe(true)
    expect(productKey(r)).toBe('점착메모지 블루|100매:블루')
    expect(outputFileName(spec('cj'), '2026-10-15', 2)).toBe('20261015_2차_CJ대한통운업로드.xlsx')
  })
})
