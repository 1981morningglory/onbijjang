import { describe, expect, it } from 'vitest'
import { code128Bits, code128Values, ean13Bits, eanCheckDigit, fileBase, parseInput, topText } from './logic'

describe('EAN-13', () => {
  it('회사코드 뒤 5자리로 검증코드를 계산한다', () => {
    expect(eanCheckDigit('880123789039').digit).toBe(4)
    expect(eanCheckDigit('880123712345').digit).toBe(4)
    expect(eanCheckDigit('251266889840').digit).toBe(3)
  })
  it('95 모듈 패턴(시작·가운데·끝 가드)', () => {
    const bits = ean13Bits('8801237890394')
    expect(bits).toHaveLength(95)
    expect(bits.slice(0, 3)).toBe('101')
    expect(bits.slice(45, 50)).toBe('01010')
    expect(bits.slice(92)).toBe('101')
  })
})

describe('Code 128', () => {
  it('R + 숫자 12자리는 B 로 시작해 C 로 바꾼다', () => {
    expect(code128Values('R214508300002')).toEqual([104, 50, 99, 21, 45, 8, 30, 0, 2, 7, 106])
  })
  it('끝은 정지 패턴 + 종료 바', () => {
    expect(code128Bits('R214508300002').endsWith('1100011101011')).toBe(true)
  })
})

describe('입력 해석', () => {
  it('15099-89039 → 8801237890394, 맨 위 NO. 표기', () => {
    const [r] = parseInput('15099-89039', 'flat')
    expect(r.code).toBe('8801237890394')
    expect(r.no).toBe('15099-89039')
    expect(topText(r, 'flat', 'no', '', '')).toBe('NO.15099-89039')
  })
  it('여러 표기 방식을 같은 회사코드로 읽는다', () => {
    const rows = parseInput('NO.15099-89039\n1509989039\n15099 – 89039\n89039', 'long')
    expect(rows.map((r) => r.code)).toEqual(Array(4).fill('8801237890394'))
  })
  it('엑셀 붙여넣기: 제목 줄은 건너뛰고 열 순서와 무관', () => {
    const rows = parseInput('회사코드\t제품명\n하드커버 소\t15099-89039\n15099-89040\t스프링노트 중', 'flat')
    expect(rows[0].skip).toBe(true)
    expect(rows[1]).toMatchObject({ code: '8801237890394', name: '하드커버 소' })
    expect(rows[2]).toMatchObject({ code: '8801237890400', name: '스프링노트 중' })
    expect(fileBase(rows[1])).toBe('8801237890394_하드커버 소')
  })
  it('검증코드가 틀린 13자리는 오류, 앞자리 0 이 빠진 값은 보정', () => {
    const [bad, short] = parseInput('8801237890395\n123', 'flat')
    expect(bad.err).toContain('올바른 끝자리 4')
    expect(short.code).toBe('8801237001233')
    expect(short.warn).toContain('00123')
  })
  it('한 줄에 쉼표·공백으로 여러 개', () => {
    expect(parseInput('15099-89039, 15099-89040 89041', 'flat').map((r) => r.code)).toEqual(['8801237890394', '8801237890400', '8801237890417'])
  })
  it('공통 회사코드 앞 5자리 + 줄의 뒤 5자리', () => {
    const [r] = parseInput('89039', 'flat')
    expect(topText(r, 'flat', 'no', '', '15099')).toBe('NO.15099-89039')
  })
  it('쿠팡 R 값과 회사코드를 함께 붙여넣기', () => {
    const [r] = parseInput('R214508300002\t77000-20562', 'r')
    expect(r.code).toBe('R214508300002')
    expect(topText(r, 'r', 'no', '', '')).toBe('NO. 77000-20562')
  })
  it('쿠팡 R 에 한글이 섞이면 오류', () => {
    expect(parseInput('R2145가', 'r')[0].err).not.toBe('')
  })
})
