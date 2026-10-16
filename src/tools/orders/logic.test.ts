import { describe, expect, it } from 'vitest'
import { A4_PRINT_PX, buildOutput, cellValue, centerHeader, centerWidths, COL, colPx, layoutCenter, productSummary, dateFromName, JEJU_NOTE, looksLikeSabangnet, needsProduct, OUTPUTS, outputFileName, productKey, sortRows, timeKst, type OrderRow } from './logic'

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
    expect(outputFileName(spec('cj'), '2026-10-15', 2)).toBe('20261015_2차_CJ택배.xlsx')
    expect(timeKst('2026-10-15T04:05:00.000Z')).toBe('13:05')
  })
})

describe('센터주문서 쪽 나누기·요약', () => {
  // 주문 하나 = 같은 쇼핑몰·주문번호 줄 묶음
  const order = (no: string, n: number, buyer = no) => Array.from({ length: n }, (_, i) => row({ [COL.orderNo]: no, [COL.buyer]: buyer, [COL.receiver]: buyer, [COL.code]: `${10000 + i}-0000${i}` }))
  it('한 주문이 두 쪽에 나뉘지 않게, 남은 칸은 뒤의 작은 주문으로 채운다', () => {
    // 쪽당 5줄: A(2) B(2) 다음 C(3)는 1칸에 안 들어가므로 D(1)를 끌어와 채우고 C는 다음 쪽
    const rows = [...order('A', 2), ...order('B', 2), ...order('C', 3), ...order('D', 1), ...order('E', 1)]
    const l = layoutCenter(rows, 5)
    expect(l.rows.map((r) => r[COL.orderNo])).toEqual(['A', 'A', 'B', 'B', 'D', 'C', 'C', 'C', 'E'])
    expect(l.pageEnds).toEqual([5, 9])
    // 어느 주문도 쪽 경계를 넘지 않는다
    let start = 0
    for (const end of l.pageEnds) {
      const keys = new Set(l.rows.slice(start, end).map((r) => r[COL.orderNo]))
      for (const k of keys) expect(l.rows.slice(end).some((r) => r[COL.orderNo] === k)).toBe(false)
      start = end
    }
  })
  it('같은 사람이 주문을 여러 건 하면(쇼핑몰이 달라도) 한 묶음으로 모은다', () => {
    const rows = [...order('A', 1, '홍길동'), ...order('B', 2), ...order('C', 1, '홍길동').map((r) => ({ ...r, [COL.mall]: '지마켓' }))]
    const l = layoutCenter(rows, 5)
    expect(l.groups.map((g) => g.map((r) => r[COL.orderNo]).join(''))).toEqual(['AC', 'BB'])
  })
  it('한 쪽보다 긴 주문은 새 쪽에서 시작', () => {
    const l = layoutCenter([...order('A', 2), ...order('B', 7)], 5)
    expect(l.oversized).toBe(1)
    expect(l.rows[0][COL.orderNo]).toBe('A')
    expect(l.pageEnds[0]).toBe(2)
  })
  it('출고제품 요약: 주문수량 순, 주문건수는 주문자 수, 같으면 같은 순위', () => {
    const rows = [
      row({ [COL.code]: 'P1', [COL.name]: '필통', [COL.qty]: 3, [COL.buyer]: '홍길동' }),
      row({ [COL.code]: 'P1', [COL.name]: '필통', [COL.qty]: 2, [COL.buyer]: '홍길동' }),
      row({ [COL.code]: 'P2', [COL.name]: '자', [COL.qty]: 4, [COL.buyer]: '김' }),
      row({ [COL.code]: 'P3', [COL.name]: '풀', [COL.qty]: 4, [COL.buyer]: '이' }),
      row({ [COL.code]: 'P4', [COL.name]: '펜', [COL.qty]: 1, [COL.buyer]: '박' }),
    ]
    const s = productSummary(rows, 3)
    // 주문건수 기준: 펜은 1개씩 두 사람(건수 2) → 1위
    const byBuyers = productSummary([...rows, row({ [COL.code]: 'P4', [COL.name]: '펜', [COL.qty]: 1, [COL.buyer]: '최' })], 30, 'buyers')
    expect(byBuyers.map((p) => [p.rank, p.name, p.buyers])[0]).toEqual([1, '펜', 2])
    expect(s.map((p) => [p.rank, p.name, p.qty, p.buyers])).toEqual([
      [1, '필통', 5, 1],
      [2, '자', 4, 1],
      [2, '풀', 4, 1],
    ])
    expect(centerHeader('2026-10-16', 2)).toBe('2026.10.16 주문서 2차')
  })
})

describe('센터주문서 열 너비', () => {
  it('정해 준 너비로 넣고 남는 폭은 상품명에, 한 쪽 폭을 넘지 않는다', () => {
    const base = OUTPUTS.find((o) => o.kind === 'warehouse')!.widths
    expect(base).toEqual([4, 11, 15.7, 36, 8.5, 4, 10])
    const w = centerWidths(base)
    expect(w.filter((_, i) => i !== 3)).toEqual([4, 11, 15.7, 8.5, 4, 10])
    expect(w[3]).toBeGreaterThan(36)
    const used = w.reduce((t, x) => t + colPx(x), 0)
    expect(used).toBeLessThanOrEqual(A4_PRINT_PX)
    expect(A4_PRINT_PX - used).toBeLessThan(7)
  })
})

describe('제주 배송메세지', () => {
  it('제주 주소: 보통은 제주도출고O, 핫트랙스·텐바이텐 주문은 제주도 확인', async () => {
    const { jejuNote } = await import('./logic')
    const jeju = { [COL.address]: '제주특별자치도 제주시 구산로 50' }
    expect(jejuNote(row({ ...jeju, [COL.mall]: '스마트스토어' }))).toBe('제주도출고O')
    expect(jejuNote(row({ ...jeju, [COL.mall]: '교보핫트랙스' }))).toBe('제주도 확인')
    expect(jejuNote(row({ ...jeju, [COL.mall]: '핫트렉스' }))).toBe('제주도 확인')
    expect(jejuNote(row({ ...jeju, [COL.mall]: '텐바이텐' }))).toBe('제주도 확인')
    expect(jejuNote(row({ [COL.mall]: '텐바이텐' }))).toBeNull()
  })
})
