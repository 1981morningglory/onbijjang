import { describe, expect, it } from 'vitest'
import { addRange, moveEdge, nextRangeName, rangeProblem, tickStep, tickTimes, timeAt, type ClipRange } from './ranges'

const range = (start: number, end: number, name = '구간 1'): ClipRange => ({ id: name, name, start, end, selected: true })

describe('구간 다루기', () => {
  it('이름은 겹치지 않게 번호를 붙인다', () => {
    expect(nextRangeName([])).toBe('구간 1')
    expect(nextRangeName([range(0, 1, '구간 1')])).toBe('구간 2')
    expect(nextRangeName([range(0, 1, '구간 2')])).toBe('구간 3')
    expect(nextRangeName([range(0, 1, '인트로'), range(1, 2, '구간 3')])).toBe('구간 4')
  })

  it('추가할 때 순서와 범위를 바로잡는다', () => {
    const list = addRange([], 12, 4, 10)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ start: 4, end: 10, name: '구간 1', selected: true })
    const two = addRange(list, 5, 5, 10)
    expect(two[1].end - two[1].start).toBeCloseTo(0.1)
    expect(two[1].id).not.toBe(two[0].id)
  })

  it('시작을 옮겨도 끝을 넘지 못한다', () => {
    expect(moveEdge(range(2, 5), 'start', 7, 10).start).toBe(4.9)
    expect(moveEdge(range(2, 5), 'start', -3, 10).start).toBe(0)
    expect(moveEdge(range(2, 5), 'start', 3.3333, 10).start).toBe(3.333)
  })

  it('끝을 옮겨도 시작 앞으로 가지 못하고 영상 길이를 넘지 못한다', () => {
    expect(moveEdge(range(2, 5), 'end', 1, 10).end).toBe(2.1)
    expect(moveEdge(range(2, 5), 'end', 99, 10).end).toBe(10)
    expect(moveEdge(range(2, 5), 'end', NaN, 10).end).toBe(5)
  })

  it('GIF·WebP 는 60초까지, MP4 는 제한 없음', () => {
    expect(rangeProblem(range(0, 60), 'gif')).toBeNull()
    expect(rangeProblem(range(0, 60.5), 'gif')).toContain('60초')
    expect(rangeProblem(range(0, 61), 'webp')).toContain('WebP')
    expect(rangeProblem(range(0, 1800), 'mp4')).toBeNull()
    expect(rangeProblem(range(3, 3.01), 'mp4')).toContain('짧습니다')
  })
})

describe('타임라인', () => {
  it('눈금 간격은 보이는 길이에 맞춘다', () => {
    expect(tickStep(10, 1)).toBe(2)
    expect(tickStep(60, 1)).toBe(10)
    expect(tickStep(3600, 1)).toBe(600)
    expect(tickStep(3600, 10)).toBe(60)
    expect(tickStep(4, 4)).toBe(0.5)
  })

  it('눈금 시각', () => {
    expect(tickTimes(10, 5)).toEqual([0, 5, 10])
    expect(tickTimes(9, 5)).toEqual([0, 5])
    expect(tickTimes(1, 0.5)).toEqual([0, 0.5, 1])
  })

  it('위치를 시각으로 바꾼다', () => {
    expect(timeAt(0.5, 120)).toBe(60)
    expect(timeAt(-1, 120)).toBe(0)
    expect(timeAt(2, 120)).toBe(120)
  })
})
