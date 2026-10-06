import { describe, expect, it } from 'vitest'
import { parsePathD, parseTransform } from './vector'

describe('QR 벡터 변환', () => {
  it('상대 좌표·H/V 를 절대 좌표로', () => {
    const s = parsePathD('M 10 10v 11h 11 z')
    expect(s).toEqual([{ t: 'M', p: [10, 10] }, { t: 'L', p: [10, 21] }, { t: 'L', p: [21, 21] }, { t: 'Z' }])
  })
  it('호(a)는 끝점이 정확한 베지어로', () => {
    const s = parsePathD('M 100 12 a 5.5 5.5, 0, 0, 0, -5.5 -5.5')
    const last = s.at(-1)!
    expect(last.t).toBe('C')
    if (last.t === 'C') expect(last.p).toEqual([94.5, 6.5])
  })
  it('rotate(각도, cx, cy) 는 중심을 그대로 둔다', () => {
    const m = parseTransform('rotate(90,105.5,17.5)')
    const x = m[0] * 105.5 + m[2] * 17.5 + m[4]
    const y = m[1] * 105.5 + m[3] * 17.5 + m[5]
    expect(x).toBeCloseTo(105.5)
    expect(y).toBeCloseTo(17.5)
  })
})
