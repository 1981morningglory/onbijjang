import { describe, expect, it } from 'vitest'
import { MALL_CODES, mallCode } from './mallCodes'

describe('쇼핑몰 코드', () => {
  it('거래처코드 파일 18곳이 그대로', () => {
    expect(Object.keys(MALL_CODES)).toHaveLength(18)
    expect(mallCode('11번가')).toBe('020188')
    expect(mallCode('교보핫트랙스')).toBe('003331')
    expect(mallCode('현대이지웰(신)')).toBe('022661')
    expect(mallCode('신세계몰(신)')).toBe('020522')
  })
  it('띄어쓰기·대소문자·(신) 표시·비슷한 이름도 맞춘다', () => {
    expect(mallCode(' 쿠팡 ')).toBe('019870')
    expect(mallCode('yes24')).toBe('015005')
    expect(mallCode('aliexpress')).toBe('027236')
    expect(mallCode('신세계몰')).toBe('020522')
    expect(mallCode('G마켓')).toBe('007035')
    expect(mallCode('e제너두')).toBe('023752')
  })
  it('모르는 곳·빈칸은 빈 코드', () => {
    expect(mallCode('옥션')).toBe('')
    expect(mallCode('')).toBe('')
    expect(mallCode(null)).toBe('')
  })
})
